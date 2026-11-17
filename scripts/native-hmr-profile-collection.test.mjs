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
  await value.finish();
  const bytes = fs.readFileSync(path.join(output, 'safe/summary.json'));
  assert.ok(bytes.length <= 1024 * 1024);
  partial(JSON.parse(bytes), 'summary-too-large');
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
