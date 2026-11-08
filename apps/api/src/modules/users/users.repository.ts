import { Prisma, type PrismaClient } from '@prisma/client';
import type { UserDirectory } from '../../lib/identity.js';

/** Maps Clerk users to rows in the users table. */
export function createUsersRepository(prisma: Pick<PrismaClient, 'user'>): UserDirectory {
  return {
    async findOrCreate(clerkUserId) {
      try {
        return await prisma.user.upsert({
          where: { clerkUserId },
          update: {},
          create: { clerkUserId },
          select: { id: true },
        });
      } catch (error) {
        // Two first requests from a new user can race to create the row. The
        // unique constraint lets only one succeed; the other reads that row.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return prisma.user.findUniqueOrThrow({ where: { clerkUserId }, select: { id: true } });
        }
        throw error;
      }
    },
  };
}
