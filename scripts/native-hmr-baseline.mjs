import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { waitForObserved } from './native-hmr-support.mjs';
import { initialInventory } from './native-hmr-inventory.mjs';

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

export function subscriptionResources(events, label) {
  return subscriptions(
    events
      .filter((event) => event.page === label)
      .map(frame)
      .filter(Boolean),
  ).map((item) => resource(item.message));
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

export function hmrBaseline(events, label, inventory = []) {
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
  if (inventory.length === 0) state.invalid = 'Initial producer inventory is missing';
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
    [...inventory, ...current.map((item) => resource(item.message))].map((item) => [
      JSON.stringify(item),
      item,
    ]),
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

export async function waitForHmrBaseline(state, events, observed, record, publish, options = {}) {
  const started = performance.now();
  const budget = options.timeoutMs ?? 5000;
  const remaining = () => Math.max(1, budget - (performance.now() - started));
  const start = record('initial-hmr-setup-start', {}, state.label);
  let baseline = { start, deadlineMs: budget, ready: false };
  let inventory;
  const inspect = () => {
    baseline = {
      ...hmrBaseline(
        events.filter((event) => event.ms >= (options.since ?? 0)),
        state.label,
        inventory.resources,
      ),
      inventory,
      start,
      deadlineMs: budget,
      elapsedMs: performance.now() - started,
    };
    publish(baseline);
    return baseline.ready || baseline.invalid !== null;
  };
  try {
    inventory = await initialInventory(state, observed, remaining);
    await waitForObserved(observed, inspect, remaining(), 'Initial document HMR baseline');
    assert.equal(baseline.invalid, null, 'Initial document HMR baseline failed');
    assert(performance.now() - started <= budget, 'Initial document HMR baseline exceeded budget');
    baseline.armed = record(
      'initial-hmr-baseline-armed',
      { version: baseline.connection.version },
      state.label,
    );
    publish(baseline);
  } catch (error) {
    if (inventory) inspect();
    baseline.error = error.message;
    publish(baseline);
    throw error;
  }
}
