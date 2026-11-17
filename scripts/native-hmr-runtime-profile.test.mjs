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

test('runtime publishes a suspended browser terminal state without replacing its completed interval', async (t) => {
  const repo = temporary(t);
  const output = path.join(repo, 'output');
  fs.mkdirSync(output);
  const context = { generation: 0, trial: 0 };
  const profiling = createRuntimeProfile(
    { profile: true, repo, out: output, mode: 'restored-lifecycle', started: performance.now() },
    () => context,
  );
  assert.equal(
    profiling.prepare(
      { target: 'aarch64-apple-darwin', binarySha256: digest },
      { status: 'setup' },
    ),
    true,
  );
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
