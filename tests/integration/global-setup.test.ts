import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

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
    sql.unsafe = (text) => ({ simple: async () => { queries.push(text); return []; } });
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
    await mkdir(join(cwd, 'db/dev'), { recursive: true });
    await copyFile(resolve('db/dev/app-role.sql'), join(cwd, 'db/dev/app-role.sql'));
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

  it.each(['DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
    'redacts malformed %s before any connection',
    async (key) => {
      const malformed = 'postgres://malformed-user:malformed-password@localhost:badport/source';
      const result = await probe(
        undefined,
        { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner, [key]: malformed },
        `
        const { inspect } = await import('node:util');
        const { resetTestDatabase, withScratchDatabase } = await import(${JSON.stringify(lifecycleUrl)});
        const { default: setup } = await import(${JSON.stringify(setupUrl)});
        for (const run of [() => resetTestDatabase('app_test'), () => withScratchDatabase(() => {}), setup]) {
          try { await run(); throw new Error('unexpected success'); }
          catch (error) {
            assert.equal(connections.length, 0);
            assert.equal(error.message, '${key} must be a PostgreSQL URL');
            console.error(inspect(error, { showHidden: true }));
            process.exitCode = 1;
          }
        }
        console.log('sanitized all three seams');
      `,
      );
      expect(result.status).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain(`${key} must be a PostgreSQL URL`);
      expect(output).toContain('sanitized all three seams');
      for (const value of [malformed, 'malformed-user', 'malformed-password']) {
        expect(output.includes(value)).toBe(false);
      }
    },
  );

  it.each(['lifecycle', 'migration'])(
    'redacts %s failures at the setup boundary',
    async (stage) => {
      const result = await probe(
        undefined,
        { DATABASE_URL: app, MIGRATION_DATABASE_URL: owner },
        `
      mock.restoreAll();
      mock.module(${JSON.stringify(postgresUrl)}, { defaultExport: () => {
        const sql = async (parts) => {
          if (typeof parts === 'string') return parts;
          const query = parts.join('?');
          if (query.includes(${JSON.stringify(stage === 'lifecycle' ? 'pg_database' : 'schema_migrations')})) {
            throw Object.assign(new Error('failure-marker ' + process.env.MIGRATION_DATABASE_URL), {
              input: process.env.DATABASE_URL, cause: new Error('cause-marker')
            });
          }
          return [];
        };
        sql.begin = async callback => callback(sql);
        sql.end = async () => {};
        return sql;
      }});
      const { inspect } = await import('node:util');
      const { default: setup } = await import(${JSON.stringify(setupUrl)});
      try { await setup(); }
      catch (error) {
        console.error(inspect(error, { showHidden: true }));
        process.exitCode = 1;
      }
    `,
      );
      expect(result.status).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('Integration database setup failed');
      for (const value of [
        owner,
        app,
        'owner-marker',
        'reader-marker',
        'failure-marker',
        'cause-marker',
      ]) {
        expect(output.includes(value)).toBe(false);
      }
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
