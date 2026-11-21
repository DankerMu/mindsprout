import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { projectCpuProfile } from './native-hmr-profile-projection.mjs';
import {
  secret,
  cpu,
  collector,
  generationFiles,
  generation,
  partial,
  noSecrets,
  deferred,
  browserFixture,
} from './native-hmr-profile-fixtures.mjs';

test('browser intervals stop before suspension and restart only after resume with an explicit gap', async () => {
  const { calls, gaps, profiler, advance } = browserFixture();
  await profiler.start();
  assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start']);
  advance(100);
  await profiler.suspend();
  profiler.paused();
  assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
  await profiler.start();
  await profiler.stop();
  assert.equal(calls.length, 3);
  advance(500);
  await profiler.resume();
  assert.equal(calls.at(-1), 'Profiler.start');
  advance(100);
  await profiler.close();
  assert.equal(calls.at(-1), 'Profiler.stop');
  const summary = profiler.snapshot();
  assert.equal(summary.intervals.length, 2);
  assert.deepEqual(gaps, [
    {
      generation: 0,
      trial: 0,
      page: 'retained-editor',
      fromElapsedMs: 100,
      toElapsedMs: 600,
      reason: 'browser-suspended',
    },
  ]);
  assert.equal(summary.intervals[0].cpu.samples, 4);
  noSecrets(summary);
});

for (const command of ['Profiler.enable', 'Profiler.start', 'Profiler.stop']) {
  test(`${command} timeout abandons the session and ignores late successful replies`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fixture = browserFixture();
    const held = deferred();
    const entered = deferred();
    fixture.cdp.send = (method) => {
      fixture.calls.push(method);
      if (method === command) {
        entered.resolve();
        return held.promise;
      }
      return Promise.resolve({});
    };
    let pending;
    if (command === 'Profiler.stop') {
      await fixture.profiler.start();
      pending = fixture.profiler.stop();
    } else pending = fixture.profiler.start();
    await entered.promise;
    t.mock.timers.tick(1000);
    await pending;
    partial(fixture.profiler.snapshot(), 'cdp-timeout');
    const before = JSON.stringify(fixture.profiler.snapshot());
    const count = fixture.calls.length;
    held.resolve({ profile: cpu(), secret });
    await Promise.resolve();
    await fixture.profiler.resume();
    await fixture.profiler.start();
    await fixture.profiler.close();
    assert.equal(fixture.calls.length, count);
    assert.equal(JSON.stringify(fixture.profiler.snapshot()), before);
  });

  test(`${command} rejection is locally redacted and cannot start another interval`, async (t) => {
    const logs = [];
    for (const method of ['log', 'warn', 'error']) {
      t.mock.method(console, method, (...args) => logs.push(args));
    }
    const fixture = browserFixture();
    fixture.cdp.send = async (method) => {
      fixture.calls.push(method);
      if (method === command) throw new Error(secret);
      return {};
    };
    await fixture.profiler.start();
    if (command === 'Profiler.stop') await fixture.profiler.stop();
    partial(fixture.profiler.snapshot(), 'cdp-failed');
    const count = fixture.calls.length;
    await fixture.profiler.resume();
    await fixture.profiler.close();
    assert.equal(fixture.calls.length, count);
    assert.deepEqual(logs, []);
  });
}

test('disconnect during a stop discards its late response without publication or more CDP requests', async () => {
  const fixture = browserFixture();
  await fixture.profiler.start();
  const held = deferred();
  fixture.cdp.send = (method) => {
    fixture.calls.push(method);
    return held.promise;
  };
  const pending = fixture.profiler.stop();
  fixture.profiler.disconnect();
  held.resolve({ profile: cpu(), secret });
  await pending;
  partial(fixture.profiler.snapshot(), 'cdp-disconnected');
  const count = fixture.calls.length;
  await fixture.profiler.resume();
  await fixture.profiler.close();
  assert.equal(fixture.calls.length, count);
  assert.equal(
    fixture.profiler.snapshot().intervals.filter((entry) => entry.status === 'complete').length,
    0,
  );
});

test('interruption abandons collection without issuing another profiler request', async () => {
  const fixture = browserFixture();
  await fixture.profiler.start();
  fixture.profiler.interrupt();
  await fixture.profiler.close();
  partial(fixture.profiler.snapshot(), 'interrupted');
  assert.deepEqual(fixture.calls, ['Profiler.enable', 'Profiler.start']);
});

test('browser interval cap is global across pages in a run', async (t) => {
  const { value } = collector(t);
  value.prepare();
  for (let i = 0; i < 8; i++) {
    const fixture = browserFixture({
      context: { generation: 0, trial: 0, page: i % 2 ? 'fresh-editor' : 'retained-editor' },
    });
    await fixture.profiler.start();
    await fixture.profiler.stop();
    assert.equal(
      value.addBrowserInterval(fixture.profiler.snapshot().intervals[0]).status,
      'complete',
    );
  }
  partial(
    value.addBrowserInterval({ status: 'complete', cpu: projectCpuProfile(cpu()) }),
    'browser-interval-limit',
  );
  await value.finish();
});
for (const command of ['Profiler.enable', 'Profiler.start']) {
  test(`disconnect while awaiting ${command} abandons its late reply`, async () => {
    const fixture = browserFixture();
    const held = deferred();
    const entered = deferred();
    fixture.cdp.send = (method) => {
      fixture.calls.push(method);
      if (method === command) {
        entered.resolve();
        return held.promise;
      }
      return Promise.resolve({});
    };
    const pending = fixture.profiler.start();
    await entered.promise;
    fixture.profiler.disconnect();
    held.resolve({});
    await pending;
    partial(fixture.profiler.snapshot(), 'cdp-disconnected');
    const count = fixture.calls.length;
    await fixture.profiler.resume();
    await fixture.profiler.close();
    assert.equal(fixture.calls.length, count);
  });
}

test('a pending start cannot become active after suspension', async () => {
  const fixture = browserFixture();
  const held = deferred();
  const entered = deferred();
  fixture.cdp.send = (method) => {
    fixture.calls.push(method);
    if (method === 'Profiler.start') {
      entered.resolve();
      return held.promise;
    }
    return Promise.resolve({});
  };
  const pending = fixture.profiler.start();
  await entered.promise;
  await fixture.profiler.suspend();
  held.resolve({});
  await pending;
  partial(fixture.profiler.snapshot(), 'browser-suspended');
  await fixture.profiler.resume();
  await fixture.profiler.close();
  assert.deepEqual(fixture.calls, ['Profiler.enable', 'Profiler.start']);
});
test('full document transitions publish renderer-local coverage without losing available CPU samples', async (t) => {
  const { repo, output, value } = collector(t);
  value.prepare();
  generationFiles(repo);
  await value.collectServer(generation());
  const { cdp, calls, profiler, advance } = browserFixture({
    onInterval: value.addBrowserInterval,
  });
  await profiler.start();
  advance(100);
  cdp.emit('Page.frameNavigated', {
    frame: {
      id: `${secret}-first-frame`,
      loaderId: `${secret}-first-loader`,
      url: `https://example.invalid/${secret}`,
    },
    type: 'Navigation',
  });
  advance(200);
  cdp.emit('Page.frameNavigated', {
    frame: {
      id: `${secret}-second-frame`,
      loaderId: `${secret}-second-loader`,
      url: `/maps/${secret}`,
    },
    type: 'Navigation',
  });
  assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start']);
  advance(50);
  await profiler.stop();
  const interval = profiler.snapshot().intervals[0];
  partial(interval, 'renderer-local-coverage');
  assert.deepEqual(interval.documentTransitions, {
    count: 2,
    first: { epochMs: 1794823200100, elapsedMs: 100 },
    last: { epochMs: 1794823200300, elapsedMs: 300 },
  });
  assert.deepEqual(interval.cpu, {
    status: 'complete',
    codes: [],
    clock: {
      origin: 'unspecified-monotonic',
      unit: 'microseconds',
      start: 8000000000,
      end: 8001500000,
    },
    samples: 4,
    categories: { javascript: 2, gc: 1, idle: 1, other: 0 },
    buckets: [
      { second: 0, samples: 2 },
      { second: 1, samples: 2 },
    ],
  });
  await profiler.start();
  await profiler.close();
  const next = profiler.snapshot().intervals[1];
  assert.equal(next.status, 'complete');
  assert.deepEqual(next.documentTransitions, { count: 0, first: null, last: null });
  assert.deepEqual(calls, [
    'Profiler.enable',
    'Profiler.start',
    'Profiler.stop',
    'Profiler.start',
    'Profiler.stop',
  ]);
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.equal(summary.status, 'partial');
  partial(summary.intervals[0], 'renderer-local-coverage');
  assert.deepEqual(summary.intervals[0].documentTransitions, {
    count: 2,
    first: { epochMs: 1794823200100, elapsedMs: 100 },
    last: { epochMs: 1794823200300, elapsedMs: 300 },
  });
  assert.equal(summary.intervals[0].cpu.samples, 4);
  noSecrets(summary);
});

test('subframes and same-document navigation do not claim renderer-local sample loss', async () => {
  const { cdp, calls, profiler } = browserFixture();
  await profiler.start();
  cdp.emit('Page.frameNavigated', {
    frame: { id: secret, parentId: `${secret}-parent`, loaderId: secret, url: secret },
    type: 'Navigation',
  });
  cdp.emit('Page.navigatedWithinDocument', {
    frameId: secret,
    url: secret,
    navigationType: 'historyApi',
  });
  await profiler.close();
  const interval = profiler.snapshot().intervals[0];
  assert.equal(interval.status, 'complete');
  assert.deepEqual(interval.codes, []);
  assert.deepEqual(interval.documentTransitions, { count: 0, first: null, last: null });
  assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
  noSecrets(interval);
});

test('document-transition metadata stays constant-sized and ignores events outside an interval', async () => {
  const { cdp, profiler, advance } = browserFixture();
  const navigation = { frame: { id: secret, loaderId: secret, url: secret }, type: 'Navigation' };
  cdp.emit('Page.frameNavigated', navigation);
  await profiler.start();
  for (let index = 0; index < 1000; index++) {
    advance(1);
    cdp.emit('Page.frameNavigated', navigation);
  }
  await profiler.close();
  cdp.emit('Page.frameNavigated', navigation);
  const interval = profiler.snapshot().intervals[0];
  partial(interval, 'renderer-local-coverage');
  assert.deepEqual(interval.documentTransitions, {
    count: 1000,
    first: { epochMs: 1794823200001, elapsedMs: 1 },
    last: { epochMs: 1794823201000, elapsedMs: 1000 },
  });
  assert.equal(cdp.listenerCount('Page.frameNavigated'), 0);
  noSecrets(interval);
});

test('interrupted physical suspension retains one attributed gap without profiler revival', async (t) => {
  const { repo, output, value } = collector(t);
  value.prepare();
  generationFiles(repo);
  await value.collectServer(generation());
  const context = { generation: 0, trial: 1, page: 'retained-editor' };
  const { calls, profiler, advance } = browserFixture({
    context,
    onInterval: value.addBrowserInterval,
    onGap: value.addBrowserGap,
    reserve: value.reserveBrowserInterval,
  });
  await profiler.start();
  advance(100);
  await profiler.suspend();
  profiler.paused();
  advance(200);
  profiler.paused();
  profiler.interrupt();
  context.generation = 1;
  context.trial = 2;
  advance(50);
  await profiler.resume(false);
  await profiler.resume();
  await profiler.close();
  profiler.finalize();
  value.recordBrowserProblems(profiler.snapshot().codes);
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  assert.deepEqual(summary.gaps, [
    {
      generation: 0,
      trial: 1,
      page: 'retained-editor',
      fromElapsedMs: 100,
      toElapsedMs: 350,
      reason: 'browser-suspended',
    },
  ]);
  assert.equal(summary.intervals[0].cpu.samples, 4);
  partial(summary.intervals[1], 'interrupted');
  assert.equal(
    summary.intervals.some((interval) => Object.hasOwn(interval, 'gap')),
    false,
  );
  assert.deepEqual(calls, ['Profiler.enable', 'Profiler.start', 'Profiler.stop']);
  noSecrets(summary);
});

test('physical gap capacity is independent of sample reservations and never evicts evidence', async (t) => {
  const { output, value } = collector(t);
  value.prepare();
  const { profiler } = browserFixture({ onInterval: value.addBrowserInterval });
  await profiler.start();
  await profiler.close();
  for (let index = 0; index < 8; index++) {
    assert.equal(value.reserveBrowserInterval(), true);
    value.addBrowserGap({
      generation: 0,
      trial: 1,
      page: 'fresh-editor',
      fromElapsedMs: index * 100,
      toElapsedMs: index * 100 + 50,
      extra: secret,
    });
  }
  partial(
    value.addBrowserGap({
      generation: 0,
      trial: 1,
      page: 'fresh-editor',
      fromElapsedMs: 800,
      toElapsedMs: 850,
    }),
    'browser-gap-limit',
  );
  await value.finish();
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'safe/summary.json'), 'utf8'));
  partial(summary, 'browser-gap-limit');
  assert.equal(summary.intervals[0].cpu.samples, 4);
  assert.deepEqual(
    summary.gaps.map(({ fromElapsedMs }) => fromElapsedMs),
    [0, 100, 200, 300, 400, 500, 600, 700],
  );
  assert.equal(
    summary.gaps.every((gap) => gap.page === 'fresh-editor'),
    true,
  );
  noSecrets(summary);
});
