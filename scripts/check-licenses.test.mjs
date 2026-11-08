import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const checkerPath = fileURLToPath(new URL('./check-licenses.mjs', import.meta.url));
const policy = `dependencies:
  allowed_licenses:
    scope: installed-all
    value: [MIT]
    exceptions: []
    severity: block
    enforced_by: pnpm licenses:check
`;

function writePackage(directory, manifest) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function withoutField(record, omittedField) {
  return Object.fromEntries(Object.entries(record).filter(([field]) => field !== omittedField));
}

function fixtureEnvironment(root) {
  const directories = {
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    TMPDIR: join(root, 'tmp'),
  };
  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true });
  }
  const userConfig = join(root, 'npm-userconfig');
  const globalConfig = join(root, 'npm-globalconfig');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  return {
    PATH: process.env.PATH,
    ...directories,
    CI: '1',
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
  };
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        env,
        encoding: 'utf8',
        // Bound hung fixture processes while allowing cold local pnpm startup.
        timeout: 60_000,
        // Native inventory and installation diagnostics can exceed the default buffer.
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && (typeof error.code !== 'number' || error.signal || error.killed)) {
          reject(error);
          return;
        }
        resolve({
          status: error?.code ?? 0,
          stdout,
          diagnostic: `${stdout}\n${stderr}`,
        });
      },
    );
  });
}

async function registerPackage(root, registry, routes, env, manifest) {
  const directory = join(root, 'packages', manifest.name, manifest.version);
  writePackage(join(directory, 'package'), manifest);
  const archive = join(directory, 'package.tgz');
  const packed = await run('tar', ['-czf', archive, '-C', directory, 'package'], root, env);
  assert.equal(packed.status, 0, `Fixture packaging failed:\n${packed.diagnostic}`);
  const bytes = readFileSync(archive);
  const tarballPath = `/${manifest.name}/-/${manifest.name}-${manifest.version}.tgz`;
  routes.set(tarballPath, { type: 'application/octet-stream', body: bytes });
  const existing = routes.get(`/${manifest.name}`);
  const versions = existing ? JSON.parse(existing.body).versions : {};
  versions[manifest.version] = {
    ...manifest,
    dist: {
      tarball: `${registry}${tarballPath}`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    },
  };
  routes.set(`/${manifest.name}`, {
    type: 'application/json',
    body: JSON.stringify({
      name: manifest.name,
      'dist-tags': { latest: manifest.version },
      versions,
    }),
  });
}

async function createRegistry(t) {
  const root = mkdtempSync(join(tmpdir(), 'mindsprout-license-audit-'));
  const routes = new Map();
  const server = createServer((request, response) => {
    const route = routes.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': route.type });
    response.end(route.body);
  });
  t.after(async () => {
    try {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const env = fixtureEnvironment(root);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const registry = `http://127.0.0.1:${server.address().port}`;
  return { root, env, registry, routes };
}

async function installProject({ root, env, registry }, devDependencies, fixturePolicy) {
  const project = join(root, 'project');
  writePackage(project, {
    name: 'license-fixture-project',
    version: '1.0.0',
    private: true,
    license: 'MIT',
    devDependencies,
  });
  writeFileSync(join(project, 'constraints.yaml'), fixturePolicy);
  writeFileSync(
    join(project, '.npmrc'),
    `registry=${registry}\nstore-dir=${join(root, 'store')}\n`,
  );
  const installed = await run(
    'pnpm',
    ['install', '--ignore-scripts', '--no-frozen-lockfile', '--prod=false'],
    project,
    env,
  );
  assert.equal(installed.status, 0, `Fixture installation failed:\n${installed.diagnostic}`);

  const inventory = await run('pnpm', ['licenses', 'list', '--json'], project, env);
  assert.equal(inventory.status, 0, `Fixture inventory failed:\n${inventory.diagnostic}`);
  return { project, env, inventoryOutput: inventory.stdout };
}

function inventoryEntries(stdout) {
  return Object.values(JSON.parse(stdout)).flat();
}

async function installFixture(t, manifest, fixturePolicy = policy) {
  const context = await createRegistry(t);
  const { root, env, registry, routes } = context;
  const toolName = `${manifest.name}-dev-tool`;
  await registerPackage(root, registry, routes, env, manifest);
  await registerPackage(root, registry, routes, env, {
    name: toolName,
    version: '1.0.0',
    license: 'MIT',
    dependencies: { [manifest.name]: manifest.version },
  });
  const installed = await installProject(context, { [toolName]: '1.0.0' }, fixturePolicy);
  const leaf = inventoryEntries(installed.inventoryOutput).find(
    (entry) => entry.name === manifest.name,
  );
  assert.ok(leaf, `Native inventory omitted ${manifest.name}`);
  assert.deepEqual(
    leaf.versions,
    [manifest.version],
    'Fixture must have a resolved native version',
  );
  assert.equal(leaf.license, manifest.license);
  return installed;
}

test('accepts MIT dependencies and rejects a GPL-3.0-only transitive dev dependency', async (t) => {
  const cases = [
    { name: 'license-fixture-mit-leaf', license: 'MIT', status: 0 },
    { name: 'license-fixture-forbidden-leaf', license: 'GPL-3.0-only', status: 1 },
  ];
  for (const fixture of cases) {
    const { project, env } = await installFixture(t, {
      name: fixture.name,
      version: '1.2.3',
      license: fixture.license,
    });

    const checked = await run(process.execPath, [checkerPath], project, env);
    assert.equal(checked.status, fixture.status, `${fixture.license}:\n${checked.diagnostic}`);
    if (fixture.status === 1) {
      for (const expected of ['license-fixture-forbidden-leaf', '1.2.3', 'GPL-3.0-only']) {
        assert.ok(
          checked.diagnostic.includes(expected),
          `Missing ${expected} in violation diagnostic:\n${checked.diagnostic}`,
        );
      }
    }
  }
});

test('accepts only the registered package name, version and license exception', async (t) => {
  const exceptionPolicy = stringify({
    dependencies: {
      allowed_licenses: {
        scope: 'installed-all',
        value: ['MIT'],
        exceptions: [
          {
            packages: ['license-fixture-exception-leaf'],
            version: '1.2.3',
            license: 'GPL-3.0-only',
            reason: 'Retain this exact fixture dependency under explicit approval',
            exit_condition: 'Remove when unused; require approval for version or license changes',
          },
        ],
        severity: 'block',
        enforced_by: 'pnpm licenses:check',
      },
    },
  });
  const cases = [
    {
      name: 'license-fixture-exception-leaf',
      version: '1.2.3',
      license: 'GPL-3.0-only',
      status: 0,
    },
    {
      name: 'license-fixture-exception-leaf-lookalike',
      version: '1.2.3',
      license: 'GPL-3.0-only',
      status: 1,
    },
    {
      name: 'license-fixture-exception-leaf',
      version: '1.2.4',
      license: 'GPL-3.0-only',
      status: 1,
    },
    {
      name: 'license-fixture-exception-leaf',
      version: '1.2.3',
      license: 'GPL-3.0-or-later',
      status: 1,
    },
  ];
  for (const fixture of cases) {
    const { project, env } = await installFixture(
      t,
      { name: fixture.name, version: fixture.version, license: fixture.license },
      exceptionPolicy,
    );
    const checked = await run(process.execPath, [checkerPath], project, env);
    assert.equal(
      checked.status,
      fixture.status,
      `${fixture.name}@${fixture.version} ${fixture.license}:\n${checked.diagnostic}`,
    );
    if (fixture.status === 1) {
      for (const expected of [fixture.name, fixture.version, fixture.license]) {
        assert.ok(
          checked.diagnostic.includes(expected),
          `Missing ${expected} in violation diagnostic:\n${checked.diagnostic}`,
        );
      }
    }
  }
});

test('rejects missing or unsupported license policy metadata', async (t) => {
  const cases = [
    { field: 'scope' },
    { field: 'scope', value: 'direct-only' },
    { field: 'severity' },
    { field: 'severity', value: 'warn' },
    { field: 'enforced_by' },
    { field: 'enforced_by', value: '' },
  ];
  for (const fixture of cases) {
    const rules = {
      scope: 'installed-all',
      value: ['MIT'],
      exceptions: [],
      severity: 'block',
      enforced_by: 'pnpm licenses:check',
    };
    const updatedRules =
      'value' in fixture
        ? { ...rules, [fixture.field]: fixture.value }
        : withoutField(rules, fixture.field);
    const { project, env } = await installFixture(
      t,
      { name: 'license-fixture-policy-leaf', version: '1.2.3', license: 'MIT' },
      stringify({ dependencies: { allowed_licenses: updatedRules } }),
    );
    const checked = await run(process.execPath, [checkerPath], project, env);
    assert.equal(
      checked.status,
      2,
      `Invalid ${fixture.field} (${fixture.value ?? 'missing'}):\n${checked.diagnostic}`,
    );
  }
});

test('checks every grouped version against the exact exception', async (t) => {
  const context = await createRegistry(t);
  const { root, registry, routes, env } = context;
  const name = 'license-fixture-grouped-leaf';
  const parents = [
    { name: 'license-fixture-approved-version-tool', version: '1.2.3' },
    { name: 'license-fixture-unapproved-version-tool', version: '1.2.4' },
  ];
  const devDependencies = {};
  for (const parent of parents) {
    await registerPackage(root, registry, routes, env, {
      name,
      version: parent.version,
      license: 'GPL-3.0-only',
    });
    await registerPackage(root, registry, routes, env, {
      name: parent.name,
      version: '1.0.0',
      license: 'MIT',
      dependencies: { [name]: parent.version },
    });
    devDependencies[parent.name] = '1.0.0';
  }
  const fixturePolicy = stringify({
    dependencies: {
      allowed_licenses: {
        scope: 'installed-all',
        value: ['MIT'],
        exceptions: [
          {
            packages: [name],
            version: '1.2.3',
            license: 'GPL-3.0-only',
            reason: 'Retain only the explicitly approved dependency version',
            exit_condition: 'Remove when unused; require approval for another version',
          },
        ],
        severity: 'block',
        enforced_by: 'pnpm licenses:check',
      },
    },
  });
  const { project, inventoryOutput } = await installProject(
    context,
    devDependencies,
    fixturePolicy,
  );
  const leaf = inventoryEntries(inventoryOutput).find((entry) => entry.name === name);
  assert.ok(leaf, `Native inventory omitted ${name}`);
  assert.deepEqual(
    [...leaf.versions].sort(),
    ['1.2.3', '1.2.4'],
    'Native inventory must group both resolved versions',
  );
  assert.equal(leaf.license, 'GPL-3.0-only');

  const checked = await run(process.execPath, [checkerPath], project, env);
  assert.equal(checked.status, 1, checked.diagnostic);
  for (const expected of [name, '1.2.4', 'GPL-3.0-only']) {
    assert.ok(
      checked.diagnostic.includes(expected),
      `Missing ${expected} in violation diagnostic:\n${checked.diagnostic}`,
    );
  }
  assert.ok(
    !checked.diagnostic.split('\n').some((line) => line.includes(name) && line.includes('1.2.3')),
    `Approved version reported as a violation:\n${checked.diagnostic}`,
  );
});

test('rejects an empty native installed inventory', async (t) => {
  const context = await createRegistry(t);
  const { project, env, inventoryOutput } = await installProject(context, {}, policy);
  assert.ok(
    inventoryOutput.trim().length > 0,
    'Native producer must report its dependency-free tree',
  );
  const checked = await run(process.execPath, [checkerPath], project, env);
  assert.equal(checked.status, 2, checked.diagnostic);
});

test('rejects malformed allowlists and incomplete unused exceptions', async (t) => {
  const cases = [
    { field: 'value', value: 'MIT' },
    { field: 'value', value: [] },
    { field: 'reason' },
    { field: 'exit_condition' },
  ];
  for (const fixture of cases) {
    const exception = {
      packages: ['license-fixture-unused-exception'],
      version: '1.2.3',
      license: 'GPL-3.0-only',
      reason: 'Retain the explicitly approved dependency',
      exit_condition: 'Remove when unused',
    };
    const rules = {
      scope: 'installed-all',
      value: ['MIT'],
      exceptions: [exception],
      severity: 'block',
      enforced_by: 'pnpm licenses:check',
    };
    const updatedRules =
      'value' in fixture
        ? { ...rules, [fixture.field]: fixture.value }
        : { ...rules, exceptions: [withoutField(exception, fixture.field)] };
    const { project, env } = await installFixture(
      t,
      { name: 'license-fixture-malformed-policy-leaf', version: '1.2.3', license: 'MIT' },
      stringify({ dependencies: { allowed_licenses: updatedRules } }),
    );
    const checked = await run(process.execPath, [checkerPath], project, env);
    assert.equal(checked.status, 2, `Invalid ${fixture.field}:\n${checked.diagnostic}`);
  }
});

test('rejects unavailable native inventory acquisition', async (t) => {
  const { project, env } = await installFixture(t, {
    name: 'license-fixture-producer-leaf',
    version: '1.2.3',
    license: 'MIT',
  });
  const emptyPath = join(project, 'empty-bin');
  mkdirSync(emptyPath);
  const checked = await run(process.execPath, [checkerPath], project, { ...env, PATH: emptyPath });
  assert.equal(checked.status, 2, checked.diagnostic);
});

test('rejects unknown, unlicensed and unapproved composite declarations exactly', async (t) => {
  const cases = [
    { name: 'license-fixture-unknown-leaf', license: 'unknown' },
    { name: 'license-fixture-unlicensed-leaf', license: 'UNLICENSED' },
    { name: 'license-fixture-composite-leaf', license: '(MIT OR GPL-3.0-only)' },
    { name: 'license-fixture-lowercase-leaf', license: 'mit' },
  ];
  for (const fixture of cases) {
    const { project, env } = await installFixture(t, {
      name: fixture.name,
      version: '1.2.3',
      license: fixture.license,
    });
    const checked = await run(process.execPath, [checkerPath], project, env);
    assert.equal(checked.status, 1, checked.diagnostic);
    for (const expected of [fixture.name, '1.2.3', fixture.license]) {
      assert.ok(
        checked.diagnostic.includes(expected),
        `Missing ${expected} in violation diagnostic:\n${checked.diagnostic}`,
      );
    }
  }
});

test('rejects missing or unparseable policy files', async (t) => {
  for (const invalidPolicy of [null, 'dependencies: [']) {
    const { project, env } = await installFixture(t, {
      name: 'license-fixture-policy-file-leaf',
      version: '1.2.3',
      license: 'MIT',
    });
    const policyPath = join(project, 'constraints.yaml');
    if (invalidPolicy === null) rmSync(policyPath);
    else writeFileSync(policyPath, invalidPolicy);
    const checked = await run(process.execPath, [checkerPath], project, env);
    assert.equal(checked.status, 2, checked.diagnostic);
  }
});
