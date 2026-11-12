// Regression for the repo-maintained Stryker patches (decision 0022): the @stryker-mutator/vitest-runner
// debug config log (#118) and the @stryker-mutator/util errorToString fallback (#119).
// Exercises the INSTALLED files (the pnpm entries carrying the patch hash), never a copy.
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
// The util entry the runner itself imports: its sibling in the runner's pnpm store folder.
const utilDist = fs.realpathSync(path.join(runnerDist, '../../../util/dist/src'));
const { VitestTestRunner } = await import(
  pathToFileURL(path.join(runnerDist, 'vitest-test-runner.js')).href
);
const { vitestWrapper } = await import(
  pathToFileURL(path.join(runnerDist, 'vitest-wrapper.js')).href
);
const { errorToString } = await import(pathToFileURL(path.join(utilDist, 'index.js')).href);
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

// Vitest rebuilds an error crossing a worker boundary without a prototype, so String() throws on it.
function nullPrototype(fields) {
  return Object.assign(Object.create(null), fields);
}

// A run that finds no test files but collected an unstringifiable error and an ordinary one.
function erroringContext(errors) {
  return {
    config: { root: '/project', browser: {} },
    projects: [{ config: { setupFiles: [], browser: {} } }],
    provide: () => undefined,
    start: async () => undefined,
    state: { filesMap: new Map(), getFiles: () => [], errorsSet: new Set(errors) },
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

// `act` runs inside the temp cwd with the stubbed Vitest; its outcome is settled, never thrown.
async function withRunner({ debugEnabled, createVitest }, act = (runner) => runner.init()) {
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
    const outcome = await act(runner, directory).then(
      (value) => ({ ok: true, value }),
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
  const result = await withRunner({
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
  const result = await withRunner({
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
  const result = await withRunner({
    debugEnabled: false,
    createVitest: async () => circularContext(),
  });
  assert.equal(result.ok, true, result.error?.stack);
  assert.deepEqual(configMessages(result.log), []);
});

test('the runner imports the installed util entry carrying the patch hash', () => {
  assert.match(
    utilDist,
    /node_modules\/\.pnpm\/@stryker-mutator\+util@10\.1\.1_patch_hash=[0-9a-f]+\/node_modules\//,
  );
});

const unstringifiable = [
  {
    title: 'an error that lost its prototype keeps name, message and stack',
    input: () =>
      nullPrototype({
        name: 'TypeError',
        message: 'expected error',
        stack: 'TypeError: expected error\n    at foo.js:1:1',
      }),
    expected: 'TypeError: expected error\nTypeError: expected error\n    at foo.js:1:1',
  },
  {
    title: 'an empty null-prototype object renders its object tag',
    input: () => nullPrototype({}),
    expected: '[object Object]',
  },
  {
    title: 'a throwing Symbol.toPrimitive does not propagate',
    input: () => ({
      [Symbol.toPrimitive]() {
        throw new Error('not convertible');
      },
    }),
    expected: '[object Object]',
  },
  {
    title: 'a non-string name renders the message alone',
    input: () => nullPrototype({ message: 'm' }),
    expected: 'm',
  },
  {
    title: 'a non-string stack renders name and message only',
    input: () => nullPrototype({ name: 'E', message: 'm' }),
    expected: 'E: m',
  },
];

for (const { title, input, expected } of unstringifiable) {
  test(`errorToString: ${title}`, () => {
    assert.equal(errorToString(input()), expected);
  });
}

test('errorToString keeps the output of every value String() can convert', () => {
  for (const falsy of [undefined, null, 0, '', false]) {
    assert.equal(errorToString(falsy), '', `falsy ${String(falsy)}`);
  }
  const errno = Object.assign(new Error('missing'), { code: 'ENOENT', syscall: 'open' });
  assert.equal(errorToString(errno), `Error: ENOENT (open) ${errno.stack}`);
  const withStack = new TypeError('broken');
  assert.equal(errorToString(withStack), `TypeError: broken\n${withStack.stack}`);
  const withoutStack = new RangeError('bare');
  delete withoutStack.stack;
  assert.equal(errorToString(withoutStack), 'RangeError: bare');
  assert.equal(errorToString('plain text'), 'plain text');
  assert.equal(errorToString({ any: 'object' }), '[object Object]');
});

// Every mutant run and the dry run go through VitestTestRunner.run, which formats errorsSet.
async function runWithCollectedErrors(act) {
  const readable = new Error('readable');
  const workerLost = nullPrototype({
    name: 'TypeError',
    message: 'worker lost',
    stack: 'TypeError: worker lost\n    at w.js:1:1',
  });
  const result = await withRunner(
    { debugEnabled: false, createVitest: async () => erroringContext([workerLost, readable]) },
    async (runner, directory) => {
      await runner.init();
      return act(runner, directory);
    },
  );
  assert.equal(result.ok, true, result.error?.stack);
  assert.deepEqual(result.value, {
    status: 'error',
    errorMessage:
      'An error occurred outside of a test run: ' +
      'TypeError: worker lost\nTypeError: worker lost\n    at w.js:1:1\n' +
      `Error: readable\n${readable.stack}`,
  });
}

test('dryRun returns an error result with every collected error message', async () => {
  await runWithCollectedErrors((runner) => runner.dryRun({ files: [] }));
});

test('mutantRun returns an error result with every collected error message', async () => {
  await runWithCollectedErrors((runner, directory) => {
    const sandboxFileName = path.join(directory, 'mutated.js');
    fs.writeFileSync(sandboxFileName, '');
    return runner.mutantRun({
      activeMutant: { id: '1' },
      testFilter: undefined,
      sandboxFileName,
      hitLimit: undefined,
      mutantActivation: 'runtime',
    });
  });
});
