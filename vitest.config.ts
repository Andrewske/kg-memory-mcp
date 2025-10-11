import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['./src/__tests__/helpers/test-setup.ts'],
		testTimeout: 60000,
		poolOptions: {
			threads: {
				singleThread: true, // Database test safety (equivalent to maxWorkers: 1)
			},
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'html'],
			exclude: [
				'src/**/*.d.ts',
				'src/__tests__/**',
				'src/tests/**',
				'src/index.ts',
			],
		},
		include: ['src/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
		exclude: ['node_modules', 'dist', 'coverage'],
	},
	resolve: {
		alias: {
			'~': path.resolve(__dirname, './src'),
		},
	},
});
