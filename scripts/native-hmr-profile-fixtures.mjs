import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { deadline, processGroup } from './native-hmr-support.mjs';
import { createNativeProfile } from './native-hmr-profile-collection.mjs';
import { createBrowserProfiler } from './native-hmr-browser-profile.mjs';

export {
  secret,
  sha,
  digest,
  profileName,
  temporary,
  noSecrets,
  partial,
  cpu,
  span,
  identity,
  collector,
  generationFiles,
  generation,
  deferred,
  browserIdentity,
  browserFixture,
  startSignalChild,
  startStalledSignalChild,
  reapSignalChild,
  readSignalCleanup,
  publishedSignalReadiness,
};
const secret = 'PRIVATE_CANARY_cookie-password-body-env';
const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const profileName = (role) => `${role}-2026-11-16T10-00-00.cpuprofile`;
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function noSecrets(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_CANARY|__proto__|\/private\/|https:\/\//);
}

function partial(value, code) {
  assert.equal(value.status, 'partial');
  assert.ok(value.codes.includes(code), `Expected fixed partial code ${code}`);
  noSecrets(value);
}

function cpu() {
  return {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '', scriptId: '0' }, children: [2, 3, 4] },
      { id: 2, callFrame: { functionName: secret, url: `/private/${secret}.js`, scriptId: '1' } },
      { id: 3, callFrame: { functionName: '(garbage collector)', url: '', scriptId: '0' } },
      { id: 4, callFrame: { functionName: '(idle)', url: '', scriptId: '0' } },
    ],
    startTime: 8000000000,
    endTime: 8001500000,
    samples: [2, 3, 4, 2],
    timeDeltas: [250000, 250000, 500000, 500000],
    extra: secret,
  };
}

function span(overrides = {}) {
  return {
    name: 'compile-path',
    startTime: 1794823200000,
    timestamp: 4105188000000,
    duration: 125000,
    id: 12,
    parentId: 11,
    tags: { trigger: '/maps/[id]', cookie: secret, [secret]: 42, numeric: 13 },
    traceId: secret,
    ...overrides,
  };
}

function identity() {
  return {
    workflowSha: sha,
    checkoutSha: 'c'.repeat(40),
    prHeadSha: 'd'.repeat(40),
    runId: '1234',
    runAttempt: '2',
    nodeVersion: 'v22.23.4',
    platform: 'darwin',
    arch: 'arm64',
    nativeTarget: 'darwin-arm64',
    nativeDigest: digest,
    mode: 'restored-lifecycle',
    environment: { SECRET: secret },
    repo: `/private/${secret}`,
  };
}

function collector(t, options = {}) {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const value = createNativeProfile({
    enabled: true,
    repo,
    output,
    identity: identity(),
    ...options,
  });
  return { repo, output, value, directory: path.join(repo, '.next-profiles') };
}

function generationFiles(repo, { trace = `${JSON.stringify([span()])}\n` } = {}) {
  fs.mkdirSync(path.join(repo, '.next/dev'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.next/dev/trace'), trace);
  for (const role of ['dev-main', 'dev-server']) {
    fs.writeFileSync(path.join(repo, '.next-profiles', profileName(role)), JSON.stringify(cpu()));
  }
}

function generation(index = 0) {
  return {
    generation: index,
    trial: index,
    stopped: true,
    launcherPid: 4321,
    processGroup: [4321, 4322],
    before: { epochMs: 1794823201000, elapsedMs: 1000 },
    after: { epochMs: 1794823202000, elapsedMs: 2000 },
    network: { timestamp: 42.125, wallTime: 1794823200.25, request: { url: secret } },
  };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function browserFixture(options = {}) {
  const calls = [];
  const gaps = [];
  const cdp = new EventEmitter();
  cdp.send = async (method) => {
    calls.push(method);
    return method === 'Profiler.stop' ? { profile: cpu(), secret } : {};
  };
  let elapsedMs = 0;
  const profiler = createBrowserProfiler({
    enabled: true,
    cdp,
    clock: () => ({ epochMs: 1794823200000 + elapsedMs, elapsedMs }),
    context: { generation: 0, trial: 0, page: 'retained-editor' },
    onGap: (gap) => gaps.push(gap),
    ...options,
  });
  return {
    calls,
    gaps,
    cdp,
    profiler,
    advance: (ms) => {
      elapsedMs += ms;
    },
  };
}

const childFile = fileURLToPath(new URL('./native-hmr-signal-child.mjs', import.meta.url));
const readinessMs = 10000;
const stderrLimit = 16 * 1024;
const fixtureFailureLine = Buffer.from('Browser signal fixture failed\n');
const readinessErrors = new WeakSet();
const browserCleanupOwners = new WeakMap();
const nextPhase = {
  launching: 'browser-launched',
  'browser-launched': 'connecting',
  connecting: 'ready',
};
const stalledConnect = `data:text/javascript,${encodeURIComponent(`
  import { chromium } from ${JSON.stringify(import.meta.resolve('@playwright/test'))};
  const connect = chromium.connect.bind(chromium);
  chromium.connect = async (...args) => {
    await new Promise((resolve) => {
      const onMessage = (message) => {
        if (message.type === 'cleanup') {
          process.off('message', onMessage);
          process.send({ type: 'connecting', elapsedMs: Number.MAX_SAFE_INTEGER });
        }
        if (message.type !== 'release-connect') return;
        process.off('message', onMessage);
        resolve();
      };
      process.on('message', onMessage);
      process.send({ type: 'connect-stalled' });
    });
    return connect(...args);
  };
`)}`;

function send(child, message) {
  if (child.connected) child.send(message, () => undefined);
}

function browserIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const output = execFileSync(
      '/bin/ps',
      ['-ww', '-p', String(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='],
      {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const fields = output.match(
      /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)\s*$/,
    );
    if (!fields || Number(fields[1]) !== pid || Number(fields[2]) !== pid) return null;
    return {
      started: fields[3],
      commandSha256: createHash('sha256').update(fields[4]).digest('hex'),
    };
  } catch {
    return null;
  }
}

function sameBrowserIdentity(expected, current) {
  return (
    expected !== null &&
    current !== null &&
    expected.started === current.started &&
    expected.commandSha256 === current.commandSha256
  );
}

function startSignalChild(
  mode,
  directory,
  { nodeArgs = [], executable = process.execPath, readBrowserIdentity = browserIdentity } = {},
) {
  const started = performance.now();
  const ready = deferred();
  const exited = deferred();
  const observed = {
    phase: 'launching',
    phaseMs: 0,
    browserPid: null,
    browserIdentity: null,
    stderrBytes: 0,
  };
  const stderr = Buffer.alloc(stderrLimit);
  let stderrRetainedBytes = 0;
  let state = 'pending';
  let spawnState = 'pending';
  let child;

  function readinessError(reason) {
    const { phase, phaseMs, stderrBytes } = observed;
    const fixedFailure =
      child?.stderr.readableEnded &&
      stderrBytes === fixtureFailureLine.length &&
      stderr.subarray(0, stderrRetainedBytes).equals(fixtureFailureLine);
    const error = new Error(
      `${reason}: ${JSON.stringify({
        phase,
        phaseMs,
        elapsedMs: Math.round(performance.now() - started),
        spawnState,
        exitCode: child?.exitCode ?? null,
        signal: child?.signalCode ?? null,
        stderrState: fixedFailure ? 'fixture-failed' : 'unpublished',
        stderrBytes,
        stderrRetainedBytes,
        stderrTruncated: stderrBytes > stderrRetainedBytes,
      })}`,
    );
    readinessErrors.add(error);
    return error;
  }

  try {
    child = spawn(executable, [...nodeArgs, childFile, mode, directory], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
  } catch {
    spawnState = 'spawn-failed';
    throw readinessError('Signal child could not spawn');
  }

  function fail(reason) {
    if (state !== 'pending') return;
    state = 'failed';
    clearTimeout(timer);
    ready.reject(readinessError(reason));
  }
  const timer = setTimeout(
    () => fail(`Signal child browser readiness exceeded ${readinessMs}ms`),
    readinessMs,
  );
  ready.promise.catch(() => undefined);

  function verifyLaunch(browserPid) {
    observed.browserPid = Number.isSafeInteger(browserPid) && browserPid > 0 ? browserPid : null;
    observed.browserIdentity = readBrowserIdentity(observed.browserPid);
    // A live but unverified normal launch must still be refused by the fallback reaper.
    if (observed.browserPid !== null) {
      browserCleanupOwners.set(child, {
        pid: observed.browserPid,
        identity: observed.browserIdentity,
      });
    }
    if (observed.browserIdentity === null) fail('Signal child reported an unverified browser');
  }

  function rememberLateLaunch(browserPid) {
    if (browserCleanupOwners.has(child) || !Number.isSafeInteger(browserPid) || browserPid <= 0)
      return;
    const identity = readBrowserIdentity(browserPid);
    if (identity !== null) browserCleanupOwners.set(child, { pid: browserPid, identity });
  }

  function acceptReady(browserPid) {
    if (
      browserPid !== observed.browserPid ||
      !sameBrowserIdentity(observed.browserIdentity, readBrowserIdentity(browserPid))
    ) {
      fail('Signal child ready without verified browser identity');
      return;
    }
    state = 'ready';
    clearTimeout(timer);
    ready.resolve({ browserPid });
  }

  child.stdout.resume();
  child.stderr.on('data', (bytes) => {
    observed.stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, observed.stderrBytes + bytes.length);
    const count = Math.min(bytes.length, stderrLimit - stderrRetainedBytes);
    stderrRetainedBytes += bytes.copy(stderr, stderrRetainedBytes, 0, count);
  });
  child.once('spawn', () => {
    spawnState = 'spawned';
  });
  child.on('error', () => {
    spawnState = child.pid === undefined ? 'spawn-failed' : 'child-error';
    fail(
      spawnState === 'spawn-failed' ? 'Signal child could not spawn' : 'Signal child process error',
    );
  });
  child.once('exit', (code, signal) => exited.resolve({ code, signal }));
  child.once('close', (code, signal) => {
    // Only a drained stderr stream can match the complete fixed failure line.
    fail('Signal child exited before browser readiness');
    exited.resolve({ code, signal });
  });
  child.on('message', (message) => {
    const { type, elapsedMs, browserPid } = message ?? {};
    if (type === 'browser-closed') send(child, { type: 'finish-cleanup' });
    if (type !== nextPhase[observed.phase]) return;
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < observed.phaseMs) return;
    if (state !== 'pending') {
      if (type === 'browser-launched') rememberLateLaunch(browserPid);
      return;
    }
    observed.phase = type;
    observed.phaseMs = elapsedMs;
    if (type === 'browser-launched') verifyLaunch(browserPid);
    if (type === 'ready') acceptReady(browserPid);
  });
  return {
    child,
    observed,
    ready: ready.promise,
    exited: exited.promise,
    signal(signal) {
      return (
        state === 'ready' &&
        sameBrowserIdentity(observed.browserIdentity, readBrowserIdentity(observed.browserPid)) &&
        child.kill(signal)
      );
    },
    stop() {
      fail('Signal child teardown started before browser readiness');
      state = 'stopping';
    },
  };
}

function startStalledSignalChild(mode, directory) {
  const fixture = startSignalChild(mode, directory, { nodeArgs: ['--import', stalledConnect] });
  const stalled = deferred();
  const connected = deferred();
  const phases = [];
  let verifiedAtLaunch = false;
  fixture.child.on('message', ({ type, browserPid }) => {
    if (['browser-launched', 'connecting', 'ready'].includes(type)) phases.push(type);
    if (type === 'browser-launched') {
      verifiedAtLaunch =
        browserPid === fixture.observed.browserPid &&
        sameBrowserIdentity(fixture.observed.browserIdentity, browserIdentity(browserPid));
    }
    if (type === 'connect-stalled') {
      stalled.resolve({ verifiedAtLaunch, browserPid: fixture.observed.browserPid });
    }
    if (type === 'ready') connected.resolve();
  });
  return {
    fixture,
    phases,
    stalled: stalled.promise,
    connected: connected.promise,
    releaseConnect: () => send(fixture.child, { type: 'release-connect' }),
  };
}

async function reapSignalChild(fixture) {
  const { child, exited } = fixture;
  const running = () =>
    child.pid !== undefined && child.exitCode === null && child.signalCode === null;
  fixture.stop();
  try {
    if (running()) send(child, { type: 'cleanup' });
    await deadline(exited, 10000, 'Signal child cleanup');
  } finally {
    try {
      if (running()) {
        child.kill('SIGKILL');
        await deadline(exited, 5000, 'Signal child forced cleanup');
      }
    } finally {
      const owner = browserCleanupOwners.get(child);
      if (owner) await reapBrowser(owner.pid, owner.identity);
    }
  }
}

async function reapBrowser(pid, expectedIdentity) {
  if (pid === null) return;
  const live = () => processGroup(pid).filter((member) => !member.state.startsWith('Z'));
  const remaining = live();
  if (!remaining.length) return;
  assert(
    remaining.some((member) => member.pid === pid),
    'Refusing to signal an unowned browser group',
  );
  assert(
    sameBrowserIdentity(expectedIdentity, browserIdentity(pid)),
    'Refusing to signal a browser whose process identity is unverified or changed',
  );
  process.kill(-pid, 'SIGKILL');
  await deadline(
    (async () => {
      while (live().length) await sleep(10);
    })(),
    5000,
    'Test-owned browser cleanup',
  );
}

function assertNoSignalSecrets(value) {
  try {
    noSecrets(value);
  } catch {
    assert.fail('Signal fixture output published a private canary');
  }
}

function readSignalCleanup(directory) {
  const cleanup = JSON.parse(fs.readFileSync(path.join(directory, 'cleanup.json'), 'utf8'));
  assertNoSignalSecrets(cleanup);
  return cleanup;
}

function publishedSignalReadiness(error, reason, minimumMs = 0) {
  const { message, stack, cause } = error;
  assertNoSignalSecrets({ message, stack, cause });
  const prefix = `${reason}: `;
  const matchesReason = message?.startsWith(prefix);
  if (!matchesReason && readinessErrors.has(error)) throw error;
  assert(matchesReason, `Expected bounded diagnostics after "${reason}"`);
  const { elapsedMs, ...status } = JSON.parse(message.slice(prefix.length));
  assert(Number.isSafeInteger(status.phaseMs) && status.phaseMs >= 0);
  assert(Number.isSafeInteger(elapsedMs) && elapsedMs >= Math.max(minimumMs, status.phaseMs));
  return status;
}
