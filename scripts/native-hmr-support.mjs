import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function deadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function waitForObserved(observed, predicate, ms, label) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      observed.off('event', inspect);
      if (error) reject(error);
      else resolve();
    };
    const inspect = () => {
      if (predicate()) finish();
    };
    const timer = setTimeout(() => finish(new Error(`${label} exceeded ${ms}ms`)), ms);
    observed.on('event', inspect);
    inspect();
  });
}

export function listening() {
  return new Promise((resolve) => {
    const socket = net.connect(3000, 'localhost');
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(300, () => done(true));
  });
}

export function processGroup(pid) {
  return execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([, group]) => Number(group) === pid)
    .map(([id, group, state]) => ({ pid: Number(id), group: Number(group), state }));
}

export async function stopOwnedProcessGroup(
  owned,
  closed,
  timeoutMs = 10000,
  isListening = listening,
) {
  const end = performance.now() + timeoutMs;
  const remaining = () => {
    const ms = end - performance.now();
    if (ms <= 0) throw new Error(`Owned server shutdown exceeded ${timeoutMs}ms`);
    return ms;
  };
  assert(
    owned.exitCode === null && owned.signalCode === null,
    'Owned server leader disappeared; refusing stale PID signal',
  );
  assert(
    processGroup(owned.pid).some((item) => item.pid === owned.pid && !item.state.startsWith('Z')),
    'Owned server leader disappeared; refusing stale PID signal',
  );
  remaining();
  process.kill(-owned.pid, 'SIGTERM');
  await deadline(closed, remaining(), 'Owned server shutdown');
  while (processGroup(owned.pid).some((item) => !item.state.startsWith('Z'))) {
    await sleep(Math.min(50, remaining()));
  }
  assert(
    !(await deadline(isListening(), remaining(), 'Owned server shutdown')),
    'Listener survived shutdown; refusing restoration',
  );
  remaining();
}

export async function waitForReadiness(state, start, expectedPath, started) {
  const remaining = 5000 - (performance.now() - started - start.ms);
  assert(remaining > 0, 'Readiness expired before document commit');
  await state.page
    .getByTestId('map-editor-ready')
    .waitFor({ state: 'visible', timeout: remaining });
  const elapsedMs = performance.now() - started - start.ms;
  assert(elapsedMs <= 5000, 'Editor readiness exceeded 5000ms');
  const actualPath = new URL(state.page.url()).pathname;
  if (expectedPath !== undefined) assert.equal(actualPath, expectedPath);
  else assert.match(actualPath, /^\/maps\/[^/]+$/);
  return elapsedMs;
}

export async function capturePage(state, name, out) {
  const evidence = { url: state.page.url(), started: Date.now(), steps: {} };
  const capture = async (kind, action) => {
    const step = (evidence.steps[kind] = { started: Date.now(), monotonicMs: performance.now() });
    try {
      await action();
    } catch (error) {
      step.error = error.message;
      throw error;
    } finally {
      step.finished = Date.now();
    }
  };
  const outcomes = await Promise.allSettled([
    capture('frame', async () => {
      evidence.frame = (
        await deadline(state.cdp.send('Page.getFrameTree'), 1000, 'Capture frame')
      ).frameTree.frame;
    }),
    capture('screenshot', () =>
      state.page.screenshot({ path: path.join(out, name + '.png'), timeout: 2000 }),
    ),
    capture('dom', async () => {
      fs.writeFileSync(
        path.join(out, name + '.html'),
        await deadline(state.page.content(), 2000, 'DOM capture'),
      );
    }),
  ]);
  evidence.finished = Date.now();
  fs.writeFileSync(
    path.join(out, name + '-capture.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((outcome) => outcome.reason),
      'Page capture failed',
    );
}

export function changesEditor(event, sourceRelative) {
  if (event.type !== 'Network.webSocketFrameReceived') return false;
  let message;
  try {
    message = JSON.parse(event.data.response.payloadData);
  } catch {
    return false;
  }
  if (message.type !== 'turbopack-message') return false;
  const updates = Array.isArray(message.data) ? message.data : [message.data];
  return updates.some(
    (update) =>
      update?.type === 'partial' &&
      update.instruction?.type === 'ChunkListUpdate' &&
      update.instruction.merged?.some((merged) =>
        Object.keys(merged.entries || {}).some((name) => name.includes(sourceRelative)),
      ),
  );
}

export function assertSourceProof(proof) {
  assert.equal(proof.retainedDocuments, 0);
  assert.equal(proof.retainedReloads, 0);
  assert.equal(proof.loaderAfter, proof.retainedLoader, 'Retained HMR replaced its document');
  assert.equal(proof.targetDocuments, 0);
  assert.equal(proof.targetReloads, 0);
  assert(proof.receivedUpdateFrames > 0, 'Missing partial MapEditor HMR');
}

export function editorUpdates(events, page, sinceMs, sourceRelative) {
  return events.filter(
    (event) => event.page === page && event.ms >= sinceMs && changesEditor(event, sourceRelative),
  );
}

// Visibility on a clock. Callers join it after other awaits, so an early rejection is observed
// here instead of escaping as an unhandled rejection that would skip cleanup.
export function visibleWithin(locator, budget, visible, message) {
  const waiting = locator
    .waitFor({ state: 'visible', timeout: budget.remaining() })
    .then(() => assert(visible().ms <= budget.endMs, message));
  waiting.catch(() => {
    // Observes an early rejection only; the same rejection still reaches the caller's join.
  });
  return waiting;
}

export function clock(startMs, elapsed, ms = 5000) {
  const endMs = startMs + ms;
  return { endMs, remaining: () => Math.max(1, endMs - elapsed()) };
}

// Dev chunk URLs map to their emitted file: /_next/static/chunks/X -> <.next/dev>/static/chunks/X.
export function editorChunkFile(cacheDirectory, chunks, page, literal) {
  const urls = [
    ...new Set(
      chunks
        .filter((entry) => entry.page === page && entry.literals.includes(literal))
        .map((entry) => entry.url),
    ),
  ];
  assert.equal(urls.length, 1, `Expected exactly one retained editor chunk carrying ${literal}`);
  const { pathname } = new URL(urls[0]);
  assert(pathname.startsWith('/_next/static/chunks/'), `Not an emitted chunk URL: ${urls[0]}`);
  return path.join(cacheDirectory, decodeURIComponent(pathname.slice('/_next/'.length)));
}

// Complete B build: B present, A absent, and the trailing source-map line is already written.
export function emittedB(bytes, file, [valueA, valueB]) {
  const text = bytes.toString('utf8');
  return (
    text.includes(valueB) &&
    !text.includes(valueA) &&
    text.trimEnd().endsWith(`//# sourceMappingURL=${path.basename(file)}.map`)
  );
}

function readEmitted(file, values) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const { size, mtimeMs } = fs.fstatSync(fd);
    const bytes = fs.readFileSync(fd);
    if (!emittedB(bytes, file, values)) return null;
    return { path: file, size, mtimeMs, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    fs.closeSync(fd);
  }
}

export async function waitForEmitted(file, values, ms, intervalMs = 5) {
  let polling = true;
  const poll = async () => {
    while (polling) {
      const emitted = readEmitted(file, values);
      if (emitted) return emitted;
      await sleep(intervalMs);
    }
  };
  try {
    return await deadline(poll(), ms, 'Emitted B chunk');
  } finally {
    polling = false;
  }
}

// First navigation starts only after the retained page received the changed module and the
// emitted chunk on disk is the complete B build, so the navigation cannot fetch A.
export async function firstNavigationGate({ observed, updates, file, values, clock: budget }) {
  await waitForObserved(
    observed,
    () => updates().length > 0,
    budget.remaining(),
    'Changed editor module HMR',
  );
  const emitted = await waitForEmitted(file, values, budget.remaining());
  return {
    waitedOn: ['retained-editor-partial', 'emitted-B-chunk'],
    partialMs: updates()[0].ms,
    emitted,
  };
}

export async function nativeIdentity(manifestPath) {
  let candidate;
  if (process.env.NEXT_TEST_NATIVE_DIR) {
    assert(manifestPath, 'Candidate browser qualification requires its build manifest');
    candidate = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./native-package.mjs', import.meta.url)),
        'verify',
        path.resolve(manifestPath),
      ],
      { stdio: 'inherit' },
    );
  } else {
    assert(!manifestPath, 'Installed browser qualification must not select a candidate manifest');
  }
  assert.equal(require('next/package.json').version, '16.4.5', 'Unexpected Next version');
  const binding = await require('next/dist/build/swc').loadBindings();
  assert.equal(binding.isWasm, false, 'WASM fallback is not permitted');
  const loaded = Object.keys(require.cache).filter((filename) => filename.endsWith('.node'));
  assert.equal(loaded.length, 1, 'Browser qualification requires one exclusive native addon');
  if (candidate) {
    const expected = fs.realpathSync(
      path.join(process.env.NEXT_TEST_NATIVE_DIR, candidate.binary.file),
    );
    assert.equal(fs.realpathSync(loaded[0]), expected, 'Next loaded a different candidate');
    assert.equal(
      createHash('sha256').update(fs.readFileSync(expected)).digest('hex'),
      candidate.binary.sha256,
      'Loaded candidate binary differs from its manifest',
    );
    assert.equal(binding.turbopackCacheVersion('16.4.5'), candidate.addon.cacheVersion);
    assert.equal(
      binding.getTargetTriple(),
      candidate.addon.targetTriple,
      'Loaded candidate target mismatch',
    );
  }
  return {
    target: binding.getTargetTriple(),
    cacheVersion: binding.turbopackCacheVersion('16.4.5'),
    binary: fs.realpathSync(loaded[0]),
    binarySha256: createHash('sha256').update(fs.readFileSync(loaded[0])).digest('hex'),
    nativeDirectory: process.env.NEXT_TEST_NATIVE_DIR || null,
  };
}

export async function publicMap(state, origin, guard, visitEditor, homeBack) {
  await guard(state.page.goto(origin, { waitUntil: 'commit', timeout: 5000 }));
  await guard(
    state.page
      .getByRole('button', { name: '新建导图', exact: true })
      .waitFor({ state: 'visible', timeout: 5000 }),
  );
  await visitEditor(state, () =>
    state.page.getByRole('button', { name: '新建导图', exact: true }).click(),
  );
  const mapPath = new URL(state.page.url()).pathname;
  assert.match(mapPath, /^\/maps\/[^/]+$/);
  await homeBack(state);
  await visitEditor(state, () => state.page.locator(`a[href="${mapPath}"]`).click(), mapPath);
  return mapPath;
}

export function assertQuiet(events) {
  assert(
    !events.some(
      (event) =>
        event.type === 'pageerror' ||
        event.type === 'crash' ||
        (event.type === 'console' && ['warning', 'warn', 'error'].includes(event.data.type)),
    ),
    'Browser warning/error/pageerror/crash observed',
  );
}

export function sourceStimulus(original, { mode, probe, valueA, valueB, variable }) {
  const anchor =
    mode === 'source-change'
      ? '      <EditorView storageUnavailable={storageUnavailable} />'
      : '  return <RepositoryContext value={state}>{children}</RepositoryContext>;';
  const text = original.toString('utf8');
  assert.equal(text.split(anchor).length, 2, 'Qualified source seam changed; refusing edit');
  const replacement =
    mode === 'source-change'
      ? `      <output data-testid="${probe}">${valueA}</output>\n${anchor}`
      : `  return <RepositoryContext value={state}><output data-testid="${probe}">{process.env.${variable}}</output>{children}</RepositoryContext>;`;
  const stimulated = Buffer.from(text.replace(anchor, replacement));
  const stimulatedB = Buffer.from(
    stimulated.toString().replace(`>${valueA}</output>`, `>${valueB}</output>`),
  );
  return { stimulated, stimulatedB };
}
