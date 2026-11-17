import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { deadline, processGroup } from './native-hmr-support.mjs';
import { deferred, temporary } from './native-hmr-profile-fixtures.mjs';

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
