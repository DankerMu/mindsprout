import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const configPath = resolve('playwright.config.ts');
const serverPath = resolve('scripts/e2e-server.mjs');
const playwrightCli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
const playwrightModule = fileURLToPath(import.meta.resolve('@playwright/test'));
const app = 'postgres://reader:reader-marker@reader-host:5433/app_dev';
const owner = 'postgres://owner:owner-marker@owner-host:5434/app_dev';

async function probe(
  file: string | undefined,
  env: Record<string, string | undefined>,
  options: {
    json?: 'stdout' | 'file';
    launcher?: boolean;
    spawnFailure?: boolean;
    childExitCode?: number;
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), 'mindsprout-playwright-'));
  const sentinel = join(cwd, 'server-launched');
  const reportPath = join(cwd, 'report.json');
  try {
    if (file !== undefined) await writeFile(join(cwd, '.env'), file);
    await symlink(process.execPath, join(cwd, 'node'));
    await symlink(resolve('scripts'), join(cwd, 'scripts'), 'dir');
    await mkdir(join(cwd, 'e2e/support'), { recursive: true });
    await symlink(resolve('e2e/global-setup.ts'), join(cwd, 'e2e/global-setup.ts'));
    await symlink(resolve('e2e/support/session.ts'), join(cwd, 'e2e/support/session.ts'));
    if (!options.spawnFailure) {
      await writeFile(
        join(cwd, 'pnpm'),
        `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(sentinel)}, JSON.stringify({
  databaseUrl: process.env.DATABASE_URL,
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
  distDir: process.env.NEXT_DIST_DIR,
}));
process.exit(${String(options.childExitCode ?? 41)});
`,
        { mode: 0o755 },
      );
    }
    await writeFile(join(cwd, 'package.json'), '{"type":"module"}');
    // Replace only the external server boundary: never reuse dev3000 or launch Next.
    await writeFile(
      join(cwd, 'playwright.config.mts'),
      `import config from ${JSON.stringify(configPath)};
export default {
  ...config,
  testDir: ${JSON.stringify(cwd)},
  outputDir: ${JSON.stringify(join(cwd, 'results'))},
  webServer: {
    ...config.webServer,
    url: 'http://127.0.0.1:0',
    reuseExistingServer: false,
  },
};
`,
    );
    await writeFile(
      join(cwd, 'probe.spec.ts'),
      `import { test } from ${JSON.stringify(playwrightModule)};
test('configuration probe', () => {});
`,
    );
    const result = spawnSync(
      process.execPath,
      options.launcher
        ? [serverPath]
        : [
            playwrightCli,
            'test',
            '--config',
            join(cwd, 'playwright.config.mts'),
            ...(options.json ? ['--reporter=json'] : []),
          ],
      {
        cwd,
        env: {
          PATH: cwd,
          NODE_ENV: 'test',
          ...env,
          ...(options.json === 'file' ? { PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath } : {}),
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
    return {
      status: result.status,
      stdout: result.stdout,
      output: result.stdout + result.stderr,
      report: options.json === 'file' ? await readFile(reportPath, 'utf8') : result.stdout,
      launched: existsSync(sentinel) ? await readFile(sentinel, 'utf8') : undefined,
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
  'rejects missing %s before launching the e2e server',
  async (missing) => {
    const env = { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner, [missing]: undefined };
    const result = await probe(undefined, env);
    expect(result.launched, result.output).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`${missing} is required`);
  },
);

it.each(['file-only', 'exported-wins', 'missing-file'])(
  '%s launches the owned server with derived database credentials',
  async (kind) => {
    const file =
      kind === 'missing-file'
        ? undefined
        : `DATABASE_URL=${app}\nMIGRATION_DATABASE_URL=${owner}\n`;
    const env =
      kind === 'file-only'
        ? {}
        : {
            DATABASE_URL:
              'postgres://exported-reader:exported-app-marker@reader-export:5435/source',
            MIGRATION_DATABASE_URL:
              'postgres://exported-owner:exported-owner-marker@owner-export:5436/source',
          };
    const result = await probe(file, {
      ...env,
      NEXT_DIST_DIR: '.next',
      BASE_URL: 'http://localhost:3000',
    });
    expect(result.launched, result.output).toBeDefined();
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.launched ?? '')).toEqual({
      databaseUrl:
        kind === 'file-only'
          ? 'postgres://reader:reader-marker@reader-host:5433/app_e2e'
          : 'postgres://exported-reader:exported-app-marker@reader-export:5435/app_e2e',
      migrationDatabaseUrl:
        kind === 'file-only'
          ? 'postgres://owner:owner-marker@owner-host:5434/app_e2e'
          : 'postgres://exported-owner:exported-owner-marker@owner-export:5436/app_e2e',
      distDir: '.next-e2e',
    });
    for (const marker of [
      'reader-marker',
      'owner-marker',
      'exported-app-marker',
      'exported-owner-marker',
    ]) {
      expect(result.output).not.toContain(marker);
    }
  },
);

it.each([
  ['stdout', 'file-only'],
  ['stdout', 'exported-wins'],
  ['stdout', 'missing-file'],
  ['file', 'file-only'],
  ['file', 'exported-wins'],
  ['file', 'missing-file'],
] as const)(
  'native JSON %s report omits database credentials with %s environment',
  async (json, kind) => {
    const databaseUrl =
      'postgres://json-reader-196:json-app-secret-196@reader.invalid:5433/app_dev';
    const migrationDatabaseUrl =
      'postgres://json-owner-196:json-owner-secret-196@owner.invalid:5434/app_dev';
    const result = await probe(
      kind === 'missing-file'
        ? undefined
        : kind === 'exported-wins'
          ? `DATABASE_URL=${app}\nMIGRATION_DATABASE_URL=${owner}\n`
          : `DATABASE_URL=${databaseUrl}\nMIGRATION_DATABASE_URL=${migrationDatabaseUrl}\n`,
      kind === 'file-only'
        ? {}
        : { DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: migrationDatabaseUrl },
      { json },
    );
    expect(result.status).not.toBe(0);
    expect(result.launched, result.output).toBeDefined();
    expect(JSON.parse(result.launched ?? '')).toEqual({
      databaseUrl: 'postgres://json-reader-196:json-app-secret-196@reader.invalid:5433/app_e2e',
      migrationDatabaseUrl:
        'postgres://json-owner-196:json-owner-secret-196@owner.invalid:5434/app_e2e',
      distDir: '.next-e2e',
    });
    const reportContent = JSON.stringify(JSON.parse(result.report));
    for (const secret of [
      'postgres://json-reader-196:json-app-secret-196@reader.invalid:5433/app_e2e',
      'postgres://json-owner-196:json-owner-secret-196@owner.invalid:5434/app_e2e',
      databaseUrl,
      migrationDatabaseUrl,
      'json-reader-196',
      'json-owner-196',
      'json-app-secret-196',
      'json-owner-secret-196',
      app,
      owner,
      'postgres://reader:reader-marker@reader-host:5433/app_e2e',
      'postgres://owner:owner-marker@owner-host:5434/app_e2e',
      'reader-marker',
      'owner-marker',
    ]) {
      expect(reportContent).not.toContain(secret);
      expect(result.output).not.toContain(secret);
    }
  },
);

it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
  'rejects malformed %s without exposing credentials or launching the server',
  async (key) => {
    const malformed = 'postgres://malformed-user:malformed-password@localhost:badport/source';
    const result = await probe(undefined, {
      DATABASE_URL: app,
      MIGRATION_DATABASE_URL: owner,
      [key]: malformed,
    });
    expect(result.launched, result.output).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`${key} must be a PostgreSQL URL`);
    for (const marker of [malformed, 'malformed-user', 'malformed-password']) {
      expect(result.output).not.toContain(marker);
    }
  },
);

it.each([0, 41])('server launcher preserves child exit code %s', async (childExitCode) => {
  const result = await probe(
    `DATABASE_URL=${app}?database=app_dev&sslmode=require\nMIGRATION_DATABASE_URL=${owner}?database=app_dev&sslmode=require\n`,
    { NEXT_DIST_DIR: '.next-e2e' },
    { launcher: true, childExitCode },
  );
  expect(result.status).toBe(childExitCode);
  expect(result.launched).toBeDefined();
  expect(JSON.parse(result.launched ?? '')).toEqual({
    databaseUrl: 'postgres://reader:reader-marker@reader-host:5433/app_e2e?sslmode=require',
    migrationDatabaseUrl: 'postgres://owner:owner-marker@owner-host:5434/app_e2e?sslmode=require',
    distDir: '.next-e2e',
  });
  expect(result.output).toBe('');
});

it('server launcher reports spawn failure without exposing credentials', async () => {
  const result = await probe(
    undefined,
    { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner },
    { launcher: true, spawnFailure: true },
  );
  expect(result.status).toBe(1);
  expect(result.launched).toBeUndefined();
  expect(result.stdout).toBe('');
  expect(result.output).toBe('E2E server failed to start\n');
});

it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
  'server launcher rejects missing %s before starting a child',
  async (missing) => {
    const result = await probe(
      undefined,
      { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner, [missing]: undefined },
      { launcher: true },
    );
    expect(result.status).not.toBe(0);
    expect(result.launched).toBeUndefined();
    expect(result.output).toContain(`${missing} is required`);
    expect(result.output).not.toContain('reader-marker');
    expect(result.output).not.toContain('owner-marker');
  },
);

it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
  'server launcher rejects malformed %s without exposing credentials or starting a child',
  async (key) => {
    const malformed = 'postgres://launcher-user:launcher-password@localhost:badport/source';
    const result = await probe(
      undefined,
      { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner, [key]: malformed },
      { launcher: true },
    );
    expect(result.status).not.toBe(0);
    expect(result.launched).toBeUndefined();
    expect(result.output).toContain(`${key} must be a PostgreSQL URL`);
    for (const marker of [malformed, 'launcher-user', 'launcher-password']) {
      expect(result.output).not.toContain(marker);
    }
  },
);
