import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { deadline, processGroup } from './native-hmr-support.mjs';
import {
  cpu,
  deferred,
  digest,
  generationFiles,
  noSecrets,
  publishedSignalReadiness,
  reapSignalChild,
  readSignalCleanup,
  secret,
  span,
  startSignalChild,
  startStalledSignalChild,
  temporary,
} from './native-hmr-profile-fixtures.mjs';
import { createRuntimeProfile } from './native-hmr-runtime-profile.mjs';

for (const mode of ['default', 'profile']) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`${signal} lets the ${mode} collector complete real-browser cleanup and choose its exit`, async (t) => {
      const directory = temporary(t);
      const fixture = startSignalChild(mode, directory);
      try {
        const ready = await fixture.ready;
        assert.equal(fixture.observed.phase, 'ready');
        assert.notEqual(
          fixture.observed.browserIdentity,
          null,
          'Browser process identity must be verified before signalling',
        );
        assert(processGroup(ready.browserPid).some((member) => member.pid === ready.browserPid));
        assert.equal(fixture.signal(signal), true);
        const result = await deadline(fixture.exited, 10000, 'Signal child owned teardown');
        assert.deepEqual(result, { code: 1, signal: null });
        assert.deepEqual(readSignalCleanup(directory), {
          cleanupCompleted: true,
          signalReceived: true,
          browserExited: true,
          errors: [],
        });
        assert.equal(
          processGroup(ready.browserPid).some((member) => !member.state.startsWith('Z')),
          false,
        );
        assert.equal(fixture.observed.stderrBytes, 0);
      } finally {
        await reapSignalChild(fixture);
      }
    });
  }
}

for (const [mode, signal] of [
  ['default', 'SIGINT'],
  ['profile', 'SIGTERM'],
]) {
  test(`stalled ${mode}/${signal} readiness retains verified browser ownership without sending the signal`, async (t) => {
    const directory = temporary(t);
    const probe = startStalledSignalChild(mode, directory);
    const { fixture, phases } = probe;
    let ownership;
    let diagnostic;
    try {
      ownership = await deadline(probe.stalled, 10000, 'Signal child reached the connection stall');
      assert.equal(fixture.signal(signal), false);
      const failure = await fixture.ready.catch((error) => error);
      diagnostic = publishedSignalReadiness(
        failure,
        'Signal child browser readiness exceeded 10000ms',
        10000,
      );
      assert.equal(diagnostic.phase, 'connecting');
      assert.deepEqual(phases, ['browser-launched', 'connecting']);
      assert(ownership.verifiedAtLaunch, 'Browser identity must be verified on browser-launched');
      assert(
        processGroup(ownership.browserPid).some((member) => member.pid === ownership.browserPid),
      );
      assert.equal(fixture.signal(signal), false);
      if (mode === 'profile') {
        probe.releaseConnect();
        await deadline(probe.connected, 10000, 'Signal child delivered late readiness');
        assert.deepEqual(phases, ['browser-launched', 'connecting', 'ready']);
        assert.equal(fixture.observed.phase, 'connecting');
        assert.equal(fixture.observed.phaseMs, diagnostic.phaseMs);
        await assert.rejects(fixture.ready, (error) => error === failure);
        assert.equal(fixture.signal(signal), false);
      }
    } finally {
      await reapSignalChild(fixture);
    }
    assert.deepEqual(await fixture.exited, { code: 2, signal: null });
    if (mode === 'default') {
      assert.deepEqual(phases, ['browser-launched', 'connecting', 'connecting']);
      assert.equal(fixture.observed.phaseMs, diagnostic.phaseMs);
    }
    assert.equal(
      processGroup(ownership.browserPid).some((member) => !member.state.startsWith('Z')),
      false,
    );
    assert.deepEqual(readSignalCleanup(directory), {
      cleanupCompleted: true,
      signalReceived: false,
      browserExited: true,
      errors: [],
    });
  });
}

test('signal readiness publishes only bounded stderr and exit status', async (t) => {
  const fixedLine = 'Browser signal fixture failed\n';
  for (const [name, text, expectedState, expectedRetained] of [
    ['exact failure line', fixedLine, 'fixture-failed'],
    ['credential canary', secret, 'unpublished'],
    ['mixed content', `${fixedLine}${secret}`, 'unpublished'],
    ['multiline content', `${fixedLine}${fixedLine}`, 'unpublished'],
    ['oversized content', `${fixedLine}${'é'.repeat(8192)}${secret}`, 'unpublished', 16384],
  ]) {
    await t.test(name, async (t) => {
      const fixture = startSignalChild('default', temporary(t), {
        nodeArgs: [
          '--eval',
          `process.stderr.write(${JSON.stringify(text)}); process.exitCode = 7;`,
        ],
      });
      try {
        await assert.rejects(fixture.ready, (error) => {
          const status = publishedSignalReadiness(
            error,
            'Signal child exited before browser readiness',
          );
          assert.deepEqual(status, {
            phase: 'launching',
            phaseMs: 0,
            spawnState: 'spawned',
            exitCode: 7,
            signal: null,
            stderrState: expectedState,
            stderrBytes: Buffer.byteLength(text),
            stderrRetainedBytes: expectedRetained ?? Buffer.byteLength(text),
            stderrTruncated: expectedRetained !== undefined,
          });
          return true;
        });
      } finally {
        await reapSignalChild(fixture);
      }
    });
  }
});

test('signal readiness reports spawn failures without publishing the underlying error', async (t) => {
  const directory = temporary(t);
  function verifySpawnFailure(error) {
    const status = publishedSignalReadiness(error, 'Signal child could not spawn');
    assert.equal(status.phase, 'launching');
    assert.equal(status.spawnState, 'spawn-failed');
    assert.equal(status.signal, null);
    assert.equal(status.stderrBytes, 0);
    assert.equal(status.stderrState, 'unpublished');
    return true;
  }
  const fixture = startSignalChild('default', directory, {
    executable: path.join(directory, secret),
  });
  try {
    await assert.rejects(fixture.ready, verifySpawnFailure);
  } finally {
    await reapSignalChild(fixture);
  }
  assert.throws(
    () => startSignalChild('default', directory, { executable: `${secret}\0` }),
    verifySpawnFailure,
  );
});

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
  profiling.paused();
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
  profiling.paused();
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
  assert.equal(summary.gaps.length, 1);
  const gap = summary.gaps[0];
  assert.equal(gap.generation, 0);
  assert.equal(gap.trial, 1);
  assert.equal(gap.page, 'retained-editor');
  assert.equal(gap.reason, 'browser-suspended');
  assert.ok(gap.fromElapsedMs >= suspendBefore);
  assert.ok(gap.fromElapsedMs <= suspendAfter);
  assert.ok(gap.toElapsedMs >= resumeBefore);
  assert.ok(gap.toElapsedMs <= resumeAfter);
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
  profiling.paused();
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
  assert.equal(summary.gaps.length, 1);
  const gap = summary.gaps[0];
  assert.equal(gap.generation, 0);
  assert.equal(gap.trial, 1);
  assert.equal(gap.page, 'retained-editor');
  assert.equal(gap.reason, 'browser-suspended');
  assert.ok(gap.fromElapsedMs >= suspendBefore);
  assert.ok(gap.fromElapsedMs <= suspendAfter);
  assert.ok(gap.toElapsedMs >= resumeBefore);
  assert.ok(gap.toElapsedMs <= resumeAfter);
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
    profiling.paused();
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
  assert.equal((summary.gaps ?? []).length, 8);
  for (const page of ['retained-editor', 'first-navigation']) {
    const gaps = (summary.gaps ?? []).filter((gap) => gap.page === page);
    assert.deepEqual(
      gaps.map(({ generation, trial }) => ({ generation, trial })),
      [1, 2, 3, 4].map((trial) => ({ generation: 0, trial })),
    );
    for (const gap of gaps) {
      assert.equal(gap.reason, 'browser-suspended');
      assert.ok(Number.isFinite(gap.fromElapsedMs));
      assert.ok(Number.isFinite(gap.toElapsedMs));
      assert.ok(gap.toElapsedMs >= gap.fromElapsedMs);
    }
  }
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
  const unknown = path.join(path.dirname(trace), 'unknown');
  fs.writeFileSync(unknown, secret);
  const renameSync = fs.renameSync;
  let refused = false;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === trace && target === destination) {
      refused = true;
      throw Object.assign(new Error(secret), { code: 'ENOENT' });
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
  assert.equal(fs.readFileSync(unknown, 'utf8'), secret);
  noSecrets(summary);
});

test('runtime allows an initially absent trace before producer launch', async (t) => {
  const { repo, output, profiling } = preparedRuntime(t);
  assert.doesNotThrow(() => profiling.beginServer());
  generationFiles(repo);
  await profiling.collectServer(4321, [4321]);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.generations[0].status, 'complete');
  assert.equal(summary.codes.includes('trace-isolation-failed'), false);
});

for (const collect of [true, false]) {
  test(`runtime retains physical gaps after stop timeout with ${collect ? 'normal' : 'cleanup'} resume`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { profiling, context, started, output, browser, browserServer } =
      await attachedRuntime(t);
    const held = deferred();
    const entered = deferred();
    const calls = [];
    let physicallyPaused = false;
    const cdp = new EventEmitter();
    cdp.send = (method) => {
      assert.equal(physicallyPaused, false, 'No CDP while physically paused');
      calls.push(method);
      if (method === 'Profiler.stop') {
        entered.resolve();
        return held.promise;
      }
      return Promise.resolve({});
    };
    await profiling.attach(new EventEmitter(), cdp, 'fresh-editor', browser);
    context.trial = 1;
    const pending = profiling.suspend();
    await entered.promise;
    t.mock.timers.tick(1000);
    await pending;
    const from = performance.now() - started;
    physicallyPaused = true;
    profiling.paused();
    const until = performance.now() - started;
    assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
    context.generation = 1;
    context.trial = 2;
    const beforeResume = performance.now() - started;
    physicallyPaused = false;
    await profiling.resume(collect);
    const afterResume = performance.now() - started;
    held.resolve({ profile: cpu(), secret });
    await Promise.resolve();
    await profiling.resume(collect);
    const errors = [];
    await profiling.closeBrowser(browser, browserServer, errors);
    await profiling.collectServer(4321, [4321]);
    await profiling.finish(true);
    const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
    assert.equal(summary.status, 'partial');
    assert.ok(summary.codes.includes('cdp-timeout'));
    const gaps = (summary.gaps ?? []).filter((gap) => gap.page === 'fresh-editor');
    assert.equal(gaps.length, 1);
    const gap = gaps[0];
    assert.equal(gap.generation, 0);
    assert.equal(gap.trial, 1);
    assert.equal(gap.reason, 'browser-suspended');
    assert.ok(gap.fromElapsedMs >= from && gap.fromElapsedMs <= until);
    assert.ok(gap.toElapsedMs >= beforeResume && gap.toElapsedMs <= afterResume);
    const intervals = summary.intervals.filter((interval) => interval.page === 'fresh-editor');
    assert.equal(intervals.length, 1);
    assert.deepEqual(intervals[0].codes, ['cdp-timeout']);
    assert.equal(intervals[0].cpu.samples, undefined);
    assert.equal(summary.intervals[0].cpu.samples, 4);
    assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
    assert.deepEqual(errors, []);
    noSecrets(summary);
  });
}

test('an unsuccessful physical pause records no gap', async (t) => {
  const { profiling, output, browser, browserServer } = await attachedRuntime(t);
  await profiling.suspend();
  // A failed SIGSTOP never calls the physical-pause notification.
  await profiling.resume(false);
  const errors = [];
  await profiling.closeBrowser(browser, browserServer, errors);
  await profiling.collectServer(4321, [4321]);
  await profiling.finish(true);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.deepEqual(summary.gaps, []);
  assert.equal(summary.intervals[0].cpu.samples, 4);
  assert.deepEqual(errors, []);
});
