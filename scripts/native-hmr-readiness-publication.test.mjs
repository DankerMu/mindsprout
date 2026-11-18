import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { collector, noSecrets, secret } from './native-hmr-profile-fixtures.mjs';

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
