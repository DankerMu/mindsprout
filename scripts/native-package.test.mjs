import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const input = process.argv[2];
assert(input, 'Usage: pnpm native:package:test BUILT_MANIFEST');
const manifestPath = path.resolve(input);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const cli = fileURLToPath(new URL('./native-package.mjs', import.meta.url));

function invoke(filename, args = [], env = process.env) {
  return spawnSync(process.execPath, [cli, 'verify', filename, ...args], { encoding: 'utf8', env });
}

function withManifest(change, check) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-native-contract-'));
  try {
    fs.copyFileSync(
      path.join(path.dirname(manifestPath), manifest.tarball.file),
      path.join(directory, manifest.tarball.file),
    );
    const changed = structuredClone(manifest);
    change(changed);
    const filename = path.join(directory, 'manifest.json');
    fs.writeFileSync(filename, JSON.stringify(changed));
    check(filename);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('packed native addon loads through Next with its repaired cache identity', () => {
  const result = invoke(manifestPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status":"verified"/);
  assert.match(result.stdout, /"installed":false/);
});

const negatives = [
  [
    'upstream source',
    (value) => {
      value.upstreamCommit = '0'.repeat(40);
    },
    /Manifest upstreamCommit mismatch/,
  ],
  [
    'patch',
    (value) => {
      value.patchSha256 = '0'.repeat(64);
    },
    /Manifest patchSha256 mismatch/,
  ],
  [
    'Cargo lockfile',
    (value) => {
      value.cargoLockSha256 = '0'.repeat(64);
    },
    /Manifest cargoLockSha256 mismatch/,
  ],
  [
    'toolchain',
    (value) => {
      value.toolchain = 'stable';
    },
    /Manifest toolchain mismatch/,
  ],
  [
    'target',
    (value) => {
      value.target = 'linux-arm64-gnu';
    },
    /Manifest target mismatch/,
  ],
  [
    'tarball bytes',
    (value) => {
      value.tarball.sha256 = '0'.repeat(64);
    },
    /Tarball digest mismatch/,
  ],
  [
    'package integrity',
    (value) => {
      value.tarball.integrity = 'sha512-invalid';
    },
    /Tarball integrity mismatch/,
  ],
  [
    'source identity',
    (value) => {
      value.sourceCommit = '0'.repeat(40);
      value.sourceCommitShort = '0'.repeat(12);
    },
    /Package provenance mismatch/,
  ],
  [
    'native bytes',
    (value) => {
      value.binary.sha256 = '0'.repeat(64);
    },
    /Binary digest mismatch/,
  ],
  [
    'escaping tarball path',
    (value) => {
      value.tarball.file = '../escape.tgz';
    },
    /Unsafe tarball path/,
  ],
];
for (const [label, change, expected] of negatives) {
  test(`rejects mismatched ${label} without native fallback`, () => {
    withManifest(change, (filename) => {
      const result = invoke(filename);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
      assert.doesNotMatch(result.stdout, /"status":"verified"/);
    });
  });
}

test('installed verification rejects the diagnostic native-directory seam', () => {
  const result = invoke(manifestPath, ['--installed'], {
    ...process.env,
    NEXT_TEST_NATIVE_DIR: '/not-an-installed-package',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Installed verification forbids NEXT_TEST_NATIVE_DIR/);
});

for (const [name, expected] of [
  ['VERGEN_GIT_SHA', /Refusing forged build metadata/],
  ['GIT_DIR', /native builds must use their owned checkout/],
]) {
  test(`rejects ${name} before creating or fetching build source`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-native-preflight-'));
    const output = path.join(directory, 'output');
    try {
      const result = spawnSync(process.execPath, [cli, 'build', output], {
        encoding: 'utf8',
        env: { ...process.env, [name]: 'untrusted-override' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
      assert.equal(fs.existsSync(output), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

function assertCompilerPreflightRejected(setting, configure, expected, operation = 'build') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-native-compiler-'));
  const output = path.join(directory, 'output');
  const bin = path.join(directory, 'bin');
  const temporary = path.join(directory, 'tmp');
  const gitLog = path.join(directory, 'git-invocations.log');
  const cargoLog = path.join(directory, 'cargo-invocations.log');
  const wrapperLog = path.join(directory, 'wrapper-invocations.log');
  const cwd = path.join(directory, 'caller', 'nested');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(temporary);
  // Git is the external IO boundary: an unguarded selection stops before any
  // fetch or native compilation, while still exposing preflight side effects.
  fs.writeFileSync(
    path.join(bin, 'git'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NATIVE_PREFLIGHT_GIT_LOG"\nprintf "GIT_BOUNDARY_REACHED\\n" >&2\nexit 97\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, 'cargo'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NATIVE_PREFLIGHT_CARGO_LOG"\nprintf "CARGO_BOUNDARY_REACHED\\n" >&2\nexit 98\n',
    { mode: 0o755 },
  );
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !compilerSelections.includes(name) &&
        !['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS'].includes(name) &&
        !/^CARGO_TARGET_.+_RUSTFLAGS$/.test(name),
    ),
  );
  const env = {
    ...inherited,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    TMPDIR: fs.realpathSync(temporary),
    NATIVE_PREFLIGHT_GIT_LOG: gitLog,
    NATIVE_PREFLIGHT_CARGO_LOG: cargoLog,
    NATIVE_PREFLIGHT_WRAPPER_LOG: wrapperLog,
  };
  try {
    configure(env, directory);
    const argument = operation === 'build' ? output : manifestPath;
    const result = spawnSync(process.execPath, [cli, operation, argument], {
      encoding: 'utf8',
      env,
      cwd,
      timeout: 10000,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.notEqual(result.status, 0, `${setting} must not produce a candidate`);
    assert.equal(
      fs.existsSync(output),
      false,
      `${setting} must be rejected before creating build output`,
    );
    assert.equal(
      fs.existsSync(gitLog),
      false,
      `${setting} must be rejected before initializing or fetching source`,
    );
    assert.equal(fs.existsSync(cargoLog), false, `${setting} must be rejected before Cargo`);
    assert.equal(fs.existsSync(wrapperLog), false, 'Unchecked Cargo wrapper must not execute');
    if (operation === 'test') {
      assert.match(
        result.stdout,
        /"status":"verified"/,
        'Native-test preflight must use the genuine verified artifact',
      );
    }
    assert.match(
      result.stderr,
      expected,
      'Preflight must identify the compiler selection or flags it rejected',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const compilerSelections = [
  'RUSTC',
  'CARGO_BUILD_RUSTC',
  'RUSTC_WRAPPER',
  'RUSTC_WORKSPACE_WRAPPER',
  'CARGO_BUILD_RUSTC_WRAPPER',
  'CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER',
];
for (const name of compilerSelections) {
  test(`${name} cannot select an unchecked compiler before native build preflight`, () => {
    assertCompilerPreflightRejected(
      name,
      (env) => {
        // A real executable distinct from the parent's pinned PATH rustc; no
        // forged compiler identity, manifest hash, or compiler output is involved.
        env[name] = process.execPath;
      },
      new RegExp(name),
    );
  });
}

const targetRustflags = `CARGO_TARGET_${manifest.addon.targetTriple.replaceAll('-', '_').toUpperCase()}_RUSTFLAGS`;
for (const [name, value] of [
  ['RUSTFLAGS', '-C opt-level=0'],
  ['CARGO_ENCODED_RUSTFLAGS', '-C\u001fopt-level=0'],
  ['CARGO_BUILD_RUSTFLAGS', '-C opt-level=0'],
  [targetRustflags, '-C opt-level=0'],
]) {
  test(`${name} cannot replace the reviewed native compiler flags`, () => {
    assertCompilerPreflightRejected(
      name,
      (env) => {
        env[name] = value;
      },
      new RegExp(name),
    );
  });
}

for (const filename of ['config.toml', 'config']) {
  test(`Cargo home ${filename} cannot select an unchecked build.rustc`, () => {
    assertCompilerPreflightRejected(
      `CARGO_HOME/${filename} build.rustc`,
      (env, directory) => {
        const cargoHome = path.join(directory, 'cargo-home');
        fs.mkdirSync(cargoHome);
        fs.writeFileSync(
          path.join(cargoHome, filename),
          `[build]\nrustc = ${JSON.stringify(process.execPath)}\n`,
        );
        env.CARGO_HOME = cargoHome;
      },
      /build\.rustc/,
    );
  });
}

for (const operation of ['build', 'test']) {
  for (const config of [null, 'config.toml', 'config']) {
    const variant = config ? `wrapper trap in ${config}` : 'configuration-free home';
    test(`${operation} rejects relative CARGO_HOME before native work: ${variant}`, () => {
      assertCompilerPreflightRejected(
        'relative CARGO_HOME',
        (env, directory) => {
          const home = path.join(fs.realpathSync(path.join(directory, 'tmp')), 'external-home');
          fs.mkdirSync(home);
          env.CARGO_HOME =
            operation === 'build'
              ? '../../external-home'
              : path.relative(manifest.sourceDirectory, home);
          const caller = fs.realpathSync(path.join(directory, 'caller', 'nested'));
          const callerHome = path.resolve(caller, env.CARGO_HOME);
          assert(!path.isAbsolute(env.CARGO_HOME));
          assert.notEqual(
            callerHome,
            home,
            'Fixture must expose different Node/Cargo home resolution',
          );
          assert(!fs.existsSync(path.join(callerHome, 'config')));
          assert(!fs.existsSync(path.join(callerHome, 'config.toml')));
          if (config) {
            const wrapper = path.join(home, 'unchecked-wrapper');
            fs.writeFileSync(
              wrapper,
              '#!/bin/sh\nprintf "WRAPPER_BOUNDARY_REACHED\\n" >> "$NATIVE_PREFLIGHT_WRAPPER_LOG"\nexit 99\n',
              { mode: 0o755 },
            );
            fs.writeFileSync(
              path.join(home, config),
              `[build]\nrustc-wrapper = ${JSON.stringify(wrapper)}\n`,
            );
          }
        },
        /CARGO_HOME.*absolute/i,
        operation,
      );
    });
  }
}
