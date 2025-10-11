/**
 * Global teardown for Jest tests
 * Ensures database connections are properly closed after all tests
 */

module.exports = async () => {
  // Force clear the Prisma client singleton
  const globalForPrisma = globalThis;
  if (globalForPrisma.prisma) {
    try {
      await globalForPrisma.prisma.$disconnect();
    } catch (error) {
      console.warn('Error disconnecting Prisma in global teardown:', error.message);
    }
    globalForPrisma.prisma = undefined;
  }

  // Give a moment for connections to close
  await new Promise(resolve => setTimeout(resolve, 100));
};
