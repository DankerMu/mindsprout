import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { observeNavigation } from './native-hmr-observation.mjs';
import { createRuntimeProfile, launchNativeBrowser } from './native-hmr-runtime-profile.mjs';
import { cpu, deferred, digest, noSecrets, temporary } from './native-hmr-profile-fixtures.mjs';
import { waitForObserved } from './native-hmr-support.mjs';

test('safe public-create evidence preserves the original budget and failure after late network delivery', async (t) => {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const profiling = createRuntimeProfile(
    { profile: true, repo, out: output, mode: 'restored-lifecycle', started: performance.now() },
    () => ({ generation: 0, trial: 0 }),
  );
  assert.equal(
    profiling.prepare({ target: 'aarch64-apple-darwin', binarySha256: digest }, {}),
    true,
  );
  const cdp = new EventEmitter();
  cdp.send = async (command) => (command === 'Profiler.stop' ? { profile: cpu() } : {});
  const page = new EventEmitter();
  const browser = new EventEmitter();
  const diagnostic = await profiling.attach(page, cdp, 'retained-editor', browser, {
    origin: 'http://localhost:3000',
  });
  const observation = observeNavigation(
    { cdp, label: 'retained-editor' },
    () => undefined,
    diagnostic,
  );
  await observation.begin();
  observation.start?.({ at: 1800000001000, ms: 1000.125 });
  observation.actionSettled?.('fulfilled', { at: 1800000001001, ms: 1001.25 });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-get',
    type: 'Fetch',
    request: { method: 'GET', url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 10,
  });
  observation.outcome?.('readiness-failed', { at: 1800000006000, ms: 6000.5 });
  await observation.end();
  cdp.emit('Network.responseReceived', {
    requestId: 'private-get',
    timestamp: 16,
    response: { status: 200 },
  });
  cdp.emit('Network.loadingFinished', {
    requestId: 'private-get',
    timestamp: 16.1,
    encodedDataLength: 48,
  });
  observation.outcome?.('ready', { at: 1800000007000, ms: 7000.5 });
  observation.start?.({ at: 1800000008000, ms: 8000 });
  page.emit('close');
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.deepEqual(summary.publicCreate?.budget, {
    start: { epochMs: 1800000001000, elapsedMs: 1000.125 },
    deadline: { epochMs: 1800000006000, elapsedMs: 6000.125 },
  });
  assert.deepEqual(summary.publicCreate.action, {
    status: 'fulfilled',
    at: { epochMs: 1800000001001, elapsedMs: 1001.25 },
  });
  assert.deepEqual(summary.publicCreate.outcome, {
    status: 'readiness-failed',
    at: { epochMs: 1800000006000, elapsedMs: 6000.5 },
  });
  assert.deepEqual(
    ['attempt', 'mode', 'generation', 'trial', 'page'].map((key) => summary.publicCreate[key]),
    [1, 'restored-lifecycle', 0, 0, 'retained-editor'],
  );
  assert.deepEqual(
    summary.publicCreate.network.requests.map((request) => ({
      ordinal: request.ordinal,
      requestClass: request.requestClass,
      method: request.method,
      responseStatus: request.responseStatus,
      completion: request.completion,
      completionTimestampSeconds: request.completionTimestampSeconds,
    })),
    [
      {
        ordinal: 1,
        requestClass: 'map-get',
        method: 'GET',
        responseStatus: 200,
        completion: 'finished',
        completionTimestampSeconds: 16.1,
      },
    ],
  );
  noSecrets(summary);
  assert.doesNotMatch(JSON.stringify(summary), /private-get|private-id|localhost/);
});

test('malformed standalone requests consume no hops and missing redirect methods terminate attribution', async () => {
  const cdp = new EventEmitter();
  cdp.send = async () => ({ metrics: [] });
  const snapshots = [];
  const observation = observeNavigation({ cdp, label: 'retained-editor' }, () => undefined, {
    origin: 'http://localhost:3000',
    clock: () => ({ epochMs: 1800000000000, elapsedMs: 0 }),
    sink: (snapshot) => snapshots.push(snapshot),
  });
  await observation.begin();
  for (const request of [
    { method: 'PUT', url: 'malformed-private-url' },
    { url: 'http://localhost:3000/api/maps/private-id' },
    undefined,
  ]) {
    cdp.emit('Network.requestWillBeSent', {
      requestId: 'ignored-private-id',
      type: 'Fetch',
      request,
      timestamp: 1,
    });
  }
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { method: 'PUT', url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 2,
  });
  cdp.emit('Network.requestWillBeSent', {
    requestId: 'private-chain',
    type: 'Fetch',
    request: { url: 'http://localhost:3000/api/maps/private-id' },
    timestamp: 3,
    redirectResponse: { status: 307 },
  });
  cdp.emit('Network.loadingFinished', {
    requestId: 'private-chain',
    timestamp: 4,
    encodedDataLength: 999,
  });
  await observation.end();
  const [snapshot] = snapshots;
  assert.deepEqual(
    snapshot.requests.map(({ ordinal, requestClass, method, responseStatus, completion }) => ({
      ordinal,
      requestClass,
      method,
      responseStatus,
      completion,
    })),
    [
      {
        ordinal: 1,
        requestClass: 'map-put',
        method: 'PUT',
        responseStatus: 307,
        completion: 'redirected',
      },
      {
        ordinal: 2,
        requestClass: 'redirect-out-of-scope',
        method: 'unavailable',
        responseStatus: undefined,
        completion: 'out-of-scope',
      },
    ],
  );
  assert.equal(snapshot.omittedRequests, 0);
  assert.equal(snapshot.requests[1].completionTimestampSeconds, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|localhost|malformed-private-url/);
});

test('real Chromium samples absent hidden and opacity-zero visibility without treating SPA history as readiness', async (t) => {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const started = performance.now();
  const now = () => ({ at: Date.now(), ms: performance.now() - started });
  const profiling = createRuntimeProfile(
    { profile: true, repo, out: output, mode: 'source-change', started },
    () => ({ generation: 0, trial: 0 }),
  );
  profiling.prepare({ target: 'aarch64-apple-darwin', binarySha256: digest }, {});
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Readiness measurement fixture</title><body></body>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browserServer;
  let browser;
  const errors = [];
  let browserOrigin;
  let failedAt;
  try {
    browserServer = await launchNativeBrowser();
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage();
    await page.goto(origin);
    browserOrigin = await page.evaluate(() => performance.timeOrigin);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    const observed = new EventEmitter();
    let latestSample;
    cdp.on('Runtime.bindingCalled', ({ name, payload }) => {
      if (name !== '__mindsproutReadinessSample') return;
      latestSample = JSON.parse(payload);
      observed.emit('event');
    });
    const sampled = (predicate) =>
      waitForObserved(
        observed,
        () => latestSample && predicate(latestSample),
        1000,
        'Fixture sample',
      );
    const diagnostic = await profiling.attach(page, cdp, 'retained-editor', browser, { origin });
    const observation = observeNavigation(
      { page, cdp, label: 'retained-editor' },
      () => undefined,
      diagnostic,
    );
    await observation.begin();
    observation.start(now());
    observation.actionSettled('fulfilled', now());
    await sampled((sample) => sample.presence === 'absent' && sample.route === 'home');
    await page.evaluate(() => globalThis.history.pushState({}, '', '/maps/private-fixture'));
    assert.equal(await page.getByTestId('map-editor-ready').isVisible(), false);
    await sampled((sample) => sample.presence === 'absent' && sample.route === 'editor');
    failedAt = now();
    observation.outcome('readiness-failed', failedAt);
    await observation.end();
    await page.evaluate(() => {
      const marker = globalThis.document.createElement('div');
      marker.dataset.testid = 'map-editor-ready';
      marker.style.cssText = 'width:20px;height:20px;visibility:hidden';
      globalThis.document.body.append(marker);
    });
    assert.equal(await page.getByTestId('map-editor-ready').isVisible(), false);
    await sampled((sample) => sample.presence === 'present' && sample.visibility === 'hidden');
    await page.evaluate(() => {
      globalThis.document.querySelector('[data-testid="map-editor-ready"]').style.cssText =
        'width:20px;height:20px;opacity:0';
    });
    assert.equal(await page.getByTestId('map-editor-ready').isVisible(), true);
    await sampled((sample) => sample.visibility === 'visible');
    await page.close();
  } finally {
    await profiling.closeBrowser(browser, browserServer, errors);
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual(errors, []);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  const evidence = summary.publicCreate;
  assert.deepEqual(
    [
      ...new Set(
        evidence.marker.samples.map((sample) => `${sample.presence}/${sample.visibility}`),
      ),
    ],
    ['absent/hidden', 'present/hidden', 'present/visible'],
  );
  assert(
    evidence.marker.samples.some(
      (sample) => sample.route === 'editor' && sample.presence === 'absent',
    ),
  );
  assert.deepEqual(
    evidence.routes.observations.map((entry) => entry.route),
    ['editor'],
  );
  const visibleIndex = evidence.marker.samples.findIndex(
    (sample) => sample.visibility === 'visible',
  );
  assert(visibleIndex > 0);
  assert.deepEqual(evidence.marker.firstVisible, {
    at: evidence.marker.samples[visibleIndex].browser,
    previous: evidence.marker.samples[visibleIndex - 1].browser,
  });
  assert.equal(evidence.marker.firstVisible.at.timeOriginMs, browserOrigin);
  assert(evidence.marker.firstVisible.at.nowMs > evidence.marker.firstVisible.previous.nowMs);
  assert.equal(evidence.marker.samples[visibleIndex].receipt.phase, 'failed-tail');
  assert.deepEqual(evidence.outcome, {
    status: 'readiness-failed',
    at: { epochMs: failedAt.at, elapsedMs: failedAt.ms },
  });
  assert.doesNotMatch(JSON.stringify(evidence), /private-fixture|127[.]0[.]0[.]1|localhost/);
});

async function liveReadiness(t) {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const started = performance.now();
  const now = () => ({ at: Date.now(), ms: performance.now() - started });
  const profiling = createRuntimeProfile(
    { profile: true, repo, out: output, mode: 'source-change', started },
    () => ({ generation: 0, trial: 0 }),
  );
  profiling.prepare({ target: 'aarch64-apple-darwin', binarySha256: digest }, {});
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<!doctype html><div data-testid="map-editor-ready" style="width:20px;height:20px"></div>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browserServer;
  let browser;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    const errors = [];
    await profiling.closeBrowser(browser, browserServer, errors);
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(errors, []);
  }
  t.after(close);
  browserServer = await launchNativeBrowser();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(origin);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  const diagnostic = await profiling.attach(page, cdp, 'retained-editor', browser, { origin });
  const observation = observeNavigation(
    { page, cdp, label: 'retained-editor' },
    () => undefined,
    diagnostic,
  );
  const events = new EventEmitter();
  const received = [];
  cdp.on('Runtime.bindingCalled', ({ name, payload }) => {
    if (name !== '__mindsproutReadinessSample') return;
    received.push(JSON.parse(payload));
    events.emit('event');
  });
  return {
    page,
    cdp,
    observation,
    now,
    received,
    sampled: (predicate) =>
      waitForObserved(events, () => received.some(predicate), 1000, 'Fixture sample'),
    async finish() {
      await close();
      await profiling.finish(true);
      return JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'))
        .publicCreate;
    },
  };
}

async function countSamplerWork(page) {
  await page.evaluate(() => {
    const getBox = globalThis.Element.prototype.getBoundingClientRect;
    const schedule = globalThis.setTimeout;
    globalThis.__readinessWork = { reads: 0, holdNext: false, delayed: null };
    globalThis.Element.prototype.getBoundingClientRect = function (...args) {
      if (this.getAttribute('data-testid') === 'map-editor-ready')
        globalThis.__readinessWork.reads++;
      return getBox.apply(this, args);
    };
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (callback.name !== 'sample') return schedule(callback, delay, ...args);
      return schedule(
        () => {
          if (globalThis.__readinessWork.holdNext) {
            globalThis.__readinessWork.holdNext = false;
            globalThis.__readinessWork.delayed = callback;
          } else callback();
        },
        delay,
        ...args,
      );
    };
  });
}

for (const held of [false, true]) {
  test(`successful readiness fences collection with ${held ? 'held' : 'acknowledged'} real sampler disposal`, async (t) => {
    const fixture = await liveReadiness(t);
    const { page, observation, now, received } = fixture;
    await countSamplerWork(page);
    await observation.begin();
    observation.start(now());
    observation.actionSettled('fulfilled', now());
    await page.evaluate(() => globalThis.history.pushState({}, '', '/maps/private-success'));
    await fixture.sampled((sample) => sample.visibility === 'visible' && sample.route === 'editor');
    assert.equal(await page.getByTestId('map-editor-ready').isVisible(), true);
    const evaluate = page.evaluate.bind(page);
    const disposal = deferred();
    if (held) {
      page.evaluate = (fn, args) =>
        fn.name === 'disposeSampler'
          ? disposal.promise.then(() => evaluate(fn, args))
          : evaluate(fn, args);
    }
    const beforeSuccess = received.filter((sample) => sample.ordinal);
    const success = now();
    observation.outcome('ready', success);
    await observation.end();
    await page.goBack();
    const atHome = await evaluate(() => globalThis.__readinessWork.reads);
    if (held) {
      assert(
        atHome > beforeSuccess.length,
        'Page work continues independently of collector acceptance',
      );
      await evaluate(() => {
        globalThis.__readinessWork.holdNext = true;
      });
      await page.waitForFunction(() => globalThis.__readinessWork.delayed !== null);
      const beforeExpiry = await evaluate(() => globalThis.__readinessWork.reads);
      await page.waitForFunction(
        (expires) => performance.now() >= expires,
        beforeSuccess[0].nowMs + 6500,
      );
      const afterExpiry = await evaluate(() => {
        globalThis.__readinessWork.delayed();
        return globalThis.__readinessWork.reads;
      });
      assert.equal(
        afterExpiry,
        beforeExpiry,
        'A delayed callback past expiry must not read layout',
      );
      disposal.resolve();
    } else {
      await evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      assert.equal(await evaluate(() => globalThis.__readinessWork.reads), atHome);
      assert.equal(
        await evaluate(() => Object.hasOwn(globalThis, '__mindsproutReadinessSampler')),
        false,
      );
    }
    const evidence = await fixture.finish();
    assert.deepEqual(evidence.outcome, {
      status: 'ready',
      at: { epochMs: success.at, elapsedMs: success.ms },
    });
    assert.deepEqual(
      evidence.routes.observations.map((entry) => entry.route),
      ['editor'],
    );
    assert(evidence.marker.samples.length <= beforeSuccess.length);
    assert.equal(
      evidence.marker.samples.some((sample) => sample.receipt.phase === 'failed-tail'),
      false,
    );
    assert.deepEqual(evidence.marker.firstVisible.at, {
      timeOriginMs: beforeSuccess[0].timeOriginMs,
      nowMs: beforeSuccess[0].nowMs,
    });
    assert.equal(evidence.marker.shutdown, held ? 'unknown' : 'stopped');
    assert.equal(evidence.marker.codes.includes('sampler-disposal-timeout'), held);
    noSecrets(evidence);
  });
}
