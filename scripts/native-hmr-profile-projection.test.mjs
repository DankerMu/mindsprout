import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCpuProfile, projectNextTrace } from './native-hmr-profile-projection.mjs';
import { cpu, span, secret, partial, noSecrets } from './native-hmr-profile-fixtures.mjs';

test('CPU projection retains only fixed categories and microsecond-relative buckets', () => {
  assert.deepEqual(projectCpuProfile(cpu()), {
    status: 'complete',
    codes: [],
    clock: {
      origin: 'unspecified-monotonic',
      unit: 'microseconds',
      start: 8000000000,
      end: 8001500000,
    },
    samples: 4,
    categories: { javascript: 2, gc: 1, idle: 1, other: 0 },
    buckets: [
      { second: 0, samples: 2 },
      { second: 1, samples: 2 },
    ],
  });
  const hostile = cpu();
  hostile.nodes[1].callFrame.functionName = '__proto__';
  hostile.nodes[1].callFrame.url = `https://example.invalid/${secret}`;
  noSecrets(projectCpuProfile(hostile));
});

test('zero microsecond sample deltas remain valid without inventing elapsed time', () => {
  const input = { ...cpu(), timeDeltas: [0, 0, 0, 0] };
  const result = projectCpuProfile(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.samples, 4);
  assert.deepEqual(result.buckets, [{ second: 0, samples: 4 }]);
});

test('interior signed CPU deltas preserve every sample in chronological histogram buckets', () => {
  const input = { ...cpu(), timeDeltas: [1000020, -42, 42, 499980] };
  assert.deepEqual(projectCpuProfile(input), {
    status: 'complete',
    codes: [],
    clock: {
      origin: 'unspecified-monotonic',
      unit: 'microseconds',
      start: 8000000000,
      end: 8001500000,
    },
    samples: 4,
    categories: { javascript: 2, gc: 1, idle: 1, other: 0 },
    buckets: [
      { second: 0, samples: 1 },
      { second: 1, samples: 3 },
    ],
  });
  assert.deepEqual(input.samples, [2, 3, 4, 2]);
  assert.deepEqual(input.timeDeltas, [1000020, -42, 42, 499980]);
});

test('trace projection parses every JSONL batch and distinguishes epoch from hrtime', () => {
  const input = `${JSON.stringify([span(), span({ name: secret })])}\n${JSON.stringify([
    span({ name: 'handle-request', tags: { url: '/' } }),
    span({ name: 'ensure-page', tags: { inputPage: '/api/healthz/route' } }),
    span({ name: 'render-path', tags: { page: `/unexpected/${secret}` } }),
  ])}\n`;
  assert.deepEqual(projectNextTrace(input), {
    status: 'complete',
    codes: [],
    coverage: 'observed-only',
    spans: [
      {
        name: 'compile-path',
        route: 'persisted-map',
        startTimeEpochMs: 1794823200000,
        timestampHrtimeUs: 4105188000000,
        durationUs: 125000,
      },
      {
        name: 'handle-request',
        route: 'home',
        startTimeEpochMs: 1794823200000,
        timestampHrtimeUs: 4105188000000,
        durationUs: 125000,
      },
      {
        name: 'ensure-page',
        route: 'health',
        startTimeEpochMs: 1794823200000,
        timestampHrtimeUs: 4105188000000,
        durationUs: 125000,
      },
      {
        name: 'render-path',
        route: 'other',
        startTimeEpochMs: 1794823200000,
        timestampHrtimeUs: 4105188000000,
        durationUs: 125000,
      },
    ],
  });
});

test('empty, malformed and nonfinite profiles never become empty success', () => {
  for (const input of [
    null,
    {},
    { ...cpu(), samples: [] },
    { ...cpu(), timeDeltas: [-1, 1, 1, 1] },
    { ...cpu(), timeDeltas: [NaN, 1, 1, 1] },
    { ...cpu(), samples: [999] },
    { ...cpu(), endTime: Infinity },
    { ...cpu(), endTime: 1 },
  ]) {
    assert.equal(projectCpuProfile(input).status, 'partial');
    noSecrets(projectCpuProfile(input));
  }
  for (const input of [
    '',
    '[]\n',
    `${secret}{`,
    `${JSON.stringify([span()])}\n[`,
    JSON.stringify([span({ duration: -1 })]),
    JSON.stringify([span({ startTime: secret })]),
  ]) {
    assert.equal(projectNextTrace(input).status, 'partial');
    noSecrets(projectNextTrace(input));
  }
});

test('CPU node, sample and time-bucket caps accept the boundary but not cap plus one', () => {
  const nodeProfile = (count) => ({
    nodes: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      callFrame: { functionName: '', url: '' },
    })),
    startTime: 0,
    endTime: 1,
    samples: [count],
    timeDeltas: [1],
  });
  assert.equal(projectCpuProfile(nodeProfile(50000)).status, 'complete');
  partial(projectCpuProfile(nodeProfile(50001)), 'node-limit');
  const samples = (count) => ({
    ...cpu(),
    startTime: 0,
    endTime: count,
    samples: Array(count).fill(2),
    timeDeltas: Array(count).fill(1),
  });
  assert.equal(projectCpuProfile(samples(250000)).status, 'complete');
  partial(projectCpuProfile(samples(250001)), 'sample-limit');
  const buckets = (count) => ({
    ...cpu(),
    startTime: 0,
    endTime: count * 1000000,
    samples: Array(count).fill(2),
    timeDeltas: [1, ...Array(count - 1).fill(1000000)],
  });
  assert.equal(projectCpuProfile(buckets(300)).status, 'complete');
  partial(projectCpuProfile(buckets(301)), 'bucket-limit');
});

test('trace record and accepted-span caps cannot silently truncate complete evidence', () => {
  const records = (count) =>
    JSON.stringify([
      span(),
      ...Array.from({ length: count - 1 }, () => span({ name: 'unselected' })),
    ]);
  assert.equal(projectNextTrace(records(20000)).status, 'complete');
  partial(projectNextTrace(records(20001)), 'trace-record-limit');
  assert.equal(
    projectNextTrace(JSON.stringify(Array.from({ length: 2000 }, () => span()))).status,
    'complete',
  );
  partial(
    projectNextTrace(JSON.stringify(Array.from({ length: 2001 }, () => span()))),
    'trace-span-limit',
  );
});
for (const [name, field, routes] of [
  [
    'compile-path',
    'trigger',
    [
      ['/', 'home'],
      ['/maps/[id]', 'persisted-map'],
      ['/api/healthz', 'health'],
    ],
  ],
  [
    'ensure-page',
    'inputPage',
    [
      ['/page', 'home'],
      ['/maps/[id]/page', 'persisted-map'],
      ['/api/healthz/route', 'health'],
    ],
  ],
]) {
  test(`${name} classifies the installed Next producer's ${field} without exposing tags`, () => {
    const inputs = [
      ...routes,
      [`/unknown/${secret}`, 'other'],
      ['__proto__', 'other'],
      [{ private: secret }, 'other'],
    ];
    const raw = inputs.map(([route]) =>
      span({
        name,
        tags: { [field]: route, page: '/misleading', cookie: secret, [secret]: 42 },
      }),
    );
    const projected = projectNextTrace(JSON.stringify(raw));
    assert.deepEqual(projected, {
      status: 'complete',
      codes: [],
      coverage: 'observed-only',
      spans: inputs.map(([, route]) => ({
        name,
        route,
        startTimeEpochMs: 1794823200000,
        timestampHrtimeUs: 4105188000000,
        durationUs: 125000,
      })),
    });
    noSecrets(projected);
  });
}
