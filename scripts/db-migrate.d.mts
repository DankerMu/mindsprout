export function migrateDatabase(options: {
  migrationsDir: string;
  databaseUrl: string;
}): Promise<void>;
