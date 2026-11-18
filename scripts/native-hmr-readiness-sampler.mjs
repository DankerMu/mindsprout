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

function installSampler({ bindingName, samplerName, epoch, interval, maximum, lifetime }) {
  if (globalThis[samplerName] || typeof globalThis[bindingName] !== 'function') return 'conflict';
  const armed = performance.now();
  const timeOriginMs = performance.timeOrigin;
  let timer;
  let count = 0;
  let last = -Infinity;
  let stopped = false;
  const send = (value) =>
    globalThis[bindingName](JSON.stringify({ epoch, timeOriginMs, ...value }));
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
  Object.defineProperty(globalThis, samplerName, { value: { stop, epoch }, configurable: true });
  sample();
  return 'installed';
}

function disposeSampler({ bindingName, samplerName, epoch }) {
  const sampler = globalThis[samplerName];
  if (!sampler || sampler.epoch !== epoch) return 'unavailable';
  sampler.stop();
  Reflect.deleteProperty(globalThis, samplerName);
  Reflect.deleteProperty(globalThis, bindingName);
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
  let installed = false;
  let stopping;
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
    markerCodes.add(code);
    routeCodes.add(code);
    epoch++;
    fence();
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
    await cdp.send('Runtime.addBinding', { name: bindingName, executionContextId: contextId });
    if (epoch !== token) return;
    accepting = true;
    sampling = true;
    const result = await page.evaluate(installSampler, {
      bindingName,
      samplerName,
      epoch: token,
      interval: limits.markerIntervalMs,
      maximum: limits.markerSamples,
      lifetime: limits.markerLifetimeMs,
    });
    if (epoch !== token) return;
    if (result !== 'installed') throw new Error('Sampler installation unavailable');
    installed = true;
  }
  async function begin() {
    if (typeof page?.evaluate !== 'function') {
      abandon('missing-marker-observation');
      return;
    }
    try {
      await deadline(setup(epoch), 1000, 'Readiness sampler setup');
    } catch (error) {
      abandon(
        error.message === 'Readiness sampler setup exceeded 1000ms'
          ? 'sampler-setup-timeout'
          : 'sampler-setup-failed',
      );
    }
  }
  async function dispose(token) {
    const result = await page.evaluate(disposeSampler, { bindingName, samplerName, epoch: token });
    await cdp.send('Runtime.removeBinding', { name: bindingName });
    return result;
  }
  async function stopWork(token) {
    if (page?.isClosed?.()) {
      shutdown = 'stopped';
      return;
    }
    if (!installed) return;
    try {
      const result = await deadline(dispose(token), 1000, 'Readiness sampler disposal');
      if (result === 'stopped') shutdown = 'stopped';
      else markerCodes.add('sampler-disposal-failed');
    } catch (error) {
      markerCodes.add(
        error.message === 'Readiness sampler disposal exceeded 1000ms'
          ? 'sampler-disposal-timeout'
          : 'sampler-disposal-failed',
      );
    }
  }
  function stop(code) {
    if (stopping) return stopping;
    const token = epoch;
    if (code) {
      markerCodes.add(code);
      routeCodes.add(code);
    }
    fence();
    epoch++;
    stopping = stopWork(token);
    return stopping;
  }
  function snapshot() {
    if (!samples.length) markerCodes.add('missing-marker-observation');
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
  return { begin, stop, snapshot };
}
