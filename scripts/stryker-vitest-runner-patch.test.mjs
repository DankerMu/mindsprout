// Regression for the repo-maintained @stryker-mutator/vitest-runner patch (#118, decision 0022).
// Exercises the INSTALLED runner file (the pnpm entry carrying the patch hash), never a copy:
// debug-level init must not throw on a circular Vitest config and must still log its content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import util from 'node:util';
import test from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerDist = fs.realpathSync(
  path.join(repository, 'node_modules/@stryker-mutator/vitest-runner/dist/src'),
);
const { VitestTestRunner } = await import(
  pathToFileURL(path.join(runnerDist, 'vitest-test-runner.js')).href
);
const { vitestWrapper } = await import(
  pathToFileURL(path.join(runnerDist, 'vitest-wrapper.js')).href
);
const CONFIG_MESSAGE = 'vitest final config:';

// Same shape as Vitest 5's resolved config: resolvedProjects[0].viteConfig.test closes the circle.
function circularContext() {
  const config = { root: '/project', include: ['src/**/*.test.ts'], browser: {} };
  config.resolvedProjects = [{ viteConfig: { test: config } }];
  return {
    config,
    projects: [{ config: { setupFiles: [], browser: {} } }],
    provide: () => undefined,
  };
}

// Stryker core's LoggingEvent renders `util.format(...args)` in the worker before transport.
function capturingLogger(debugEnabled) {
  const messages = [];
  const record = (...args) => messages.push(util.format(...args));
  return {
    messages,
    isDebugEnabled: () => debugEnabled,
    isTraceEnabled: () => false,
    isInfoEnabled: () => true,
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
    fatal: record,
  };
}

async function initRunner({ debugEnabled, createVitest }) {
  const saved = { cwd: process.cwd(), createVitest: vitestWrapper.createVitest };
  const env = Object.fromEntries(
    ['NODE_ENV', 'VITEST', 'STRYKER_MUTATOR_WORKER'].map((key) => [key, process.env[key]]),
  );
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-runner-')));
  const log = capturingLogger(debugEnabled);
  try {
    delete process.env.STRYKER_MUTATOR_WORKER;
    // localSetupFile resolves against cwd at construction; init() writes it there.
    process.chdir(directory);
    vitestWrapper.createVitest = createVitest;
    const runner = new VitestTestRunner({ vitest: { pool: 'forks', related: true } }, log, '__s');
    assert.equal(path.dirname(runner.localSetupFile), directory);
    const outcome = await runner.init().then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    return { ...outcome, log, setupWritten: fs.existsSync(runner.localSetupFile) };
  } finally {
    vitestWrapper.createVitest = saved.createVitest;
    process.chdir(saved.cwd);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const configMessages = (log) => log.messages.filter((m) => m.startsWith(CONFIG_MESSAGE));

test('the runner under test is the installed pnpm entry carrying the patch hash', () => {
  assert.match(
    runnerDist,
    /node_modules\/\.pnpm\/@stryker-mutator\+vitest-runner@10\.1\.1_[^/]*patch_hash=[0-9a-f]+[^/]*\//,
  );
});

test('debug init tolerates a circular Vitest config and still logs its content', async () => {
  const result = await initRunner({
    debugEnabled: true,
    createVitest: async () => circularContext(),
  });
  assert.equal(result.ok, true, result.error?.stack);
  assert.equal(result.setupWritten, true);
  const [message, ...rest] = configMessages(result.log);
  assert.equal(rest.length, 0);
  assert.ok(message, 'expected one "vitest final config:" debug message');
  for (const key of ['root', 'include', 'resolvedProjects']) {
    assert.match(message, new RegExp(`\\b${key}\\b`), `config message must name ${key}`);
  }
});

test('an initialization error is propagated unchanged at debug level', async () => {
  const boom = new Error('boom');
  const result = await initRunner({
    debugEnabled: true,
    createVitest: async () => {
      throw boom;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, boom);
  assert.deepEqual(configMessages(result.log), []);
});

test('non-debug init logs no config and resolves', async () => {
  const result = await initRunner({
    debugEnabled: false,
    createVitest: async () => circularContext(),
  });
  assert.equal(result.ok, true, result.error?.stack);
  assert.deepEqual(configMessages(result.log), []);
});
