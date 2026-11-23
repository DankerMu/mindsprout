import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  browserIdentity,
  deferred,
  publishedSignalReadiness,
  reapSignalChild,
  readSignalCleanup,
  startSignalChild,
  temporary,
} from './native-hmr-profile-fixtures.mjs';
import { deadline, processGroup } from './native-hmr-support.mjs';

const stalledLaunch = `data:text/javascript,${encodeURIComponent(`
  import { chromium } from ${JSON.stringify(import.meta.resolve('@playwright/test'))};
  const launch = chromium.launchServer.bind(chromium);
  chromium.launchServer = async (...args) => {
    await new Promise((resolve) => {
      const onMessage = (message) => {
        if (message.type !== 'release-launch') return;
        process.off('message', onMessage);
        resolve();
      };
      process.on('message', onMessage);
      process.send({ type: 'launch-stalled' });
    });
    return launch(...args);
  };
`)}`;

function startLaunchProbe(directory) {
  const fixture = startSignalChild('default', directory, { nodeArgs: ['--import', stalledLaunch] });
  const { child } = fixture;
  const stalled = deferred();
  const launchSettled = deferred();
  const lateReady = deferred();
  const phases = [];
  let releaseRequested = false;
  let atGate = false;
  let browser;
  function releaseLaunch() {
    releaseRequested = true;
    if (!atGate || !child.connected) return;
    atGate = false;
    child.send({ type: 'release-launch' }, () => undefined);
  }
  child.on('message', ({ type, browserPid }) => {
    switch (type) {
      case 'launch-stalled':
        atGate = true;
        stalled.resolve();
        if (releaseRequested) releaseLaunch();
        break;
      case 'browser-launched':
        browser = { pid: browserPid, identity: browserIdentity(browserPid) };
        phases.push(type);
        launchSettled.resolve();
        break;
      case 'connecting':
        phases.push(type);
        break;
      case 'ready':
        phases.push(type);
        lateReady.resolve(browserPid);
        break;
      case 'browser-closed':
        launchSettled.resolve();
        break;
    }
  });
  child.once('close', () => launchSettled.resolve());
  return {
    fixture,
    stalled: stalled.promise,
    launchSettled: launchSettled.promise,
    lateReady: lateReady.promise,
    phases,
    releaseLaunch,
    capturedBrowser: () => browser,
  };
}

function liveBrowserGroup(pid) {
  return processGroup(pid).filter((member) => !member.state.startsWith('Z'));
}

async function waitForBrowserGroup(pid, predicate) {
  const end = performance.now() + 5000;
  let members = liveBrowserGroup(pid);
  while (!predicate(members) && performance.now() < end) {
    await sleep(10);
    members = liveBrowserGroup(pid);
  }
  return members;
}

async function suspendBrowser({ pid, identity }) {
  assert.notEqual(identity, null);
  assert.deepEqual(browserIdentity(pid), identity, 'The late browser must still own its group');
  // Keep Chromium from exiting on pipe closure when its fixture child is killed.
  process.kill(-pid, 'SIGSTOP');
  const leaderStopped = (members) =>
    members.some((member) => member.pid === pid && member.state.startsWith('T'));
  assert(leaderStopped(await waitForBrowserGroup(pid, leaderStopped)));
}

async function reapCapturedBrowser(t, { pid, identity } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const before = liveBrowserGroup(pid).length;
  if (before && identity && isDeepStrictEqual(browserIdentity(pid), identity)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error; // The owned group may have exited already.
    }
  }
  const after = (await waitForBrowserGroup(pid, (members) => members.length === 0)).length;
  t.diagnostic(`Test-owned browser cleanup: group=${pid} liveBefore=${before} liveAfter=${after}`);
  assert.equal(after, 0, 'Test-owned cleanup must leave no live browser group');
}

function assertSignalsRefused(fixture) {
  assert.equal(fixture.signal('SIGINT'), false);
  assert.equal(fixture.signal('SIGTERM'), false);
}

async function assertOriginalFailure(fixture, failure, message) {
  await assert.rejects(fixture.ready, (error) => error === failure && error.message === message);
  assert.equal(fixture.observed.phase, 'launching');
  assert.equal(fixture.observed.phaseMs, 0);
  assert.equal(fixture.observed.browserPid, null);
  assert.equal(fixture.observed.browserIdentity, null);
  assertSignalsRefused(fixture);
}

for (const [cleanup, forced] of [
  ['graceful', false],
  ['forced', true],
]) {
  test(`late browser launch preserves the readiness timeout through ${cleanup} cleanup`, async (t) => {
    const directory = temporary(t);
    const probe = startLaunchProbe(directory);
    const { fixture } = probe;
    let failure, message, pid;
    try {
      try {
        await deadline(probe.stalled, 10000, 'Signal child reached the launch stall');
        assertSignalsRefused(fixture);
        await assert.rejects(fixture.ready, (error) => {
          failure = error;
          message = error.message;
          assert.deepEqual(
            publishedSignalReadiness(
              error,
              'Signal child browser readiness exceeded 10000ms',
              10000,
            ),
            {
              phase: 'launching',
              phaseMs: 0,
              spawnState: 'spawned',
              exitCode: null,
              signal: null,
              stderrState: 'unpublished',
              stderrBytes: 0,
              stderrRetainedBytes: 0,
              stderrTruncated: false,
            },
          );
          return true;
        });
        assert.deepEqual(probe.phases, []);
        await assertOriginalFailure(fixture, failure, message);
        probe.releaseLaunch();
        pid = await deadline(probe.lateReady, 10000, 'Signal child delivered late readiness');
        assert.deepEqual(probe.phases, ['browser-launched', 'connecting', 'ready']);
        assert.equal(pid, probe.capturedBrowser().pid);
        assert.notEqual(probe.capturedBrowser().identity, null);
        assert(liveBrowserGroup(pid).some((member) => member.pid === pid));
        await assertOriginalFailure(fixture, failure, message);
        if (forced) {
          await suspendBrowser(probe.capturedBrowser());
          assert.equal(fixture.child.kill('SIGKILL'), true);
          assert.deepEqual(await deadline(fixture.exited, 5000, 'Forced signal child exit'), {
            code: null,
            signal: 'SIGKILL',
          });
          assert(
            liveBrowserGroup(pid).some(
              (member) => member.pid === pid && member.state.startsWith('T'),
            ),
            'The stopped browser must outlive the forced fixture child exit',
          );
        }
      } finally {
        probe.releaseLaunch();
        try {
          // Allow Playwright's own launch timeout before terminating a child with no captured PID.
          await deadline(probe.launchSettled, 35000, 'Signal child launch settled for cleanup');
        } finally {
          await reapSignalChild(fixture);
        }
      }
      await assertOriginalFailure(fixture, failure, message);
      if (forced) {
        assert.equal(fs.existsSync(path.join(directory, 'cleanup.json')), false);
      } else {
        assert.deepEqual(await fixture.exited, { code: 2, signal: null });
        assert.deepEqual(readSignalCleanup(directory), {
          cleanupCompleted: true,
          signalReceived: false,
          browserExited: true,
          errors: [],
        });
      }
      assert.equal(
        liveBrowserGroup(pid).length,
        0,
        'Fixture cleanup must reap the real late browser',
      );
    } finally {
      await reapCapturedBrowser(t, probe.capturedBrowser());
    }
  });
}
