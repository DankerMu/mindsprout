import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativeBrowserArgs } from './native-hmr-profile.mjs';
import { secret, noSecrets } from './native-hmr-profile-fixtures.mjs';

const ambientVariables = [
  'NEXT_CPU_PROF',
  'NEXT_CPU_PROF_DIR',
  '__NEXT_PRIVATE_CPU_PROFILE',
  'NEXT_TURBOPACK_TRACING',
  'NEXT_TURBOPACK_TRACING_PATH',
];

for (const mode of ['restored-lifecycle', 'source-change']) {
  test(`${mode} accepts installed and candidate invocations with only a trailing opt-in`, () => {
    for (const candidate of [undefined, 'candidate.json']) {
      for (const enabled of [false, true]) {
        const args = [
          mode,
          'fresh-output',
          ...(candidate ? [candidate] : []),
          ...(enabled ? ['--profile'] : []),
        ];
        assert.deepEqual(parseNativeBrowserArgs(args, {}), {
          mode,
          output: 'fresh-output',
          candidateManifest: candidate,
          profile: enabled,
        });
      }
    }
  });
}

test('ambiguous CLI input is rejected without echoing any argument', () => {
  for (const args of [
    [],
    ['unknown', secret],
    ['source-change'],
    ['--profile', 'source-change', secret],
    ['source-change', '--profile'],
    ['source-change', secret, '--profile', 'candidate.json'],
    ['source-change', secret, '--profile', '--profile'],
    ['source-change', secret, '--unknown'],
    ['source-change', secret, 'candidate.json', 'surplus'],
    ['source-change', secret, 'candidate.json', '--profile', 'surplus'],
  ]) {
    assert.throws(
      () => parseNativeBrowserArgs(args, {}),
      (error) => {
        assert.equal(error.code, 'invalid-arguments');
        noSecrets({ message: error.message, stack: error.stack, cause: error.cause });
        return true;
      },
    );
  }
});

for (const variable of ambientVariables) {
  test(`ambient ${variable} is refused even when empty in default and profiled modes`, () => {
    for (const value of ['', secret]) {
      for (const args of [
        ['source-change', 'output'],
        ['source-change', 'output', '--profile'],
      ]) {
        assert.throws(
          () => parseNativeBrowserArgs(args, { [variable]: value }),
          (error) => {
            assert.equal(error.code, 'ambient-profiling');
            noSecrets({ message: error.message, stack: error.stack, cause: error.cause });
            return true;
          },
        );
      }
    }
  });
}
