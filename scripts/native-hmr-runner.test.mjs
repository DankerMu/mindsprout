import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deadline, listening, processGroup } from './native-hmr-support.mjs';

const next = path.resolve('.next');
const cache = path.join(next, 'dev');
const source = path.resolve('src/app/maps/[id]/MapEditor.tsx');
const runner = fileURLToPath(new URL('./native-hmr.mjs', import.meta.url));
const preload = fileURLToPath(new URL('./native-hmr-runner-fixture.mjs', import.meta.url));
const provider = path.resolve('src/app/providers/MapRepositoryProvider.tsx');
const load = (directory, file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stat = (file) => fs.lstatSync(file, { throwIfNoEntry: false });
const inode = (file) => {
  const entry = stat(file);
  return entry ? [entry.dev, entry.ino] : null;
};
const liveGroup = (pid) => processGroup(pid).filter((member) => !member.state.startsWith('Z'));
const wait = (work, stage) => deadline(work, 90000, stage);
const sentinel = 'PRIVATE_CANARY_external-worktree-trace';

async function prepare(t, name, sourceFile = source) {
  assert(
    process.env.NATIVE_HMR_RUNNER_OUTPUT,
    'Set NATIVE_HMR_RUNNER_OUTPUT to a fresh artifact directory',
  );
  assert(process.env.DATABASE_URL, 'Supply an owned scratch Postgres database');
  assert(!stat(next), 'Run in a disposable checkout without a .next directory');
  assert(!stat('.next-profiles'), 'Run without a pre-existing .next-profiles entry');
  assert.equal(await listening(), false, 'Port 3000 must be unused');
  const directory = path.resolve(process.env.NATIVE_HMR_RUNNER_OUTPUT, name);
  fs.mkdirSync(directory, { recursive: true });
  const original = hash(sourceFile);
  t.after(() => {
    if (stat(next)) fs.renameSync(next, path.join(directory, 'cache-final'));
  });
  return { directory, output: path.join(directory, 'probe'), original, sourceFile };
}

function start(
  { directory, output },
  profile,
  probe,
  { externalCache, linked, mode = 'source-change' } = {},
) {
  const log = fs.openSync(path.join(directory, 'runner.log'), 'wx');
  try {
    const child = spawn(
      process.execPath,
      ['--import', preload, runner, mode, output, ...(profile ? ['--profile'] : [])],
      {
        env: {
          ...process.env,
          NATIVE_RUNNER_PROBE: probe,
          NATIVE_RUNNER_EXTERNAL_CACHE: externalCache ?? '',
          NATIVE_RUNNER_LINK: linked ?? '',
        },
        stdio: ['ignore', log, log, 'ipc'],
      },
    );
    return { child, exit: once(child, 'exit') };
  } finally {
    fs.closeSync(log);
  }
}

function onMessage({ child, exit }, type) {
  return wait(
    Promise.race([
      once(child, 'message').then(([message]) => {
        assert.equal(message.type, type);
        return message;
      }),
      exit.then(([code, signal]) => assert.fail(`Runner exited before ${type}: ${code ?? signal}`)),
    ]),
    type,
  );
}

async function deliver(fixture, signal) {
  const ack = onMessage(fixture, 'signal');
  assert.equal(fixture.child.kill(signal), true);
  assert.equal((await ack).signal, signal);
}

async function restored(
  { output, original, sourceFile },
  { sourcePrepared = true, cacheRestored = true } = {},
) {
  const result = load(output, 'result.json');
  assert.deepEqual(result.cleanup, {
    errors: cacheRestored ? [] : ['Profile cache parent is unsafe'],
    sourceRestored: true,
    cacheRestored,
    ...(sourcePrepared ? { sourceHash: original, expectedSourceHash: original } : {}),
  });
  assert.deepEqual(load(output, 'cleanup.json'), result.cleanup);
  assert.equal(hash(sourceFile), original);
  assert.equal(load(output, 'handles.json').active, false);
  assert(!stat('.next-profiles'));
  assert.equal(await listening(), false);
  return result;
}

function createCache() {
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'cache-sentinel'), sentinel);
  return inode(cache);
}

for (const profile of [false, true]) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const name = `${profile ? 'profile' : 'default'}-${signal}`;
    test(`${name}: interrupt after functional success fails the actual runner after restoration`, async (t) => {
      const run = await prepare(t, name);
      const cacheInode = createCache();
      const fixture = start(run, profile, 'signal');
      let browserPid, serverPid;
      try {
        ({ browserPid } = await onMessage(fixture, 'cleanup-barrier'));
        ({ serverPid } = load(run.output, 'handles.json'));
        const events = fs
          .readFileSync(path.join(run.output, 'events.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse);
        assert(!events.some(({ type }) => type === 'failure'));
        assert(events.some(({ type }) => type === 'visible-first-navigation-B'));
        assert(stat(path.join(run.output, 'source-first-navigation-B.png')));
        assert.equal(hash(source), load(run.output, 'source-manifest.json').bHash);
        assert(liveGroup(browserPid).length > 0);
        assert(liveGroup(serverPid).length > 0);
        assert.equal(await listening(), true);
        await deliver(fixture, signal);
        await deliver(fixture, signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
      } finally {
        if (fixture.child.connected) fixture.child.send({ type: 'release' }, () => undefined);
        await wait(fixture.exit, 'runner teardown');
      }
      const [code, exitSignal] = await fixture.exit;
      const result = await restored(run);
      assert(result.sourceProof.receivedUpdateFrames > 0);
      assert.deepEqual(inode(cache), cacheInode);
      assert.equal(fs.readFileSync(path.join(cache, 'cache-sentinel'), 'utf8'), sentinel);
      assert.deepEqual(liveGroup(browserPid), []);
      assert.deepEqual(liveGroup(serverPid), []);
      const summary = profile ? load(run.output, 'safe/summary.json') : null;
      if (profile) {
        assert.equal(summary.status, 'partial');
        assert(summary.codes.includes('interrupted'));
      } else {
        assert(!stat(path.join(run.output, 'safe')));
        assert(!stat(path.join(run.output, 'profile-private')));
      }
      assert.deepEqual(
        { code, exitSignal, status: result.status, failures: result.failures },
        {
          code: 1,
          exitSignal: null,
          status: 'failed',
          failures: [`Interrupted by ${signal}`],
        },
      );
      const interrupts = result.events.filter(({ type }) => type === 'interrupt');
      assert.deepEqual(
        interrupts.map(({ phase, data }) => [phase, data.message]),
        [['cleanup', `Interrupted by ${signal}`]],
      );
    });
  }
}

test('a later restored trial failure cannot change the ready first-create attempt or label its capture', async (t) => {
  const run = await prepare(t, 'restored-trial-failure', provider);
  const cacheInode = createCache();
  const fixture = start(run, false, 'restored-trial', { mode: 'restored-lifecycle' });
  assert.deepEqual(await wait(fixture.exit, 'restored trial teardown'), [1, null]);
  const result = await restored(run);
  assert.deepEqual(inode(cache), cacheInode);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failures, ['Controlled restored trial click failure']);
  const { events } = result;
  const [attempt] = events.filter(({ type }) => type === 'public-create-evidence');
  assert.equal(events.filter(({ type }) => type === 'public-create-evidence').length, 1);
  assert.deepEqual(
    [attempt.phase, attempt.data.mode, attempt.data.trial, attempt.data.outcome.status],
    ['public-map-setup', 'restored-lifecycle', 0, 'ready'],
  );
  const failure = events.find(({ type }) => type === 'failure');
  assert.deepEqual([failure.phase, failure.trial], ['spa-preparation', 1]);
  assert(failure.ms > attempt.ms);
  assert.equal(Object.hasOwn(load(run.output, 'failure-capture.json'), 'publicCreate'), false);
});

function assertExternalTrace(
  run,
  summary,
  trace,
  before,
  [code, exitSignal],
  postStop,
  parentLinked,
) {
  const prefix = path.join(run.output, 'profile-private');
  assert.deepEqual(
    {
      code,
      exitSignal,
      codeInSummary: summary.codes.includes('unsafe-file'),
      producerLaunched: Boolean(stat(path.join(run.output, 'server-0.log'))),
      externalInode: inode(trace),
      externalTraceUnchanged: stat(trace) && fs.readFileSync(trace, 'utf8') === sentinel,
      prestartDestination: Boolean(stat(path.join(prefix, 'prestart-0.trace'))),
      poststopDestination: Boolean(stat(path.join(prefix, 'generation-0/trace'))),
    },
    {
      code: postStop && !parentLinked ? 0 : 1,
      exitSignal: null,
      codeInSummary: true,
      producerLaunched: postStop,
      externalInode: before,
      externalTraceUnchanged: true,
      prestartDestination: false,
      poststopDestination: false,
    },
  );
  assert.equal(summary.status, 'partial');
  assert(!JSON.stringify(summary).includes(sentinel));
}

for (const [probe, linked] of [
  ['pre-start', '.next/dev'],
  ['pre-start', '.next'],
  ['post-stop', '.next/dev'],
  ['post-stop', '.next'],
]) {
  const name = `${probe}-${linked === '.next' ? 'next' : 'dev'}-link`;
  test(`${name}: actual runner keeps a regular trace under the external cache untouched`, async (t) => {
    const run = await prepare(t, name);
    const external = path.join(run.directory, 'external');
    const externalCache = linked === '.next' ? path.join(external, 'dev') : external;
    const trace = path.join(externalCache, 'trace');
    fs.mkdirSync(externalCache, { recursive: true });
    fs.writeFileSync(trace, sentinel);
    const before = inode(trace);
    if (probe === 'post-stop') createCache();
    else if (linked === '.next') fs.symlinkSync(external, next);
    else {
      fs.mkdirSync(next);
      fs.symlinkSync(external, cache);
    }
    const cacheInode = inode(linked);
    const fixture = start(run, true, probe, { externalCache: external, linked });
    const exit = await wait(fixture.exit, 'linked-cache runner teardown');
    const parentLinked = linked === '.next';
    const postStop = probe === 'post-stop';
    const result = await restored(run, {
      sourcePrepared: postStop || !parentLinked,
      cacheRestored: !postStop || !parentLinked,
    });
    const summary = load(run.output, 'safe/summary.json');
    assertExternalTrace(run, summary, trace, before, exit, postStop, parentLinked);
    if (postStop && parentLinked) {
      assert.equal(fs.readlinkSync(next), external);
      assert.deepEqual(inode(path.join(run.output, 'cache-before-link')), cacheInode);
      assert(stat(path.join(run.output, 'cache-original/cache-sentinel')));
    } else {
      assert.deepEqual(inode(linked), cacheInode);
    }
    if (postStop) {
      assert.equal(result.status, parentLinked ? 'cleanup-blocked' : 'passed');
      assert.deepEqual(result.failures, []);
      assert.deepEqual(summary.generations[0].trace, {
        status: 'partial',
        codes: ['unsafe-file'],
        coverage: 'observed-only',
      });
      const { launcherPid, processGroup: members } = summary.generations[0].process;
      assert.deepEqual(liveGroup(launcherPid), []);
      assert(members.includes(launcherPid));
    } else {
      assert.deepEqual(summary.generations, []);
    }
  });
}
