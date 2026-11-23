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
  assertSourceProof,
  sourceStimulus,
  deadline,
  listening,
  processGroup,
  waitForReadiness,
  capturePage,
  nativeIdentity,
  publicMap,
  registerNativeProbeUser,
  clock,
  editorChunkFile,
  editorUpdates,
  firstNavigationGate,
  visibleWithin,
} from './native-hmr-support.mjs';
import { waitForHmrBaseline, subscriptionResources } from './native-hmr-baseline.mjs';
import { trackInitialScripts } from './native-hmr-inventory.mjs';
import {
  saveCacheIdentity,
  observeNavigation,
  observeEditorVisit,
  observeScripts,
  probeLiterals,
  probeTimeline,
} from './native-hmr-observation.mjs';
import { parseNativeBrowserArgs } from './native-hmr-profile.mjs';
import { createRuntimeProfile, launchNativeBrowser } from './native-hmr-runtime-profile.mjs';

const { mode, output, candidateManifest, profile } = parseNativeBrowserArgs(process.argv.slice(2));
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
const values = [valueA, valueB];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (name) => path.join(out, name);
const cachePathExists = (name) => fs.lstatSync(name, { throwIfNoEntry: false }) !== undefined;
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
const context = () => ({ generation, trial });
const profiling = createRuntimeProfile({ profile, repo, out, mode, started }, context);
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
let signalReceived = false;
const interrupted = new Promise((_, reject) => {
  interrupt = reject;
});
interrupted.catch(() => {
  // Guard races observe the original rejection even when a signal arrives between operations.
});
const guard = (promise) => Promise.race([promise, interrupted]);
const removeSignalHandlers = profiling.registerSignals((error) => {
  signalReceived = true;
  interrupt(error);
});
const defaultCreate = { origin, now, mode, context, interrupted: () => signalReceived };

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
  profiling.beginServer();
  const fd = fs.openSync(file(`server-${generation}.log`), 'wx');
  const env = { ...process.env };
  if (value) env[variable] = value;
  server = spawn('pnpm', profile ? ['dev', '--experimental-cpu-prof'] : ['dev'], {
    cwd: repo,
    env,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
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
  const group = await profiling.stopServer(owned, serverExit);
  server = undefined;
  record('server-stopped', { pid: owned.pid });
  await profiling.collectServer(owned.pid, group);
}
async function pauseBrowser() {
  if (profile) await profiling.suspend();
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
  if (profile) profiling.paused();
  const group = processGroup(child.pid);
  record('browser-stopped', { pid: child.pid, group });
  handles();
  assert(
    group.length && group.every((item) => /[TZ]/.test(item.state)),
    'Browser pause was not confirmed',
  );
}
async function resumeBrowser(collect = true) {
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
  const child = pausedBrowser;
  process.kill(-child.pid, 'SIGCONT');
  pausedBrowser = undefined;
  const resumed = profile ? profiling.resume(collect) : undefined;
  record('browser-resumed', { pid: child.pid });
  handles();
  await resumed;
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
  if (!profile)
    state.navigationObservation = observeNavigation(state, record, undefined, defaultCreate);
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
  page.on('crash', () => {
    state.crashed = true;
    record('crash', {}, label);
  });
  cdp.on('Network.requestWillBeSent', (data) => {
    profiling.recordNetwork(data, label);
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
  observeScripts(state, {
    origin,
    out,
    record,
    chunks,
    pendingBodies,
    literals: probeLiterals(mode),
    elapsed: () => now().ms,
    context: () => ({ generation, trial }),
  });
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  state.frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  if (profile) {
    const diagnostic = await profiling.attach(page, cdp, label, browser, { origin });
    state.navigationObservation = observeNavigation(state, record, diagnostic);
  }
  return state;
}
const capture = (state, name, publicCreate) => capturePage(state, name, out, publicCreate);
const visitEditor = (state, action, expectedPath) =>
  observeEditorVisit(state, action, expectedPath, { guard, readiness, now });
async function homeBack(state) {
  await guard(state.page.goBack({ waitUntil: 'commit', timeout: 5000 }));
  await guard(
    state.page
      .getByRole('button', { name: '新建导图', exact: true })
      .waitFor({ state: 'visible', timeout: 5000 }),
  );
  assert.equal(new URL(state.page.url()).pathname, '/');
}
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
  await guard(deadline(Promise.all([...pendingBodies]), 5000, 'Retained script bodies'));
  const editorChunk = editorChunkFile(cache, chunks, retained.label, valueA);
  phase = 'source-observation';
  const stimulus = record('source-change-start', { from: valueA, to: valueB });
  cas(stimulatedB);
  handles();
  const sinceStimulus = clock(stimulus.ms, () => now().ms);
  const retainedUpdate = visibleWithin(
    retained.page.getByTestId(probe).filter({ hasText: valueB }),
    sinceStimulus,
    () => record('visible-HMR-B', {}, retained.label),
    'Source HMR exceeded 5000ms',
  );
  const updates = () => editorUpdates(result.events, retained.label, stimulus.ms, sourceRelative);
  const waited = await guard(
    firstNavigationGate({ observed, updates, file: editorChunk, values, clock: sinceStimulus }),
  );
  const gate = record('first-navigation-gate', waited);
  const navigation = record('first-navigation-start', { mapPath });
  const { endMs, remaining } = clock(navigation.ms, () => now().ms);
  const navigate = target.page.locator(`a[href="${mapPath}"]`).click({ timeout: remaining() });
  const editorReady = readiness(target, navigation, 'first-source-navigation', mapPath);
  const newValue = target.page
    .getByTestId(probe)
    .filter({ hasText: valueB })
    .waitFor({ state: 'visible', timeout: remaining() })
    .then(() => record('visible-first-navigation-B', {}, target.label));
  const timeline = probeTimeline(target, { probe, values, elapsed: () => now().ms, record });
  result.targetProbe = timeline.samples;
  timeline.follow(editorReady, endMs);
  await guard(Promise.all([retainedUpdate, navigate, editorReady, newValue])).catch(
    async (error) => {
      await timeline.failure(() => capture(target, 'failure-first-navigation'));
      throw error;
    },
  );
  timeline.stop();
  const loaderAfter = (await retained.cdp.send('Page.getFrameTree')).frameTree.frame.loaderId;
  result.sourceProof = {
    retainedDocuments: retained.documents.length - documents,
    retainedReloads: retained.reloads.length - reloads,
    retainedLoader,
    loaderAfter,
    targetDocuments: target.documents.length - targetDocuments,
    targetReloads: target.reloads.length - targetReloads,
    sourceToNavigationMs: navigation.ms - stimulus.ms,
    stimulusToGateMs: gate.ms - stimulus.ms,
    gateToNavigationMs: navigation.ms - gate.ms,
    gate: gate.data,
    receivedUpdateFrames: updates().length,
  };
  assertSourceProof(result.sourceProof);
  assert.equal(new URL(target.page.url()).pathname, mapPath);
  await capture(retained, 'source-retained-B');
  await capture(target, 'source-first-navigation-B');
  await timeline.finish();
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
    phase = 'restart-observation';
    await pauseBrowser();
    await stopServer();
    window = { documents: 0, reloads: 0, restarts: 0, connected: [], subscriptions: [] };
    const api = await startServer(condition.value);
    await resumeBrowser();
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
    await resumeBrowser(false);
  } catch (error) {
    errors.push(error.message);
  }
  browserServer = await profiling.closeBrowser(browser, browserServer, errors);
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
        profiling.assertCacheRestorable();
        if (cachePathExists(cache)) fs.renameSync(cache, file('cache-observed'));
        if (cachePathExists(file('cache-original'))) fs.renameSync(file('cache-original'), cache);
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
  await profiling.finish(!server);
}
async function startRuntime() {
  assert(!(await listening()), 'Port 3000 occupied; refusing an unowned runtime');
  assert(!Object.hasOwn(process.env, variable), 'Synthetic probe variable already set');
  assert(!process.env.__INTERNAL_CUSTOM_TURBOPACK_BINDINGS, 'Custom bindings are not permitted');
  result.addon = await nativeIdentity(candidateManifest);
  if (!profiling.prepare(result.addon, result)) return;
  prepareSource();
  if (cachePathExists(cache)) fs.renameSync(cache, file('cache-original'));
  cacheOwned = true;
  result.cacheIdentity = saveCacheIdentity(file('cache-original'), file('cache-identity.json'));
  if (cachePathExists(file('cache-original')))
    fs.cpSync(file('cache-original'), cache, { recursive: true, preserveTimestamps: true });
  await startServer(mode === 'restored-lifecycle' ? 'probe79-A' : undefined);
  browserServer = await launchNativeBrowser();
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext();
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(5000);
  await registerNativeProbeUser(context, origin);
  retained = await attach(await context.newPage(), 'retained-editor');
  phase = 'public-map-setup';
  return context;
}
async function run() {
  fs.mkdirSync(out, { recursive: false });
  try {
    const context = await startRuntime();
    if (!context) return;
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
        await capture(retained, 'failure', retained.navigationObservation.failedCreateCapture());
      } catch (captureError) {
        result.failures.push(captureError.message);
      }
    }
  } finally {
    try {
      retained?.navigationObservation?.finish();
    } finally {
      phase = 'cleanup';
      // Observation only: bodies requested before shutdown are saved, never affecting status.
      await deadline(Promise.all([...pendingBodies]), 5000, 'Script body capture').catch((error) =>
        record('chunk-body-error', { message: error.message }),
      );
      await cleanup();
    }
    save('chunks.json', chunks);
    save('readiness.json', readies);
    profiling.recordInterrupt(result, record);
    save('result.json', result);
    removeSignalHandlers();
    process.exitCode = result.status === 'passed' ? 0 : 1;
    const { status, failures, cleanup: cleanupResult } = result;
    console.log(JSON.stringify({ status, failures, cleanup: cleanupResult, out }));
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
