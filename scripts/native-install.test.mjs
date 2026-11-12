import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv[2];
assert(outputArgument, 'Usage: pnpm native:install:test FRESH_EVIDENCE_DIRECTORY');
const output = path.resolve(outputArgument);
const rootPackage = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'));
const target = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
const manifestFile = path.join(repository, 'patches/native/published', `${target}.json`);
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const packageName = `@next/swc-${target}`;
const publishedUrl = rootPackage.pnpm.overrides[`${packageName}@${manifest.version}`];
assert(publishedUrl, 'The supported target must have an exact-version published override');

async function hashes(filename) {
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  for await (const chunk of fs.createReadStream(filename)) {
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return { sha256: sha256.digest('hex'), integrity: `sha512-${sha512.digest('base64')}` };
}

function save(name, value) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
}

async function spawnPnpm(project, args, logs, env) {
  const fds = logs.map((log) => fs.openSync(log, 'wx'));
  try {
    const child = spawn('pnpm', args, {
      cwd: project,
      env,
      stdio: ['ignore', fds[0], fds.at(-1)],
      timeout: 120000,
    });
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { ...status, streams: logs.map((log) => fs.readFileSync(log, 'utf8')) };
  } finally {
    for (const fd of fds) fs.closeSync(fd);
  }
}

async function pnpm(project, args, name) {
  const log = path.join(output, `${name}.log`);
  const {
    streams: [text],
    ...status
  } = await spawnPnpm(project, args, [log], process.env);
  return { ...status, log, text };
}

async function pnpmVersion(project, directory, env = process.env) {
  // Only stdout is the version; Node warnings (e.g. the env-proxy agent) go to stderr.
  const logs = ['pnpm-version.stdout.log', 'pnpm-version.stderr.log'].map((name) =>
    path.join(directory, name),
  );
  const {
    streams: [stdout, stderr],
    ...status
  } = await spawnPnpm(project, ['--version'], logs, env);
  return { ...status, stdout, stderr };
}

function assertPnpmVersion(result, expected) {
  const diagnostic = `pnpm --version exited ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
  assert.equal(result.code, 0, diagnostic);
  assert.equal(result.stdout.trim(), expected, diagnostic);
  return result.stdout.trim();
}

function fixture(directory) {
  const project = path.join(directory, 'project');
  fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(project, 'patches/native/published'), { recursive: true });
  for (const name of ['native-installed.mjs', 'native-package.mjs']) {
    fs.copyFileSync(path.join(repository, 'scripts', name), path.join(project, 'scripts', name));
  }
  for (const name of ['next-swc.json', 'next-swc-registration.patch']) {
    fs.copyFileSync(
      path.join(repository, 'patches/native', name),
      path.join(project, 'patches/native', name),
    );
  }
  fs.copyFileSync(manifestFile, path.join(project, 'patches/native/published', `${target}.json`));
  // The real publication bytes are served from one stable local path so only their
  // post-lockfile integrity changes; Next and the lifecycle guard are not mocked.
  const pkg = {
    name: 'native-frozen-install-contract',
    private: true,
    packageManager: rootPackage.packageManager,
    scripts: { postinstall: rootPackage.scripts.postinstall },
    dependencies: { next: manifest.version, react: '19.3.1', 'react-dom': '19.3.1' },
    optionalDependencies: { [packageName]: 'file:./candidate.tgz' },
    pnpm: { overrides: { [`${packageName}@${manifest.version}`]: 'file:./candidate.tgz' } },
  };
  assert.equal(
    pkg.scripts.postinstall,
    'node scripts/native-installed.mjs',
    'Fixture must exercise the ordinary root installation guard',
  );
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return project;
}

function lockedIntegrity(project) {
  const lockfile = parse(fs.readFileSync(path.join(project, 'pnpm-lock.yaml'), 'utf8'));
  const entries = Object.entries(lockfile.packages).filter(([name]) =>
    name.startsWith(`${packageName}@`),
  );
  assert.equal(entries.length, 1, 'Fixture must lock one target native artifact');
  assert.equal(
    entries[0][1].resolution.integrity,
    manifest.tarball.integrity,
    'Fixture did not lock the actual published package integrity',
  );
  return entries[0][1].resolution.integrity;
}

test('ordinary frozen installation rejects corrupt optional native bytes through its real lifecycle guard', async () => {
  fs.mkdirSync(output, { recursive: false });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-native-install-'));
  const evidence = {
    status: 'running',
    target,
    publishedUrl,
    packageManager: rootPackage.packageManager,
  };
  try {
    const project = fixture(directory);
    evidence.actualPnpmVersion = assertPnpmVersion(
      await pnpmVersion(project, output),
      rootPackage.packageManager.replace('pnpm@', ''),
    );
    const tarball = path.join(project, 'candidate.tgz');
    const response = await fetch(publishedUrl, { signal: AbortSignal.timeout(120000) });
    assert(response.ok && response.body, `Published artifact download failed: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tarball, { flags: 'wx' }));
    evidence.download = { url: publishedUrl, status: response.status, ...(await hashes(tarball)) };
    assert.equal(evidence.download.sha256, manifest.tarball.sha256);
    assert.equal(evidence.download.integrity, manifest.tarball.integrity);
    save('download.json', evidence.download);
    const seedStore = path.join(directory, 'seed-store');
    const locked = await pnpm(
      project,
      ['install', '--lockfile-only', '--ignore-scripts', '--store-dir', seedStore],
      'lockfile',
    );
    assert.equal(locked.code, 0, locked.text);
    evidence.lockedIntegrity = lockedIntegrity(project);
    const frozenLock = fs.readFileSync(path.join(project, 'pnpm-lock.yaml'));
    fs.writeFileSync(path.join(output, 'pnpm-lock.yaml'), frozenLock);
    const valid = await pnpm(
      project,
      ['install', '--frozen-lockfile', '--store-dir', seedStore],
      'valid-install',
    );
    evidence.validInstall = { code: valid.code, signal: valid.signal };
    assert.equal(valid.code, 0, valid.text);
    assert.match(
      valid.text,
      /"status":"installed-native-verified"/,
      'Normal postinstall must load the actual repaired native package',
    );
    assert.deepEqual(fs.readFileSync(path.join(project, 'pnpm-lock.yaml')), frozenLock);

    fs.rmSync(path.join(project, 'node_modules'), { recursive: true });
    fs.writeFileSync(tarball, 'deliberately corrupted published native package\n');
    evidence.corrupted = await hashes(tarball);
    assert.notEqual(evidence.corrupted.integrity, evidence.lockedIntegrity);
    const corrupt = await pnpm(
      project,
      ['install', '--frozen-lockfile', '--store-dir', path.join(directory, 'fresh-store')],
      'corrupt-install',
    );
    evidence.corruptInstall = { code: corrupt.code, signal: corrupt.signal };
    assert.equal(corrupt.signal, null, 'An interrupted install is not an integrity rejection');
    assert.notEqual(
      corrupt.code,
      0,
      'Corrupt optional package must not produce a successful installation',
    );
    assert.match(
      corrupt.text,
      /Required maintained native package is unavailable/,
      "The ordinary lifecycle guard must reject pnpm's omitted optional package",
    );
    assert.doesNotMatch(corrupt.text, /"status":"installed-native-verified"/);
    assert.equal(fs.existsSync(path.join(project, 'node_modules', packageName)), false);
    assert.deepEqual(fs.readFileSync(path.join(project, 'pnpm-lock.yaml')), frozenLock);
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = error.message;
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    save('result.json', evidence);
  }
});

test('pnpm version comes from stdout only; stderr warnings stay diagnostic', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindsprout-pnpm-version-'));
  try {
    const bin = path.join(directory, 'bin');
    fs.mkdirSync(bin);
    // A stub pnpm at the process boundary reproduces Node's proxy warning on stderr.
    fs.writeFileSync(
      path.join(bin, 'pnpm'),
      '#!/bin/sh\n' +
        'echo "(node:1) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental" >&2\n' +
        'echo "$STUB_PNPM_VERSION"\n',
      { mode: 0o755 },
    );
    const env = (version) => ({
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      STUB_PNPM_VERSION: version,
    });
    const run = async (name, version) => {
      const logs = path.join(directory, name);
      fs.mkdirSync(logs);
      return pnpmVersion(directory, logs, env(version));
    };
    const good = await run('good', '10.28.0');
    assert.equal(assertPnpmVersion(good, '10.28.0'), '10.28.0');
    assert.match(good.stderr, /EnvHttpProxyAgent is experimental/);
    const wrong = await run('wrong', '10.27.0');
    assert.throws(
      () => assertPnpmVersion(wrong, '10.28.0'),
      (error) =>
        error instanceof assert.AssertionError &&
        /stdout:\n10\.27\.0/.test(error.message) &&
        /EnvHttpProxyAgent is experimental/.test(error.message),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
