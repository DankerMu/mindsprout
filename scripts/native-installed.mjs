import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadataPath = path.join(repository, 'patches/native/next-swc.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const provenanceFields = [
  'upstreamCommit',
  'sourceCommit',
  'sourceCommitShort',
  'sourceTree',
  'patchSha256',
  'recipeSha256',
  'metadataSha256',
  'cargoLockSha256',
  'toolchain',
];

async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function options() {
  const result = { project: repository };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    assert(['--manifest', '--project'].includes(option), `Unknown option: ${option}`);
    assert(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${option}`);
    const key = option.slice(2);
    assert(!Object.hasOwn(result, key) || key === 'project', `Duplicate option: ${option}`);
    result[key] = path.resolve(args[index + 1]);
  }
  return result;
}

function targetName() {
  const target = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
  assert(
    Object.hasOwn(metadata.targets, target),
    'Native repair supports only macOS arm64 and Linux x64 GNU',
  );
  if (process.platform === 'linux') {
    assert(
      process.report.getReport().header.glibcVersionRuntime,
      'Native repair requires GNU libc',
    );
  }
  return target;
}

function rejectOverrides() {
  for (const name of [
    'NEXT_TEST_NATIVE_DIR',
    '__INTERNAL_CUSTOM_TURBOPACK_BINDINGS',
    'NEXT_TEST_WASM',
    'NEXT_TEST_WASM_DIR',
    'NEXT_TEST_NATIVE_IGNORE_LOCAL_INSTALL',
  ]) {
    assert(!Object.hasOwn(process.env, name), `Installed native verification forbids ${name}`);
  }
}

async function publication(filename, target) {
  assert(fs.existsSync(filename), `Required native publication manifest is missing: ${filename}`);
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.equal(manifest.schema, 1, 'Publication schema mismatch');
  assert.equal(manifest.target, target, 'Publication target mismatch');
  for (const key of ['version', 'upstreamCommit', 'patchSha256', 'cargoLockSha256', 'toolchain']) {
    assert.equal(manifest[key], metadata[key], `Publication ${key} mismatch`);
  }
  assert.equal(
    manifest.metadataSha256,
    await digest(metadataPath),
    'Publication metadata digest mismatch',
  );
  assert.equal(
    manifest.recipeSha256,
    await digest(path.join(repository, 'scripts/native-package.mjs')),
    'Publication recipe digest mismatch',
  );
  assert.equal(
    manifest.patchSha256,
    await digest(path.join(path.dirname(metadataPath), metadata.patch)),
    'Publication patch digest mismatch',
  );
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/, 'Invalid published source commit');
  assert.match(manifest.sourceCommitShort, /^[a-f0-9]{12,40}$/, 'Invalid published cache identity');
  assert(
    manifest.sourceCommit.startsWith(manifest.sourceCommitShort),
    'Published cache identity differs from source commit',
  );
  assert.equal(
    manifest.binary.file,
    `next-swc.${target}.node`,
    'Published native filename mismatch',
  );
  assert.match(manifest.binary.sha256, /^[a-f0-9]{64}$/, 'Invalid published binary digest');
  assert.equal(
    manifest.addon.targetTriple,
    metadata.targets[target],
    'Published addon target mismatch',
  );
  assert.equal(
    manifest.addon.cacheVersion,
    `v${metadata.version}-${manifest.sourceCommitShort}`,
    'Published addon cache identity mismatch',
  );
  return manifest;
}

function resolveRequired(require, name, label) {
  try {
    return require.resolve(name);
  } catch (cause) {
    throw new Error(`${label} is unavailable; the native repair installation is incomplete`, {
      cause,
    });
  }
}

async function installedPackage(project, target, manifest) {
  const projectRequire = createRequire(path.join(project, 'package.json'));
  const nextMetadata = resolveRequired(
    projectRequire,
    'next/package.json',
    'Installed Next package',
  );
  const nextRequire = createRequire(nextMetadata);
  assert.equal(
    nextRequire('./package.json').version,
    metadata.version,
    'Installed Next version bypasses the qualified native repair',
  );
  const packageName = `@next/swc-${target}`;
  const packageMetadata = resolveRequired(
    nextRequire,
    `${packageName}/package.json`,
    'Required maintained native package',
  );
  const pkg = JSON.parse(fs.readFileSync(packageMetadata, 'utf8'));
  assert.equal(pkg.name, packageName, 'Installed native package name mismatch');
  assert.equal(pkg.version, metadata.version, 'Installed native package version mismatch');
  assert.equal(pkg.main, manifest.binary.file, 'Installed native entrypoint mismatch');
  assert.deepEqual(pkg.os, [process.platform], 'Installed native OS constraint mismatch');
  assert.deepEqual(pkg.cpu, [process.arch], 'Installed native CPU constraint mismatch');
  if (process.platform === 'linux')
    assert.deepEqual(pkg.libc, ['glibc'], 'Installed native libc constraint mismatch');
  const provenance = Object.fromEntries(provenanceFields.map((key) => [key, manifest[key]]));
  assert.deepEqual(
    pkg.mindsproutNativeRepair,
    provenance,
    'Installed native repair provenance mismatch',
  );
  const binary = path.join(path.dirname(packageMetadata), manifest.binary.file);
  assert(fs.lstatSync(binary).isFile(), 'Installed native binary must be a regular file');
  assert.equal(
    await digest(binary),
    manifest.binary.sha256,
    'Installed native binary digest mismatch',
  );
  assert.equal(
    fs.realpathSync(resolveRequired(nextRequire, packageName, 'Native package entrypoint')),
    fs.realpathSync(binary),
    'Installed package resolves to another native binary',
  );
  return { nextRequire, binary: fs.realpathSync(binary) };
}

async function verify() {
  rejectOverrides();
  const { project, manifest: explicitManifest } = options();
  const target = targetName();
  const filename =
    explicitManifest || path.join(repository, 'patches/native/published', `${target}.json`);
  const manifest = await publication(filename, target);
  const { nextRequire, binary } = await installedPackage(project, target, manifest);
  // Load verified bytes first: an absent or unloadable addon never reaches Next's fallback path.
  const addon = nextRequire(binary);
  assert.equal(
    addon.getTargetTriple(),
    manifest.addon.targetTriple,
    'Installed addon target mismatch',
  );
  assert.equal(
    addon.turbopackCacheVersion(metadata.version),
    manifest.addon.cacheVersion,
    'Installed addon cache identity mismatch',
  );
  const loaded = await nextRequire('next/dist/build/swc').loadBindings();
  assert.equal(loaded.isWasm, false, 'Installed verification rejects WASM fallback');
  assert.equal(
    loaded.getTargetTriple(),
    manifest.addon.targetTriple,
    'Next loaded another native target',
  );
  assert.equal(
    loaded.turbopackCacheVersion(metadata.version),
    manifest.addon.cacheVersion,
    'Next loaded another native cache identity',
  );
  const nativeFiles = Object.keys(nextRequire.cache).filter((name) => name.endsWith('.node'));
  assert.deepEqual(nativeFiles, [binary], 'Next loaded an unqualified native addon');
  console.log(
    JSON.stringify({
      status: 'installed-native-verified',
      version: metadata.version,
      target,
      binary,
      binarySha256: manifest.binary.sha256,
      ...manifest.addon,
    }),
  );
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
