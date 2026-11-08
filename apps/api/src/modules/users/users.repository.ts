import type { PrismaClient } from '@prisma/client';

export interface UsersRepository {
  findOrCreateByClerkUserId(clerkUserId: string): Promise<{ id: string }>;
}

export function createUsersRepository(prisma: Pick<PrismaClient, 'user'>): UsersRepository {
  return {
    async findOrCreateByClerkUserId(clerkUserId) {
      const user = await prisma.user.upsert({
        where: { clerkUserId },
        update: {},
        create: { clerkUserId },
        select: { id: true },
      });
      return user;
    },
  };
}
