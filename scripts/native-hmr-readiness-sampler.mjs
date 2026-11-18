import { randomUUID } from 'node:crypto';
import { deadline } from './native-hmr-support.mjs';
import {
  boundedInteger,
  finite,
  integer,
  limits,
  validMarkerState,
} from './native-hmr-profile-projection.mjs';

const bindingName = '__mindsproutReadinessSample';
const samplerName = '__mindsproutReadinessSampler';

function prepareBinding({ bindingName, samplerName, ownerKey, epoch }) {
  if (bindingName in globalThis || samplerName in globalThis) return { status: 'conflict' };
  const timeOriginMs = performance.timeOrigin;
  Object.defineProperty(globalThis, ownerKey, {
    value: { epoch, timeOriginMs, binding: null, sampler: null },
    configurable: true,
  });
  return { status: 'prepared', timeOriginMs };
}

function captureBinding({ bindingName, ownerKey, epoch }) {
  const owner = globalThis[ownerKey];
  if (!owner || owner.epoch !== epoch) return false;
  if (typeof globalThis[bindingName] !== 'function') return false;
  owner.binding = globalThis[bindingName];
  return true;
}

function installSampler({
  bindingName,
  samplerName,
  ownerKey,
  epoch,
  interval,
  maximum,
  lifetime,
}) {
  const owner = globalThis[ownerKey];
  if (!owner || owner.epoch !== epoch || !owner.binding) return 'conflict';
  if (globalThis[samplerName] || globalThis[bindingName] !== owner.binding) return 'conflict';
  const armed = performance.now();
  const timeOriginMs = performance.timeOrigin;
  let timer;
  let count = 0;
  let last = -Infinity;
  let stopped = false;
  const send = (value) => owner.binding(JSON.stringify({ epoch, timeOriginMs, ...value }));
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  function visible(element) {
    const style = globalThis.getComputedStyle(element);
    if (style.display === 'contents') {
      return [...element.childNodes].some((node) => {
        if (node.nodeType === globalThis.Node.ELEMENT_NODE) return visible(node);
        if (node.nodeType !== globalThis.Node.TEXT_NODE) return false;
        const range = globalThis.document.createRange();
        range.selectNode(node);
        const rect = range.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }
    if (!element.checkVisibility() || style.visibility !== 'visible') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function route() {
    if (globalThis.location.pathname === '/') return 'home';
    return /^\/maps\/[^/]+$/.test(globalThis.location.pathname) ? 'editor' : 'other';
  }
  function sample() {
    if (stopped) return;
    const nowMs = performance.now();
    if (nowMs - armed >= lifetime || count >= maximum) {
      stop();
      send({ terminal: count >= maximum ? 'sample-limit' : 'sampler-expired', nowMs });
      return;
    }
    if (nowMs - last < interval) {
      timer = setTimeout(sample, interval - (nowMs - last));
      return;
    }
    last = nowMs;
    const marker = globalThis.document.querySelector('[data-testid="map-editor-ready"]');
    send({
      ordinal: ++count,
      nowMs,
      presence: marker ? 'present' : 'absent',
      visibility: marker && visible(marker) ? 'visible' : 'hidden',
      route: route(),
    });
    timer = setTimeout(sample, interval);
  }
  owner.sampler = { stop, epoch };
  Object.defineProperty(globalThis, samplerName, { value: owner.sampler, configurable: true });
  sample();
  return 'installed';
}

function disposeSampler({ bindingName, samplerName, ownerKey, epoch, timeOriginMs }) {
  if (performance.timeOrigin !== timeOriginMs) return 'context-lost';
  const owner = globalThis[ownerKey];
  if (!owner || owner.epoch !== epoch) return 'unavailable';
  if (owner.sampler) {
    owner.sampler.stop();
    if (globalThis[samplerName] === owner.sampler) Reflect.deleteProperty(globalThis, samplerName);
  }
  if (!owner.binding && Object.hasOwn(globalThis, bindingName)) return 'ownership-pending';
  if (globalThis[bindingName] === owner.binding) Reflect.deleteProperty(globalThis, bindingName);
  Reflect.deleteProperty(globalThis, ownerKey);
  return 'stopped';
}

function routeClass(raw, origin) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return 'other';
  if (url.pathname === '/') return 'home';
  return /^\/maps\/[^/]+$/.test(url.pathname) ? 'editor' : 'other';
}

function validSample(value) {
  return (
    Boolean(boundedInteger(value.ordinal, limits.markerSamples)) &&
    finite(value.timeOriginMs) &&
    finite(value.nowMs) &&
    validMarkerState(value)
  );
}

function createSamplerBinding({
  page,
  cdp,
  executionContext,
  abandoned,
  onCleanup,
  onSetupFailure,
}) {
  const ownership = {
    ownerKey: `__mindsproutReadinessOwner_${randomUUID().replaceAll('-', '')}`,
    epoch: 1,
    revision: 0,
    attempted: -1,
    issued: false,
    removed: false,
    released: false,
    timeOriginMs: null,
  };
  let cleanupPromise;
  let cleanupRunning = false;
  const parameters = () => ({
    bindingName,
    samplerName,
    ownerKey: ownership.ownerKey,
    epoch: ownership.epoch,
    timeOriginMs: ownership.timeOriginMs,
  });
  async function begin(setup) {
    if (typeof page?.evaluate !== 'function') {
      onSetupFailure('missing-marker-observation');
      return;
    }
    try {
      await deadline(setup(), 1000, 'Readiness sampler setup');
    } catch (error) {
      onSetupFailure(
        error.message === 'Readiness sampler setup exceeded 1000ms'
          ? 'sampler-setup-timeout'
          : 'sampler-setup-failed',
      );
    }
  }
  async function prepare() {
    const prepared = await page.evaluate(prepareBinding, parameters());
    if (prepared.status !== 'prepared') throw new Error('Sampler binding conflict');
    ownership.timeOriginMs = prepared.timeOriginMs;
    ownership.revision++;
  }
  async function add() {
    ownership.issued = true;
    ownership.revision++;
    const added = cdp.send('Runtime.addBinding', {
      name: bindingName,
      executionContextId: executionContext(),
    });
    added.catch(() => undefined);
    // Capture in the same CDP context before awaiting an acknowledgement that may arrive late.
    const captured = await cdp.send('Runtime.callFunctionOn', {
      executionContextId: executionContext(),
      functionDeclaration: captureBinding.toString(),
      arguments: [{ value: parameters() }],
      returnByValue: true,
    });
    if (captured.result?.value === true) ownership.revision++;
    else throw new Error('Binding ownership unavailable');
    if (abandoned(ownership.epoch)) void cleanup();
    await added;
  }
  function install() {
    return page.evaluate(installSampler, {
      ...parameters(),
      interval: limits.markerIntervalMs,
      maximum: limits.markerSamples,
      lifetime: limits.markerLifetimeMs,
    });
  }
  async function dispose() {
    try {
      return await page.evaluate(disposeSampler, parameters());
    } finally {
      if (ownership.issued && !ownership.removed) {
        await cdp.send('Runtime.removeBinding', { name: bindingName });
        ownership.removed = true;
      }
    }
  }
  function cleanupResult(result) {
    if (['stopped', 'context-lost'].includes(result)) {
      ownership.released = true;
      onCleanup('stopped');
    } else onCleanup('sampler-disposal-failed');
  }
  async function stopWork() {
    if (page?.isClosed?.()) {
      cleanupResult('stopped');
      return;
    }
    try {
      const result = await deadline(dispose(), 1000, 'Readiness sampler disposal');
      cleanupResult(result);
    } catch (error) {
      onCleanup(
        error.message === 'Readiness sampler disposal exceeded 1000ms'
          ? 'sampler-disposal-timeout'
          : 'sampler-disposal-failed',
      );
    }
  }
  function cleanup() {
    if (ownership.released || ownership.revision === 0) return Promise.resolve();
    if (ownership.attempted === ownership.revision) return cleanupPromise;
    if (cleanupRunning) return cleanupPromise.then(cleanup);
    ownership.attempted = ownership.revision;
    cleanupRunning = true;
    cleanupPromise = stopWork().finally(() => {
      cleanupRunning = false;
    });
    return cleanupPromise;
  }
  return { begin, prepare, add, install, cleanup };
}

export function createReadinessSampler(state, options, receipt) {
  const { page, cdp } = state;
  const samples = [];
  const observations = [];
  const markerCodes = new Set();
  const routeCodes = new Set();
  let epoch = 1;
  let accepting = false;
  let sampling = false;
  let contextId;
  let frameId = state.frameId;
  let firstVisible = null;
  let omittedSamples = 0;
  let omittedRecords = 0;
  let shutdown = 'unknown';
  let sealed = false;
  let stopping;
  const bindingOwner = createSamplerBinding({
    page,
    cdp,
    executionContext: () => contextId,
    abandoned: (token) => !accepting && epoch !== token,
    onSetupFailure: abandon,
    onCleanup(code) {
      if (sealed) return;
      if (code === 'stopped') shutdown = 'stopped';
      else markerCodes.add(code);
    },
  });
  const listeners = [];
  const listen = (event, handler) => {
    cdp.on(event, handler);
    listeners.push([event, handler]);
  };
  function fence() {
    accepting = false;
    sampling = false;
    for (const [event, handler] of listeners) cdp.off(event, handler);
    listeners.length = 0;
  }
  function abandon(code) {
    if (!sealed) {
      markerCodes.add(code);
      routeCodes.add(code);
    }
    epoch++;
    fence();
    void bindingOwner.cleanup();
  }
  function rejectSample(code) {
    markerCodes.add(code);
    omittedSamples = Math.min(Number.MAX_SAFE_INTEGER, omittedSamples + 1);
  }
  function acceptSample(value) {
    if (samples.length >= limits.markerSamples) return rejectSample('sample-limit');
    if (!validSample(value)) return rejectSample('invalid-marker-sample');
    const previous = samples.at(-1);
    if (
      previous &&
      (value.timeOriginMs !== previous.browser.timeOriginMs ||
        value.nowMs - previous.browser.nowMs < limits.markerIntervalMs ||
        value.ordinal <= previous.ordinal)
    )
      return rejectSample('unordered-marker-sample');
    const sample = {
      ordinal: value.ordinal,
      browser: { timeOriginMs: value.timeOriginMs, nowMs: value.nowMs },
      presence: value.presence,
      visibility: value.visibility,
      route: value.route,
      receipt: receipt(),
    };
    samples.push(sample);
    if (!firstVisible && sample.visibility === 'visible') {
      firstVisible = { at: sample.browser, previous: previous ? previous.browser : null };
    }
  }
  function acceptTerminal(value) {
    if (
      !['sample-limit', 'sampler-expired'].includes(value.terminal) ||
      !finite(value.timeOriginMs) ||
      !finite(value.nowMs)
    )
      return rejectSample('invalid-marker-sample');
    markerCodes.add(value.terminal);
    shutdown = 'stopped';
    sampling = false;
  }
  const matchingBinding = (data) =>
    accepting && sampling && data.name === bindingName && data.executionContextId === contextId;
  function binding(data) {
    if (!matchingBinding(data)) return;
    if (typeof data.payload !== 'string' || data.payload.length > 1024)
      return rejectSample('invalid-marker-sample');
    let value;
    try {
      value = JSON.parse(data.payload);
    } catch {
      return rejectSample('invalid-marker-sample');
    }
    if (!value || value.epoch !== epoch) return rejectSample('invalid-marker-sample');
    if (value.terminal !== undefined) return acceptTerminal(value);
    acceptSample(value);
  }
  function route(data) {
    if (!accepting || data.frameId !== frameId) return;
    const route = routeClass(data.url, options.origin);
    if (!route) {
      routeCodes.add('invalid-route-observation');
      return;
    }
    if (observations.length >= limits.createRoutes) {
      routeCodes.add('route-limit');
      omittedRecords = Math.min(Number.MAX_SAFE_INTEGER, omittedRecords + 1);
      return;
    }
    observations.push({ ordinal: observations.length + 1, route, receipt: receipt() });
  }
  function installListeners() {
    listen('Runtime.bindingCalled', binding);
    listen('Page.navigatedWithinDocument', route);
    listen('Runtime.executionContextCreated', ({ context }) => {
      if (context.auxData?.isDefault && context.auxData.frameId === frameId) contextId = context.id;
    });
    listen('Runtime.executionContextDestroyed', (data) => {
      if (data.executionContextId === contextId) abandon('sampler-context-lost');
    });
    listen('Runtime.executionContextsCleared', () => abandon('sampler-context-lost'));
  }
  async function setup(token) {
    if (!frameId) frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    if (epoch !== token) return;
    installListeners();
    await cdp.send('Runtime.enable');
    if (epoch !== token) return;
    if (!integer(contextId)) throw new Error('Missing main execution context');
    await bindingOwner.prepare();
    if (epoch !== token) {
      void bindingOwner.cleanup();
      return;
    }
    await bindingOwner.add();
    if (epoch !== token) {
      void bindingOwner.cleanup();
      return;
    }
    accepting = true;
    sampling = true;
    const result = await bindingOwner.install();
    if (epoch !== token) {
      void bindingOwner.cleanup();
      return;
    }
    if (result !== 'installed') throw new Error('Sampler installation unavailable');
  }
  function stop(code) {
    if (stopping) return stopping;
    if (code) {
      markerCodes.add(code);
      routeCodes.add(code);
    }
    fence();
    epoch++;
    stopping = bindingOwner.cleanup();
    return stopping;
  }
  function snapshot() {
    if (!samples.length) markerCodes.add('missing-marker-observation');
    sealed = true;
    return {
      marker: {
        status: markerCodes.size ? 'partial' : 'complete',
        codes: [...markerCodes],
        samples,
        firstVisible,
        omittedSamples,
        shutdown,
      },
      routes: {
        status: routeCodes.size ? 'partial' : 'complete',
        codes: [...routeCodes],
        observations,
        omittedRecords,
      },
    };
  }
  return { begin: () => bindingOwner.begin(() => setup(epoch)), stop, snapshot };
}
