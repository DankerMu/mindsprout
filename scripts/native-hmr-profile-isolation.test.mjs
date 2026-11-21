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
