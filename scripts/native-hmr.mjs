import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';
import { chromium } from '@playwright/test';
import {
  assertQuiet,
  sourceStimulus,
  deadline,
  listening,
  processGroup,
  stopOwnedProcessGroup,
  waitForReadiness,
  capturePage,
  nativeIdentity,
  publicMap,
  waitForObserved as waitForEvent,
  changesEditor as changesSource,
} from './native-hmr-support.mjs';
import { waitForHmrBaseline, subscriptionResources } from './native-hmr-baseline.mjs';
import { trackInitialScripts } from './native-hmr-inventory.mjs';
import { observeNavigation } from './native-hmr-observation.mjs';

const [mode, output, candidateManifest] = process.argv.slice(2);
assert(
  ['restored-lifecycle', 'source-change'].includes(mode) && output,
  'Usage: pnpm native:browser restored-lifecycle|source-change FRESH_OUTPUT_DIRECTORY [CANDIDATE_MANIFEST]',
);
const repo = process.cwd();
const out = path.resolve(output);
const origin = 'http://localhost:3000';
const sourceRelative =
  mode === 'source-change'
    ? 'src/app/maps/[id]/MapEditor.tsx'
    : 'src/app/providers/MapRepositoryProvider.tsx';
const source = path.join(repo, sourceRelative);
const cache = path.join(repo, '.next/dev');
const variable = 'NEXT_PUBLIC_MINDSPROUT_79_PROBE';
const probe = mode === 'source-change' ? 'native-hmr-proof' : 'probe79-compiled-value';
const valueA = 'Native HMR A';
const valueB = 'Native HMR B';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (name) => path.join(out, name);
const started = performance.now();
const result = {
  mode,
  repo,
  source,
  deadlineMs: 5000,
  observationMs: 15000,
  events: [],
  trials: [],
  failures: [],
  status: 'setup',
};
const observed = new EventEmitter();
let phase = 'setup',
  generation = -1,
  trial = 0;
let server, serverExit, browserServer, browser, pausedBrowser;
let original,
  ownedHash,
  stimulatedB,
  sourceOwned = false,
  cacheOwned = false;
let retained, window;
const pendingBodies = new Set();
const chunks = [];
const readies = [];
const now = () => ({ at: Date.now(), ms: performance.now() - started });
const save = (name, value) => {
  fs.writeFileSync(file(name + '.pending'), JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(file(name + '.pending'), file(name));
};
const record = (type, data = {}, page = 'collector') => {
  const event = { ...now(), phase, generation, trial, page, type, data };
  result.events.push(event);
  fs.appendFileSync(file('events.jsonl'), JSON.stringify(event) + '\n');
  observed.emit('event');
  return event;
};
let interrupt;
const interrupted = new Promise((_, reject) => {
  interrupt = reject;
});
interrupted.catch(() => {
  // Guard races observe the original rejection even when a signal arrives between operations.
});
const guard = (promise) => Promise.race([promise, interrupted]);
const sigterm = () => interrupt(new Error('Interrupted by SIGTERM'));
const sigint = () => interrupt(new Error('Interrupted by SIGINT'));
process.on('SIGTERM', sigterm);
process.on('SIGINT', sigint);

const waitForObserved = (predicate, ms, label) => waitForEvent(observed, predicate, ms, label);
function handles() {
  save('handles.json', {
    active: Boolean(server || browserServer),
    collectorPid: process.pid,
    serverPid: server?.pid,
    browserPid: browserServer?.process()?.pid,
    pausedBrowserPid: pausedBrowser?.pid,
    sourceOwned,
    ownedHash,
    cacheOwned,
    phase,
    repo,
    out,
  });
}
function cas(bytes) {
  assert(fs.lstatSync(source).isFile(), 'Source must remain a regular file');
  assert.equal(
    hash(fs.readFileSync(source)),
    ownedHash,
    'Source ownership conflict; refusing overwrite',
  );
  fs.writeFileSync(source, bytes);
  ownedHash = hash(bytes);
  assert.equal(hash(fs.readFileSync(source)), ownedHash, 'Source changed during owned write');
}
async function startServer(value) {
  generation++;
  const fd = fs.openSync(file(`server-${generation}.log`), 'wx');
  const env = { ...process.env };
  if (value) env[variable] = value;
  server = spawn('pnpm', ['dev'], { cwd: repo, env, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  serverExit = new Promise((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
  });
  serverExit.catch(() => {
    // Shutdown observes this rejection; attach early to avoid an unhandled spawn error.
  });
  handles();
  await guard(
    deadline(
      (async () => {
        while (!(await listening())) {
          assert(
            server.exitCode === null && server.signalCode === null,
            'Dev server exited during startup',
          );
          await sleep(50);
        }
      })(),
      30000,
      'Server TCP startup',
    ),
  );
  // No page warmup: the single route handler must execute before reconnect.
  const begin = record('api-request', { url: '/api/healthz' });
  const response = await guard(
    fetch(origin + '/api/healthz', { signal: AbortSignal.timeout(10000) }),
  );
  const body = await response.text();
  const end = record('api-response', { status: response.status, body });
  assert.equal(response.status, 200, 'The health route must execute normally');
  return { begin, end };
}
async function stopServer() {
  if (!server) return;
  const owned = server;
  await stopOwnedProcessGroup(owned, serverExit);
  server = undefined;
  record('server-stopped', { pid: owned.pid });
}
function pauseBrowser() {
  const child = browserServer.process();
  assert(
    child.exitCode === null && child.signalCode === null && child.pid !== process.pid,
    'Browser must be live and owned',
  );
  assert(
    processGroup(child.pid).some((item) => item.pid === child.pid),
    'Browser must lead its process group',
  );
  process.kill(-child.pid, 'SIGSTOP');
  pausedBrowser = child;
  const group = processGroup(child.pid);
  record('browser-stopped', { pid: child.pid, group });
  handles();
  assert(
    group.length && group.every((item) => /[TZ]/.test(item.state)),
    'Browser pause was not confirmed',
  );
}
function resumeBrowser() {
  if (!pausedBrowser) return;
  assert.equal(browserServer.process(), pausedBrowser, 'Browser ownership changed');
  assert(
    pausedBrowser.exitCode === null && pausedBrowser.signalCode === null,
    'Owned browser exited',
  );
  assert(
    processGroup(pausedBrowser.pid).some((item) => item.pid === pausedBrowser.pid),
    'Owned browser leader disappeared',
  );
  process.kill(-pausedBrowser.pid, 'SIGCONT');
  record('browser-resumed', { pid: pausedBrowser.pid });
  pausedBrowser = undefined;
  handles();
}
async function readiness(state, start, label, expectedPath) {
  const elapsedMs = await waitForReadiness(state, start, expectedPath, started);
  const ready = record('editor-ready', { elapsedMs, label, expectedPath }, state.label);
  readies.push(ready);
}
function checkLoop() {
  if (window && window.documents > 3 && window.restarts >= 2 && window.reloads >= 2) {
    interrupt(new Error('Repeated native resource restart/document reload loop'));
  }
}
async function attach(page, label) {
  const cdp = await page.context().newCDPSession(page);
  const state = {
    page,
    cdp,
    label,
    frameId: null,
    documents: [],
    reloads: [],
    frames: [],
    readiness: [],
  };
  trackInitialScripts(state, observed);
  state.navigationObservation = observeNavigation(state, record);
  page.on('console', (message) =>
    record(
      'console',
      { type: message.type(), text: message.text(), location: message.location() },
      label,
    ),
  );
  page.on('pageerror', (error) =>
    record('pageerror', { message: error.message, stack: error.stack }, label),
  );
  page.on('crash', () => record('crash', {}, label));
  cdp.on('Network.requestWillBeSent', (data) => {
    record(
      'browser-request',
      {
        requestId: data.requestId,
        type: data.type,
        url: data.request.url,
        frameId: data.frameId,
        loaderId: data.loaderId,
        timestamp: data.timestamp,
        wallTime: data.wallTime,
      },
      label,
    );
    if (data.type === 'Document' && data.frameId === state.frameId) {
      state.documents.push(
        record('document', { url: data.request.url, loaderId: data.loaderId }, label),
      );
      if (window) {
        window.documents++;
        checkLoop();
      }
    }
  });
  cdp.on('Page.frameRequestedNavigation', (data) => {
    record('requested-navigation', data, label);
    if (data.frameId === state.frameId && data.reason === 'reload') {
      state.reloads.push(result.events.at(-1));
      if (window) {
        window.reloads++;
        checkLoop();
      }
    }
  });
  cdp.on('Page.frameNavigated', (data) => {
    record('frame-navigated', data, label);
    if (data.frame.id !== state.frameId || mode !== 'restored-lifecycle') return;
    const request = state.documents.findLast(
      (event) => event.data.loaderId === data.frame.loaderId,
    );
    const pathname = new URL(data.frame.url).pathname;
    if (!request || !pathname.startsWith('/maps/')) return;
    const pending = readiness(state, request, 'document-commit', pathname).catch((error) => {
      result.failures.push(error.message);
    });
    state.readiness.push(pending);
  });
  for (const name of [
    'Network.webSocketCreated',
    'Network.webSocketClosed',
    'Network.webSocketFrameError',
    'Network.webSocketFrameReceived',
    'Network.webSocketFrameSent',
    'Network.loadingFailed',
  ]) {
    cdp.on(name, (data) => {
      const event = record(name, data, label);
      if (name === 'Network.webSocketFrameReceived') state.frames.push(event);
      if (!window) return;
      const payload = data.response?.payloadData || '';
      if (name === 'Network.webSocketFrameReceived') {
        if (payload.includes('turbopack-connected')) window.connected.push(event);
        window.restarts += (payload.match(/"type"\s*:\s*"restart"/g) || []).length;
        checkLoop();
      }
      if (name === 'Network.webSocketFrameSent' && payload.includes('turbopack-subscribe'))
        window.subscriptions.push(event);
    });
  }
  const scripts = new Map();
  cdp.on('Network.responseReceived', (data) => {
    if (
      mode === 'restored-lifecycle' &&
      data.type === 'Script' &&
      data.response.url.startsWith(origin + '/')
    ) {
      scripts.set(data.requestId, { url: data.response.url, generation, trial });
    }
  });
  cdp.on('Network.loadingFinished', (data) => {
    const response = scripts.get(data.requestId);
    if (!response) return;
    scripts.delete(data.requestId);
    const pending = cdp
      .send('Network.getResponseBody', { requestId: data.requestId })
      .then((body) => {
        const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
        const literals = ['probe79-A', 'probe79-B', 'probe79-C', 'probe79-D'].filter((value) =>
          bytes.toString('utf8').includes(value),
        );
        const entry = { ...response, sha256: hash(bytes), literals };
        fs.writeFileSync(file(`chunk-${entry.sha256}.js`), bytes);
        chunks.push(entry);
        record('chunk-body', entry, label);
      })
      .catch((error) => record('chunk-body-error', { message: error.message }, label))
      .finally(() => pendingBodies.delete(pending));
    pendingBodies.add(pending);
  });
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  state.frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  return state;
}
const capture = (state, name) => capturePage(state, name, out);
async function visitEditor(state, action, expectedPath) {
  if (expectedPath === undefined) await state.navigationObservation.begin();
  try {
    const start = now();
    await guard(action());
    await guard(readiness(state, start, 'public-navigation', expectedPath));
    assert.equal(
      await state.page.getByText('未保存到浏览器', { exact: true }).count(),
      0,
      'Map must be persisted',
    );
  } finally {
    if (expectedPath === undefined) await state.navigationObservation.end();
  }
}
async function homeBack(state) {
  await guard(state.page.goBack({ waitUntil: 'commit', timeout: 5000 }));
  await guard(
    state.page
      .getByRole('button', { name: '新建导图', exact: true })
      .waitFor({ state: 'visible', timeout: 5000 }),
  );
  assert.equal(new URL(state.page.url()).pathname, '/');
}
const changesEditor = (event) => changesSource(event, sourceRelative);
async function sourceChange(context, mapPath) {
  const previous = new Set(
    subscriptionResources(result.events, retained.label).map((item) => item.path),
  );
  phase = 'retained-document-setup';
  const setup = record('retained-editor-document-start', { mapPath });
  const setupRemaining = () => Math.max(1, 5000 - (performance.now() - started - setup.ms));
  await guard(
    retained.page.goto(origin + mapPath, { waitUntil: 'commit', timeout: setupRemaining() }),
  );
  await guard(
    retained.page
      .getByTestId('map-editor-ready')
      .waitFor({ state: 'visible', timeout: setupRemaining() }),
  );
  await guard(
    retained.page
      .getByTestId(probe)
      .filter({ hasText: valueA })
      .waitFor({ state: 'visible', timeout: setupRemaining() }),
  );
  await guard(
    waitForHmrBaseline(
      retained,
      result.events,
      observed,
      record,
      (baseline) => {
        result.subscriptionPrerequisite = { setup, ...baseline };
      },
      { since: setup.ms, timeoutMs: setupRemaining() },
    ),
  );
  assert(
    result.subscriptionPrerequisite.inventory.resources.some((item) => !previous.has(item.path)),
    'Editor document must establish a new route-specific chunk-list subscription',
  );
  assert(
    performance.now() - started - setup.ms <= 5000,
    'Retained subscription setup exceeded 5000ms',
  );
  phase = 'source-preparation';
  const target = await attach(await context.newPage(), 'first-navigation');
  await guard(target.page.goto(origin, { waitUntil: 'commit', timeout: 5000 }));
  await guard(target.page.getByTestId('app-ready').waitFor({ state: 'visible', timeout: 5000 }));
  const retainedLoader = (await retained.cdp.send('Page.getFrameTree')).frameTree.frame.loaderId;
  const documents = retained.documents.length,
    reloads = retained.reloads.length;
  const targetDocuments = target.documents.length,
    targetReloads = target.reloads.length;
  await capture(retained, 'source-before-A');
  await guard(
    waitForHmrBaseline(target, result.events, observed, record, (baseline) => {
      result.targetSubscriptionPrerequisite = baseline;
    }),
  );
  phase = 'source-observation';
  const stimulus = record('source-change-start', { from: valueA, to: valueB });
  cas(stimulatedB);
  handles();
  const navigation = record('first-navigation-start', { mapPath });
  const endMs = navigation.ms + 5000;
  const remaining = () => Math.max(1, endMs - (performance.now() - started));
  const retainedUpdate = retained.page
    .getByTestId(probe)
    .filter({ hasText: valueB })
    .waitFor({ state: 'visible', timeout: remaining() })
    .then(() => {
      assert(record('visible-HMR-B', {}, retained.label).ms <= endMs, 'Source HMR exceeded 5000ms');
    });
  const navigate = target.page.locator(`a[href="${mapPath}"]`).click({ timeout: remaining() });
  const editorReady = readiness(target, navigation, 'first-source-navigation', mapPath);
  const newValue = target.page
    .getByTestId(probe)
    .filter({ hasText: valueB })
    .waitFor({ state: 'visible', timeout: remaining() });
  const moduleUpdate = waitForObserved(
    () =>
      result.events.some(
        (event) => event.page === retained.label && event.ms >= stimulus.ms && changesEditor(event),
      ),
    remaining(),
    'Changed editor module HMR',
  );
  await guard(Promise.all([retainedUpdate, navigate, editorReady, newValue, moduleUpdate]));
  const loaderAfter = (await retained.cdp.send('Page.getFrameTree')).frameTree.frame.loaderId;
  result.sourceProof = {
    retainedDocuments: retained.documents.length - documents,
    retainedReloads: retained.reloads.length - reloads,
    retainedLoader,
    loaderAfter,
    targetDocuments: target.documents.length - targetDocuments,
    targetReloads: target.reloads.length - targetReloads,
    sourceToNavigationMs: navigation.ms - stimulus.ms,
    receivedUpdateFrames: result.events.filter(
      (event) => event.page === retained.label && event.ms >= stimulus.ms && changesEditor(event),
    ).length,
  };
  assert.equal(result.sourceProof.retainedDocuments, 0);
  assert.equal(result.sourceProof.retainedReloads, 0);
  assert.equal(loaderAfter, retainedLoader, 'Retained HMR replaced its document');
  assert.equal(result.sourceProof.targetDocuments, 0);
  assert.equal(result.sourceProof.targetReloads, 0);
  assert(result.sourceProof.receivedUpdateFrames > 0, 'Missing partial MapEditor HMR');
  assert.equal(new URL(target.page.url()).pathname, mapPath);
  await capture(retained, 'source-retained-B');
  await capture(target, 'source-first-navigation-B');
}
async function restoredLifecycle(mapPath) {
  let currentValue = 'probe79-A';
  await homeBack(retained);
  assert.equal(await retained.page.getByTestId(probe).textContent(), currentValue);
  await Promise.all([...pendingBodies]);
  assert(
    chunks.some((entry) => entry.generation === 0 && entry.literals.includes(currentValue)),
    'Missing baseline client literal',
  );
  const trials = [
    { id: 1, retained: 'editor', roundTrips: 1, value: 'probe79-A' },
    { id: 2, retained: 'editor', roundTrips: 1, value: 'probe79-B' },
    { id: 3, retained: 'editor', roundTrips: 2, value: 'probe79-C' },
    { id: 4, retained: 'home', roundTrips: 1, value: 'probe79-D' },
  ];
  for (const condition of trials) {
    trial = condition.id;
    phase = 'spa-preparation';
    if (new URL(retained.page.url()).pathname !== '/') await homeBack(retained);
    const before = retained.documents.length;
    for (let trip = 0; trip < condition.roundTrips; trip++) {
      await visitEditor(
        retained,
        () => retained.page.locator(`a[href="${mapPath}"]`).click(),
        mapPath,
      );
      await guard(sleep(2000));
      await homeBack(retained);
      await guard(sleep(2000));
    }
    if (condition.retained === 'editor')
      await visitEditor(
        retained,
        () => retained.page.locator(`a[href="${mapPath}"]`).click(),
        mapPath,
      );
    assert.equal(retained.documents.length - before, 0, 'SPA preparation made document requests');
    if (condition.retained === 'home')
      await guard(retained.page.goto(origin, { waitUntil: 'commit', timeout: 5000 }));
    await guard(sleep(3000));
    assert.equal(await retained.page.getByTestId(probe).textContent(), currentValue);
    pauseBrowser();
    await stopServer();
    phase = 'restart-observation';
    window = { documents: 0, reloads: 0, restarts: 0, connected: [], subscriptions: [] };
    const api = await startServer(condition.value);
    resumeBrowser();
    await guard(sleep(15000));
    await Promise.all([...pendingBodies, ...retained.readiness]);
    const apiFirst = Boolean(
      window.connected[0] &&
      window.subscriptions[0] &&
      api.end.at < window.connected[0].at &&
      api.end.at < window.subscriptions[0].at,
    );
    const value = await retained.page.getByTestId(probe).textContent({ timeout: 1000 });
    const chunkValueObserved = chunks.some(
      (entry) => entry.generation === generation && entry.literals.includes(condition.value),
    );
    const summary = { ...condition, ...window, apiFirst, value, chunkValueObserved };
    result.trials.push(summary);
    save(`trial-${trial}.json`, summary);
    assert(apiFirst, 'Health response must precede connection and subscription');
    assert(chunkValueObserved, 'Expected compiled client literal was not captured');
    assert.equal(value, condition.value);
    assert.equal(window.documents, 1, 'Expected exactly one normal reconnect document');
    assert.equal(window.reloads, 1, 'Expected exactly one normal reconnect reload');
    assert.equal(window.restarts, 0, 'Native resource restart message observed');
    assert.equal(result.failures.length, 0, 'Reconnect readiness failed');
    await capture(retained, `restored-${trial}`);
    currentValue = condition.value;
    window = undefined;
  }
}
function prepareSource() {
  original = fs.readFileSync(source);
  ownedHash = hash(original);
  const stimulus = sourceStimulus(original, { mode, probe, valueA, valueB, variable });
  const stimulated = stimulus.stimulated;
  stimulatedB = stimulus.stimulatedB;
  fs.writeFileSync(file('source-original.tsx'), original, { flag: 'wx' });
  save('source-manifest.json', {
    source,
    originalHash: ownedHash,
    aHash: hash(stimulated),
    bHash: hash(stimulatedB),
  });
  cas(stimulated);
  sourceOwned = true;
}
async function stopOwnedProcesses(errors) {
  try {
    resumeBrowser();
  } catch (error) {
    errors.push(error.message);
  }
  try {
    await deadline(browser?.close() || Promise.resolve(), 5000, 'Browser close');
    await deadline(browserServer?.close() || Promise.resolve(), 5000, 'Browser process close');
    browserServer = undefined;
  } catch (error) {
    errors.push(error.message);
  }
  try {
    await stopServer();
  } catch (error) {
    errors.push(error.message);
  }
}
function restoreOwnedFiles(errors) {
  if (!server) {
    if (sourceOwned) {
      try {
        cas(original);
        sourceOwned = false;
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (cacheOwned) {
      try {
        if (fs.existsSync(cache)) fs.renameSync(cache, file('cache-observed'));
        if (fs.existsSync(file('cache-original'))) fs.renameSync(file('cache-original'), cache);
        cacheOwned = false;
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
}
function recordCleanup(errors) {
  const sourceHash = original && hash(fs.readFileSync(source));
  result.cleanup = {
    errors,
    sourceRestored: !sourceOwned,
    cacheRestored: !cacheOwned,
    sourceHash,
    expectedSourceHash: original && hash(original),
  };
  if (errors.length || sourceOwned || cacheOwned || sourceHash !== (original && hash(original)))
    result.status = 'cleanup-blocked';
  save('cleanup.json', result.cleanup);
  handles();
}
async function cleanup() {
  const errors = [];
  await stopOwnedProcesses(errors);
  restoreOwnedFiles(errors);
  recordCleanup(errors);
}
async function startRuntime() {
  assert(!(await listening()), 'Port 3000 occupied; refusing an unowned runtime');
  assert(!Object.hasOwn(process.env, variable), 'Synthetic probe variable already set');
  assert(!process.env.__INTERNAL_CUSTOM_TURBOPACK_BINDINGS, 'Custom bindings are not permitted');
  result.addon = await nativeIdentity(candidateManifest);
  prepareSource();
  if (fs.existsSync(cache)) fs.renameSync(cache, file('cache-original'));
  cacheOwned = true;
  if (fs.existsSync(file('cache-original')))
    fs.cpSync(file('cache-original'), cache, { recursive: true, preserveTimestamps: true });
  await startServer(mode === 'restored-lifecycle' ? 'probe79-A' : undefined);
  browserServer = await chromium.launchServer(
    process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  );
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext();
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  retained = await attach(await context.newPage(), 'retained-editor');
  phase = 'public-map-setup';
  return context;
}
async function run() {
  fs.mkdirSync(out, { recursive: false });
  try {
    const context = await startRuntime();
    const mapPath = await publicMap(retained, origin, guard, visitEditor, homeBack);
    if (mode === 'restored-lifecycle') await restoredLifecycle(mapPath);
    else await sourceChange(context, mapPath);
    assertQuiet(result.events);
    assert.equal(result.failures.length, 0);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.failures.push(error.message);
    record('failure', { message: error.message, stack: error.stack });
    if (retained && !pausedBrowser) {
      try {
        await capture(retained, 'failure');
      } catch (captureError) {
        result.failures.push(captureError.message);
      }
    }
  } finally {
    phase = 'cleanup';
    await cleanup();
    save('chunks.json', chunks);
    save('readiness.json', readies);
    save('result.json', result);
    process.off('SIGTERM', sigterm);
    process.off('SIGINT', sigint);
    process.exitCode = result.status === 'passed' ? 0 : 1;
    console.log(
      JSON.stringify({
        status: result.status,
        failures: result.failures,
        cleanup: result.cleanup,
        out,
      }),
    );
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
