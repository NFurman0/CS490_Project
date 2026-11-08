import { PrismaClient } from '@prisma/client';

/** Creates the database client from validated configuration, never process.env. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
