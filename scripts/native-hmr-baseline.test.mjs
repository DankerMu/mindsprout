import assert from 'node:assert/strict';
import test from 'node:test';
import { hmrBaseline } from './native-hmr-baseline.mjs';
import { entryProducer } from './native-hmr-inventory.mjs';

const label = 'first-navigation';
function event(type, message, options = {}) {
  return {
    page: label,
    ms: 10,
    type,
    data: { requestId: 'socket-a', response: { payloadData: JSON.stringify(message) } },
    ...options,
  };
}
const subscribe = (path, version = '0', headers) =>
  event('Network.webSocketFrameSent', {
    type: 'turbopack-subscribe',
    path,
    hmrVersion: version,
    headers,
  });
const connect = (version = '0') =>
  event('Network.webSocketFrameReceived', {
    type: 'turbopack-connected',
    data: { sessionId: 123, hmrVersion: version },
  });
const alpha = { path: 'static/chunks/alpha.js', headers: null };
const beta = { path: 'static/chunks/beta.js', headers: null };

test('every pre-connect resource must be subscribed again at the connected version', () => {
  const events = [subscribe(alpha.path), subscribe(beta.path), connect(), subscribe(alpha.path)];
  const partial = hmrBaseline(events, label, [alpha, beta]);
  assert.equal(partial.ready, false);
  assert.deepEqual(partial.preConnectResources, [alpha, beta]);
  assert.deepEqual(partial.matchedResources, [alpha]);
  assert.deepEqual(partial.pendingResources, [beta]);
  const complete = hmrBaseline([...events, subscribe(beta.path)], label, [alpha, beta]);
  assert.equal(complete.ready, true);
  assert.deepEqual(complete.pendingResources, []);
  assert.deepEqual(complete.matchedResources, [alpha, beta]);
});

test('pre-connect subscriptions cannot satisfy post-connect ordering even at the same timestamp', () => {
  const baseline = hmrBaseline([subscribe(alpha.path), subscribe(alpha.path), connect()], label, [
    alpha,
  ]);
  assert.equal(baseline.ready, false);
  assert.deepEqual(baseline.pendingResources, [alpha]);
  assert.deepEqual(baseline.matchedResources, []);
});

test('duplicates do not invent additional required resources', () => {
  const baseline = hmrBaseline(
    [
      subscribe(alpha.path),
      subscribe(alpha.path, '0', null),
      connect(),
      subscribe(alpha.path),
      subscribe(alpha.path, '0', null),
    ],
    label,
    [alpha],
  );
  assert.equal(baseline.ready, true);
  assert.deepEqual(baseline.preConnectResources, [alpha]);
  assert.deepEqual(baseline.matchedResources, [alpha]);
});

test('resource identity includes headers rather than only the path', () => {
  const events = [
    subscribe(alpha.path, '0', { accept: 'a' }),
    subscribe(alpha.path, '0', { accept: 'b' }),
    connect(),
    subscribe(alpha.path, '0', { accept: 'a' }),
  ];
  const inventory = [
    { path: alpha.path, headers: { accept: 'a' } },
    { path: alpha.path, headers: { accept: 'b' } },
  ];
  assert.equal(hmrBaseline(events, label, inventory).ready, false);
  assert.deepEqual(hmrBaseline(events, label, inventory).pendingResources, [
    { path: alpha.path, headers: { accept: 'b' } },
  ]);
  assert.equal(
    hmrBaseline([...events, subscribe(alpha.path, '0', { accept: 'b' })], label, inventory).ready,
    true,
  );
});

test('wrong-version subscriptions cannot be repaired into a valid baseline by later matching frames', () => {
  const baseline = hmrBaseline(
    [subscribe(alpha.path, '0'), connect('1'), subscribe(alpha.path, '1')],
    label,
    [alpha],
  );
  assert.equal(baseline.ready, false);
  assert.equal(
    baseline.invalid,
    'Target library subscription HMR version differs from its connection',
  );
});

test('another page or socket cannot complete the initial resource set', () => {
  const foreignPage = { ...subscribe(beta.path), page: 'retained-editor' };
  const foreignSocket = subscribe(beta.path);
  foreignSocket.data.requestId = 'socket-b';
  const baseline = hmrBaseline(
    [
      subscribe(alpha.path),
      subscribe(beta.path),
      connect(),
      subscribe(alpha.path),
      foreignPage,
      foreignSocket,
    ],
    label,
    [alpha, beta],
  );
  assert.equal(baseline.ready, false);
  assert.deepEqual(baseline.pendingResources, [beta]);
});

test('connection without subscriptions and subscriptions without connection remain unarmed', () => {
  assert.equal(hmrBaseline([connect()], label, [alpha]).ready, false);
  assert.equal(hmrBaseline([subscribe(alpha.path)], label, [alpha]).ready, false);
});

test('connection-first ordering arms a known single-resource producer inventory', () => {
  const baseline = hmrBaseline([connect(), subscribe(alpha.path)], label, [alpha]);
  assert.equal(baseline.ready, true);
  assert.deepEqual(baseline.preConnectResources, []);
  assert.deepEqual(baseline.matchedResources, [alpha]);
});

test('connection-first ordering cannot arm until both independently known initial resources subscribe', () => {
  const inventory = [alpha, beta];
  const events = [connect(), subscribe(alpha.path)];
  const incomplete = hmrBaseline(events, label, inventory);
  assert.equal(
    incomplete.ready,
    false,
    'Producer metadata includes B even before its first subscription frame arrives',
  );
  assert.deepEqual(incomplete.matchedResources, [alpha]);
  assert.deepEqual(incomplete.pendingResources, [beta]);
  const complete = hmrBaseline([...events, subscribe(beta.path)], label, inventory);
  assert.equal(complete.ready, true);
  assert.deepEqual(complete.matchedResources, [alpha, beta]);
  assert.deepEqual(complete.pendingResources, []);
});

test('newly observed resources also require versioned post-connect registration', () => {
  const unversioned = event('Network.webSocketFrameSent', {
    type: 'turbopack-subscribe',
    path: beta.path,
  });
  const baseline = hmrBaseline(
    [subscribe(alpha.path), connect(), subscribe(alpha.path), unversioned],
    label,
    [alpha, beta],
  );
  assert.equal(baseline.ready, false);
  assert.deepEqual(baseline.pendingResources, [beta]);
});

test('a missing connected version cannot arm the source stimulus', () => {
  const connected = event('Network.webSocketFrameReceived', {
    type: 'turbopack-connected',
    data: {},
  });
  const baseline = hmrBaseline([subscribe(alpha.path), connected, subscribe(alpha.path)], label, [
    alpha,
  ]);
  assert.equal(baseline.ready, false);
  assert.equal(
    baseline.invalid,
    'Target library connection lacks its HMR version or socket identity',
  );
});

test('reload and reconnect during setup remain failures rather than recovery', () => {
  const baseline = [subscribe(alpha.path), connect(), subscribe(alpha.path)];
  for (const failure of [
    event('Network.webSocketFrameReceived', { type: 'reloadPage', data: 'HMR hash mismatch' }),
    connect(),
    { page: label, type: 'requested-navigation', data: { reason: 'reload' } },
  ]) {
    const state = hmrBaseline([...baseline, failure], label, [alpha]);
    assert.equal(state.ready, false);
    assert.notEqual(state.invalid, null);
  }
});

test('a second setup document cannot reset the baseline', () => {
  const document = { page: label, type: 'document' };
  const baseline = hmrBaseline(
    [document, subscribe(alpha.path), connect(), subscribe(alpha.path), document],
    label,
    [alpha],
  );
  assert.equal(baseline.ready, false);
  assert.equal(baseline.invalid, 'Target library document changed during baseline setup');
});

test('a closed initial HMR socket cannot arm a source change', () => {
  const closed = { page: label, type: 'Network.webSocketClosed', data: { requestId: 'socket-a' } };
  const baseline = hmrBaseline(
    [subscribe(alpha.path), connect(), subscribe(alpha.path), closed],
    label,
    [alpha],
  );
  assert.equal(baseline.ready, false);
  assert.equal(baseline.invalid, 'Target library HMR disconnected during baseline setup');
});

// Shape emitted by the pinned Turbopack entry chunk-list producer. These are
// script bodies, not subscription frames: A and B exist before either subscribes.
const producer = (chunks, source = 'entry') => `
(globalThis["TURBOPACK_CHUNK_LISTS"] || (globalThis["TURBOPACK_CHUNK_LISTS"] = [])).push({
  script: typeof document === "object" ? document.currentScript : undefined,
  chunks: ${JSON.stringify(chunks)},
  source: ${JSON.stringify(source)}
});`;

test('entry metadata is recognized without executing or mutating browser globals', () => {
  const before = globalThis.TURBOPACK_CHUNK_LISTS;
  assert.equal(entryProducer(producer(['static/chunks/a.js', 'static/chunks/b.js'])), true);
  assert.equal(globalThis.TURBOPACK_CHUNK_LISTS, before);
  assert.equal(entryProducer(producer(['static/chunks/a.js'], 'dynamic')), false);
});

test('runtime registration and quoted producer text are not initial producers', () => {
  assert.equal(
    entryProducer(`
    var pending = globalThis["TURBOPACK_CHUNK_LISTS"] || [];
    globalThis["TURBOPACK_CHUNK_LISTS"] = { push: registerChunkList };
    pending.forEach(registerChunkList);
  `),
    false,
  );
  assert.equal(entryProducer(JSON.stringify(producer(['a.js']))), false);
});

test('nonliteral chunks and missing executing-script identity fail closed', () => {
  assert.throws(
    () => entryProducer(producer(['a.js']).replace('["a.js"]', 'getChunks()')),
    /Missing initial chunks/,
  );
  assert.throws(
    () =>
      entryProducer(
        producer(['a.js']).replace('document.currentScript', '"document.currentScript"'),
      ),
    /executing script/,
  );
  assert.throws(
    () => entryProducer(producer(['a.js']) + producer(['b.js'])),
    /Multiple entry producers/,
  );
});

test('a missing independent inventory never arms even with a complete observed subscription', () => {
  const baseline = hmrBaseline([connect(), subscribe(alpha.path)], label);
  assert.equal(baseline.ready, false);
  assert.equal(baseline.invalid, 'Initial producer inventory is missing');
});
