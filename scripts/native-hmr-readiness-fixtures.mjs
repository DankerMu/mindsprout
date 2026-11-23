import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { observeNavigation } from './native-hmr-observation.mjs';
import { createRuntimeProfile, launchNativeBrowser } from './native-hmr-runtime-profile.mjs';
import { digest, temporary } from './native-hmr-profile-fixtures.mjs';
import { waitForObserved } from './native-hmr-support.mjs';

export async function liveReadiness(t, { profile = true } = {}) {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const started = performance.now();
  const now = () => ({ at: Date.now(), ms: performance.now() - started });
  const profiling = createRuntimeProfile(
    { profile, repo, out: output, mode: 'source-change', started },
    () => ({ generation: 0, trial: 0 }),
  );
  profiling.prepare({ target: 'aarch64-apple-darwin', binarySha256: digest }, {});
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<!doctype html><link rel="icon" href="data:,"><div data-testid="map-editor-ready" style="width:20px;height:20px"></div>',
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
  const defaultEvents = [];
  const observation = observeNavigation(
    { page, cdp, label: 'retained-editor' },
    (type, data) => defaultEvents.push({ type, data }),
    diagnostic,
    profile
      ? undefined
      : { origin, now, mode: 'source-change', context: () => ({ generation: 0, trial: 0 }) },
  );
  const events = new EventEmitter();
  const received = [];
  cdp.on('Runtime.bindingCalled', ({ name, payload }) => {
    if (name !== '__mindsproutReadinessSample') return;
    try {
      received.push(JSON.parse(payload));
    } catch {
      return;
    }
    events.emit('event');
  });
  const readEvidence = () =>
    profile
      ? JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8')).publicCreate
      : defaultEvents.find(({ type }) => type === 'public-create-evidence')?.data;
  return {
    page,
    browser,
    cdp,
    profiling,
    observation,
    now,
    received,
    requests,
    readEvidence,
    sampled: (predicate) =>
      waitForObserved(events, () => received.some(predicate), 1000, 'Fixture sample'),
    async finish() {
      if (!profile) observation.finish?.();
      await close();
      await profiling.finish(true);
      if (!profile) {
        assert.equal(fs.existsSync(path.join(output, 'safe')), false);
        assert.equal(fs.existsSync(path.join(repo, '.next-profiles')), false);
      }
      return readEvidence();
    },
  };
}

export async function countSamplerWork(page) {
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
