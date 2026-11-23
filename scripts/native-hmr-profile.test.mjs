import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseNativeBrowserArgs, selectNativeDiagnostic } from './native-hmr-profile.mjs';
import { secret, temporary, noSecrets } from './native-hmr-profile-fixtures.mjs';

const ambientVariables = [
  'NEXT_CPU_PROF',
  'NEXT_CPU_PROF_DIR',
  '__NEXT_PRIVATE_CPU_PROFILE',
  'NEXT_TURBOPACK_TRACING',
  'NEXT_TURBOPACK_TRACING_PATH',
];

for (const mode of ['restored-lifecycle', 'source-change']) {
  test(`${mode} accepts installed and candidate invocations with only a trailing opt-in`, () => {
    for (const candidate of [undefined, 'candidate.json']) {
      for (const enabled of [false, true]) {
        const args = [
          mode,
          'fresh-output',
          ...(candidate ? [candidate] : []),
          ...(enabled ? ['--profile'] : []),
        ];
        assert.deepEqual(parseNativeBrowserArgs(args, {}), {
          mode,
          output: 'fresh-output',
          candidateManifest: candidate,
          profile: enabled,
        });
      }
    }
  });
}

test('ambiguous CLI input is rejected without echoing any argument', () => {
  for (const args of [
    [],
    ['unknown', secret],
    ['source-change'],
    ['--profile', 'source-change', secret],
    ['source-change', '--profile'],
    ['source-change', secret, '--profile', 'candidate.json'],
    ['source-change', secret, '--profile', '--profile'],
    ['source-change', secret, '--unknown'],
    ['source-change', secret, 'candidate.json', 'surplus'],
    ['source-change', secret, 'candidate.json', '--profile', 'surplus'],
  ]) {
    assert.throws(
      () => parseNativeBrowserArgs(args, {}),
      (error) => {
        assert.equal(error.code, 'invalid-arguments');
        noSecrets({ message: error.message, stack: error.stack, cause: error.cause });
        return true;
      },
    );
  }
});

for (const variable of ambientVariables) {
  test(`ambient ${variable} is refused even when empty in default and profiled modes`, () => {
    for (const value of ['', secret]) {
      for (const args of [
        ['source-change', 'output'],
        ['source-change', 'output', '--profile'],
      ]) {
        assert.throws(
          () => parseNativeBrowserArgs(args, { [variable]: value }),
          (error) => {
            assert.equal(error.code, 'ambient-profiling');
            noSecrets({ message: error.message, stack: error.stack, cause: error.cause });
            return true;
          },
        );
      }
    }
  });
}

function failureEvent(phase, generation = 0, trial = 0) {
  return {
    at: 1794823201000,
    ms: 1000,
    phase,
    generation,
    trial,
    page: 'collector',
    type: 'failure',
    data: { message: secret, stack: secret },
  };
}

function resumedEvent(generation = 2, trial = 2) {
  return {
    at: 1794823200900,
    ms: 900,
    phase: 'restart-observation',
    generation,
    trial,
    page: 'collector',
    type: 'browser-resumed',
    data: { pid: 4321 },
  };
}

function diagnosticFixture(t, mode = 'restored-lifecycle') {
  const root = temporary(t);
  const source = path.join(root, 'source.tsx');
  fs.writeFileSync(source, 'original source');
  const sourceHash = createHash('sha256').update('original source').digest('hex');
  const evidenceDirectory = path.join(root, 'qualification');
  fs.mkdirSync(evidenceDirectory);
  const cleanup = {
    errors: [],
    sourceRestored: true,
    cacheRestored: true,
    sourceHash,
    expectedSourceHash: sourceHash,
  };
  const result = {
    mode,
    status: 'failed',
    failures: ['original failure'],
    cleanup,
    events: [failureEvent('public-map-setup')],
  };
  const save = () => {
    fs.writeFileSync(path.join(evidenceDirectory, 'result.json'), JSON.stringify(result));
    fs.writeFileSync(path.join(evidenceDirectory, 'cleanup.json'), JSON.stringify(cleanup));
  };
  save();
  const input = {
    platform: 'darwin',
    cancelled: false,
    outcomes:
      mode === 'restored-lifecycle'
        ? { restored: 'failure', source: 'skipped' }
        : { restored: 'success', source: 'failure' },
    evidenceDirectory,
    source,
  };
  return { source, evidenceDirectory, cleanup, result, save, input };
}

for (const mode of ['restored-lifecycle', 'source-change']) {
  test(`verified failed ${mode} evidence selects exactly its diagnostic without rewriting qualification`, (t) => {
    const fixture = diagnosticFixture(t, mode);
    const resultPath = path.join(fixture.evidenceDirectory, 'result.json');
    const before = fs.readFileSync(resultPath);
    assert.deepEqual(selectNativeDiagnostic(fixture.input), { eligible: true, mode, code: null });
    assert.deepEqual(fs.readFileSync(resultPath), before);
    assert.equal(JSON.parse(before).status, 'failed');
  });
}

test('selector keeps the legacy record cap plus one valid first-create envelope', (t) => {
  const fixture = diagnosticFixture(t);
  const failure = failureEvent('public-map-setup');
  const evidence = {
    ...failure,
    type: 'public-create-evidence',
    page: 'retained-editor',
    data: { attempt: 1 },
  };
  const legacy = [...Array(19_999).fill({ type: 'browser-request' }), failure];
  for (const [name, events, eligible] of [
    ['legacy boundary', legacy, true],
    ['additive evidence', [...legacy, evidence], true],
    ['arbitrary extra event', [...legacy, { type: 'extra' }], false],
    ['excess legacy and evidence', [...legacy, { type: 'extra' }, evidence], false],
    ['duplicate evidence', [failure, evidence, evidence], false],
    ['malformed extra evidence', [...legacy, { ...evidence, page: 'collector' }], false],
    ['malformed evidence within legacy cap', [failure, { type: evidence.type }], false],
  ]) {
    fixture.result.events = events;
    fixture.save();
    assert.deepEqual(
      selectNativeDiagnostic(fixture.input),
      eligible
        ? { eligible: true, mode: 'restored-lifecycle', code: null }
        : { eligible: false, mode: null, code: 'non-browser-failure' },
      name,
    );
  }
});

const capFailure = failureEvent('public-map-setup');
const createEvidence = {
  ...capFailure,
  type: 'public-create-evidence',
  page: 'retained-editor',
  data: { attempt: 1 },
};
const publicationNotice = {
  ...createEvidence,
  type: 'public-create-observation-error',
  data: { stage: 'publication', message: 'Public-create evidence publication failed' },
};
const capLegacy = [...Array(19_999).fill({ type: 'browser-request' }), capFailure];

test('selector allows one paired publication notice beyond the legacy cap, even without JSONL', (t) => {
  const fixture = diagnosticFixture(t);
  fixture.result.events = [...capLegacy, createEvidence, publicationNotice];
  fixture.save();
  assert.deepEqual(selectNativeDiagnostic(fixture.input), {
    eligible: true,
    mode: 'restored-lifecycle',
    code: null,
  });
});

for (const [name, events] of [
  ['unpaired notice', [capFailure, publicationNotice]],
  ['duplicate notices', [capFailure, createEvidence, publicationNotice, publicationNotice]],
  ['wrong phase notice', [capFailure, createEvidence, { ...publicationNotice, phase: 'cleanup' }]],
  ['wrong page notice', [capFailure, createEvidence, { ...publicationNotice, page: 'collector' }]],
  [
    'wrong generation notice',
    [capFailure, createEvidence, { ...publicationNotice, generation: 1 }],
  ],
  ['wrong trial notice', [capFailure, createEvidence, { ...publicationNotice, trial: 1 }]],
  ['invalid clock notice', [capFailure, createEvidence, { ...publicationNotice, at: null }]],
  ['missing data', [capFailure, createEvidence, { ...publicationNotice, data: null }]],
  [
    'extra data field',
    [
      capFailure,
      createEvidence,
      { ...publicationNotice, data: { ...publicationNotice.data, details: secret } },
    ],
  ],
  [
    'wrong notice message',
    [
      capFailure,
      createEvidence,
      { ...publicationNotice, data: { ...publicationNotice.data, message: secret } },
    ],
  ],
  [
    'unrelated observation error',
    [
      capFailure,
      createEvidence,
      { ...publicationNotice, data: { ...publicationNotice.data, stage: 'before' } },
    ],
  ],
  [
    'over-cap legacy with notice and no evidence',
    [...capLegacy, { type: 'extra' }, publicationNotice],
  ],
  ['duplicate evidence at total cap', [...capLegacy, createEvidence, createEvidence]],
  ['arbitrary extra event at total cap', [...capLegacy, createEvidence, { type: 'extra' }]],
  ['total cap plus one', [...capLegacy, createEvidence, publicationNotice, { type: 'extra' }]],
]) {
  test(`selector rejects publication accounting: ${name}`, (t) => {
    const fixture = diagnosticFixture(t);
    fixture.result.events = events;
    fixture.save();
    assert.deepEqual(selectNativeDiagnostic(fixture.input), {
      eligible: false,
      mode: null,
      code: 'non-browser-failure',
    });
  });
}

test('success, Linux, cancellation and installation failures cannot select a diagnostic', (t) => {
  const { input } = diagnosticFixture(t);
  for (const changes of [
    { platform: 'linux' },
    { cancelled: true },
    { outcomes: { restored: 'success', source: 'success' } },
    { outcomes: { restored: 'skipped', source: 'skipped' } },
    { outcomes: { restored: 'cancelled', source: 'skipped' } },
  ]) {
    const result = selectNativeDiagnostic({ ...input, ...changes });
    assert.equal(result.eligible, false);
    assert.equal(result.mode, null);
    noSecrets(result);
  }
});

function damageQualification(fixture, defect) {
  if (defect === 'cleanup-errors') fixture.cleanup.errors.push(secret);
  if (defect === 'cache-owned') fixture.cleanup.cacheRestored = false;
  if (defect === 'source-owned') fixture.cleanup.sourceRestored = false;
  if (defect === 'hash-mismatch') fixture.cleanup.sourceHash = 'e'.repeat(64);
  if (defect === 'current-source') fs.writeFileSync(fixture.source, secret);
  if (defect === 'mode-mismatch') fixture.result.mode = 'source-change';
  if (defect === 'passed') fixture.result.status = 'passed';
}

test('missing, malformed, cleanup-blocked and changed-source evidence is ineligible', (t) => {
  for (const defect of [
    'missing',
    'malformed',
    'cleanup-errors',
    'cache-owned',
    'source-owned',
    'hash-mismatch',
    'current-source',
    'mode-mismatch',
    'passed',
  ]) {
    const fixture = diagnosticFixture(t);
    damageQualification(fixture, defect);
    fixture.save();
    if (defect === 'missing') fs.unlinkSync(path.join(fixture.evidenceDirectory, 'cleanup.json'));
    if (defect === 'malformed')
      fs.writeFileSync(path.join(fixture.evidenceDirectory, 'result.json'), secret);
    const result = selectNativeDiagnostic(fixture.input);
    assert.equal(result.eligible, false, defect);
    assert.equal(result.mode, null);
    noSecrets(result);
  }
});

test('cleanup-blocked or disagreeing cleanup evidence cannot authorize a replay', (t) => {
  for (const defect of ['cleanup-blocked', 'disagreement', 'symlink']) {
    const fixture = diagnosticFixture(t);
    if (defect === 'cleanup-blocked') fixture.result.status = 'cleanup-blocked';
    fixture.save();
    const cleanupPath = path.join(fixture.evidenceDirectory, 'cleanup.json');
    if (defect === 'disagreement') {
      fs.writeFileSync(cleanupPath, JSON.stringify({ ...fixture.cleanup, cacheRestored: false }));
    }
    if (defect === 'symlink') {
      const target = path.join(fixture.evidenceDirectory, 'unowned.json');
      fs.renameSync(cleanupPath, target);
      fs.symlinkSync(target, cleanupPath);
    }
    const result = selectNativeDiagnostic(fixture.input);
    assert.equal(result.eligible, false);
    assert.equal(result.mode, null);
  }
});

test('setup and unproven restart failures cannot become browser diagnostic replays', (t) => {
  for (const [scenario, events] of [
    ['initial setup', [failureEvent('setup')]],
    ['missing events', undefined],
    ['empty events', []],
    ['malformed event', [null]],
    ['unknown phase', [failureEvent(secret)]],
    ['restart before resume', [failureEvent('restart-observation', 2, 2)]],
    [
      'previous generation resumed',
      [resumedEvent(1, 2), failureEvent('restart-observation', 2, 2)],
    ],
    ['different trial resumed', [resumedEvent(2, 1), failureEvent('restart-observation', 2, 2)]],
    [
      'cleanup resumed after failure',
      [
        failureEvent('restart-observation', 2, 2),
        { ...resumedEvent(), at: 1794823201100, ms: 1100, phase: 'cleanup' },
      ],
    ],
  ]) {
    const fixture = diagnosticFixture(t);
    fixture.result.events = events;
    fixture.save();
    const result = selectNativeDiagnostic(fixture.input);
    assert.deepEqual(
      result,
      { eligible: false, mode: null, code: 'non-browser-failure' },
      scenario,
    );
    noSecrets(result);
  }
});

test('actual navigation phases remain eligible without inspecting exception text', (t) => {
  for (const phase of [
    'public-map-setup',
    'retained-document-setup',
    'source-preparation',
    'source-observation',
    'spa-preparation',
  ]) {
    const fixture = diagnosticFixture(t);
    fixture.result.events = [failureEvent(phase)];
    fixture.save();
    assert.deepEqual(selectNativeDiagnostic(fixture.input), {
      eligible: true,
      mode: 'restored-lifecycle',
      code: null,
    });
  }
});

test('restart navigation is eligible only after its own generation and trial resumed', (t) => {
  const fixture = diagnosticFixture(t);
  fixture.result.events = [resumedEvent(), failureEvent('restart-observation', 2, 2)];
  fixture.save();
  assert.deepEqual(selectNativeDiagnostic(fixture.input), {
    eligible: true,
    mode: 'restored-lifecycle',
    code: null,
  });
});
