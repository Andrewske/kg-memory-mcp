/**
 * Architecture dependency rules tests
 *
 * These tests enforce architectural boundaries to prevent circular dependencies
 * and maintain clean separation of concerns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Dependency Architecture Rules', () => {
	it('should not allow production code to import from benchmarks', () => {
		const productionDirs = ['features', 'server', 'shared'];
		const violations: string[] = [];

		for (const dir of productionDirs) {
			const dirPath = path.join(process.cwd(), 'src', dir);

			// Skip if directory doesn't exist
			if (!fs.existsSync(dirPath)) {
				continue;
			}

			const files = getAllTsFiles(dirPath);
			for (const file of files) {
				const content = fs.readFileSync(file, 'utf-8');

				// Check for imports from benchmarks directory
				if (content.includes("from '~/benchmarks/") || content.includes('from "~/benchmarks/')) {
					violations.push(`${file} imports from benchmarks`);
				}
			}
		}

		// If violations found, fail with detailed message
		if (violations.length > 0) {
			const message = [
				'Production code should not import from benchmarks directory.',
				'This creates a circular dependency.',
				'',
				'Violations found:',
				...violations.map(v => `  - ${v}`),
				'',
				'Solution: Move shared types to src/shared/types/ and re-export from benchmarks if needed.',
			].join('\n');

			throw new Error(message);
		}

		expect(violations).toEqual([]);
	});

	it('should allow benchmarks to import from production code', () => {
		// This is the correct direction - benchmarks can depend on production
		const benchmarkDir = path.join(process.cwd(), 'src', 'benchmarks');

		// Skip if directory doesn't exist
		if (!fs.existsSync(benchmarkDir)) {
			return;
		}

		const files = getAllTsFiles(benchmarkDir);
		let hasProductionImports = false;

		for (const file of files) {
			const content = fs.readFileSync(file, 'utf-8');

			// Check for imports from production directories
			if (
				content.includes("from '~/features/") ||
				content.includes("from '~/server/") ||
				content.includes("from '~/shared/") ||
				content.includes('from "~/features/') ||
				content.includes('from "~/server/') ||
				content.includes('from "~/shared/')
			) {
				hasProductionImports = true;
				break;
			}
		}

		// This should be true - benchmarks can import from production
		expect(hasProductionImports).toBe(true);
	});

	it('should allow production code to import from shared types', () => {
		const featuresDir = path.join(process.cwd(), 'src', 'features');

		// Skip if directory doesn't exist
		if (!fs.existsSync(featuresDir)) {
			return;
		}

		const files = getAllTsFiles(featuresDir);
		let hasSharedImports = false;

		for (const file of files) {
			const content = fs.readFileSync(file, 'utf-8');

			// Check for imports from shared types
			if (content.includes("from '~/shared/types/") || content.includes('from "~/shared/types/')) {
				hasSharedImports = true;
				break;
			}
		}

		// This should be true - production can import from shared
		expect(hasSharedImports).toBe(true);
	});
});

/**
 * Recursively get all TypeScript files in a directory
 */
function getAllTsFiles(dir: string): string[] {
	const files: string[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				files.push(...getAllTsFiles(fullPath));
			} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
				files.push(fullPath);
			}
		}
	} catch (error) {
		// Ignore errors (e.g., permission denied)
	}

	return files;
}
