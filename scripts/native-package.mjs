import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadataPath = path.join(root, 'patches/native/next-swc.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const patchPath = path.join(path.dirname(metadataPath), metadata.patch);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (filename) => sha256(fs.readFileSync(filename));
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const save = (filename, value) =>
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const require = createRequire(import.meta.url);

function targetName() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
  if (
    process.platform === 'linux' &&
    process.arch === 'x64' &&
    process.report.getReport().header.glibcVersionRuntime
  )
    return 'linux-x64-gnu';
  throw new Error('Native repair supports only macOS arm64 and Linux x64 GNU');
}

function rejectExternalCargoConfig(directory, cargoHome) {
  let current = path.resolve(directory);
  const homes = new Set([cargoHome]);
  for (;;) {
    homes.add(path.join(current, '.cargo'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const home of homes) {
    for (const name of ['config', 'config.toml']) {
      const filename = path.join(home, name);
      assert(
        !fs.existsSync(filename),
        `External Cargo configuration may override build.rustc, wrappers or rustflags: ${filename}`,
      );
    }
  }
}

function environment() {
  for (const name of Object.keys(process.env)) {
    assert(!name.startsWith('VERGEN_'), `Refusing forged build metadata: ${name}`);
    assert(
      !/^CARGO_TARGET_.*_(RUSTFLAGS|LINKER|RUNNER)$/.test(name),
      `Unset ${name}; use the pinned upstream target configuration`,
    );
  }
  for (const name of [
    'RUSTC',
    'CARGO_BUILD_RUSTC',
    'CARGO_BUILD_RUSTC_WRAPPER',
    'CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER',
    'CARGO_BUILD_RUSTFLAGS',
    'CARGO_BUILD_TARGET',
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'RUSTC_WRAPPER',
    'RUSTC_WORKSPACE_WRAPPER',
  ]) {
    assert(!process.env[name], `Unset ${name}; use the pinned upstream build configuration`);
  }
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ]) {
    assert(!process.env[name], `Unset ${name}; native builds must use their owned checkout`);
  }
  const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo');
  assert(path.isAbsolute(cargoHome), 'CARGO_HOME must be an absolute, configuration-free path');
  // Clean source, not CI's dirty-tree exception, must enable the persistent cache.
  const env = {
    ...process.env,
    CARGO_HOME: path.resolve(cargoHome),
    RUSTUP_TOOLCHAIN: metadata.toolchain,
    RUSTUP_AUTO_INSTALL: '0',
  };
  env.TMPDIR = fs.realpathSync(os.tmpdir());
  rejectExternalCargoConfig(env.TMPDIR, env.CARGO_HOME);
  delete env.CI;
  return env;
}

function command(binary, args, cwd, env, log) {
  const options = { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
  if (!log) return execFileSync(binary, args, options).trim();
  const fd = fs.openSync(log, 'wx');
  try {
    execFileSync(binary, args, { ...options, stdio: ['ignore', fd, fd] });
  } finally {
    fs.closeSync(fd);
  }
}

function pinnedInputs() {
  assert.equal(digest(patchPath), metadata.patchSha256, 'Corrective patch digest mismatch');
  return {
    ...metadata,
    recipeSha256: digest(fileURLToPath(import.meta.url)),
    metadataSha256: digest(metadataPath),
  };
}

function cleanSource(source, env, expectedCommit) {
  assert.equal(
    command('git', ['rev-parse', 'HEAD'], source, env),
    expectedCommit,
    'Source commit mismatch',
  );
  assert.equal(
    command('git', ['status', '--porcelain', '--untracked-files=all'], source, env),
    '',
    'Native source must be clean',
  );
  assert.equal(
    digest(path.join(source, 'Cargo.lock')),
    metadata.cargoLockSha256,
    'Cargo.lock changed',
  );
  assert.equal(
    readJson(path.join(source, 'packages/next/package.json')).version,
    metadata.version,
    'Next version mismatch',
  );
}

function prepareSource(work, env) {
  const source = path.join(work, 'source');
  fs.mkdirSync(source);
  command('git', ['-c', 'init.templateDir=', 'init', '--quiet'], source, env);
  command('git', ['config', 'core.autocrlf', 'false'], source, env);
  command('git', ['config', 'core.abbrev', String(metadata.gitAbbrev)], source, env);
  command('git', ['remote', 'add', 'origin', metadata.repository], source, env);
  command('git', ['config', 'remote.origin.promisor', 'true'], source, env);
  command('git', ['config', 'remote.origin.partialclonefilter', 'blob:none'], source, env);
  command(
    'git',
    ['fetch', '--depth=1', '--filter=blob:none', 'origin', metadata.upstreamCommit],
    source,
    env,
  );
  command('git', ['sparse-checkout', 'init', '--cone'], source, env);
  command(
    'git',
    [
      'sparse-checkout',
      'set',
      '--cone',
      '.cargo',
      'crates',
      'turbopack',
      'packages/next-swc',
      'packages/next/src',
      'scripts',
    ],
    source,
    env,
  );
  command('git', ['checkout', '--detach', 'FETCH_HEAD'], source, env);
  cleanSource(source, env, metadata.upstreamCommit);
  command('git', ['apply', '--index', patchPath], source, env);
  assert.equal(
    digest(path.join(source, 'Cargo.lock')),
    metadata.cargoLockSha256,
    'Patch changed Cargo.lock',
  );
  const tree = command('git', ['write-tree'], source, env);
  const identity = {
    ...env,
    GIT_AUTHOR_NAME: 'MindSprout native maintenance',
    GIT_AUTHOR_EMAIL: 'native-maintenance@mindsprout.invalid',
    GIT_COMMITTER_NAME: 'MindSprout native maintenance',
    GIT_COMMITTER_EMAIL: 'native-maintenance@mindsprout.invalid',
    GIT_AUTHOR_DATE: metadata.commitDate,
    GIT_COMMITTER_DATE: metadata.commitDate,
  };
  const commit = command(
    'git',
    [
      '-c',
      'commit.gpgSign=false',
      'commit-tree',
      tree,
      '-p',
      metadata.upstreamCommit,
      '-m',
      `MindSprout native registration repair ${metadata.patchSha256}`,
    ],
    source,
    identity,
  );
  command('git', ['checkout', '--detach', commit], source, env);
  cleanSource(source, env, commit);
  const short = command('git', ['rev-parse', '--short', commit], source, env);
  assert(commit.startsWith(short), 'Git abbreviation does not identify the patched commit');
  return { source, commit, short, tree };
}

function toolchain(source, env, target) {
  const sysroot = command('rustc', ['--print', 'sysroot'], source, env);
  const executable = fs.realpathSync(path.join(sysroot, 'bin', 'rustc'));
  const rustc = command(executable, ['--version', '--verbose'], source, env);
  assert(rustc.includes(`commit-hash: ${metadata.rustcCommit}`), 'Rust compiler commit mismatch');
  assert(rustc.includes(`host: ${metadata.targets[target]}`), 'Cross compilation is not supported');
  const cargo = command('cargo', ['--version'], source, env);
  env.RUSTC = executable;
  return { channel: metadata.toolchain, rustc, cargo, sha256: sha256(rustc + '\n' + cargo) };
}

function loadAddon(filename, manifest) {
  const addon = require(filename);
  const targetTriple = addon.getTargetTriple();
  const cacheVersion = addon.turbopackCacheVersion(metadata.version);
  assert.equal(targetTriple, metadata.targets[manifest.target], 'Native addon target mismatch');
  assert.equal(
    cacheVersion,
    `v${metadata.version}-${manifest.sourceCommitShort}`,
    'Native cache identity mismatch',
  );
  return { targetTriple, cacheVersion };
}

function packageBinary(out, source, target, provenance, binary) {
  const directory = path.join(out, 'package');
  fs.mkdirSync(directory);
  const official = readJson(
    path.join(source, 'crates/next-napi-bindings/npm', target, 'package.json'),
  );
  assert.equal(official.name, `@next/swc-${target}`);
  assert.equal(official.main, `next-swc.${target}.node`);
  fs.copyFileSync(binary, path.join(directory, official.main));
  fs.copyFileSync(path.join(source, 'license.md'), path.join(directory, 'LICENSE'));
  save(path.join(directory, 'package.json'), {
    ...official,
    version: metadata.version,
    files: [...official.files, 'LICENSE', 'README.md'],
    mindsproutNativeRepair: provenance,
  });
  fs.writeFileSync(
    path.join(directory, 'README.md'),
    `# MindSprout maintained native repair\n\nThis is not an unmodified upstream release.\n\nUpstream: ${metadata.repository} at ${metadata.upstreamCommit}.\nPatched source: ${provenance.sourceCommit}.\nPatch SHA-256: ${metadata.patchSha256}.\nBuild recipe SHA-256: ${provenance.recipeSha256}.\nRust: ${metadata.toolchain}.\nSupported target: ${target}.\n`,
  );
  const packed = JSON.parse(
    command(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', out],
      directory,
      environment(),
    ),
  );
  assert.equal(packed.length, 1, 'Expected exactly one native package');
  const tarball = `next-swc-${target}-${metadata.version}-${metadata.patchSha256.slice(0, 12)}-${digest(path.join(out, packed[0].filename))}.tgz`;
  fs.renameSync(path.join(out, packed[0].filename), path.join(out, tarball));
  return { directory, tarball, integrity: packed[0].integrity, binary: official.main };
}

function build(output) {
  const inputs = pinnedInputs();
  const target = targetName();
  const env = environment();
  const compiler = toolchain(env.TMPDIR, env, target);
  const out = path.resolve(output);
  fs.mkdirSync(out, { recursive: false });
  const work = fs.mkdtempSync(path.join(env.TMPDIR, 'mindsprout-native-'));
  env.CARGO_TARGET_DIR = path.resolve(process.env.CARGO_TARGET_DIR || path.join(work, 'target'));
  save(path.join(out, 'workspace.json'), { work, targetDirectory: env.CARGO_TARGET_DIR });
  const { source, commit, short, tree } = prepareSource(work, env);
  const args = [
    'build',
    '--locked',
    '--release',
    '-p',
    'next-napi-bindings',
    '--features',
    metadata.features,
  ];
  // Equivalent to upstream build-native-release's native-only Cargo invocation;
  // the upstream build.rs owns N-API linking, and no generated JS is packaged.
  command('cargo', args, source, env, path.join(out, 'build.log'));
  cleanSource(source, env, commit);
  const library =
    process.platform === 'darwin' ? 'libnext_napi_bindings.dylib' : 'libnext_napi_bindings.so';
  const binary = path.join(env.CARGO_TARGET_DIR, 'release', library);
  const provenance = {
    upstreamCommit: inputs.upstreamCommit,
    sourceCommit: commit,
    sourceCommitShort: short,
    sourceTree: tree,
    patchSha256: inputs.patchSha256,
    recipeSha256: inputs.recipeSha256,
    metadataSha256: inputs.metadataSha256,
    cargoLockSha256: inputs.cargoLockSha256,
    toolchain: inputs.toolchain,
  };
  const packaged = packageBinary(out, source, target, provenance, binary);
  const manifest = {
    schema: 1,
    version: metadata.version,
    target,
    ...provenance,
    compiler,
    buildCommand: ['cargo', ...args],
    sourceDirectory: source,
    targetDirectory: env.CARGO_TARGET_DIR,
    binary: { file: packaged.binary, sha256: digest(binary) },
    tarball: {
      file: packaged.tarball,
      sha256: digest(path.join(out, packaged.tarball)),
      integrity: packaged.integrity,
    },
  };
  manifest.addon = loadAddon(path.join(packaged.directory, packaged.binary), manifest);
  save(path.join(out, 'manifest.json'), manifest);
  console.log(JSON.stringify({ manifest: path.join(out, 'manifest.json'), ...manifest.addon }));
}

function manifestInputs(filename) {
  const inputs = pinnedInputs();
  const manifest = readJson(filename);
  for (const key of [
    'version',
    'upstreamCommit',
    'patchSha256',
    'recipeSha256',
    'metadataSha256',
    'cargoLockSha256',
    'toolchain',
  ]) {
    assert.equal(manifest[key], inputs[key], `Manifest ${key} mismatch`);
  }
  assert.equal(manifest.schema, 1, 'Manifest schema mismatch');
  assert.equal(manifest.target, targetName(), 'Manifest target mismatch');
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/, 'Invalid source commit');
  assert.match(
    manifest.sourceCommitShort,
    /^[a-f0-9]{12,40}$/,
    'Invalid abbreviated source commit',
  );
  assert(
    manifest.sourceCommit.startsWith(manifest.sourceCommitShort),
    'Cache identity is not a source commit prefix',
  );
  assert.equal(
    manifest.compiler.sha256,
    sha256(manifest.compiler.rustc + '\n' + manifest.compiler.cargo),
    'Toolchain digest mismatch',
  );
  assert(
    manifest.compiler.rustc.includes(`commit-hash: ${metadata.rustcCommit}`),
    'Toolchain compiler mismatch',
  );
  assert.equal(path.basename(manifest.tarball.file), manifest.tarball.file, 'Unsafe tarball path');
  assert.equal(
    manifest.binary.file,
    `next-swc.${manifest.target}.node`,
    'Binary filename mismatch',
  );
  return manifest;
}

async function verify(filename, installed = false) {
  const manifest = manifestInputs(filename);
  const out = path.dirname(path.resolve(filename));
  const tarball = path.join(out, manifest.tarball.file);
  assert.equal(digest(tarball), manifest.tarball.sha256, 'Tarball digest mismatch');
  assert.equal(
    manifest.tarball.file,
    `next-swc-${manifest.target}-${metadata.version}-${metadata.patchSha256.slice(0, 12)}-${manifest.tarball.sha256}.tgz`,
    'Immutable tarball name mismatch',
  );
  const integrity =
    'sha512-' + createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
  assert.equal(integrity, manifest.tarball.integrity, 'Tarball integrity mismatch');
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-native-verify-'));
  try {
    const entries = command('tar', ['-tzf', tarball], out, process.env).split('\n').sort();
    assert.deepEqual(
      entries,
      [
        'package/LICENSE',
        'package/README.md',
        `package/${manifest.binary.file}`,
        'package/package.json',
      ].sort(),
      'Unexpected package members',
    );
    command('tar', ['-xzf', tarball, '-C', extracted], out, process.env);
    let directory = path.join(extracted, 'package');
    if (installed) {
      assert(
        !process.env.NEXT_TEST_NATIVE_DIR,
        'Installed verification forbids NEXT_TEST_NATIVE_DIR',
      );
      const nextRequire = createRequire(require.resolve('next/package.json'));
      assert.equal(
        nextRequire('./package.json').version,
        metadata.version,
        'Installed Next version mismatch',
      );
      directory = path.dirname(nextRequire.resolve(`@next/swc-${manifest.target}/package.json`));
    }
    if (installed) {
      const packedMetadata = fs.readFileSync(path.join(extracted, 'package/package.json'));
      assert.equal(
        digest(path.join(directory, 'package.json')),
        sha256(packedMetadata),
        'Installed metadata differs from the verified tarball',
      );
    }
    const pkg = readJson(path.join(directory, 'package.json'));
    assert.equal(pkg.name, `@next/swc-${manifest.target}`, 'Package name mismatch');
    assert.equal(pkg.version, metadata.version, 'Package version mismatch');
    assert.equal(pkg.main, manifest.binary.file, 'Package entry mismatch');
    assert.deepEqual(pkg.os, [process.platform], 'Package OS constraint mismatch');
    assert.deepEqual(pkg.cpu, [process.arch], 'Package CPU constraint mismatch');
    assert.equal(pkg.license, 'MIT', 'Package license mismatch');
    assert.deepEqual(pkg.engines, { node: '>= 10' }, 'Package engine constraint mismatch');
    if (process.platform === 'linux')
      assert.deepEqual(pkg.libc, ['glibc'], 'Package libc constraint mismatch');
    assert.equal(
      pkg.mindsproutNativeRepair.sourceCommit,
      manifest.sourceCommit,
      'Package provenance mismatch',
    );
    assert.equal(
      pkg.mindsproutNativeRepair.patchSha256,
      metadata.patchSha256,
      'Package patch mismatch',
    );
    for (const key of [
      'sourceCommitShort',
      'sourceTree',
      'recipeSha256',
      'metadataSha256',
      'cargoLockSha256',
      'toolchain',
    ]) {
      assert.equal(pkg.mindsproutNativeRepair[key], manifest[key], `Package ${key} mismatch`);
    }
    const binary = path.join(directory, pkg.main);
    assert(fs.lstatSync(binary).isFile(), 'Native binary must be a regular file');
    assert.equal(digest(binary), manifest.binary.sha256, 'Binary digest mismatch');
    const addon = loadAddon(binary, manifest);
    assert(!process.env.__INTERNAL_CUSTOM_TURBOPACK_BINDINGS, 'Custom bindings are not permitted');
    const previousNativeDirectory = process.env.NEXT_TEST_NATIVE_DIR;
    if (!installed) process.env.NEXT_TEST_NATIVE_DIR = directory;
    try {
      const loaded = await require('next/dist/build/swc').loadBindings();
      assert.equal(loaded.isWasm, false, 'WASM fallback is not permitted');
      assert.equal(loaded.getTargetTriple(), addon.targetTriple, 'Next loaded the wrong target');
      assert.equal(
        loaded.turbopackCacheVersion(metadata.version),
        addon.cacheVersion,
        'Next loaded the wrong cache namespace',
      );
      const loadedFiles = Object.keys(require.cache).filter((name) =>
        /next-swc\..*\.node$/.test(name),
      );
      assert.deepEqual(
        loadedFiles,
        [fs.realpathSync(binary)],
        'Next did not exclusively load the verified native binary',
      );
    } finally {
      if (previousNativeDirectory === undefined) delete process.env.NEXT_TEST_NATIVE_DIR;
      else process.env.NEXT_TEST_NATIVE_DIR = previousNativeDirectory;
    }
    console.log(JSON.stringify({ status: 'verified', installed, binary, ...addon }));
    return manifest;
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

async function nativeTests(filename) {
  const manifest = await verify(filename);
  const env = environment();
  env.CARGO_TARGET_DIR = manifest.targetDirectory;
  const source = manifest.sourceDirectory;
  rejectExternalCargoConfig(path.dirname(source), env.CARGO_HOME);
  cleanSource(source, env, manifest.sourceCommit);
  toolchain(source, env, manifest.target);
  const cases = [
    ['next-api', '--lib'],
    ['turbo-tasks-backend', '--test', 'operation_vc'],
    [
      'turbo-tasks',
      '--lib',
      'manager::tests::self_operation_rejects_missing_task_context',
      '--',
      '--exact',
    ],
    ['turbo-tasks-macros-tests', '--test', 'trybuild'],
    [
      'turbo-tasks-macros',
      '--lib',
      'func::tests::self_operation_requires_an_operation_declaration',
      '--',
      '--exact',
    ],
  ];
  for (const [index, args] of cases.entries()) {
    const log = path.join(path.dirname(path.resolve(filename)), `native-test-${index}.log`);
    command('cargo', ['test', '--locked', '-p', ...args], source, env, log);
    const output = fs.readFileSync(log, 'utf8');
    const expected = [24, 3, 1, 1, 1][index];
    assert(
      output.includes(`test result: ok. ${expected} passed; 0 failed; 0 ignored`),
      `Native suite ${index} did not execute its expected tests`,
    );
  }
  cleanSource(source, env, manifest.sourceCommit);
  console.log(JSON.stringify({ status: 'native-tests-passed', suites: cases.length }));
}

const [action, argument, option] = process.argv.slice(2);
assert(
  argument,
  'Usage: native-package.mjs build OUTPUT | verify MANIFEST [--installed] | test MANIFEST',
);
assert(!option || (action === 'verify' && option === '--installed'), 'Unknown option');
if (action === 'build') build(argument);
else if (action === 'verify') await verify(argument, option === '--installed');
else if (action === 'test') await nativeTests(argument);
else throw new Error(`Unknown native package command: ${action}`);
