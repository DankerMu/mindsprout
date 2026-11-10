import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { waitForObserved } from './native-hmr-support.mjs';

function frame(event, index) {
  if (!['Network.webSocketFrameSent', 'Network.webSocketFrameReceived'].includes(event.type))
    return null;
  try {
    const message = JSON.parse(event.data.response.payloadData);
    if (!message || typeof message !== 'object') return null;
    return { event, index, message };
  } catch {
    return null;
  }
}

function resource(message) {
  return { path: message.path, headers: message.headers || null };
}

function subscriptions(frames) {
  return frames.filter(
    (item) =>
      item.event.type === 'Network.webSocketFrameSent' &&
      item.message.type === 'turbopack-subscribe' &&
      typeof item.message.path === 'string',
  );
}

function invalidSetup(events, frames, connections) {
  if (events.filter((event) => event.type === 'document').length > 1)
    return 'Target library document changed during baseline setup';
  if (
    events.some((event) => event.type === 'requested-navigation' && event.data.reason === 'reload')
  )
    return 'Target library reloaded during baseline setup';
  if (
    frames.some(
      (item) =>
        item.event.type === 'Network.webSocketFrameReceived' && item.message.type === 'reloadPage',
    )
  )
    return 'Target library received reloadPage during baseline setup';
  if (connections.length > 1) return 'Target library HMR reconnected during baseline setup';
  const socket = connections[0]?.event.data.requestId;
  if (
    events.some(
      (event) => event.type === 'Network.webSocketClosed' && event.data.requestId === socket,
    )
  )
    return 'Target library HMR disconnected during baseline setup';
  return null;
}

export function hmrBaseline(events, label) {
  const selected = events.filter((event) => event.page === label);
  const frames = selected.map(frame).filter(Boolean);
  const connections = frames.filter(
    (item) =>
      item.event.type === 'Network.webSocketFrameReceived' &&
      item.message.type === 'turbopack-connected',
  );
  const connected = connections[0];
  const observed = subscriptions(frames);
  const state = {
    ready: false,
    invalid: invalidSetup(selected, frames, connections),
    connection: null,
    observedSubscriptions: observed.map((item) => ({
      ...resource(item.message),
      hmrVersion: item.message.hmrVersion,
      requestId: item.event.data.requestId,
      ms: item.event.ms,
    })),
    preConnectResources: [],
    matchedResources: [],
    pendingResources: [],
  };
  if (!connected) return state;
  const version = connected.message.data?.hmrVersion;
  state.connection = { version, ms: connected.event.ms, requestId: connected.event.data.requestId };
  if (typeof version !== 'string' || typeof state.connection.requestId !== 'string') {
    state.invalid = 'Target library connection lacks its HMR version or socket identity';
    return state;
  }
  const current = observed.filter(
    (item) => item.event.data.requestId === state.connection.requestId,
  );
  const required = new Map(
    current.map((item) => [JSON.stringify(resource(item.message)), resource(item.message)]),
  );
  const before = new Map(
    current
      .filter((item) => item.index < connected.index)
      .map((item) => [JSON.stringify(resource(item.message)), resource(item.message)]),
  );
  const matched = new Map(
    current
      .filter((item) => item.index > connected.index && item.message.hmrVersion === version)
      .map((item) => [JSON.stringify(resource(item.message)), resource(item.message)]),
  );
  if (
    current.some(
      (item) => item.message.hmrVersion !== undefined && item.message.hmrVersion !== version,
    )
  ) {
    state.invalid = 'Target library subscription HMR version differs from its connection';
  }
  state.preConnectResources = [...before.values()];
  state.matchedResources = [...matched.values()];
  state.pendingResources = [...required]
    .filter(([key]) => !matched.has(key))
    .map(([, value]) => value);
  state.ready = state.invalid === null && matched.size > 0 && state.pendingResources.length === 0;
  return state;
}

export async function waitForTargetHmrBaseline(events, observed, label, record, publish) {
  const started = performance.now();
  const start = record('target-library-hmr-setup-start', {}, label);
  let baseline;
  const inspect = () => {
    baseline = {
      ...hmrBaseline(events, label),
      start,
      deadlineMs: 5000,
      elapsedMs: performance.now() - started,
    };
    publish(baseline);
    return baseline.ready || baseline.invalid !== null;
  };
  try {
    await waitForObserved(observed, inspect, 5000, 'Target library HMR baseline');
    assert.equal(baseline.invalid, null, 'Target library HMR baseline failed');
    assert(performance.now() - started <= 5000, 'Target library HMR baseline exceeded 5000ms');
    baseline.armed = record(
      'target-library-hmr-baseline-armed',
      { version: baseline.connection.version },
      label,
    );
    publish(baseline);
  } catch (error) {
    inspect();
    baseline.error = error.message;
    publish(baseline);
    throw error;
  }
}
