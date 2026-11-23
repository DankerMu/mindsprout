import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { observeEditorVisit } from './native-hmr-observation.mjs';
import { countSamplerWork, liveReadiness } from './native-hmr-readiness-fixtures.mjs';
import { deferred, noSecrets } from './native-hmr-profile-fixtures.mjs';
import { deadline, waitForObserved, waitForReadiness } from './native-hmr-support.mjs';

function acknowledgedBindingRemoval(cdp) {
  const removed = deferred();
  const send = cdp.send.bind(cdp);
  cdp.send = async (method, parameters) => {
    const result = await send(method, parameters);
    if (method === 'Runtime.removeBinding') removed.resolve();
    return result;
  };
  return removed.promise;
}

test('timed-out real sampler setup cannot revive acceptance when its page evaluation arrives late', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, cdp, observation, now } = fixture;
  await countSamplerWork(page);
  const evaluate = page.evaluate.bind(page);
  const held = deferred();
  const removed = acknowledgedBindingRemoval(cdp);
  let installation;
  page.evaluate = (fn, args) => {
    if (fn.name !== 'installSampler') return evaluate(fn, args);
    installation = held.promise.then(() => evaluate(fn, args));
    return installation;
  };
  await observation.begin();
  const start = now();
  observation.start(start);
  observation.actionSettled('fulfilled', now());
  const failure = now();
  observation.outcome('readiness-failed', failure);
  await observation.end();
  await deadline(removed, 1500, 'Fixture owned binding cleanup');
  held.resolve();
  await installation;
  assert.equal(await evaluate(() => globalThis.__readinessWork.reads), 0);
  assert.equal(
    await evaluate(() => Object.hasOwn(globalThis, '__mindsproutReadinessSample')),
    false,
  );
  const evidence = await fixture.finish();
  assert.deepEqual(evidence.marker.samples, []);
  assert.equal(evidence.marker.firstVisible, null);
  assert(evidence.marker.codes.includes('sampler-setup-timeout'));
  assert.equal(evidence.budget.start.elapsedMs, start.ms);
  assert.equal(evidence.budget.deadline.elapsedMs, start.ms + 5000);
  assert.deepEqual(evidence.outcome, {
    status: 'readiness-failed',
    at: { epochMs: failure.at, elapsedMs: failure.ms },
  });
  noSecrets(evidence);
});

for (const loss of ['navigation', 'crash']) {
  test(`real ${loss} abandons the sampled document without replacing its original failed outcome`, async (t) => {
    const fixture = await liveReadiness(t);
    const { page, cdp, observation, now, received } = fixture;
    await observation.begin();
    observation.start(now());
    observation.actionSettled('fulfilled', now());
    await fixture.sampled((sample) => sample.visibility === 'visible');
    const first = received.find((sample) => sample.ordinal === 1);
    observation.outcome('readiness-failed', now());
    await observation.end();
    let crashing;
    if (loss === 'navigation') {
      await page.goto(new URL('/maps/private-new-document', page.url()).href);
      await page.evaluate(() => {
        if (typeof globalThis.__mindsproutReadinessSample === 'function')
          globalThis.__mindsproutReadinessSample(JSON.stringify({ epoch: 1, ordinal: 99 }));
      });
    } else {
      const crashed = page.waitForEvent('crash');
      crashing = cdp.send('Page.crash').catch(() => undefined);
      await crashed;
    }
    observation.outcome('ready', now());
    const evidence = await fixture.finish();
    await crashing;
    assert.equal(evidence.outcome.status, 'readiness-failed');
    assert.equal(evidence.marker.status, 'partial');
    assert(
      evidence.marker.codes.some((code) =>
        ['sampler-context-lost', 'cdp-disconnected'].includes(code),
      ),
    );
    assert.deepEqual(evidence.marker.firstVisible.at, {
      timeOriginMs: first.timeOriginMs,
      nowMs: first.nowMs,
    });
    assert.equal(
      evidence.marker.samples.some((sample) => sample.ordinal === 99),
      false,
    );
    noSecrets(evidence);
  });
}

test('stalled real sampling expires before another layout read and remains partial during failure capture', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, observation, now, received } = fixture;
  await countSamplerWork(page);
  await observation.begin();
  observation.start(now());
  observation.actionSettled('fulfilled', now());
  await fixture.sampled((sample) => sample.ordinal >= 2);
  observation.outcome('readiness-failed', now());
  await observation.end();
  await page.evaluate(() => {
    globalThis.__readinessWork.holdNext = true;
  });
  await page.waitForFunction(() => globalThis.__readinessWork.delayed !== null);
  const before = await page.evaluate(() => globalThis.__readinessWork.reads);
  const first = received.find((sample) => sample.ordinal === 1);
  await page.waitForFunction((expires) => performance.now() >= expires, first.nowMs + 6500);
  await page.evaluate(() => globalThis.__readinessWork.delayed());
  await fixture.sampled((sample) => sample.terminal === 'sampler-expired');
  assert.equal(await page.evaluate(() => globalThis.__readinessWork.reads), before);
  const evidence = await fixture.finish();
  assert(evidence.marker.codes.includes('sampler-expired'));
  assert.equal(evidence.marker.status, 'partial');
  assert(evidence.marker.samples.length >= 2 && evidence.marker.samples.length <= 128);
  for (let index = 1; index < evidence.marker.samples.length; index++)
    assert(
      evidence.marker.samples[index].browser.nowMs -
        evidence.marker.samples[index - 1].browser.nowMs >=
        50,
    );
  assert.equal(evidence.outcome.status, 'readiness-failed');
  noSecrets(evidence);
});

test('an original action rejection remains authoritative while real diagnostic sampling finalizes', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, observation, now } = fixture;
  const failure = new Error('PRIVATE_CANARY_action_failure');
  await assert.rejects(
    observeEditorVisit(
      { page, navigationObservation: observation },
      () => Promise.reject(failure),
      undefined,
      { guard: (promise) => promise, readiness: waitForReadiness, now },
    ),
    (error) => error === failure,
  );
  observation.outcome('ready', now());
  const evidence = await fixture.finish();
  assert.equal(evidence.action.status, 'rejected');
  assert.equal(evidence.outcome.status, 'action-failed');
  assert.equal(evidence.budget.deadline.elapsedMs - evidence.budget.start.elapsedMs, 5000);
  noSecrets(evidence);
});

test('interrupting an active real sampler cannot accept late success or rearm a new attempt', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, profiling, observation, now, received } = fixture;
  let interruption;
  const remove = profiling.registerSignals((error) => {
    interruption = error;
  });
  t.after(remove);
  await observation.begin();
  const start = now();
  observation.start(start);
  observation.actionSettled('fulfilled', now());
  await page.evaluate(() => globalThis.history.pushState({}, '', '/maps/private-active'));
  await fixture.sampled((sample) => sample.route === 'editor');
  const before = received.length;
  process.emit('SIGINT');
  assert.match(interruption.message, /Interrupted by SIGINT/);
  await page.evaluate(() => globalThis.history.pushState({}, '', '/'));
  observation.outcome('ready', now());
  observation.start(now());
  await observation.end();
  const evidence = await fixture.finish();
  assert.equal(evidence.outcome.status, 'unavailable');
  assert.equal(evidence.budget.start.elapsedMs, start.ms);
  assert.equal(evidence.marker.shutdown, 'stopped');
  assert(evidence.marker.codes.includes('interrupted'));
  assert(evidence.network.codes.includes('interrupted'));
  assert(evidence.marker.samples.length <= before);
  for (const channel of [evidence.network, evidence.marker, evidence.routes]) {
    assert.equal(channel.status, 'partial');
    assert(channel.codes.includes('interrupted'));
  }
  assert.deepEqual(
    evidence.routes.observations.map((entry) => entry.route),
    ['editor'],
  );
  assert.equal(evidence.routes.observations[0].receipt.phase, 'observing');
  noSecrets(evidence);
});

test('interruption during real sampler setup cannot publish a budget or revive late installation', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, cdp, profiling, observation, now } = fixture;
  await countSamplerWork(page);
  const evaluate = page.evaluate.bind(page);
  const entered = deferred();
  const held = deferred();
  const removed = acknowledgedBindingRemoval(cdp);
  let installation;
  page.evaluate = (fn, args) => {
    if (fn.name !== 'installSampler') return evaluate(fn, args);
    entered.resolve();
    installation = held.promise.then(() => evaluate(fn, args));
    return installation;
  };
  let interruption;
  t.after(
    profiling.registerSignals((error) => {
      interruption = error;
    }),
  );
  const beginning = observation.begin();
  await entered.promise;
  process.emit('SIGTERM');
  assert.match(interruption.message, /Interrupted by SIGTERM/);
  await deadline(removed, 1500, 'Fixture owned binding cleanup');
  held.resolve();
  await beginning;
  await installation;
  assert.equal(await evaluate(() => globalThis.__readinessWork.reads), 0);
  assert.equal(
    await evaluate(() => Object.hasOwn(globalThis, '__mindsproutReadinessSample')),
    false,
  );
  observation.start(now());
  observation.outcome('ready', now());
  await observation.end();
  const evidence = await fixture.finish();
  assert.deepEqual(evidence.budget, {
    start: { epochMs: null, elapsedMs: null },
    deadline: { epochMs: null, elapsedMs: null },
  });
  assert.equal(evidence.outcome.status, 'unavailable');
  assert.deepEqual(evidence.marker.samples, []);
  assert(evidence.marker.codes.includes('interrupted'));
  noSecrets(evidence);
});

test('detaching the actual CDP session abandons channels without changing the recorded failure', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, cdp, observation, now } = fixture;
  await observation.begin();
  observation.start(now());
  observation.actionSettled('fulfilled', now());
  await page.evaluate(() => globalThis.history.pushState({}, '', '/maps/private-detach'));
  await fixture.sampled((sample) => sample.route === 'editor');
  const failure = now();
  observation.outcome('readiness-failed', failure);
  await observation.end();
  await cdp.detach();
  await page.evaluate(() => globalThis.history.pushState({}, '', '/'));
  observation.outcome('ready', now());
  const evidence = await fixture.finish();
  assert.deepEqual(evidence.outcome, {
    status: 'readiness-failed',
    at: { epochMs: failure.at, elapsedMs: failure.ms },
  });
  assert(evidence.network.codes.includes('cdp-disconnected'));
  assert(evidence.marker.codes.includes('cdp-disconnected'));
  assert.equal(evidence.marker.status, 'partial');
  for (const channel of [evidence.network, evidence.marker, evidence.routes]) {
    assert.equal(channel.status, 'partial');
    assert(channel.codes.includes('cdp-disconnected'));
  }
  assert.deepEqual(
    evidence.routes.observations.map((entry) => entry.route),
    ['editor'],
  );
  noSecrets(evidence);
});

for (const profile of [false, true]) {
  test(`${profile ? 'profiled' : 'default'} readiness observation issues no additional HTTP requests`, async (t) => {
    const fixture = await liveReadiness(t, { profile });
    const { page, observation, now, requests, received } = fixture;
    assert.deepEqual(requests, [{ method: 'GET', url: '/' }]);
    if (!profile) await countSamplerWork(page);
    const commands = [];
    const send = fixture.cdp.send.bind(fixture.cdp);
    fixture.cdp.send = (method, params) => {
      commands.push(method);
      return send(method, params);
    };
    await observeEditorVisit(
      { page, navigationObservation: observation },
      () => page.evaluate(() => globalThis.history.pushState({}, '', '/maps/private-no-request')),
      undefined,
      {
        guard: (promise) => promise,
        readiness: profile
          ? () => fixture.sampled((sample) => sample.route === 'editor')
          : async () => undefined,
        now,
      },
    );
    await page.goBack();
    if (!profile) {
      assert.equal(await page.evaluate(() => globalThis.__readinessWork.reads), 0);
      assert.equal(
        await page.evaluate(() => Object.hasOwn(globalThis, '__mindsproutReadinessSample')),
        false,
      );
    }
    const evidence = await fixture.finish();
    assert.deepEqual(requests, [{ method: 'GET', url: '/' }]);
    if (profile) {
      assert.equal(evidence.outcome.status, 'ready');
      assert.equal(evidence.marker.shutdown, 'stopped');
    } else {
      assert.equal(evidence?.outcome.status, 'ready');
      assert.deepEqual(evidence.marker.codes, ['missing-marker-observation']);
      assert.deepEqual(evidence.routes.codes, ['missing-route-observation']);
      assert.deepEqual(commands, ['Performance.getMetrics', 'Performance.getMetrics']);
      assert.deepEqual(received, []);
    }
  });
}

async function terminateBeforeClaim(fixture, terminal, t) {
  if (terminal === 'SIGINT') {
    t.after(fixture.profiling.registerSignals(() => undefined));
    process.emit('SIGINT');
  } else if (terminal === 'page-close') {
    await fixture.page.close();
  } else if (terminal === 'browser-disconnect') {
    await fixture.browser.close();
  } else if (terminal === 'cdp-close') {
    await fixture.cdp.detach();
  } else {
    const crashed = fixture.page.waitForEvent('crash');
    const settled = fixture.cdp.send('Page.crash').catch(() => undefined);
    await crashed;
    return { settled };
  }
  return {};
}

for (const timing of ['before-attempt', 'held-snapshot']) {
  for (const terminal of ['SIGINT', 'page-close', 'crash', 'browser-disconnect', 'cdp-close']) {
    test(`${terminal} ${timing} prevents diagnostic setup and fabricated original budget`, async (t) => {
      const fixture = await liveReadiness(t);
      const { cdp, observation, now, received } = fixture;
      const commands = [];
      const send = cdp.send.bind(cdp);
      const entered = deferred();
      const release = deferred();
      cdp.send = async (method, parameters) => {
        commands.push(method);
        const result = await send(method, parameters);
        if (timing === 'held-snapshot' && method === 'Performance.getMetrics') {
          entered.resolve();
          await release.promise;
        }
        return result;
      };
      let beginning;
      if (timing === 'held-snapshot') {
        beginning = observation.begin();
        await entered.promise;
      }
      const { settled } = await terminateBeforeClaim(fixture, terminal, t);
      release.resolve();
      if (beginning) await beginning;
      else await observation.begin();
      observation.start(now());
      observation.actionSettled('fulfilled', now());
      observation.outcome('ready', now());
      await observation.end();
      const evidence = await fixture.finish();
      await settled;
      assert.deepEqual(
        commands.filter((method) =>
          ['Runtime.enable', 'Runtime.addBinding', 'Page.getFrameTree'].includes(method),
        ),
        [],
      );
      assert.deepEqual(received, []);
      assert.deepEqual(evidence.budget, {
        start: { epochMs: null, elapsedMs: null },
        deadline: { epochMs: null, elapsedMs: null },
      });
      assert.equal(evidence.action.status, 'unavailable');
      assert.equal(evidence.outcome.status, 'unavailable');
      const code = terminal === 'SIGINT' ? 'interrupted' : 'cdp-disconnected';
      for (const channel of [evidence.network, evidence.marker, evidence.routes]) {
        assert.equal(channel.status, 'partial');
        assert(channel.codes.includes(code));
      }
      noSecrets(evidence);
    });
  }
}

for (const document of ['retained', 'reloaded']) {
  test(`late addBinding acknowledgement cleans only its owned ${document} document after finalization`, async (t) => {
    const fixture = await liveReadiness(t);
    const { page, cdp, profiling, observation, now, readEvidence } = fixture;
    const send = cdp.send.bind(cdp);
    const created = deferred();
    const release = deferred();
    const removed = new EventEmitter();
    let removals = 0;
    let reply;
    cdp.send = (method, parameters) => {
      const pending = send(method, parameters);
      if (method === 'Runtime.removeBinding') {
        pending.then(
          () => {
            removals++;
            removed.emit('event');
          },
          () => undefined,
        );
      }
      if (method !== 'Runtime.addBinding') return pending;
      reply = pending.then(async (result) => {
        created.resolve();
        await release.promise;
        return result;
      });
      return reply;
    };
    const beginning = observation.begin();
    await created.promise;
    assert.equal(
      await page.evaluate(() => typeof globalThis.__mindsproutReadinessSample),
      'function',
    );
    await beginning;
    if (document === 'reloaded') {
      await page.reload();
      await page.evaluate(() => {
        globalThis.__foreignBinding = () => 'foreign';
        globalThis.__mindsproutReadinessSample = globalThis.__foreignBinding;
      });
    }
    observation.start(now());
    observation.actionSettled('fulfilled', now());
    observation.outcome('readiness-failed', now());
    await observation.end();
    await profiling.finish(true);
    const published = readEvidence();
    release.resolve();
    await reply;
    await waitForObserved(removed, () => removals > 0, 1500, 'Owned binding removal');
    if (document === 'retained') {
      await page.waitForFunction(() => !Object.hasOwn(globalThis, '__mindsproutReadinessSample'));
    } else {
      assert.equal(
        await page.evaluate(
          () => globalThis.__mindsproutReadinessSample === globalThis.__foreignBinding,
        ),
        true,
      );
    }
    assert.deepEqual(published.marker.samples, []);
    assert(published.marker.codes.includes('sampler-setup-timeout'));
    assert.deepEqual(readEvidence(), published);
    noSecrets(published);
  });
}

for (const failure of ['install-conflict', 'evaluation-rejected', 'foreign-binding']) {
  test(`${failure} releases owned binding resources without deleting foreign page globals`, async (t) => {
    const fixture = await liveReadiness(t);
    const { page, profiling, observation, now, readEvidence } = fixture;
    if (failure === 'evaluation-rejected') {
      const evaluate = page.evaluate.bind(page);
      page.evaluate = (fn, parameters) => {
        if (fn.name === 'installSampler')
          return Promise.reject(new Error('PRIVATE_CANARY_evaluate'));
        return evaluate(fn, parameters);
      };
    } else {
      await page.evaluate((foreignBinding) => {
        globalThis.__foreignStopped = 0;
        globalThis.__foreignSampler = {
          stop() {
            globalThis.__foreignStopped++;
          },
          foreign: true,
        };
        globalThis.__mindsproutReadinessSampler = globalThis.__foreignSampler;
        if (foreignBinding) {
          globalThis.__foreignBinding = () => 'foreign';
          globalThis.__mindsproutReadinessSample = globalThis.__foreignBinding;
        }
      }, failure === 'foreign-binding');
    }
    await observation.begin();
    observation.start(now());
    observation.outcome('readiness-failed', now());
    await observation.end();
    await profiling.finish(true);
    const evidence = readEvidence();
    const globals = await page.evaluate(() => ({
      binding: Object.hasOwn(globalThis, '__mindsproutReadinessSample'),
      foreignBinding: globalThis.__mindsproutReadinessSample === globalThis.__foreignBinding,
      foreignSampler: globalThis.__mindsproutReadinessSampler === globalThis.__foreignSampler,
      foreignStopped: globalThis.__foreignStopped,
    }));
    assert.equal(globals.binding, failure === 'foreign-binding');
    if (failure !== 'evaluation-rejected') {
      assert.equal(globals.foreignSampler, true);
      assert.equal(globals.foreignStopped, 0);
    }
    if (failure === 'foreign-binding') assert.equal(globals.foreignBinding, true);
    assert.equal(evidence.marker.status, 'partial');
    assert(evidence.marker.codes.includes('sampler-setup-failed'));
    assert.deepEqual(evidence.marker.samples, []);
    noSecrets(evidence);
  });
}
