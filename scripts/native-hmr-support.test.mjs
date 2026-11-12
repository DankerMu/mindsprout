import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import {
  assertSourceProof,
  clock,
  deadline,
  editorChunkFile,
  editorUpdates,
  emittedB,
  firstNavigationGate,
  processGroup,
  stopOwnedProcessGroup,
  visibleWithin,
  waitForEmitted,
} from './native-hmr-support.mjs';

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

const values = ['Native HMR A', 'Native HMR B'];
// Shape of the emitted dev chunk observed in .next/dev/static/chunks (fix-pass-3 runs).
const chunkName = 'src_07xec0e9q-khy._.js';
const chunkBytes = (value, tail = `\n//# sourceMappingURL=${chunkName}.map\n`) =>
  Buffer.from(`globalThis.TURBOPACK.push([{"children":"${value}"}]);\n${tail}`);
const temporaryChunk = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-hmr-gate-'));
  return { directory, file: path.join(directory, chunkName) };
};

test('a clock ends at its start plus the 5000ms budget and never returns a spent timeout', () => {
  let now = 1200;
  const navigation = clock(1000, () => now);
  assert.equal(navigation.endMs, 6000);
  assert.equal(navigation.remaining(), 4800);
  now = 7000;
  assert.equal(navigation.remaining(), 1);
});

test('the editor chunk is the single retained script that carried the A literal', () => {
  const url = `http://localhost:3000/_next/static/chunks/${chunkName}`;
  const chunks = [
    { page: 'retained-editor', url, literals: [values[0]] },
    { page: 'retained-editor', url, literals: [values[0]] },
    {
      page: 'retained-editor',
      url: 'http://localhost:3000/_next/static/chunks/a.js',
      literals: [],
    },
    {
      page: 'first-navigation',
      url: 'http://localhost:3000/_next/static/chunks/b.js',
      literals: [values[0]],
    },
  ];
  assert.equal(
    editorChunkFile('/repo/.next/dev', chunks, 'retained-editor', values[0]),
    `/repo/.next/dev/static/chunks/${chunkName}`,
  );
  assert.equal(
    editorChunkFile(
      '/repo/.next/dev',
      [
        {
          page: 'p',
          url: 'http://localhost:3000/_next/static/chunks/%5Bturbopack%5D_x.js',
          literals: ['v'],
        },
      ],
      'p',
      'v',
    ),
    '/repo/.next/dev/static/chunks/[turbopack]_x.js',
  );
  assert.throws(
    () => editorChunkFile('/repo/.next/dev', chunks.slice(2), 'retained-editor', values[0]),
    /exactly one retained editor chunk/,
  );
  assert.throws(
    () =>
      editorChunkFile(
        '/repo/.next/dev',
        [{ page: 'p', url: 'http://localhost:3000/api/x.js', literals: ['v'] }],
        'p',
        'v',
      ),
    /Not an emitted chunk URL/,
  );
});

test('only a complete chunk carrying B and not A counts as the emitted B build', () => {
  assert.equal(emittedB(chunkBytes(values[1]), `/x/${chunkName}`, values), true);
  assert.equal(emittedB(chunkBytes(values[0]), `/x/${chunkName}`, values), false);
  assert.equal(emittedB(chunkBytes(`${values[0]} ${values[1]}`), `/x/${chunkName}`, values), false);
  assert.equal(emittedB(chunkBytes(values[1], ''), `/x/${chunkName}`, values), false);
  assert.equal(emittedB(chunkBytes(values[1]), '/x/other._.js', values), false);
});

test('the emitted wait returns the on-disk B identity once a write lands', async () => {
  const { directory, file } = temporaryChunk();
  try {
    fs.writeFileSync(file, chunkBytes(values[0]));
    const waiting = waitForEmitted(file, values, 2000, 2);
    await sleep(30);
    fs.writeFileSync(file, chunkBytes(values[1]));
    const emitted = await waiting;
    const stat = fs.statSync(file);
    assert.deepEqual(
      { path: emitted.path, size: emitted.size, mtimeMs: emitted.mtimeMs },
      { path: file, size: stat.size, mtimeMs: stat.mtimeMs },
    );
    assert.match(emitted.sha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the emitted wait tolerates an absent file and times out on a chunk still at A', async () => {
  const { directory, file } = temporaryChunk();
  try {
    await assert.rejects(waitForEmitted(file, values, 40, 2), /Emitted B chunk exceeded 40ms/);
    fs.writeFileSync(file, chunkBytes(values[0]));
    await assert.rejects(waitForEmitted(file, values, 40, 2), /Emitted B chunk exceeded 40ms/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the first-navigation gate waits for the retained partial and then the emitted B chunk', async () => {
  const { directory, file } = temporaryChunk();
  try {
    fs.writeFileSync(file, chunkBytes(values[1]));
    const observed = new EventEmitter();
    const updates = [];
    let settled = false;
    const gate = firstNavigationGate({
      observed,
      updates: () => updates,
      file,
      values,
      clock: clock(0, () => 0),
    }).finally(() => {
      settled = true;
    });
    await sleep(20);
    assert.equal(settled, false, 'An emitted chunk alone must not open the gate');
    updates.push({ ms: 42 });
    observed.emit('event');
    const result = await gate;
    assert.deepEqual(result.waitedOn, ['retained-editor-partial', 'emitted-B-chunk']);
    assert.equal(result.partialMs, 42);
    assert.equal(result.emitted.path, file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the first-navigation gate fails within its clock when the partial never arrives', async () => {
  const { directory, file } = temporaryChunk();
  try {
    const gate = firstNavigationGate({
      observed: new EventEmitter(),
      updates: () => [],
      file,
      values,
      clock: clock(0, () => 4970),
    });
    await assert.rejects(gate, /Changed editor module HMR exceeded 30ms/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('editor updates are retained-page partials for the edited source after the stimulus', () => {
  const sourceRelative = 'src/app/maps/[id]/MapEditor.tsx';
  // Frame shape observed in fix-pass-3 events.jsonl for the retained editor page.
  const frame = (page, ms, entry) => ({
    page,
    ms,
    type: 'Network.webSocketFrameReceived',
    data: {
      response: {
        payloadData: JSON.stringify({
          type: 'turbopack-message',
          data: [
            {
              resource: { path: 'static/chunks/_1-1kqp2jgpvep._.js', headers: null },
              type: 'partial',
              instruction: {
                type: 'ChunkListUpdate',
                merged: [{ type: 'EcmascriptMergedUpdate', entries: { [entry]: { code: '' } } }],
              },
            },
          ],
        }),
      },
    },
  });
  const editor = `[project]/${sourceRelative} [app-client] (ecmascript)`;
  const events = [
    frame('retained-editor', 99, editor),
    frame('retained-editor', 140, editor),
    frame('first-navigation', 141, editor),
    frame('retained-editor', 142, '[project]/src/app/page.tsx [app-client] (ecmascript)'),
  ];
  assert.deepEqual(
    editorUpdates(events, 'retained-editor', 100, sourceRelative).map((event) => event.ms),
    [140],
  );
});

test('visibility within a clock records, enforces the budget, and stays handled when early', async () => {
  const locator = (outcome) => ({
    waitFor: async (options) => {
      locator.options = options;
      if (outcome instanceof Error) throw outcome;
    },
  });
  await visibleWithin(
    locator(),
    clock(0, () => 1000),
    () => ({ ms: 4999 }),
    'late',
  );
  assert.deepEqual(locator.options, { state: 'visible', timeout: 4000 });
  await assert.rejects(
    visibleWithin(
      locator(),
      clock(0, () => 0),
      () => ({ ms: 5001 }),
      'Source HMR exceeded 5000ms',
    ),
    /Source HMR exceeded 5000ms/,
  );
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const early = visibleWithin(
      locator(new Error('hidden')),
      clock(0, () => 0),
      () => ({}),
      'x',
    );
    await sleep(20);
    assert.deepEqual(unhandled, []);
    await assert.rejects(early, /hidden/);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('the source proof rejects any document, reload, loader change or missing partial', () => {
  const clean = {
    retainedDocuments: 0,
    retainedReloads: 0,
    retainedLoader: 'L1',
    loaderAfter: 'L1',
    targetDocuments: 0,
    targetReloads: 0,
    receivedUpdateFrames: 1,
  };
  assertSourceProof(clean);
  for (const change of [
    { retainedDocuments: 1 },
    { retainedReloads: 1 },
    { targetDocuments: 1 },
    { targetReloads: 1 },
  ])
    assert.throws(() => assertSourceProof({ ...clean, ...change }), assert.AssertionError);
  assert.throws(
    () => assertSourceProof({ ...clean, loaderAfter: 'L2' }),
    /Retained HMR replaced its document/,
  );
  assert.throws(
    () => assertSourceProof({ ...clean, receivedUpdateFrames: 0 }),
    /Missing partial MapEditor HMR/,
  );
});
