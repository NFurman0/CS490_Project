import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Integration tests use the dedicated test database: DATABASE_URL from
// apps/api/.env.test locally, or from the CI environment.
const testEnvPath = existsSync('.env.test') ? '.env.test' : 'apps/api/.env.test';
if (existsSync(testEnvPath)) {
  delete process.env.DATABASE_URL;
  process.loadEnvFile(testEnvPath);
}

/** Reject a development URL before a test client can use it. Never include credentials in errors. */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  let databaseName: string;
  try {
    databaseName = new URL(databaseUrl).pathname;
  } catch {
    throw new Error('Database tests require a valid reviewlens_test database URL.');
  }
  if (databaseName !== '/reviewlens_test') {
    throw new Error('Database tests require the dedicated reviewlens_test database.');
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) assertTestDatabaseUrl(databaseUrl);

/** True only when an isolated test database is configured; otherwise skip database tests. */
export const hasTestDatabase = Boolean(databaseUrl);

export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl ?? 'postgresql://reviewlens:reviewlens@localhost:5433/reviewlens_test',
    },
  },
});

/** Removes all rows. Children cascade from users, but are deleted explicitly for clarity. */
export async function resetDatabase(): Promise<void> {
  if (!databaseUrl) throw new Error('Database tests require a configured reviewlens_test database.');
  // Verify the connected database too, before the first DELETE. URL checks alone
  // cannot protect against a proxy or connection pointing at a different database.
  const [connected] = await testPrisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (connected?.name !== 'reviewlens_test') {
    throw new Error('Refusing to reset a database other than reviewlens_test.');
  }
  await testPrisma.ingestionRun.deleteMany();
  await testPrisma.analysisTarget.deleteMany();
  await testPrisma.user.deleteMany();
}
