import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const setupUrl = pathToFileURL(resolve('tests/integration/global-setup.mjs')).href;
const lifecycleUrl = pathToFileURL(resolve('scripts/test-database.mjs')).href;
const postgresUrl = import.meta.resolve('postgres');
const owner = 'postgres://owner:owner-marker@localhost:5432/app_dev';
const app = 'postgres://reader:reader-marker@localhost:5432/app_dev';
// Dynamic imports run only after the subprocess installs its PostgreSQL boundary mock.
const mockBoundary = `
  import assert from 'node:assert/strict';
  import { mock } from 'node:test';
  const connections = [], queries = [];
  mock.module(${JSON.stringify(postgresUrl)}, { defaultExport: (url) => {
    connections.push(url);
    const sql = async (parts, ...values) => {
      if (typeof parts === 'string') return parts;
      queries.push(parts.join('?'));
      return [];
    };
    sql.begin = async (callback) => callback(sql);
    sql.end = async () => {};
    sql.unsafe = async (text) => { queries.push(text); return []; };
    return sql;
  }});
`;

async function probe(
  file: string | undefined,
  env: Record<string, string | undefined>,
  code: string,
) {
  const cwd = await mkdtemp(join(tmpdir(), 'mindsprout-setup-'));
  try {
    if (file !== undefined) await writeFile(join(cwd, '.env'), file);
    return spawnSync(
      process.execPath,
      ['--experimental-test-module-mocks', '--input-type=module', '-e', mockBoundary + code],
      {
        cwd,
        env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', NODE_ENV: 'test', ...env },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe('integration globalSetup environment contract', () => {
  it.each(['file-only', 'exported-wins', 'missing-file'])(
    '%s loads environment and binds both URLs to app_test',
    async (kind) => {
      const file =
        kind === 'missing-file'
          ? undefined
          : `DATABASE_URL=${app}\nMIGRATION_DATABASE_URL=${owner}\n`;
      const env =
        kind === 'file-only'
          ? {}
          : {
              DATABASE_URL: app.replace('app_dev', 'another'),
              MIGRATION_DATABASE_URL: owner.replace('app_dev', 'another'),
            };
      const result = await probe(
        file,
        env,
        `
      const { default: setup } = await import(${JSON.stringify(setupUrl)});
      await setup();
      assert.equal(process.env.DATABASE_URL, 'postgres://reader:reader-marker@localhost:5432/app_test');
      assert.equal(process.env.MIGRATION_DATABASE_URL, 'postgres://owner:owner-marker@localhost:5432/app_test');
      assert(connections.every(url => new URL(url).username === 'owner'));
      assert(connections.some(url => new URL(url).pathname === '/postgres'));
      assert(connections.some(url => new URL(url).pathname === '/app_test'));
      assert(queries.some(query => /drop schema/i.test(query)));
      assert(queries.some(query => /schema_migrations/i.test(query)));
    `,
      );
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toBe('');
    },
  );

  it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
    'rejects missing %s before constructing any database client',
    async (missing) => {
      const env =
        missing === 'DATABASE_URL' ? { MIGRATION_DATABASE_URL: owner } : { DATABASE_URL: app };
      const result = await probe(
        undefined,
        env,
        `
      const { default: setup } = await import(${JSON.stringify(setupUrl)});
      await assert.rejects(setup, { message: '${missing} is required' });
      assert.equal(connections.length, 0);
    `,
      );
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toBe('');
    },
  );

  it('exported credentials win over file credentials and reset forces both paths without changing hosts', async () => {
    const result = await probe(
      `DATABASE_URL=${app}\nMIGRATION_DATABASE_URL=${owner}\n`,
      {
        DATABASE_URL: 'postgres://exported-reader:exported-reader-marker@reader-host:5433/source',
        MIGRATION_DATABASE_URL:
          'postgres://exported-owner:exported-owner-marker@owner-host:5434/source',
      },
      `
      const { default: setup } = await import(${JSON.stringify(setupUrl)});
      await setup();
      assert.equal(process.env.DATABASE_URL, 'postgres://exported-reader:exported-reader-marker@reader-host:5433/app_test');
      assert.equal(process.env.MIGRATION_DATABASE_URL, 'postgres://exported-owner:exported-owner-marker@owner-host:5434/app_test');
      assert(connections.every(url => new URL(url).host === 'owner-host:5434'));
      const { resetTestDatabase } = await import(${JSON.stringify(lifecycleUrl)});
      const target = await resetTestDatabase('app_e2e');
      assert.equal(target.databaseUrl, 'postgres://exported-reader:exported-reader-marker@reader-host:5433/app_e2e');
      assert.equal(target.migrationDatabaseUrl, 'postgres://exported-owner:exported-owner-marker@owner-host:5434/app_e2e');
    `,
    );
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe('');
  });

  it('never drops an uncreated scratch database when creation fails', async () => {
    const result = await probe(
      undefined,
      { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner },
      `
      mock.restoreAll();
      const failure = new Error('create denied');
      mock.module(${JSON.stringify(postgresUrl)}, { defaultExport: () => {
        const sql = (parts) => {
          if (typeof parts === 'string') return parts;
          const query = parts.join('?'); queries.push(query);
          if (/create database/i.test(query)) throw failure;
          return [];
        };
        sql.end = async () => {};
        return sql;
      }});
      const { withScratchDatabase } = await import(${JSON.stringify(lifecycleUrl)});
      await assert.rejects(() => withScratchDatabase(() => { throw new Error('callback must not run'); }), error => error === failure);
      assert(!queries.some(query => /drop database/i.test(query)));
    `,
    );
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('migration workflow configuration', () => {
  it('wires setup, safe defaults, owner CI URL, unchanged smoke and documented derivation', async () => {
    expect(await readFile('vitest.integration.config.ts', 'utf8')).toContain(
      "globalSetup: ['tests/integration/global-setup.mjs']",
    );
    const database = await readFile('tests/integration/database.test.ts', 'utf8');
    expect(database).toContain('postgres://app:app@localhost:5432/app_test');
    expect(database).not.toContain('app_dev');
    const example = await readFile('.env.example', 'utf8');
    expect(example).toContain('MIGRATION_DATABASE_URL=postgres://app:app@localhost:5432/app_dev');
    expect(example).toMatch(/#.*integration.*e2e.*app_test.*app_e2e/);
    const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8')) as {
      jobs: Record<string, { env: Record<string, string>; steps: { run?: string }[] }>;
    };
    const integration = workflow.jobs['layer3-integration-tests'];
    expect(integration?.env).toEqual({
      DATABASE_URL: 'postgres://app:app@localhost:5432/app_test',
      MIGRATION_DATABASE_URL: 'postgres://app:app@localhost:5432/app_test',
    });
    expect(integration?.steps.some((step) => step.run?.includes('pnpm smoke'))).toBe(true);
    const agents = await readFile('AGENTS.md', 'utf8');
    expect(agents).toContain('`pnpm db:migrate`');
    expect(Buffer.byteLength(agents)).toBeLessThanOrEqual(32_768);
    expect(
      Math.max(...agents.split('\n').map((line) => Buffer.byteLength(line))),
    ).toBeLessThanOrEqual(307);
  });
});
