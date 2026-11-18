import assert from 'node:assert/strict';
import test from 'node:test';
import { observeEditorVisit } from './native-hmr-observation.mjs';
import { countSamplerWork, liveReadiness } from './native-hmr-readiness-fixtures.mjs';
import { deferred, noSecrets } from './native-hmr-profile-fixtures.mjs';
import { waitForReadiness } from './native-hmr-support.mjs';

test('timed-out real sampler setup cannot revive acceptance when its page evaluation arrives late', async (t) => {
  const fixture = await liveReadiness(t);
  const { page, observation, now } = fixture;
  await countSamplerWork(page);
  const evaluate = page.evaluate.bind(page);
  const held = deferred();
  page.evaluate = (fn, args) =>
    fn.name === 'installSampler' ? held.promise.then(() => evaluate(fn, args)) : evaluate(fn, args);
  await observation.begin();
  const start = now();
  observation.start(start);
  observation.actionSettled('fulfilled', now());
  const failure = now();
  observation.outcome('readiness-failed', failure);
  await observation.end();
  held.resolve();
  await fixture.sampled((sample) => sample.ordinal === 1);
  assert((await evaluate(() => globalThis.__readinessWork.reads)) > 0);
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
  const { profiling, observation, now, received } = fixture;
  let interruption;
  const remove = profiling.registerSignals((error) => {
    interruption = error;
  });
  t.after(remove);
  await observation.begin();
  const start = now();
  observation.start(start);
  observation.actionSettled('fulfilled', now());
  await fixture.sampled((sample) => sample.ordinal >= 2);
  const before = received.length;
  process.emit('SIGINT');
  assert.match(interruption.message, /Interrupted by SIGINT/);
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
  noSecrets(evidence);
});
