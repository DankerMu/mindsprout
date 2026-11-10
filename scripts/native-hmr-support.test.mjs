import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { deadline, processGroup, stopOwnedProcessGroup } from './native-hmr-support.mjs';

const childSource = `
  const net = require('node:net');
  const control = net.connect(Number(process.argv[1]), '127.0.0.1');
  const listener = net.createServer(socket => socket.end());
  const send = value => control.write(JSON.stringify(value) + '\\n');
  let signals = 0;
  process.on('SIGTERM', () => { signals++; send({ type: 'signal', signals }); });
  let buffered = '';
  control.on('data', chunk => {
    buffered += chunk.toString();
    let newline;
    while ((newline = buffered.indexOf('\\n')) !== -1) {
      const command = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (command === 'exit') process.exit(0);
      if (command === 'state') send({ type: 'state', signals });
    }
  });
  listener.listen(0, '127.0.0.1', () => send({ type: 'ready', pid: process.pid, port: listener.address().port }));
`;
const leaderSource = `
  const { spawn } = require('node:child_process');
  process.on('SIGTERM', () => process.exit(0));
  spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}, process.argv[1]], {
    stdio: 'ignore'
  });
`;

function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}

async function groupEmpty(pid) {
  const end = performance.now() + 5000;
  while (processGroup(pid).some((member) => !member.state.startsWith('Z'))) {
    assert(performance.now() < end, 'Test-owned process group did not exit');
    await sleep(10);
  }
}

async function cleanupGroup(socket, leader, closed, control) {
  try {
    if (socket && !socket.destroyed) socket.write('exit\n');
    if (leader && leader.exitCode === null && leader.signalCode === null) leader.kill('SIGTERM');
    if (closed) await deadline(closed, 5000, 'Test leader cleanup');
    if (leader) await groupEmpty(leader.pid);
  } finally {
    socket?.destroy();
    await new Promise((resolve) => control.close(resolve));
  }
}

async function withGroup(operation) {
  const events = new EventEmitter();
  const messages = [];
  let socket, leader, closed;
  const control = net.createServer((connection) => {
    if (socket) {
      connection.end();
      return;
    }
    socket = connection;
    let buffered = '';
    connection.on('data', (chunk) => {
      buffered += chunk.toString();
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const message = JSON.parse(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        messages.push(message);
        events.emit('message', message);
      }
    });
  });
  await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
  const message = async (type) => {
    const existing = messages.find((item) => item.type === type);
    if (existing) return existing;
    while (true) {
      const [item] = await deadline(once(events, 'message'), 5000, 'Child control message');
      if (item.type === type) return item;
    }
  };
  try {
    leader = spawn(process.execPath, ['-e', leaderSource, String(control.address().port)], {
      detached: true,
      stdio: 'ignore',
    });
    closed = new Promise((resolve, reject) => {
      leader.once('close', resolve);
      leader.once('error', reject);
    });
    closed.catch(() => {
      // Cleanup awaits the same original spawn/close outcome after setup failure.
    });
    const child = await message('ready');
    assert(
      processGroup(leader.pid).some((member) => member.pid === child.pid),
      'Child must share the owned leader group',
    );
    const state = async () => {
      const response = once(events, 'message');
      socket.write('state\n');
      const [value] = await deadline(response, 5000, 'Child state');
      assert.equal(value.type, 'state');
      return value;
    };
    await operation({
      leader,
      closed,
      child,
      message,
      state,
      exitChild: () => socket.write('exit\n'),
      isListening: () => portListening(child.port),
      controlListening: () => portListening(control.address().port),
    });
  } finally {
    await cleanupGroup(socket, leader, closed, control);
  }
}

test('shutdown waits for the live child after the owned leader closes', async () => {
  await withGroup(async (fixture) => {
    let settled = false;
    const stopping = stopOwnedProcessGroup(
      fixture.leader,
      fixture.closed,
      5000,
      fixture.isListening,
    );
    const outcome = stopping.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await fixture.closed;
    await fixture.message('signal');
    await nextTurn();
    assert(
      processGroup(fixture.leader.pid).some(
        (member) => member.pid === fixture.child.pid && !member.state.startsWith('Z'),
      ),
    );
    assert.equal(
      settled,
      false,
      'Leader exit must not complete or fail shutdown while its child is still live',
    );
    fixture.exitChild();
    await stopping;
    await outcome;
    assert.equal(await fixture.isListening(), false);
    assert.equal(
      processGroup(fixture.leader.pid).filter((member) => !member.state.startsWith('Z')).length,
      0,
    );
  });
});

test('a surviving child exhausts the shutdown deadline without another group signal', async () => {
  await withGroup(async (fixture) => {
    const started = performance.now();
    const stopping = stopOwnedProcessGroup(
      fixture.leader,
      fixture.closed,
      300,
      fixture.isListening,
    );
    await assert.rejects(stopping, /Owned server shutdown exceeded/);
    assert(
      performance.now() - started < 1500,
      'Shutdown must use its bounded deadline, not wait for child exit',
    );
    assert(
      processGroup(fixture.leader.pid).some(
        (member) => member.pid === fixture.child.pid && !member.state.startsWith('Z'),
      ),
    );
    assert.equal((await fixture.state()).signals, 1);
    await assert.rejects(
      stopOwnedProcessGroup(fixture.leader, fixture.closed, 300, fixture.isListening),
      /Owned server leader disappeared; refusing stale PID signal/,
    );
    assert.equal((await fixture.state()).signals, 1);
  });
});

test('an already exited leader cannot authorize signaling its surviving child', async () => {
  await withGroup(async (fixture) => {
    fixture.leader.kill('SIGTERM');
    await fixture.closed;
    await assert.rejects(
      stopOwnedProcessGroup(fixture.leader, fixture.closed, 300, fixture.isListening),
      /Owned server leader disappeared; refusing stale PID signal/,
    );
    assert.equal((await fixture.state()).signals, 0);
    assert.equal(await fixture.isListening(), true);
  });
});

test('a closed process group cannot authorize restoration while the listener remains occupied', async () => {
  await withGroup(async (fixture) => {
    const stopping = stopOwnedProcessGroup(
      fixture.leader,
      fixture.closed,
      5000,
      fixture.controlListening,
    );
    const rejection = assert.rejects(stopping, /Listener survived shutdown; refusing restoration/);
    await fixture.message('signal');
    fixture.exitChild();
    await rejection;
    assert.equal(await fixture.controlListening(), true);
  });
});
