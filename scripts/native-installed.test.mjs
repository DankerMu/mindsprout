import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const [manifestArgument, stockArgument] = process.argv.slice(2);
assert(
  manifestArgument,
  'Usage: pnpm native:installed:test BUILT_MANIFEST [STOCK_PACKAGE_DIRECTORY]',
);
const manifestPath = path.resolve(manifestArgument);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const cli = fileURLToPath(new URL('./native-installed.mjs', import.meta.url));
const require = createRequire(import.meta.url);
const nextMetadata = require.resolve('next/package.json');
const nextRequire = createRequire(nextMetadata);
const nextRoot = path.dirname(fs.realpathSync(nextMetadata));
const packageName = `@next/swc-${manifest.target}`;
const stockRoot = stockArgument
  ? fs.realpathSync(stockArgument)
  : path.dirname(nextRequire.resolve(`${packageName}/package.json`));
const stockMetadata = JSON.parse(fs.readFileSync(path.join(stockRoot, 'package.json'), 'utf8'));
assert.equal(
  stockMetadata.name,
  packageName,
  'Stock fixture must be the actual official platform package',
);
assert.equal(
  stockMetadata.version,
  manifest.version,
  'Stock fixture version must match the qualified upstream version',
);
assert.equal(
  stockMetadata.mindsproutNativeRepair,
  undefined,
  'Pass the real unmodified stock package directory; the current installation is already repaired',
);

async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
}

function nextFixture(directory) {
  const modules = path.join(directory, 'node_modules');
  fs.mkdirSync(modules);
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ private: true, name: 'native-installed-contract' }),
  );
  copy(nextRoot, path.join(modules, 'next'));
  const pkg = JSON.parse(fs.readFileSync(nextMetadata, 'utf8'));
  const dependencies = new Set([
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies),
  ]);
  for (const name of dependencies) {
    const installed = path.join(path.dirname(nextRoot), name);
    if (!fs.existsSync(installed)) continue;
    const destination = path.join(modules, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(fs.realpathSync(installed), destination, 'dir');
  }
  return modules;
}

function environment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('NEXT_TEST_') && name !== '__INTERNAL_CUSTOM_TURBOPACK_BINDINGS',
    ),
  );
}

function invoke(project, publication = manifestPath, overrides = {}) {
  return spawnSync(process.execPath, [cli, '--project', project, '--manifest', publication], {
    encoding: 'utf8',
    env: { ...environment(), ...overrides },
    timeout: 30000,
  });
}

function rejected(result, expected) {
  assert.equal(result.error, undefined, String(result.error));
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stdout, /"status":"installed-native-verified"/);
}

test('installed native guard uses real Next and native packages without diagnostic loading', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-native-installed-'));
  try {
    const tarball = path.join(path.dirname(manifestPath), manifest.tarball.file);
    assert.equal(
      await digest(tarball),
      manifest.tarball.sha256,
      'Test artifact differs from the qualified tarball',
    );
    assert.notEqual(
      await digest(path.join(stockRoot, manifest.binary.file)),
      manifest.binary.sha256,
      'Unmodified stock fixture must differ from the maintained binary',
    );
    execFileSync('tar', ['-xzf', tarball, '-C', directory]);
    const candidate = path.join(directory, 'package');
    const modules = nextFixture(directory);
    const installed = path.join(modules, packageName);
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    const restoreNative = () => {
      fs.rmSync(installed, { recursive: true, force: true });
      copy(candidate, installed);
    };
    restoreNative();

    await t.test('accepts the actual repaired addon loaded through Next', () => {
      const result = invoke(directory);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /"status":"installed-native-verified"/);
      assert(result.stdout.includes(manifest.addon.cacheVersion));
    });
    await t.test('missing publication input cannot silently bypass verification', () => {
      rejected(
        invoke(directory, path.join(directory, 'absent.json')),
        /Required native publication manifest is missing/,
      );
    });
    await t.test('an omitted optional native dependency fails the installation guard', () => {
      fs.rmSync(installed, { recursive: true });
      rejected(invoke(directory), /Required maintained native package is unavailable/);
      restoreNative();
    });
    await t.test('unmodified upstream native bytes are not accepted as the repair', () => {
      fs.rmSync(installed, { recursive: true });
      copy(stockRoot, installed);
      rejected(invoke(directory), /Installed native repair provenance mismatch/);
      restoreNative();
    });
    await t.test('corrupted installed binary fails before addon loading or fallback', () => {
      fs.writeFileSync(path.join(installed, manifest.binary.file), 'corrupted native artifact');
      rejected(invoke(directory), /Installed native binary digest mismatch/);
      restoreNative();
    });
    await t.test('mismatched installed provenance fails even when binary bytes are intact', () => {
      const filename = path.join(installed, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'));
      pkg.mindsproutNativeRepair.sourceCommit = '0'.repeat(40);
      fs.writeFileSync(filename, JSON.stringify(pkg));
      rejected(invoke(directory), /Installed native repair provenance mismatch/);
      restoreNative();
    });
    await t.test('mismatched installed platform metadata fails with intact binary bytes', () => {
      const filename = path.join(installed, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'));
      pkg.cpu = ['unsupported'];
      fs.writeFileSync(filename, JSON.stringify(pkg));
      rejected(invoke(directory), /Installed native CPU constraint mismatch/);
      restoreNative();
    });
    await t.test(
      'another loader-selected addon path is rejected even with identical repaired bytes',
      () => {
        const local = path.join(modules, '@next/swc');
        fs.mkdirSync(path.join(local, 'native'), { recursive: true });
        fs.copyFileSync(
          path.join(candidate, manifest.binary.file),
          path.join(local, 'native', manifest.binary.file),
          fs.constants.COPYFILE_FICLONE,
        );
        rejected(invoke(directory), /Next loaded an unqualified native addon/);
        fs.rmSync(local, { recursive: true });
      },
    );
    await t.test('publication from a different build recipe is rejected', () => {
      const filename = path.join(directory, 'mismatched-manifest.json');
      fs.writeFileSync(filename, JSON.stringify({ ...manifest, recipeSha256: '0'.repeat(64) }));
      rejected(invoke(directory, filename), /Publication recipe digest mismatch/);
    });
    for (const name of [
      'NEXT_TEST_NATIVE_DIR',
      '__INTERNAL_CUSTOM_TURBOPACK_BINDINGS',
      'NEXT_TEST_WASM',
      'NEXT_TEST_WASM_DIR',
    ]) {
      await t.test(`rejects ${name} rather than qualifying a diagnostic binding`, () => {
        rejected(
          invoke(directory, manifestPath, { [name]: candidate }),
          new RegExp(`Installed native verification forbids ${name}`),
        );
      });
    }
    await t.test('a Next upgrade cannot bypass the exact-version native repair', () => {
      const filename = path.join(modules, 'next/package.json');
      const original = fs.readFileSync(filename);
      const pkg = JSON.parse(original.toString());
      pkg.version = '16.4.6';
      fs.writeFileSync(filename, JSON.stringify(pkg));
      rejected(invoke(directory), /Installed Next version bypasses the qualified native repair/);
      fs.writeFileSync(filename, original);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
