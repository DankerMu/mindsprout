import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createBrowserProfiler } from './native-hmr-browser-profile.mjs';
import {
  secret,
  sha,
  digest,
  profileName,
  cpu,
  span,
  identity,
  collector,
  generationFiles,
  generation,
  partial,
  noSecrets,
  browserFixture,
} from './native-hmr-profile-fixtures.mjs';

test('disabled collection leaves an unowned directory and all external services untouched', async (t) => {
  const { repo, output, directory, value } = collector(t, { enabled: false });
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'sentinel'), secret);
  assert.equal(value.prepare().status, 'disabled');
  await value.collectServer(generation());
  await value.finish();
  assert.deepEqual(fs.readdirSync(directory), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(directory, 'sentinel'), 'utf8'), secret);
  assert.deepEqual(fs.readdirSync(output), []);
  assert.deepEqual(fs.readdirSync(repo).sort(), ['.next-profiles', 'output']);
  const cdp = new EventEmitter();
  cdp.send = () => assert.fail('Default qualification must not send profiling commands');
  const browser = createBrowserProfiler({ enabled: false, cdp });
  assert.equal(cdp.listenerCount('Page.frameNavigated'), 0);
  await browser.start();
  await browser.suspend();
  await browser.resume();
  await browser.close();
  assert.equal(cdp.listenerCount('Page.frameNavigated'), 0);
  assert.equal(browser.snapshot().status, 'disabled');
});

for (const kind of ['file', 'directory', 'symlink', 'broken-symlink']) {
  test(`profile ownership refuses an existing ${kind} without modifying it`, (t) => {
    const { repo, directory, value } = collector(t);
    const target = path.join(repo, 'unowned');
    fs.writeFileSync(target, secret);
    if (kind === 'file') fs.writeFileSync(directory, secret);
    else if (kind === 'directory') fs.mkdirSync(directory);
    else fs.symlinkSync(kind === 'symlink' ? target : path.join(repo, 'absent'), directory);
    const before = fs.lstatSync(directory);
    partial(value.prepare(), 'profile-directory-exists');
    assert.equal(fs.lstatSync(directory).ino, before.ino);
    assert.equal(fs.readFileSync(target, 'utf8'), secret);
  });
}

test('owned generation evidence is separated before the next identical filenames arrive', async (t) => {
  const { repo, output, directory, value } = collector(t);
  assert.equal(value.prepare().status, 'complete');
  for (let i = 0; i < 2; i++) {
    generationFiles(repo);
    const observed = await value.collectServer(generation(i));
    assert.equal(observed.status, 'complete');
    assert.deepEqual(observed.process, {
      launcherPid: 4321,
      processGroup: [4321, 4322],
      profilePid: null,
    });
    assert.deepEqual(observed.collector, {
      before: { epochMs: 1794823201000, elapsedMs: 1000 },
      after: { epochMs: 1794823202000, elapsedMs: 2000 },
    });
    assert.deepEqual(observed.network, { monotonicSeconds: 42.125, epochSeconds: 1794823200.25 });
    assert.deepEqual(
      observed.cpu.map((entry) => entry.role),
      ['dev-main', 'dev-server'],
    );
    assert.equal(observed.trace.coverage, 'observed-only');
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name !== '.gitignore'),
      [],
    );
  }
  await value.finish();
  assert.equal(fs.existsSync(directory), false);
  assert.deepEqual(fs.readdirSync(path.join(output, 'safe')), ['summary.json']);
  const safePath = path.join(output, 'safe/summary.json');
  assert.equal(fs.lstatSync(safePath).isFile(), true);
  const summary = JSON.parse(fs.readFileSync(safePath, 'utf8'));
  assert.equal(summary.generations.length, 2);
  assert.deepEqual(summary.identity, {
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
  });
  noSecrets(summary);
});

test('server-only collection publishes missing browser evidence without discarding server profiles', async (t) => {
  const { repo, output, value } = collector(t);
  assert.equal(value.prepare().status, 'complete');
  generationFiles(repo);
  assert.equal((await value.collectServer(generation())).status, 'complete');
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  assert.deepEqual(summary.codes, ['missing-browser-profile']);
  assert.deepEqual(summary.intervals, []);
  assert.equal(summary.generations.length, 1);
  const captured = summary.generations[0];
  assert.equal(captured.generation, 0);
  assert.equal(captured.status, 'complete');
  assert.deepEqual(
    captured.cpu.map(({ role, samples }) => ({ role, samples })),
    [
      { role: 'dev-main', samples: 4 },
      { role: 'dev-server', samples: 4 },
    ],
  );
  assert.equal(captured.trace.status, 'complete');
  assert.equal(captured.trace.coverage, 'observed-only');
  assert.equal(captured.trace.spans.length, 1);
  noSecrets(summary);
});

test('invalid provenance is explicit unknown rather than an arbitrary environment echo', async (t) => {
  const { output, value } = collector(t, {
    identity: Object.fromEntries(Object.keys(identity()).map((key) => [key, secret])),
  });
  value.prepare();
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  for (const field of [
    'workflowSha',
    'checkoutSha',
    'prHeadSha',
    'runId',
    'runAttempt',
    'nodeVersion',
    'nativeDigest',
  ]) {
    assert.equal(summary.identity[field], null);
  }
  noSecrets(summary);
});

test('missing and ambiguous server roles remain explicit and live processes are not collected', async (t) => {
  const { repo, directory, value } = collector(t);
  value.prepare();
  generationFiles(repo);
  partial(await value.collectServer({ ...generation(), stopped: false }), 'server-not-stopped');
  assert.equal(fs.existsSync(path.join(directory, profileName('dev-main'))), true);
  fs.unlinkSync(path.join(directory, profileName('dev-server')));
  fs.writeFileSync(
    path.join(directory, 'dev-main-2026-11-16T10-00-01.cpuprofile'),
    JSON.stringify(cpu()),
  );
  const result = await value.collectServer(generation());
  partial(
    result.cpu.find((entry) => entry.role === 'dev-main'),
    'ambiguous-profile',
  );
  partial(
    result.cpu.find((entry) => entry.role === 'dev-server'),
    'missing-profile',
  );
  await value.finish();
});

test('interrupted cleanup preserves replaced ownership and unexpected entries', async (t) => {
  const { repo, directory, value } = collector(t);
  value.prepare();
  fs.renameSync(directory, path.join(repo, 'owned-moved'));
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'unowned'), secret);
  partial(await value.finish({ interrupted: true }), 'profile-ownership-changed');
  assert.equal(fs.readFileSync(path.join(directory, 'unowned'), 'utf8'), secret);
  assert.equal(fs.existsSync(path.join(repo, 'owned-moved')), true);
});

test('unexpected raw entries are preserved and never disclosed in safe evidence', async (t) => {
  const { directory, value } = collector(t);
  value.prepare();
  fs.writeFileSync(path.join(directory, secret), secret);
  const result = await value.finish({ interrupted: true });
  partial(result, 'unexpected-profile-entry');
  assert.equal(fs.readFileSync(path.join(directory, secret), 'utf8'), secret);
});

test('raw reads reject symlinks, directories, missing, empty and malformed inputs', (t) => {
  const { repo, value } = collector(t);
  const target = path.join(repo, 'cpu.json');
  fs.writeFileSync(target, JSON.stringify(cpu()));
  fs.symlinkSync(target, path.join(repo, 'link'));
  fs.mkdirSync(path.join(repo, 'directory'));
  fs.writeFileSync(path.join(repo, 'empty'), '');
  fs.writeFileSync(path.join(repo, 'malformed'), secret);
  for (const [name, code] of [
    ['link', 'unsafe-file'],
    ['directory', 'unsafe-file'],
    ['absent', 'missing-profile'],
    ['empty', 'empty-profile'],
    ['malformed', 'malformed-profile'],
  ]) {
    partial(value.readCpuProfile(path.join(repo, name)), code);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), JSON.stringify(cpu()));
});

test('file and run ingestion budgets include actual bytes and reject cap plus one', (t) => {
  const { repo, value } = collector(t);
  const filename = path.join(repo, 'large.json');
  const valid = JSON.stringify(cpu());
  fs.writeFileSync(filename, valid.padEnd(16 * 1024 * 1024));
  for (let i = 0; i < 4; i++) assert.equal(value.readCpuProfile(filename).status, 'complete');
  partial(value.readCpuProfile(filename), 'run-byte-limit');
  const other = collector(t).value;
  fs.appendFileSync(filename, ' ');
  partial(other.readCpuProfile(filename), 'file-byte-limit');
});

test('raw read count and server generation caps are global within a run', async (t) => {
  const { repo, value } = collector(t);
  const filename = path.join(repo, 'small.json');
  fs.writeFileSync(filename, JSON.stringify(cpu()));
  for (let i = 0; i < 15; i++) assert.equal(value.readCpuProfile(filename).status, 'complete');
  partial(value.readCpuProfile(filename), 'file-count-limit');
  const owned = collector(t);
  owned.value.prepare();
  for (let i = 0; i < 5; i++) {
    generationFiles(owned.repo);
    assert.equal((await owned.value.collectServer(generation(i))).status, 'complete');
  }
  partial(await owned.value.collectServer(generation(5)), 'generation-limit');
  await owned.value.finish();
});

test('safe output overflow publishes a small partial object instead of truncated or raw JSON', async (t) => {
  const { repo, output, value } = collector(t);
  value.prepare();
  const trace = JSON.stringify(Array.from({ length: 2000 }, () => span()));
  for (let i = 0; i < 5; i++) {
    generationFiles(repo, { trace });
    await value.collectServer(generation(i));
  }
  const context = { generation: 0, trial: 0, page: 'retained-editor' };
  const browser = browserFixture({
    context,
    onInterval: value.addBrowserInterval,
    reserve: value.reserveBrowserInterval,
  });
  await browser.profiler.start();
  browser.advance(100);
  context.trial = 1;
  await browser.profiler.suspend();
  browser.advance(200);
  browser.profiler.disconnect();
  browser.advance(50);
  await browser.profiler.resume(false);
  browser.advance(50);
  await browser.profiler.close();
  browser.profiler.finalize();
  value.recordBrowserProblems(browser.profiler.snapshot().codes);
  await value.finish();
  const bytes = fs.readFileSync(path.join(output, 'safe/summary.json'));
  assert.ok(bytes.length <= 1024 * 1024);
  const summary = JSON.parse(bytes);
  partial(summary, 'summary-too-large');
  assert.deepEqual(summary, {
    status: 'partial',
    codes: ['cdp-disconnected', 'summary-too-large'],
    identity: {
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
    },
    limitations: [
      'observed-trace-only',
      'cpu-samples-not-utilization',
      'clock-origins-not-correlated',
      'producer-and-cdp-allocation-unbounded',
    ],
    generations: [0, 1, 2, 3, 4].map((generation) => ({
      generation,
      trial: generation,
      status: 'partial',
      codes: ['summary-too-large'],
      cpu: [
        { role: 'dev-main', status: 'partial', codes: ['summary-too-large'] },
        { role: 'dev-server', status: 'partial', codes: ['summary-too-large'] },
      ],
      trace: { status: 'partial', codes: ['summary-too-large'] },
    })),
    intervals: [
      {
        generation: 0,
        trial: 0,
        page: 'retained-editor',
        status: 'partial',
        codes: ['summary-too-large'],
      },
      {
        generation: 0,
        trial: 1,
        page: 'retained-editor',
        status: 'partial',
        codes: ['cdp-disconnected', 'summary-too-large'],
        gap: { fromElapsedMs: 100, toElapsedMs: 350, reason: 'browser-suspended' },
      },
    ],
  });
});

test('safe staging refuses existing directories and symlink destinations', async (t) => {
  const { repo, output, value } = collector(t);
  value.prepare();
  const unowned = path.join(repo, 'unowned-summary');
  fs.writeFileSync(unowned, secret);
  fs.mkdirSync(path.join(output, 'safe'));
  fs.symlinkSync(unowned, path.join(output, 'safe/summary.json'));
  partial(await value.finish(), 'safe-output-conflict');
  assert.equal(fs.readFileSync(unowned, 'utf8'), secret);
  assert.equal(fs.lstatSync(path.join(output, 'safe/summary.json')).isSymbolicLink(), true);
});

test('safe staging rejects a symlink substituted before its first inspection', async (t) => {
  const { repo, output, value } = collector(t);
  assert.equal(value.prepare().status, 'complete');
  const safe = path.join(output, 'safe');
  const preserved = path.join(output, 'preserved-safe');
  const target = path.join(repo, 'replacement-target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel'), secret);
  const mkdirSync = fs.mkdirSync;
  let created;
  let replacement;
  t.mock.method(fs, 'mkdirSync', (directory, ...args) => {
    const result = mkdirSync(directory, ...args);
    if (directory === safe) {
      created = fs.lstatSync(safe);
      fs.renameSync(safe, preserved);
      fs.symlinkSync(target, safe);
      replacement = fs.lstatSync(safe);
    }
    return result;
  });

  const result = await value.finish();
  assert.ok(created, 'The collector must create its real safe staging directory');
  assert.ok(replacement, 'The boundary fault must replace that directory before inspection');
  partial(result, 'safe-output-conflict');
  assert.deepEqual(fs.readdirSync(target), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), secret);
  const remaining = fs.lstatSync(safe);
  assert.equal(remaining.isSymbolicLink(), true);
  assert.equal(remaining.dev, replacement.dev);
  assert.equal(remaining.ino, replacement.ino);
  assert.equal(fs.readlinkSync(safe), target);
  const owned = fs.lstatSync(preserved);
  assert.equal(owned.isDirectory(), true);
  assert.equal(owned.dev, created.dev);
  assert.equal(owned.ino, created.ino);
  assert.deepEqual(fs.readdirSync(preserved), []);
});

for (const pendingKind of ['owned', 'pre-existing', 'substituted']) {
  test(`safe staging removes only its own pending file after replacement: ${pendingKind}`, async (t) => {
    const { repo, output, value } = collector(t);
    value.prepare();
    const safe = path.join(output, 'safe');
    const preserved = path.join(output, 'preserved-safe');
    const target = path.join(repo, 'replacement-target');
    const pending = path.join(target, 'summary.pending');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'sentinel'), secret);
    if (pendingKind === 'pre-existing') fs.writeFileSync(pending, secret);
    let unrelated = pendingKind === 'pre-existing' ? fs.lstatSync(pending) : null;
    const openSync = fs.openSync;
    const writeFileSync = fs.writeFileSync;
    let created, replacement, opened;
    t.mock.method(fs, 'openSync', (filename, ...args) => {
      if (filename === path.join(safe, 'summary.pending')) {
        created = fs.lstatSync(safe);
        fs.renameSync(safe, preserved);
        fs.symlinkSync(target, safe);
        replacement = fs.lstatSync(safe);
        opened = openSync(filename, ...args);
        return opened;
      }
      return openSync(filename, ...args);
    });
    t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
      const result = writeFileSync(filename, ...args);
      if (filename === opened && pendingKind === 'substituted') {
        fs.renameSync(pending, path.join(target, 'displaced-output'));
        writeFileSync(pending, secret);
        unrelated = fs.lstatSync(pending);
      }
      return result;
    });
    partial(await value.finish(), 'safe-output-conflict');
    assert.ok(replacement, 'Replacement must occur after inspection and before pending open');
    assert.equal(fs.lstatSync(safe).ino, replacement.ino);
    assert.equal(fs.lstatSync(preserved).ino, created.ino);
    assert.deepEqual(fs.readdirSync(preserved), []);
    assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), secret);
    assert.equal(fs.existsSync(path.join(target, 'summary.json')), false);
    if (pendingKind === 'owned') assert.deepEqual(fs.readdirSync(target), ['sentinel']);
    else {
      assert.equal(fs.readFileSync(pending, 'utf8'), secret);
      assert.equal(fs.lstatSync(pending).dev, unrelated.dev);
      assert.equal(fs.lstatSync(pending).ino, unrelated.ino);
      if (pendingKind === 'substituted')
        assert.equal(fs.lstatSync(path.join(target, 'displaced-output')).isFile(), true);
    }
  });
}

test('private staging rejects a symlink substituted before its first inspection', (t) => {
  const { repo, output, directory, value } = collector(t);
  const root = path.join(output, 'profile-private');
  const target = path.join(repo, 'foreign-private');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel'), secret);
  const mkdirSync = fs.mkdirSync;
  let replaced;
  t.mock.method(fs, 'mkdirSync', (filename, ...args) => {
    const result = mkdirSync(filename, ...args);
    if (filename === root) {
      fs.renameSync(root, path.join(output, 'preserved-private'));
      fs.symlinkSync(target, root);
      replaced = fs.lstatSync(root);
    }
    return result;
  });
  partial(value.prepare(), 'profile-prepare-failed');
  assert.ok(replaced);
  assert.equal(fs.lstatSync(root).ino, replaced.ino);
  assert.deepEqual(fs.readdirSync(target), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), secret);
  assert.equal(fs.existsSync(directory), false);
});

for (const operation of ['begin', 'collect', 'finish']) {
  test(`changed private staging refuses ${operation} raw moves`, async (t) => {
    const { repo, output, directory, value } = collector(t);
    value.prepare();
    generationFiles(repo);
    const root = path.join(output, 'profile-private');
    fs.renameSync(root, path.join(output, 'preserved-private'));
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'sentinel'), secret);
    const replacement = fs.lstatSync(root);
    const source = fs.lstatSync(directory);
    const trace = path.join(repo, '.next/dev/trace');
    const traceBytes = fs.readFileSync(trace, 'utf8');
    const result =
      operation === 'begin'
        ? value.beginServer({ generation: 0 })
        : operation === 'collect'
          ? await value.collectServer(generation())
          : await value.finish();
    partial(result, 'profile-ownership-changed');
    assert.equal(fs.lstatSync(root).ino, replacement.ino);
    assert.equal(fs.lstatSync(directory).ino, source.ino);
    assert.deepEqual(fs.readdirSync(root), ['sentinel']);
    assert.equal(fs.readFileSync(path.join(root, 'sentinel'), 'utf8'), secret);
    assert.equal(fs.readFileSync(trace, 'utf8'), traceBytes);
    assert.equal(
      fs.readFileSync(path.join(directory, profileName('dev-main')), 'utf8'),
      JSON.stringify(cpu()),
    );
  });
}

for (const boundary of ['creation', 'inspection']) {
  test(`CPU destination replacement after ${boundary} preserves raw sources`, async (t) => {
    const { repo, output, directory, value } = collector(t);
    value.prepare();
    generationFiles(repo);
    const destination = path.join(output, 'profile-private/generation-0');
    const target = path.join(repo, 'foreign-generation');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'sentinel'), secret);
    const source = fs.lstatSync(directory);
    const method = boundary === 'creation' ? 'mkdirSync' : 'lstatSync';
    const original = fs[method];
    let replaced;
    t.mock.method(fs, method, (filename, ...args) => {
      const result = original(filename, ...args);
      if (filename === destination && !replaced) {
        fs.renameSync(destination, path.join(output, 'preserved-generation'));
        fs.symlinkSync(target, destination);
        replaced = true;
      }
      return result;
    });
    partial(await value.collectServer(generation()), 'profile-ownership-changed');
    assert.equal(replaced, true);
    assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(directory).ino, source.ino);
    assert.deepEqual(fs.readdirSync(target), ['sentinel']);
    assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), secret);
    assert.equal(
      fs.readFileSync(path.join(directory, profileName('dev-main')), 'utf8'),
      JSON.stringify(cpu()),
    );
    assert.equal(fs.existsSync(path.join(repo, '.next/dev/trace')), true);
  });
}

test('trace collection refuses a changed generation destination without moving the trace', async (t) => {
  const { repo, output, value } = collector(t);
  value.prepare();
  generationFiles(repo);
  const destination = path.join(output, 'profile-private/generation-0');
  const target = path.join(repo, 'foreign-generation');
  const trace = path.join(repo, '.next/dev/trace');
  const bytes = fs.readFileSync(trace, 'utf8');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'trace'), secret);
  const foreign = fs.lstatSync(path.join(target, 'trace'));
  const lstatSync = fs.lstatSync;
  let replaced = false;
  t.mock.method(fs, 'lstatSync', (filename, ...args) => {
    if (filename === trace && !replaced) {
      replaced = true;
      fs.renameSync(destination, path.join(output, 'preserved-generation'));
      fs.symlinkSync(target, destination);
    }
    return lstatSync(filename, ...args);
  });
  const result = await value.collectServer(generation());
  partial(result.trace, 'profile-ownership-changed');
  assert.equal(replaced, true);
  assert.equal(fs.readFileSync(trace, 'utf8'), bytes);
  assert.equal(fs.readFileSync(path.join(target, 'trace'), 'utf8'), secret);
  assert.equal(fs.lstatSync(path.join(target, 'trace')).ino, foreign.ino);
  assert.deepEqual(fs.readdirSync(target), ['trace']);
  assert.equal(
    fs.existsSync(path.join(output, 'preserved-generation/cpu', profileName('dev-main'))),
    true,
  );
});

for (const leaf of ['prestart-0.trace', 'remaining', 'generation-0/cpu', 'generation-0/trace']) {
  test(`raw isolation preserves an existing destination: ${leaf}`, async (t) => {
    const { repo, output, directory, value } = collector(t);
    value.prepare();
    generationFiles(repo);
    const destination = path.join(output, 'profile-private', leaf);
    const isDirectory = leaf === 'remaining' || leaf.endsWith('/cpu');
    let foreign;
    const populate = () => {
      if (isDirectory) fs.mkdirSync(destination);
      else fs.writeFileSync(destination, secret);
      foreign = fs.lstatSync(destination);
    };
    if (leaf.startsWith('generation-')) {
      const mkdirSync = fs.mkdirSync;
      t.mock.method(fs, 'mkdirSync', (filename, ...args) => {
        const result = mkdirSync(filename, ...args);
        if (filename === path.dirname(destination)) populate();
        return result;
      });
    } else populate();
    const result =
      leaf === 'prestart-0.trace'
        ? value.beginServer({ generation: 0 })
        : leaf === 'remaining'
          ? await value.finish()
          : await value.collectServer(generation());
    partial(leaf.endsWith('/trace') ? result.trace : result, 'profile-ownership-changed');
    assert.ok(foreign);
    assert.equal(fs.lstatSync(destination).dev, foreign.dev);
    assert.equal(fs.lstatSync(destination).ino, foreign.ino);
    if (isDirectory) assert.deepEqual(fs.readdirSync(destination), []);
    else assert.equal(fs.readFileSync(destination, 'utf8'), secret);
    assert.equal(fs.existsSync(path.join(repo, '.next/dev/trace')), true);
    if (!leaf.endsWith('/trace'))
      assert.equal(
        fs.readFileSync(path.join(directory, profileName('dev-main')), 'utf8'),
        JSON.stringify(cpu()),
      );
  });
}

test('a source-cache trace predating server start is excluded without modifying its backup', async (t) => {
  const { repo, output, value } = collector(t);
  const cache = path.join(repo, '.next/dev');
  fs.mkdirSync(cache, { recursive: true });
  const old = JSON.stringify([span({ duration: 999999 })]);
  fs.writeFileSync(path.join(cache, 'trace'), old);
  fs.mkdirSync(path.join(output, 'cache-original'));
  fs.writeFileSync(path.join(output, 'cache-original/trace'), old);
  value.prepare();
  value.beginServer({ generation: 0 });
  assert.equal(fs.existsSync(path.join(cache, 'trace')), false);
  assert.equal(fs.readFileSync(path.join(output, 'cache-original/trace'), 'utf8'), old);
  generationFiles(repo);
  const result = await value.collectServer(generation());
  assert.deepEqual(
    result.trace.spans.map((entry) => entry.durationUs),
    [125000],
  );
  await value.finish();
});

test('a raw file changed during descriptor reading is partial rather than trusted', (t) => {
  const { repo, value } = collector(t);
  const filename = path.join(repo, 'changing.json');
  fs.writeFileSync(filename, JSON.stringify(cpu()));
  const readSync = fs.readSync;
  let changed = false;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = readSync(...args);
    if (!changed) {
      changed = true;
      fs.appendFileSync(filename, ' ');
    }
    return count;
  });
  partial(value.readCpuProfile(filename), 'unstable-file');
  assert.equal(changed, true);
});

test('a symlink replacement between inspection and open cannot redirect a raw read', (t) => {
  const { repo, value } = collector(t);
  const filename = path.join(repo, 'replaceable.json');
  const target = path.join(repo, 'unowned.json');
  fs.writeFileSync(filename, JSON.stringify(cpu()));
  fs.writeFileSync(target, secret);
  const openSync = fs.openSync;
  let replaced = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (file === filename && !replaced) {
      replaced = true;
      fs.unlinkSync(filename);
      fs.symlinkSync(target, filename);
    }
    return openSync(file, ...args);
  });
  partial(value.readCpuProfile(filename), 'unsafe-file');
  assert.equal(fs.readFileSync(target, 'utf8'), secret);
});
test('publication reconstructs browser records rather than forwarding supplied fields', async (t) => {
  const { output, value } = collector(t);
  value.prepare();
  const fixture = browserFixture();
  await fixture.profiler.start();
  await fixture.profiler.stop();
  const interval = fixture.profiler.snapshot().intervals[0];
  interval.cookie = secret;
  interval.cpu.functionName = secret;
  interval.cpu.buckets[0].url = `https://example.invalid/${secret}`;
  value.addBrowserInterval(interval);
  await value.finish();
  const published = fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8');
  noSecrets(JSON.parse(published));
  assert.equal(published.includes(createHash('sha256').update(secret).digest('hex')), false);
});
