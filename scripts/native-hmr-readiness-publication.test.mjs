import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  browserFixture,
  collector,
  generation,
  generationFiles,
  identity,
  noSecrets,
  secret,
  span,
} from './native-hmr-profile-fixtures.mjs';

function publicCreate() {
  return {
    mode: 'source-change',
    generation: 0,
    trial: 0,
    page: 'retained-editor',
    budget: {
      start: { epochMs: 1800000001000, elapsedMs: 1000 },
      deadline: { epochMs: 1800000006000, elapsedMs: 6000 },
    },
    action: { status: 'fulfilled', at: { epochMs: 1800000001100, elapsedMs: 1100 } },
    outcome: { status: 'ready', at: { epochMs: 1800000002000, elapsedMs: 2000 } },
    status: 'complete',
    codes: [],
    omittedRequests: 0,
    requests: [
      {
        ordinal: 1,
        requestClass: 'map-put',
        method: 'PUT',
        requestTimestampSeconds: 10,
        responseStatus: 204,
        completion: 'finished',
      },
    ],
    marker: {
      status: 'complete',
      codes: [],
      omittedSamples: 0,
      shutdown: 'stopped',
      samples: [
        {
          ordinal: 1,
          presence: 'present',
          visibility: 'visible',
          route: 'editor',
          browser: { timeOriginMs: 1800000000000, nowMs: 50 },
          receipt: { epochMs: 1800000001050, elapsedMs: 1050, phase: 'observing' },
        },
      ],
    },
    routes: {
      status: 'complete',
      codes: [],
      omittedRecords: 0,
      observations: [
        {
          ordinal: 1,
          route: 'editor',
          receipt: { epochMs: 1800000001040, elapsedMs: 1040, phase: 'observing' },
        },
      ],
    },
  };
}

const invalidCases = [
  [
    'missing-budget',
    (value) => {
      value.budget.deadline = undefined;
    },
  ],
  [
    'invalid-provenance',
    (value) => {
      value.mode = secret;
      value.page = secret;
      value.generation = -1;
    },
  ],
  [
    'unknown-outcome',
    (value) => {
      value.outcome = { status: secret, error: secret };
    },
  ],
  [
    'fractional-omissions',
    (value) => {
      value.omittedRequests = 1.5;
      value.marker.omittedSamples = 1.5;
      value.routes.omittedRecords = 1.5;
    },
  ],
  [
    'negative-omissions',
    (value) => {
      value.omittedRequests = -1;
      value.marker.omittedSamples = -1;
      value.routes.omittedRecords = -1;
    },
  ],
  [
    'nonfinite-omissions',
    (value) => {
      value.omittedRequests = Infinity;
      value.marker.omittedSamples = NaN;
      value.routes.omittedRecords = Infinity;
    },
  ],
];

for (const [name, mutate] of invalidCases) {
  test(`safe public-create publication marks ${name} incomplete rather than complete evidence`, async (t) => {
    const { output, value } = collector(t);
    value.prepare();
    const input = publicCreate();
    mutate(input);
    value.addPublicCreate(input);
    await value.finish();
    const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
    assert.equal(summary.publicCreate.status, 'partial');
    assert(summary.publicCreate.codes.includes('malformed-create-observation'));
    if (name.endsWith('omissions')) {
      assert.deepEqual(
        [
          summary.publicCreate.network.omittedRequests,
          summary.publicCreate.marker.omittedSamples,
          summary.publicCreate.routes.omittedRecords,
        ],
        [null, null, null],
      );
    }
    noSecrets(summary);
  });
}

test('safe publication rejects absent-but-visible marker input before deriving a first-visible bracket', async (t) => {
  const { output, value } = collector(t);
  value.prepare();
  const input = publicCreate();
  input.marker.samples[0].presence = 'absent';
  input.marker.samples[0].text = secret;
  input.marker.firstVisible = { at: { timeOriginMs: 1800000000000, nowMs: 50 }, error: secret };
  value.addPublicCreate(input);
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.deepEqual(summary.publicCreate.marker.samples, []);
  assert.equal(summary.publicCreate.marker.firstVisible, null);
  assert.equal(summary.publicCreate.marker.status, 'partial');
  assert(summary.publicCreate.marker.codes.includes('invalid-marker-sample'));
  noSecrets(summary);
});

test('safe projection counts each request route and marker record omitted at cap plus one', async (t) => {
  const { output, value } = collector(t, { identity: { ...identity(), mode: 'source-change' } });
  value.prepare();
  const input = publicCreate();
  input.requests = Array.from({ length: 65 }, (_, index) => ({
    ...input.requests[0],
    ordinal: index + 1,
  }));
  input.routes.observations = Array.from({ length: 17 }, (_, index) => ({
    ...input.routes.observations[0],
    ordinal: index + 1,
  }));
  input.marker.samples = Array.from({ length: 129 }, (_, index) => ({
    ...input.marker.samples[0],
    ordinal: index + 1,
    browser: { timeOriginMs: 1800000000000, nowMs: (index + 1) * 50 },
  }));
  value.addPublicCreate(input);
  await value.finish();
  const evidence = JSON.parse(
    fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'),
  ).publicCreate;
  assert.deepEqual(
    [
      evidence.network.requests.length,
      evidence.routes.observations.length,
      evidence.marker.samples.length,
    ],
    [64, 16, 128],
  );
  assert.deepEqual(
    [
      evidence.network.omittedRequests,
      evidence.routes.omittedRecords,
      evidence.marker.omittedSamples,
    ],
    [1, 1, 1],
  );
  assert(evidence.network.codes.includes('request-limit'));
  assert(evidence.routes.codes.includes('route-limit'));
  assert(evidence.marker.codes.includes('sample-limit'));
  noSecrets(evidence);
});

async function existingProfileEvidence(repo, value, compact) {
  const trace = JSON.stringify(Array.from({ length: compact ? 2000 : 1 }, () => span()));
  for (let index = 0; index < (compact ? 5 : 1); index++) {
    generationFiles(repo, { trace });
    await value.collectServer(generation(index));
  }
  const browser = browserFixture({
    context: { generation: 0, trial: 0, page: 'retained-editor' },
    onInterval: value.addBrowserInterval,
    onGap: value.addBrowserGap,
    reserve: value.reserveBrowserInterval,
  });
  await browser.profiler.start();
  browser.advance(100);
  await browser.profiler.suspend();
  browser.profiler.paused();
  browser.advance(250);
  await browser.profiler.resume(false);
  await browser.profiler.close();
}

for (const form of ['full', 'compact', 'compact-unknown-counts']) {
  test(`${form} real safe file preserves public-create essentials alongside CPU trace and suspension evidence`, async (t) => {
    const { repo, output, value } = collector(t, {
      identity: { ...identity(), mode: 'source-change' },
    });
    value.prepare();
    const compact = form !== 'full';
    await existingProfileEvidence(repo, value, compact);
    const input = publicCreate();
    if (form === 'compact-unknown-counts') {
      input.omittedRequests = NaN;
      input.marker.omittedSamples = NaN;
      input.routes.omittedRecords = NaN;
    }
    value.addPublicCreate(input);
    await value.finish();
    const bytes = fs.readFileSync(path.join(output, 'safe/summary.json'));
    assert(bytes.length <= 1024 * 1024);
    const summary = JSON.parse(bytes);
    assert.equal(summary.codes.includes('summary-too-large'), compact);
    assert.deepEqual(summary.gaps, [
      {
        generation: 0,
        trial: 0,
        page: 'retained-editor',
        fromElapsedMs: 100,
        toElapsedMs: 350,
        reason: 'browser-suspended',
      },
    ]);
    assert.deepEqual(
      summary.generations[0].cpu.map((entry) => entry.role),
      ['dev-main', 'dev-server'],
    );
    if (compact) {
      assert(summary.generations[0].trace.codes.includes('summary-too-large'));
      assert(summary.generations[0].cpu[0].codes.includes('summary-too-large'));
      assert(summary.intervals[0].codes.includes('summary-too-large'));
    } else {
      assert.equal(summary.generations[0].cpu[0].samples, 4);
      assert.equal(summary.generations[0].trace.spans[0].name, 'compile-path');
      assert.equal(summary.intervals[0].cpu.samples, 4);
    }
    const evidence = summary.publicCreate;
    assert.deepEqual(
      ['attempt', 'mode', 'generation', 'trial', 'page'].map((key) => evidence[key]),
      [1, 'source-change', 0, 0, 'retained-editor'],
    );
    assert.deepEqual(evidence.budget, {
      start: { epochMs: 1800000001000, elapsedMs: 1000 },
      deadline: { epochMs: 1800000006000, elapsedMs: 6000 },
    });
    assert.deepEqual(evidence.action, {
      status: 'fulfilled',
      at: { epochMs: 1800000001100, elapsedMs: 1100 },
    });
    assert.deepEqual(evidence.outcome, {
      status: 'ready',
      at: { epochMs: 1800000002000, elapsedMs: 2000 },
    });
    assert.deepEqual(evidence.marker.firstVisible, {
      at: { timeOriginMs: 1800000000000, nowMs: 50 },
      previous: null,
    });
    const count = form === 'compact-unknown-counts' ? null : Number(compact);
    assert.deepEqual(
      [
        evidence.network.omittedRequests,
        evidence.marker.omittedSamples,
        evidence.routes.omittedRecords,
      ],
      [count, count, count],
    );
    assert.deepEqual(
      [
        evidence.network.requests.length,
        evidence.marker.samples.length,
        evidence.routes.observations.length,
      ],
      compact ? [0, 0, 0] : [1, 1, 1],
    );
    noSecrets(summary);
    assert.deepEqual(fs.readdirSync(path.join(output, 'safe')), ['summary.json']);
  });
}

test('public-create publication preserves a foreign safe summary instead of using raw fallback', async (t) => {
  const { repo, output, value } = collector(t);
  value.prepare();
  value.addPublicCreate(publicCreate());
  const foreign = path.join(repo, 'foreign-summary');
  fs.writeFileSync(foreign, secret);
  fs.mkdirSync(path.join(output, 'safe'));
  const destination = path.join(output, 'safe/summary.json');
  fs.symlinkSync(foreign, destination);
  const before = fs.lstatSync(destination);
  const result = await value.finish();
  assert(result.codes.includes('safe-output-conflict'));
  assert.equal(fs.readFileSync(foreign, 'utf8'), secret);
  assert.equal(fs.lstatSync(destination).ino, before.ino);
  assert.deepEqual(fs.readdirSync(path.join(output, 'safe')), ['summary.json']);
});

test('a public-create mode from another invocation is partial without silently rewriting its attribution', async (t) => {
  const { output, value } = collector(t);
  value.prepare();
  value.addPublicCreate(publicCreate());
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.identity.mode, 'restored-lifecycle');
  assert.equal(summary.publicCreate.mode, 'source-change');
  assert.equal(summary.publicCreate.status, 'partial');
  assert(summary.publicCreate.codes.includes('create-provenance-mismatch'));
  noSecrets(summary);
});
