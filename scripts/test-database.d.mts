interface TestDatabase {
  databaseName: string;
  databaseUrl: string;
  migrationDatabaseUrl: string;
}

export function deriveTestDatabaseTarget(
  name: string,
  env: Record<string, string | undefined>,
): TestDatabase;
export function resetTestDatabase(name: string): Promise<TestDatabase>;
export function withScratchDatabase<T>(
  callback: (database: TestDatabase) => T | Promise<T>,
): Promise<T>;
