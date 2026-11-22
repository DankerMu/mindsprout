import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  secret,
  collector,
  generationFiles,
  generation,
  partial,
  noSecrets,
  browserFixture,
} from './native-hmr-profile-fixtures.mjs';

for (const stage of ['pre-start', 'post-stop']) {
  for (const linked of ['.next/dev', '.next']) {
    test(`${stage} leaves the external trace untouched through a copied cache with a linked ${linked}`, async (t) => {
      const { repo, output, value } = collector(t);
      assert.equal(value.prepare().status, 'complete');
      if (stage === 'post-stop') assert.equal(value.beginServer(generation()).status, 'complete');

      const next = path.join(repo, '.next');
      const cache = path.join(next, 'dev');
      const backup = path.join(output, 'cache-original');
      const external = path.join(repo, 'external');
      const externalCache = linked === '.next' ? path.join(external, 'dev') : external;
      fs.mkdirSync(externalCache, { recursive: true });
      const sentinel = path.join(externalCache, 'trace');
      fs.writeFileSync(sentinel, secret);
      const original = fs.lstatSync(sentinel);
      fs.mkdirSync(next);
      if (linked === '.next/dev') fs.symlinkSync(external, cache);
      else fs.mkdirSync(cache);
      fs.renameSync(cache, backup);
      fs.cpSync(backup, cache, { recursive: true, preserveTimestamps: true });
      if (linked === '.next') {
        fs.renameSync(next, path.join(repo, 'owned-next'));
        fs.symlinkSync(external, next);
      } else {
        assert.equal(fs.readlinkSync(cache), external);
      }

      const filename = path.join(cache, 'trace');
      const inspections = t.mock.method(fs, 'lstatSync');
      const opens = t.mock.method(fs, 'openSync');
      const moves = t.mock.method(fs, 'renameSync');
      const result =
        stage === 'pre-start'
          ? value.beginServer(generation())
          : (await value.collectServer(generation())).trace;
      await value.finish();

      assert.deepEqual(result, {
        status: 'partial',
        codes: ['unsafe-file'],
        ...(stage === 'post-stop' ? { coverage: 'observed-only' } : {}),
      });
      for (const operation of [inspections, opens, moves])
        assert.equal(
          operation.mock.calls.some(({ arguments: [source] }) => source === filename),
          false,
        );
      const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
      partial(summary, 'unsafe-file');
      noSecrets(summary);
      const remaining = fs.lstatSync(sentinel);
      assert.equal(remaining.dev, original.dev);
      assert.equal(remaining.ino, original.ino);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), secret);
      assert.equal(fs.existsSync(path.join(output, 'profile-private/prestart-0.trace')), false);
      assert.equal(fs.existsSync(path.join(output, 'profile-private/generation-0/trace')), false);
    });
  }
}

for (const failure of ['EACCES', 'EIO', 'postread-stat']) {
  test(`post-stop trace isolation ${failure} publishes partial safe evidence without changing its source`, async (t) => {
    const { repo, output, value } = collector(t);
    assert.equal(value.prepare().status, 'complete');
    generationFiles(repo);
    const filename = path.join(repo, '.next/dev/trace');
    const destination = path.join(output, 'profile-private/generation-0/trace');
    const original = fs.lstatSync(filename);
    const bytes = fs.readFileSync(filename, 'utf8');
    const unknown = path.join(path.dirname(filename), 'unknown');
    fs.writeFileSync(unknown, secret);
    const browser = browserFixture({ onInterval: value.addBrowserInterval });
    await browser.profiler.start();
    await browser.profiler.close();
    let injected = false;
    const renameSync = fs.renameSync;
    const lstatSync = fs.lstatSync;
    let inspections = 0;
    t.mock.method(fs, 'renameSync', (source, target) => {
      if (source === filename && failure !== 'postread-stat') {
        injected = true;
        throw Object.assign(new Error(secret), { code: failure });
      }
      return renameSync(source, target);
    });
    t.mock.method(fs, 'lstatSync', (target, ...args) => {
      if (target === filename && ++inspections === 3 && failure === 'postread-stat') {
        injected = true;
        throw Object.assign(new Error(secret), { code: 'EIO' });
      }
      return lstatSync(target, ...args);
    });
    await value.collectServer(generation());
    assert.equal(injected, true);
    await value.finish();
    const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
    partial(summary, 'trace-isolation-failed');
    assert.equal(summary.generations[0].status, 'partial');
    partial(summary.generations[0].trace, 'trace-isolation-failed');
    assert.equal(summary.generations[0].trace.coverage, 'observed-only');
    assert.equal(summary.generations[0].trace.spans.length, 1);
    assert.deepEqual(
      summary.generations[0].cpu.map(({ samples }) => samples),
      [4, 4],
    );
    assert.equal(summary.intervals[0].status, 'complete');
    assert.equal(summary.intervals[0].cpu.samples, 4);
    const remaining = fs.lstatSync(filename);
    assert.equal(remaining.dev, original.dev);
    assert.equal(remaining.ino, original.ino);
    assert.equal(fs.readFileSync(filename, 'utf8'), bytes);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(unknown, 'utf8'), secret);
    noSecrets(summary);
  });
}
