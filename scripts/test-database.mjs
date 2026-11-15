import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { assertDevelopmentDatabaseSetup, setupDatabase } from './db-setup.mjs';

function targetUrl(key, name, env) {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  if (!URL.canParse(value)) {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  url.pathname = `/${name}`;
  // postgres startup parameters override the pathname database.
  url.searchParams.delete('database');
  return url.toString();
}

export function deriveTestDatabaseTarget(name, env) {
  return {
    databaseName: name,
    databaseUrl: targetUrl('DATABASE_URL', name, env),
    migrationDatabaseUrl: targetUrl('MIGRATION_DATABASE_URL', name, env),
  };
}

function ownerConnection(databaseUrl) {
  // DROP SCHEMA notices can contain application data; lifecycle operations stay silent.
  return postgres(databaseUrl, { max: 1, onnotice: () => undefined });
}

export async function resetTestDatabase(name) {
  if (name !== 'app_test' && name !== 'app_e2e') {
    throw new Error('Test database must be app_test or app_e2e');
  }
  assertDevelopmentDatabaseSetup();
  const destination = deriveTestDatabaseTarget(name, process.env);
  const maintenance = ownerConnection(targetUrl('MIGRATION_DATABASE_URL', 'postgres', process.env));
  try {
    const existing = await maintenance`select datname from pg_database where datname = ${name}`;
    if (existing.length === 0) await maintenance`create database ${maintenance(name)}`;
  } finally {
    await maintenance.end();
  }
  const sql = ownerConnection(destination.migrationDatabaseUrl);
  try {
    await sql.begin(async (transaction) => {
      await transaction`drop schema public cascade`;
      await transaction`create schema public`;
    });
  } finally {
    await sql.end();
  }
  await setupDatabase({ databaseUrl: destination.migrationDatabaseUrl });
  return destination;
}

export async function withScratchDatabase(callback) {
  const databaseName = `app_scratch_${randomBytes(16).toString('hex')}`;
  const destination = deriveTestDatabaseTarget(databaseName, process.env);
  const maintenance = ownerConnection(targetUrl('MIGRATION_DATABASE_URL', 'postgres', process.env));
  let created = false;
  try {
    await maintenance`create database ${maintenance(databaseName)}`;
    created = true;
    return await callback(destination);
  } finally {
    try {
      if (created) await maintenance`drop database ${maintenance(databaseName)} with (force)`;
    } finally {
      await maintenance.end();
    }
  }
}
