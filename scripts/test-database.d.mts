interface TestDatabase {
  databaseName: string;
  databaseUrl: string;
  migrationDatabaseUrl: string;
}

export function resetTestDatabase(name: string): Promise<TestDatabase>;
export function withScratchDatabase<T>(
  callback: (database: TestDatabase) => T | Promise<T>,
): Promise<T>;
