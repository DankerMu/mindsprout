import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  browserIdentity,
  deferred,
  publishedSignalReadiness,
  reapSignalChild,
  readSignalCleanup,
  secret,
  startSignalChild,
  temporary,
} from './native-hmr-profile-fixtures.mjs';
import { deadline, processGroup } from './native-hmr-support.mjs';

function assertSignalsRefused(t, fixture) {
  const kill = t.mock.method(fixture.child, 'kill');
  assert.deepEqual(
    ['SIGINT', 'SIGTERM'].map((signal) => fixture.signal(signal)),
    [false, false],
  );
  assert.equal(kill.mock.callCount(), 0, 'Neither test signal may reach the child');
}

async function assertIdentityFailure(fixture, reason, phase) {
  await assert.rejects(fixture.ready, (error) => {
    const status = publishedSignalReadiness(error, reason);
    assert.deepEqual(status, {
      phase,
      phaseMs: fixture.observed.phaseMs,
      spawnState: 'spawned',
      exitCode: null,
      signal: null,
      stderrState: 'unpublished',
      stderrBytes: 0,
      stderrRetainedBytes: 0,
      stderrTruncated: false,
    });
    return true;
  });
}

function changedIdentity(identity) {
  assert.notEqual(identity, null, 'The real browser must still be running during the probe');
  const { commandSha256 } = identity;
  return {
    ...identity,
    commandSha256: (commandSha256[0] === '0' ? '1' : '0') + commandSha256.slice(1),
  };
}

function assertBrowserReaped(directory, browserPid) {
  assert.equal(
    processGroup(browserPid).some((member) => !member.state.startsWith('Z')),
    false,
  );
  assert.deepEqual(readSignalCleanup(directory), {
    cleanupCompleted: true,
    signalReceived: false,
    browserExited: true,
    errors: [],
  });
}

test('signal identity: unavailable browser on launch fails closed through IPC', async (t) => {
  // Above the kernel PID limits for the Darwin and Linux signal fixtures.
  const unavailablePid = 0x7fffffff;
  assert.throws(() => process.kill(unavailablePid, 0), { code: 'ESRCH' });
  assert.deepEqual(processGroup(unavailablePid), []);
  const fixture = startSignalChild('default', temporary(t), {
    nodeArgs: [
      '--eval',
      `
        let signalReceived = false;
        for (const signal of ['SIGINT', 'SIGTERM']) {
          process.on(signal, () => { signalReceived = true; });
        }
        process.on('message', ({ type }) => {
          if (type !== 'cleanup') return;
          process.exitCode = signalReceived ? 1 : 0;
          process.disconnect();
        });
        for (const type of ['browser-launched', 'connecting', 'ready']) {
          process.send({ type, browserPid: ${unavailablePid}, elapsedMs: 0 });
        }
      `,
    ],
  });
  const lateReady = deferred();
  fixture.child.on('message', ({ type }) => {
    if (type === 'ready') lateReady.resolve();
  });
  try {
    await assertIdentityFailure(
      fixture,
      'Signal child reported an unverified browser',
      'browser-launched',
    );
    await deadline(lateReady.promise, 10000, 'Unverified child delivered late readiness');
    assert.equal(fixture.observed.phase, 'browser-launched');
    assertSignalsRefused(t, fixture);
  } finally {
    await reapSignalChild(fixture);
  }
  assert.deepEqual(await fixture.exited, { code: 0, signal: null });
  assert.deepEqual(processGroup(unavailablePid), []);
});

test('signal identity: changed browser at ready fails closed and retains launch ownership', async (t) => {
  const directory = temporary(t);
  let launchIdentity;
  let launchPid;
  const fixture = startSignalChild('default', directory, {
    readBrowserIdentity(pid) {
      const current = browserIdentity(pid);
      if (launchIdentity) return changedIdentity(current);
      launchPid = pid;
      launchIdentity = current;
      return current;
    },
  });
  try {
    await assertIdentityFailure(
      fixture,
      'Signal child ready without verified browser identity',
      'ready',
    );
    assert.equal(fixture.observed.browserPid, launchPid);
    assert.equal(fixture.observed.browserIdentity, launchIdentity);
    assertSignalsRefused(t, fixture);
  } finally {
    await reapSignalChild(fixture);
  }
  assert.deepEqual(await fixture.exited, { code: 2, signal: null });
  assertBrowserReaped(directory, launchPid);
});

test('signal identity: both signals revalidate browser identity after valid readiness', async (t) => {
  const directory = temporary(t);
  let identityChanged = false;
  const fixture = startSignalChild('profile', directory, {
    readBrowserIdentity(pid) {
      const current = browserIdentity(pid);
      return identityChanged ? changedIdentity(current) : current;
    },
  });
  let browserPid;
  try {
    ({ browserPid } = await fixture.ready);
    identityChanged = true;
    assertSignalsRefused(t, fixture);
  } finally {
    await reapSignalChild(fixture);
  }
  assert.deepEqual(await fixture.exited, { code: 2, signal: null });
  assertBrowserReaped(directory, browserPid);
});

test('signal readiness preserves the original unexpected bounded rejection, not a copy', async (t) => {
  const directory = temporary(t);
  const fixture = startSignalChild('default', directory, {
    executable: path.join(directory, 'missing-executable'),
  });
  const reason = 'Signal child ready without verified browser identity';
  try {
    await assert.rejects(fixture.ready, (error) => {
      assert.throws(() => publishedSignalReadiness(new Error(error.message), reason), {
        message: `Expected bounded diagnostics after "${reason}"`,
      });
      assert.throws(
        () => publishedSignalReadiness(error, reason),
        (thrown) => thrown === error,
      );
      return true;
    });
  } finally {
    await reapSignalChild(fixture);
  }
});

test('signal readiness does not echo untrusted mismatches', () => {
  const reason = 'Signal child could not spawn';
  const error = new Error('raw readiness failure', { cause: new Error('raw readiness cause') });
  assert.throws(
    () => publishedSignalReadiness(error, reason),
    (thrown) => {
      assert.equal(thrown.message, `Expected bounded diagnostics after "${reason}"`);
      assert.doesNotMatch(thrown.stack, /raw readiness (failure|cause)/);
      assert.equal(thrown.cause, undefined);
      return true;
    },
  );
  assert.throws(() => publishedSignalReadiness(new Error('raw error', { cause: secret }), reason), {
    message: 'Signal fixture output published a private canary',
  });
});
