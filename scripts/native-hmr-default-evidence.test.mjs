import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { observeEditorVisit, observeNavigation } from './native-hmr-observation.mjs';
import { deferred, noSecrets, temporary } from './native-hmr-profile-fixtures.mjs';
import { capturePage, publicMap } from './native-hmr-support.mjs';

const origin = 'http://localhost:3000';
const canary = 'PRIVATE_CANARY_default';

function defaultAttempt() {
  const events = [];
  const commands = [];
  const cdp = new EventEmitter();
  const frame = { id: `${canary}-frame` };
  cdp.send = async (method) => {
    commands.push(method);
    return method === 'Page.getFrameTree' ? { frameTree: { frame } } : { metrics: [] };
  };
  let terminal;
  const page = {
    url: () => `${origin}/maps/${canary}`,
    isClosed: () => terminal === 'cdp-disconnected',
    content: async () => '<div data-testid="map-editor-ready"></div>',
    screenshot: async ({ path: filename }) => fs.writeFileSync(filename, 'screenshot bytes'),
    getByText: () => ({ count: async () => 0 }),
  };
  const state = { page, cdp, label: 'retained-editor' };
  const context = { generation: 0, trial: 0 };
  const clock = { at: 100_100, ms: 100 };
  const now = () => ({ ...clock });
  const observation = observeNavigation(
    state,
    (type, data, page) => events.push(JSON.parse(JSON.stringify({ type, data, page }))),
    undefined,
    {
      origin,
      now,
      mode: 'restored-lifecycle',
      context: () => context,
      interrupted: () => terminal === 'interrupted',
    },
  );
  state.navigationObservation = observation;
  const visit = (action, readiness, expectedPath, guard = (promise) => promise) =>
    observeEditorVisit(state, action, expectedPath, { guard, readiness, now });
  const request = (index, at = 1) =>
    cdp.emit('Network.requestWillBeSent', {
      requestId: `${canary}-${index}`,
      loaderId: `${canary}-loader`,
      timestamp: at,
      type: 'Script',
      request: {
        method: 'GET',
        url: `${origin}/${canary}?token=${canary}`,
        postData: canary,
        headers: { cookie: canary },
      },
    });
  const evidenceEvents = () => events.filter(({ type }) => type === 'public-create-evidence');
  const evidence = () => {
    assert.equal(
      evidenceEvents().length,
      1,
      'the default attempt publishes exactly one safe event',
    );
    const [entry] = evidenceEvents();
    assert.equal(entry.page, 'retained-editor');
    noSecrets(entry);
    return entry.data;
  };
  return {
    cdp,
    commands,
    context,
    clock,
    state,
    frame,
    events,
    observation,
    request,
    visit,
    evidence,
    evidenceEvents,
    terminate: (code) => {
      terminal = code;
    },
  };
}

const provenance = {
  attempt: 1,
  mode: 'restored-lifecycle',
  generation: 0,
  trial: 0,
  page: 'retained-editor',
};
const budget = {
  start: { epochMs: 100_100, elapsedMs: 100 },
  deadline: { epochMs: 105_100, elapsedMs: 5100 },
};
const missingMarker = {
  status: 'partial',
  codes: ['missing-marker-observation'],
  samples: [],
  omittedSamples: 0,
};
const missingRoutes = {
  status: 'partial',
  codes: ['missing-route-observation'],
  observations: [],
  omittedRecords: 0,
};

test('the default observer publishes a fixed ready attempt without changing legacy events or CDP work', async () => {
  const { cdp, commands, clock, context, events, observation, request, visit, evidence } =
    defaultAttempt();
  assert.deepEqual(cdp.eventNames(), [
    'Network.requestWillBeSent',
    'Network.responseReceived',
    'Network.dataReceived',
    'Network.loadingFinished',
    'Network.loadingFailed',
  ]);
  for (const event of cdp.eventNames()) assert.equal(cdp.listenerCount(event), 1);
  const send = cdp.send;
  cdp.send = (method) => {
    if (!commands.length) {
      request('armed');
      Object.assign(context, { generation: 1, trial: 1 });
    }
    return send(method);
  };
  await visit(
    async () => {
      request('observed');
      clock.at = 100_125;
      clock.ms = 125;
    },
    async () => {
      clock.at = 100_150;
      clock.ms = 150;
    },
  );
  assert.deepEqual(evidence(), {
    ...provenance,
    budget,
    status: 'partial',
    codes: ['missing-marker-observation', 'missing-route-observation'],
    action: { status: 'fulfilled', at: { epochMs: 100_125, elapsedMs: 125 } },
    outcome: { status: 'ready', at: { epochMs: 100_150, elapsedMs: 150 } },
    marker: missingMarker,
    routes: missingRoutes,
    network: {
      status: 'complete',
      codes: [],
      omittedRequests: 0,
      requests: [
        {
          ordinal: 1,
          requestClass: 'script',
          method: 'GET',
          completion: 'unavailable',
          requestTimestampSeconds: 1,
          responseTimestampSeconds: null,
          firstDataTimestampSeconds: null,
          lastDataTimestampSeconds: null,
          completionTimestampSeconds: null,
          redirectTimestampSeconds: null,
          responseStatus: null,
          packets: 0,
          dataLength: 0,
          encodedDataLength: 0,
          completionEncodedDataLength: null,
          requestReceipt: { epochMs: 100_100, elapsedMs: 100, phase: 'observing' },
          responseReceipt: { epochMs: null, elapsedMs: null, phase: 'unavailable' },
          completionReceipt: { epochMs: null, elapsedMs: null, phase: 'unavailable' },
          redirectReceipt: { epochMs: null, elapsedMs: null, phase: 'unavailable' },
        },
      ],
    },
  });
  assert.deepEqual(commands, ['Performance.getMetrics', 'Performance.getMetrics']);
  assert.deepEqual(
    events.filter(({ type }) => ['public-create-outcome', 'public-create-network'].includes(type)),
    [
      { type: 'public-create-outcome', page: 'retained-editor', data: {} },
      {
        type: 'public-create-network',
        page: 'retained-editor',
        data: {
          omittedRequests: 0,
          requests: [
            {
              requestId: `${canary}-observed`,
              url: `${origin}/${canary}?token=${canary}`,
              type: 'Script',
              requestTimestamp: 1,
              loaderId: `${canary}-loader`,
              packets: 0,
              dataLength: 0,
              encodedDataLength: 0,
            },
          ],
        },
      },
    ],
  );
  request('second-navigation');
  observation.outcome('action-failed', clock);
  await visit(
    async () => undefined,
    async () => undefined,
    '/maps/later',
  );
  observation.finish();
  assert.equal(observation.failedCreateCapture(), undefined);
  assert.equal(evidence().network.requests.length, 1);
});

for (const terminal of ['readiness-failed', 'action-failed']) {
  test(`default ${terminal} stays authoritative through late network and capture`, async (t) => {
    const { cdp, state, frame, clock, observation, request, visit, evidence, evidenceEvents } =
      defaultAttempt();
    const error = new Error(`${canary}-original`);
    const actionFailed = terminal === 'action-failed';
    await assert.rejects(
      visit(
        async () => {
          for (let i = 1; i <= 64; i++) request(i);
          if (actionFailed) throw error;
        },
        async () => {
          clock.at = 105_100;
          clock.ms = 5100;
          throw error;
        },
      ),
      (caught) => caught === error,
    );
    assert.deepEqual(evidenceEvents(), []);
    const out = temporary(t);
    const captureError = new Error(`${canary}-screenshot`);
    if (actionFailed) {
      const screenshot = state.page.screenshot;
      state.page.screenshot = async (options) => {
        await screenshot(options);
        throw captureError;
      };
    }
    const originalContent = state.page.content;
    state.page.content = async () => {
      assert.deepEqual(evidenceEvents(), []);
      clock.at = 105_101;
      clock.ms = 5101;
      request(65, 8);
      const requestId = `${canary}-1`;
      cdp.emit('Network.responseReceived', {
        requestId,
        timestamp: 8.25,
        response: { status: 200, headers: { private: canary } },
      });
      cdp.emit('Network.loadingFailed', { requestId, timestamp: 8.5, errorText: canary });
      return originalContent();
    };
    const capturing = capturePage(state, 'failure', out, observation.failedCreateCapture?.());
    if (actionFailed) await assert.rejects(capturing, { errors: [captureError] });
    else await capturing;
    assert.deepEqual(evidenceEvents(), []);
    const capture = JSON.parse(fs.readFileSync(path.join(out, 'failure-capture.json'), 'utf8'));
    assert.deepEqual(capture.publicCreate, { phase: 'failed-tail' });
    assert.equal(capture.url, state.page.url());
    assert.deepEqual(capture.frame, frame);
    assert.equal(capture.steps.screenshot.error, actionFailed ? captureError.message : undefined);
    for (const { started, monotonicMs, finished } of Object.values(capture.steps)) {
      assert(Number.isFinite(monotonicMs));
      assert(capture.started <= started && started <= finished && finished <= capture.finished);
    }
    assert.equal(fs.readFileSync(path.join(out, 'failure.html'), 'utf8'), await originalContent());
    assert.equal(fs.readFileSync(path.join(out, 'failure.png'), 'utf8'), 'screenshot bytes');
    observation.finish();
    cdp.emit('Network.responseReceived', {
      requestId: `${canary}-2`,
      timestamp: 10,
      response: { status: 200 },
    });
    observation.finish();
    const attempt = evidence();
    assert.deepEqual(attempt.budget, budget);
    assert.equal(attempt.action.status, actionFailed ? 'rejected' : 'fulfilled');
    assert.deepEqual(attempt.outcome, {
      status: terminal,
      at: actionFailed
        ? { epochMs: 100_100, elapsedMs: 100 }
        : { epochMs: 105_100, elapsedMs: 5100 },
    });
    assert.deepEqual(attempt.marker, missingMarker);
    assert.deepEqual(attempt.routes, missingRoutes);
    assert.deepEqual(attempt.network.codes, ['request-limit']);
    assert.equal(attempt.network.status, 'partial');
    assert.equal(attempt.network.requests.length, 64);
    assert.equal(attempt.network.omittedRequests, 1);
    const [first, second] = attempt.network.requests;
    assert.equal(first.requestReceipt.phase, 'observing');
    assert.deepEqual(first.responseReceipt, {
      epochMs: 105_101,
      elapsedMs: 5101,
      phase: 'failed-tail',
    });
    assert.deepEqual(first.completionReceipt, first.responseReceipt);
    assert.equal(first.completion, 'failed');
    assert.equal(second.responseTimestampSeconds, null);
  });
}

for (const interruption of ['root-commit', 'before-claim', 'before-start', 'page-closed']) {
  test(`default ${interruption} before start publishes only partial evidence at finish`, async () => {
    const { cdp, state, observation, request, visit, evidence, evidenceEvents, terminate } =
      defaultAttempt();
    const error = new Error(`${canary}-${interruption}`);
    const code = interruption === 'page-closed' ? 'cdp-disconnected' : 'interrupted';
    if (interruption === 'root-commit') {
      state.page.goto = async () => {
        throw error;
      };
      await assert.rejects(
        publicMap(state, origin, (promise) => promise, assert.fail, assert.fail),
        (caught) => caught.cause === error,
      );
    } else {
      const entered = deferred();
      const release = deferred();
      const send = cdp.send;
      cdp.send = async (method) => {
        entered.resolve();
        await release.promise;
        return send(method);
      };
      if (interruption === 'before-claim') terminate(code);
      const visiting = assert.rejects(
        visit(
          async () => undefined,
          assert.fail,
          undefined,
          async (promise) => {
            await promise;
            throw error;
          },
        ),
        (caught) => caught === error,
      );
      await entered.promise;
      terminate(code);
      request('before-start');
      assert.deepEqual(evidenceEvents(), []);
      release.resolve();
      await visiting;
    }
    assert.deepEqual(evidenceEvents(), []);
    assert.equal(observation.failedCreateCapture?.(), undefined);
    observation.finish?.();
    const attempt = evidence();
    const unknown = { epochMs: null, elapsedMs: null };
    assert.deepEqual(attempt.budget, { start: unknown, deadline: unknown });
    assert.deepEqual(attempt.action, { status: 'unavailable', at: unknown });
    assert.deepEqual(attempt.outcome, { status: 'unavailable', at: unknown });
    assert.equal(attempt.status, 'partial');
    assert(attempt.codes.includes('malformed-create-observation'));
    assert.equal(attempt.network.status, 'partial');
    assert(attempt.network.codes.includes('missing-network-observation'));
    assert.deepEqual(attempt.network.requests, []);
    if (interruption !== 'root-commit') assert(attempt.network.codes.includes(code));
  });
}

test('readiness remains ready when the subsequent default save assertion fails', async () => {
  const { state, observation, visit, evidence, evidenceEvents } = defaultAttempt();
  let outcomeAtSaveCheck;
  state.page.getByText = () => ({
    count: async () => {
      outcomeAtSaveCheck = evidenceEvents()[0]?.data.outcome.status;
      return 1;
    },
  });
  await assert.rejects(
    visit(
      async () => undefined,
      async () => undefined,
    ),
    /Map must be persisted/,
  );
  assert.equal(outcomeAtSaveCheck, 'ready');
  assert.equal(evidence().outcome.status, 'ready');
  assert.equal(observation.failedCreateCapture(), undefined);
  observation.finish();
  assert.equal(evidence().outcome.status, 'ready');
});
