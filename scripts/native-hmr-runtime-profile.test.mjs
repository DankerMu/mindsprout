import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { deadline, processGroup } from './native-hmr-support.mjs';
import {
  cpu,
  deferred,
  digest,
  generationFiles,
  noSecrets,
  secret,
  span,
  temporary,
} from './native-hmr-profile-fixtures.mjs';
import { createRuntimeProfile } from './native-hmr-runtime-profile.mjs';

const childFile = fileURLToPath(new URL('./native-hmr-signal-child.mjs', import.meta.url));

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

function startChild(mode, directory) {
  const child = spawn(process.execPath, [childFile, mode, directory], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      PLAYWRIGHT_CHROMIUM_PATH: process.env.PLAYWRIGHT_CHROMIUM_PATH || chromium.executablePath(),
    },
  });
  const ready = deferred();
  const observed = { browserPid: null, browserIdentity: null, stderr: '' };
  child.stdout.resume();
  child.stderr.on('data', (bytes) => {
    observed.stderr += bytes.toString();
  });
  child.on('message', (message) => {
    if (message.type === 'ready') {
      observed.browserPid = message.browserPid;
      observed.browserIdentity = browserIdentity(message.browserPid);
      ready.resolve(message);
    }
    if (message.type === 'browser-closed') send(child, { type: 'finish-cleanup' });
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  exited.catch(() => undefined);
  const alive = Promise.race([
    ready.promise,
    exited.then(() => {
      throw new Error('Signal child exited before browser readiness');
    }),
  ]);
  alive.catch(() => undefined);
  return { child, observed, ready: alive, exited };
}

async function reapChild(fixture) {
  const { child, observed, exited } = fixture;
  try {
    if (child.exitCode === null && child.signalCode === null) {
      send(child, { type: 'cleanup' });
      await deadline(exited, 10000, 'Signal child cleanup');
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await deadline(exited, 5000, 'Signal child forced cleanup');
    }
    await reapBrowser(observed.browserPid, observed.browserIdentity);
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

for (const mode of ['default', 'profile']) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`${signal} lets the ${mode} collector complete real-browser cleanup and choose its exit`, async (t) => {
      const directory = temporary(t);
      const fixture = startChild(mode, directory);
      try {
        const ready = await deadline(fixture.ready, 10000, 'Signal child browser readiness');
        assert.notEqual(
          fixture.observed.browserIdentity,
          null,
          'Browser process identity must be verified before signalling',
        );
        assert(processGroup(ready.browserPid).some((member) => member.pid === ready.browserPid));
        assert.equal(fixture.child.kill(signal), true);
        const result = await deadline(fixture.exited, 10000, 'Signal child owned teardown');
        assert.deepEqual(result, { code: 1, signal: null });
        const cleanup = JSON.parse(fs.readFileSync(path.join(directory, 'cleanup.json'), 'utf8'));
        assert.deepEqual(cleanup, {
          cleanupCompleted: true,
          signalReceived: true,
          browserExited: true,
          errors: [],
        });
        assert.equal(
          processGroup(ready.browserPid).some((member) => !member.state.startsWith('Z')),
          false,
        );
        assert.equal(fixture.observed.stderr, '');
      } finally {
        await reapChild(fixture);
      }
    });
  }
}

function preparedRuntime(t) {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const context = { generation: 0, trial: 0 };
  const started = performance.now();
  const profiling = createRuntimeProfile(
    { profile: true, repo, out: output, mode: 'restored-lifecycle', started },
    () => context,
  );
  assert.equal(
    profiling.prepare(
      { target: 'aarch64-apple-darwin', binarySha256: digest },
      { status: 'setup' },
    ),
    true,
  );
  return { repo, output, context, started, profiling };
}

async function attachedRuntime(t) {
  const { repo, output, context, started, profiling } = preparedRuntime(t);
  profiling.beginServer();
  generationFiles(repo);
  const commands = [];
  const closed = [];
  const cdp = new EventEmitter();
  cdp.send = async (command) => {
    commands.push(command);
    return command === 'Profiler.stop' ? { profile: cpu() } : {};
  };
  const page = new EventEmitter();
  const browser = new EventEmitter();
  browser.close = async () => {
    closed.push('browser');
    browser.emit('disconnected', new Error(secret));
  };
  const browserServer = {
    close: async () => {
      closed.push('browser-server');
    },
  };
  await profiling.attach(page, cdp, 'retained-editor', browser);
  return { profiling, context, started, output, commands, closed, browser, browserServer };
}

test('runtime publishes a suspended browser terminal state without replacing its completed interval', async (t) => {
  const { profiling, context, output, commands, closed, browser, browserServer } =
    await attachedRuntime(t);
  context.trial = 1;
  await profiling.suspend();
  const errors = [];
  await profiling.closeBrowser(browser, browserServer, errors);
  await profiling.collectServer(4321, [4321]);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.equal(summary.codes.includes('interrupted'), false);
  assert.equal(summary.generations[0].status, 'complete');
  assert.deepEqual(
    summary.intervals.map(({ generation, trial, page, status, codes }) => ({
      generation,
      trial,
      page,
      status,
      codes,
    })),
    [
      { generation: 0, trial: 0, page: 'retained-editor', status: 'complete', codes: [] },
      {
        generation: 0,
        trial: 1,
        page: 'retained-editor',
        status: 'partial',
        codes: ['browser-suspended'],
      },
    ],
  );
  assert.equal(summary.intervals[0].cpu.samples, 4);
  assert.deepEqual(summary.intervals[0].cpu.categories, {
    javascript: 2,
    gc: 1,
    idle: 1,
    other: 0,
  });
  assert.deepEqual(summary.intervals[0].cpu.buckets, [
    { second: 0, samples: 2 },
    { second: 1, samples: 2 },
  ]);
  assert.equal(summary.intervals[1].cpu.status, 'partial');
  assert.equal(summary.intervals[1].cpu.samples, undefined);
  assert.equal(summary.intervals[1].cpu.buckets, undefined);
  assert.deepEqual(commands, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
  assert.deepEqual(closed, ['browser', 'browser-server']);
  assert.deepEqual(errors, []);
  noSecrets(summary);
});

test('runtime records cleanup-only resume after suspended disconnect without restarting collection', async (t) => {
  const { profiling, context, started, output, commands, closed, browser, browserServer } =
    await attachedRuntime(t);
  context.trial = 1;
  const suspendBefore = performance.now() - started;
  await profiling.suspend();
  const suspendAfter = performance.now() - started;
  browser.emit('disconnected', new Error(secret));
  const resumeBefore = performance.now() - started;
  await profiling.resume(false);
  const resumeAfter = performance.now() - started;
  const errors = [];
  await profiling.closeBrowser(browser, browserServer, errors);
  await profiling.collectServer(4321, [4321]);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.deepEqual(summary.codes, ['cdp-disconnected']);
  assert.equal(summary.generations[0].status, 'complete');
  assert.deepEqual(
    summary.intervals.map(({ generation, trial, page, status, codes }) => ({
      generation,
      trial,
      page,
      status,
      codes,
    })),
    [
      { generation: 0, trial: 0, page: 'retained-editor', status: 'complete', codes: [] },
      {
        generation: 0,
        trial: 1,
        page: 'retained-editor',
        status: 'partial',
        codes: ['cdp-disconnected'],
      },
    ],
  );
  assert.equal(summary.intervals[0].cpu.samples, 4);
  const terminal = summary.intervals[1];
  assert.equal(terminal.cpu.status, 'partial');
  assert.equal(terminal.cpu.samples, undefined);
  assert.equal(terminal.cpu.buckets, undefined);
  assert.ok(terminal.gap, 'Cleanup-only resume must close the suspended collection gap');
  assert.equal(terminal.gap.reason, 'browser-suspended');
  assert.ok(Number.isFinite(terminal.gap.fromElapsedMs));
  assert.ok(Number.isFinite(terminal.gap.toElapsedMs));
  assert.ok(terminal.gap.fromElapsedMs >= suspendBefore);
  assert.ok(terminal.gap.fromElapsedMs <= suspendAfter);
  assert.ok(terminal.gap.toElapsedMs >= resumeBefore);
  assert.ok(terminal.gap.toElapsedMs <= resumeAfter);
  assert.deepEqual(commands, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
  assert.deepEqual(closed, ['browser', 'browser-server']);
  assert.deepEqual(errors, []);
  noSecrets(summary);
});

test('runtime cleanup-only resume retains a suspended terminal gap without a signal or disconnect', async (t) => {
  const { profiling, context, started, output, commands, browser, browserServer } =
    await attachedRuntime(t);
  context.trial = 1;
  const suspendBefore = performance.now() - started;
  await profiling.suspend();
  const suspendAfter = performance.now() - started;
  const resumeBefore = performance.now() - started;
  await profiling.resume(false);
  const resumeAfter = performance.now() - started;
  await profiling.resume(false);
  const errors = [];
  await profiling.closeBrowser(browser, browserServer, errors);
  await profiling.collectServer(4321, [4321]);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.deepEqual(summary.codes, ['browser-suspended']);
  assert.deepEqual(
    summary.intervals.map(({ generation, trial, page, status, codes }) => ({
      generation,
      trial,
      page,
      status,
      codes,
    })),
    [
      { generation: 0, trial: 0, page: 'retained-editor', status: 'complete', codes: [] },
      {
        generation: 0,
        trial: 1,
        page: 'retained-editor',
        status: 'partial',
        codes: ['browser-suspended'],
      },
    ],
  );
  assert.equal(summary.intervals[0].cpu.samples, 4);
  const terminal = summary.intervals[1];
  assert.equal(terminal.cpu.status, 'partial');
  assert.equal(terminal.cpu.samples, undefined);
  assert.equal(terminal.cpu.buckets, undefined);
  assert.ok(terminal.gap, 'Cleanup-only resume must retain the suspended collection gap');
  assert.equal(terminal.gap.reason, 'browser-suspended');
  assert.ok(Number.isFinite(terminal.gap.fromElapsedMs));
  assert.ok(Number.isFinite(terminal.gap.toElapsedMs));
  assert.ok(terminal.gap.fromElapsedMs >= suspendBefore);
  assert.ok(terminal.gap.fromElapsedMs <= suspendAfter);
  assert.ok(terminal.gap.toElapsedMs >= resumeBefore);
  assert.ok(terminal.gap.toElapsedMs <= resumeAfter);
  assert.deepEqual(commands, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
  assert.deepEqual(errors, []);
  noSecrets(summary);
});

test('runtime retains terminal causes when two pages exhaust the global eight-interval cap', async (t) => {
  const { profiling, context, output, commands, browser, browserServer } = await attachedRuntime(t);
  const secondCommands = [];
  const secondCdp = new EventEmitter();
  secondCdp.send = async (command) => {
    secondCommands.push(command);
    return command === 'Profiler.stop' ? { profile: cpu() } : {};
  };
  await profiling.attach(new EventEmitter(), secondCdp, 'first-navigation', browser);
  for (let trial = 1; trial <= 4; trial++) {
    context.trial = trial;
    await profiling.suspend();
    if (trial < 4) await profiling.resume();
  }
  await profiling.resume(false);
  const errors = [];
  await profiling.closeBrowser(browser, browserServer, errors);
  await profiling.collectServer(4321, [4321]);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.deepEqual(summary.codes.toSorted(), ['browser-interval-limit', 'browser-suspended']);
  assert.equal(summary.intervals.length, 8);
  for (const page of ['retained-editor', 'first-navigation']) {
    assert.deepEqual(
      summary.intervals
        .filter((interval) => interval.page === page)
        .map(({ generation, trial, status, codes, cpu }) => ({
          generation,
          trial,
          status,
          codes,
          samples: cpu.samples,
        })),
      [0, 1, 2, 3].map((trial) => ({
        generation: 0,
        trial,
        status: 'complete',
        codes: [],
        samples: 4,
      })),
    );
  }
  const expectedCommands = [
    'Profiler.enable',
    ...Array.from({ length: 4 }, () => ['Profiler.start', 'Profiler.stop']).flat(),
  ];
  assert.deepEqual(commands, expectedCommands);
  assert.deepEqual(secondCommands, expectedCommands);
  assert.deepEqual(errors, []);
  noSecrets(summary);
});

test('runtime refuses pre-start profile ownership replacement and preserves the symlink target', async (t) => {
  const { repo, output, profiling } = preparedRuntime(t);
  const directory = path.join(repo, '.next-profiles');
  const preserved = path.join(repo, 'preserved-profiles');
  const original = fs.lstatSync(directory);
  fs.renameSync(directory, preserved);
  const target = path.join(repo, 'replacement-target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel'), secret);
  fs.symlinkSync(target, directory);

  assert.throws(() => profiling.beginServer(), { code: 'profile-ownership-changed' });
  await profiling.finish(true);

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.ok(summary.codes.includes('profile-ownership-changed'));
  assert.deepEqual(summary.generations, []);
  assert.deepEqual(summary.intervals, []);
  assert.deepEqual(fs.readdirSync(target), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), secret);
  assert.equal(fs.lstatSync(directory).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(directory), target);
  const remaining = fs.lstatSync(preserved);
  assert.equal(remaining.dev, original.dev);
  assert.equal(remaining.ino, original.ino);
  noSecrets(summary);
});

test('disabled runtime pre-start and finalization create no profiling artifacts', async (t) => {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const profiling = createRuntimeProfile(
    { profile: false, repo, out: output, mode: 'restored-lifecycle', started: performance.now() },
    () => ({ generation: 0, trial: 0 }),
  );
  const result = { status: 'setup' };
  assert.equal(
    profiling.prepare({ target: 'aarch64-apple-darwin', binarySha256: digest }, result),
    true,
  );
  assert.doesNotThrow(() => profiling.beginServer());
  await profiling.finish(true);
  assert.deepEqual(result, { status: 'setup' });
  assert.deepEqual(fs.readdirSync(repo), ['output']);
  assert.deepEqual(fs.readdirSync(output), []);
});

test('runtime refuses a replaced real profile directory after preserving a valid prior generation', async (t) => {
  const { repo, output, context, profiling } = preparedRuntime(t);
  profiling.beginServer();
  generationFiles(repo);
  await profiling.collectServer(4321, [4321, 4322]);
  context.generation = 1;
  context.trial = 1;
  const directory = path.join(repo, '.next-profiles');
  const preserved = path.join(repo, 'preserved-profiles');
  const original = fs.lstatSync(directory);
  fs.renameSync(directory, preserved);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'sentinel'), secret);
  const replacement = fs.lstatSync(directory);

  assert.throws(() => profiling.beginServer(), { code: 'profile-ownership-changed' });
  await profiling.finish(true);

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.ok(summary.codes.includes('profile-ownership-changed'));
  assert.equal(summary.generations.length, 1);
  const prior = summary.generations[0];
  assert.equal(prior.generation, 0);
  assert.equal(prior.trial, 0);
  assert.equal(prior.status, 'complete');
  assert.deepEqual(
    prior.cpu.map(({ role, status, samples }) => ({ role, status, samples })),
    [
      { role: 'dev-main', status: 'complete', samples: 4 },
      { role: 'dev-server', status: 'complete', samples: 4 },
    ],
  );
  assert.deepEqual(fs.readdirSync(directory), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(directory, 'sentinel'), 'utf8'), secret);
  const remaining = fs.lstatSync(directory);
  assert.equal(remaining.dev, replacement.dev);
  assert.equal(remaining.ino, replacement.ino);
  const owned = fs.lstatSync(preserved);
  assert.equal(owned.dev, original.dev);
  assert.equal(owned.ino, original.ino);
  assert.deepEqual(fs.readdirSync(preserved), []);
  noSecrets(summary);
});

for (const existing of [true, false]) {
  test(`runtime refuses a pre-start trace symlink with ${existing ? 'an existing' : 'a missing'} target`, async (t) => {
    const { repo, output, profiling } = preparedRuntime(t);
    const trace = path.join(repo, '.next/dev/trace');
    fs.mkdirSync(path.dirname(trace), { recursive: true });
    const target = path.join(repo, 'trace-target');
    if (existing) fs.writeFileSync(target, secret);
    fs.symlinkSync(target, trace);
    const original = fs.lstatSync(trace);

    assert.throws(() => profiling.beginServer(), { code: 'unsafe-file' });
    await profiling.finish(true);

    const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
    assert.equal(summary.status, 'partial');
    assert.ok(summary.codes.includes('unsafe-file'));
    assert.deepEqual(summary.generations, []);
    const remaining = fs.lstatSync(trace);
    assert.equal(remaining.isSymbolicLink(), true);
    assert.equal(remaining.dev, original.dev);
    assert.equal(remaining.ino, original.ino);
    assert.equal(fs.readlinkSync(trace), target);
    if (existing) assert.equal(fs.readFileSync(target, 'utf8'), secret);
    else assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(path.join(output, 'profile-private/prestart-0.trace')), false);
    noSecrets(summary);
  });
}

test('runtime reports a fixed refusal when isolating a regular pre-start trace fails', async (t) => {
  const { repo, output, profiling } = preparedRuntime(t);
  const trace = path.join(repo, '.next/dev/trace');
  const destination = path.join(output, 'profile-private/prestart-0.trace');
  fs.mkdirSync(path.dirname(trace), { recursive: true });
  const bytes = JSON.stringify([span()]);
  fs.writeFileSync(trace, bytes);
  const original = fs.lstatSync(trace);
  const renameSync = fs.renameSync;
  let refused = false;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === trace && target === destination) {
      refused = true;
      throw new Error(secret);
    }
    return renameSync(source, target);
  });

  assert.throws(
    () => profiling.beginServer(),
    (error) => {
      assert.equal(error.code, 'trace-isolation-failed');
      assert.equal(error.message, 'Profile pre-start refused');
      noSecrets({ code: error.code, message: error.message });
      return true;
    },
  );
  assert.equal(refused, true);
  await profiling.finish(true);

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.ok(summary.codes.includes('trace-isolation-failed'));
  assert.deepEqual(summary.generations, []);
  assert.equal(fs.readFileSync(trace, 'utf8'), bytes);
  const remaining = fs.lstatSync(trace);
  assert.equal(remaining.isFile(), true);
  assert.equal(remaining.dev, original.dev);
  assert.equal(remaining.ino, original.ino);
  assert.equal(fs.existsSync(destination), false);
  noSecrets(summary);
});
