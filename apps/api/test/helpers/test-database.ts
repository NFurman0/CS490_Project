import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Integration tests use the dedicated test database: DATABASE_URL from
// apps/api/.env.test locally, or from the CI environment.
const testEnvPath = existsSync('.env.test') ? '.env.test' : 'apps/api/.env.test';
if (existsSync(testEnvPath)) {
  delete process.env.DATABASE_URL;
  process.loadEnvFile(testEnvPath);
}

/** True when a test database is configured; database tests are skipped otherwise. */
export const hasTestDatabase = Boolean(process.env.DATABASE_URL);

export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        'postgresql://reviewlens:reviewlens@localhost:5433/reviewlens_test',
    },
  },
});

/** Removes all rows. Children cascade from users, but are deleted explicitly for clarity. */
export async function resetDatabase(): Promise<void> {
  await testPrisma.ingestionRun.deleteMany();
  await testPrisma.analysisTarget.deleteMany();
  await testPrisma.user.deleteMany();
}
