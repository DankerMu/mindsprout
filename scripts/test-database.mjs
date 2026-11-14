import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { assertDevelopmentDatabaseSetup, setupDatabase } from './db-setup.mjs';

function targetUrl(key, name) {
  if (!process.env[key]) throw new Error(`${key} is required`);
  if (!URL.canParse(process.env[key])) {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  const url = new URL(process.env[key]);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  url.pathname = `/${name}`;
  // postgres startup parameters override the pathname database.
  url.searchParams.delete('database');
  return url.toString();
}

function target(name) {
  return {
    databaseName: name,
    databaseUrl: targetUrl('DATABASE_URL', name),
    migrationDatabaseUrl: targetUrl('MIGRATION_DATABASE_URL', name),
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
  const destination = target(name);
  const maintenance = ownerConnection(targetUrl('MIGRATION_DATABASE_URL', 'postgres'));
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
  const destination = target(databaseName);
  const maintenance = ownerConnection(targetUrl('MIGRATION_DATABASE_URL', 'postgres'));
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
