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
