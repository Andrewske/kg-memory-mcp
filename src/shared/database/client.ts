import { PrismaClient } from '@prisma/client';
import { env } from '~/shared/env.js';

declare global {
	var __prisma: PrismaClient | undefined;
}

const createPrismaClient = () =>
	new PrismaClient({
		log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
		datasources: {
			db: {
				url: env.DATABASE_URL,
			},
		},
		// Connection pool optimization for better performance
		// Note: Prisma doesn't expose connection pool config directly,
		// but we can set it via DATABASE_URL query params if needed
	});

const globalForPrisma = globalThis as unknown as {
	prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
