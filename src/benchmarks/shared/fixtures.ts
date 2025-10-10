/**
 * Test fixture management for benchmarks
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');

/**
 * Available test fixture sizes
 */
export type FixtureSize = 'micro' | 'tiny' | 'small' | 'medium' | 'large' | 'xlarge' | 'default';

/**
 * Fixture metadata
 */
export interface FixtureInfo {
	name: FixtureSize;
	path: string;
	charCount: number;
	estimatedTokens: number;
}

/**
 * Load test fixture by name
 */
export async function loadFixture(name: FixtureSize = 'default'): Promise<string> {
	const filename = name === 'default' ? 'default-text.md' : `${name}-text.txt`;
	const filePath = path.join(FIXTURES_DIR, filename);

	try {
		return await fs.readFile(filePath, 'utf-8');
	} catch (error) {
		throw new Error(
			`Failed to load fixture '${name}': ${(error as Error).message}. Available fixtures: micro, tiny, small, medium, large, xlarge, default`
		);
	}
}

/**
 * Get fixture metadata without loading content
 */
export async function getFixtureInfo(name: FixtureSize = 'default'): Promise<FixtureInfo> {
	const filename = name === 'default' ? 'default-text.md' : `${name}-text.txt`;
	const filePath = path.join(FIXTURES_DIR, filename);

	try {
		const stats = await fs.stat(filePath);
		const content = await fs.readFile(filePath, 'utf-8');

		return {
			name,
			path: filePath,
			charCount: content.length,
			estimatedTokens: Math.ceil(content.length / 4), // Rough estimate
		};
	} catch (error) {
		throw new Error(`Failed to get info for fixture '${name}': ${(error as Error).message}`);
	}
}

/**
 * List all available fixtures
 */
export async function listFixtures(): Promise<FixtureInfo[]> {
	const files = await fs.readdir(FIXTURES_DIR);
	const fixtures: FixtureInfo[] = [];

	for (const file of files) {
		if (file.endsWith('.txt') || file.endsWith('.md')) {
			const name = file
				.replace('-text.txt', '')
				.replace('-text.md', '')
				.replace('default-', 'default') as FixtureSize;
			try {
				const info = await getFixtureInfo(name);
				fixtures.push(info);
			} catch {
				// Skip files that can't be loaded
			}
		}
	}

	return fixtures.sort((a, b) => a.charCount - b.charCount);
}

/**
 * Load fixture from file path (for custom inputs)
 */
export async function loadCustomFixture(filePath: string): Promise<string> {
	try {
		return await fs.readFile(filePath, 'utf-8');
	} catch (error) {
		throw new Error(
			`Failed to load custom fixture from '${filePath}': ${(error as Error).message}`
		);
	}
}
