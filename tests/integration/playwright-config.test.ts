import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const configPath = resolve('playwright.config.ts');
const playwrightCli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
const playwrightModule = fileURLToPath(import.meta.resolve('@playwright/test'));
const app = 'postgres://reader:reader-marker@reader-host:5433/app_dev';
const owner = 'postgres://owner:owner-marker@owner-host:5434/app_dev';

async function probe(file: string | undefined, env: Record<string, string | undefined>) {
  const cwd = await mkdtemp(join(tmpdir(), 'mindsprout-playwright-'));
  const sentinel = join(cwd, 'server-launched');
  try {
    if (file !== undefined) await writeFile(join(cwd, '.env'), file);
    await writeFile(
      join(cwd, 'pnpm'),
      `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(sentinel)}, JSON.stringify({
  databaseUrl: process.env.DATABASE_URL,
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
  distDir: process.env.NEXT_DIST_DIR,
}));
process.exit(41);
`,
      { mode: 0o755 },
    );
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
    env: { ...config.webServer.env, PATH: ${JSON.stringify(`${cwd}:${process.env.PATH ?? ''}`)} },
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
      [playwrightCli, 'test', '--config', join(cwd, 'playwright.config.mts')],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          ...env,
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    return {
      output: result.stdout + result.stderr,
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
    expect(result.output).toContain(`${key} must be a PostgreSQL URL`);
    for (const marker of [malformed, 'malformed-user', 'malformed-password']) {
      expect(result.output).not.toContain(marker);
    }
  },
);
