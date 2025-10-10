/**
 * Tests for vocabulary backup and recovery functionality
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from '@jest/globals';
import {
	createVocabularyBackup,
	saveVocabulary,
	type Vocabulary,
} from '../vocabulary-tracker.js';
import {
	listBackups,
	readBackup,
	restoreBackup,
	validateVocabulary,
	getMostRecentBackup,
	compareVocabularies,
} from '../vocabulary-recovery.js';

const TEST_DIR = path.join(process.cwd(), 'test-vocab-backup');
const TEST_VOCAB_PATH = 'test-vocab-backup/vocabulary.json';

describe('Vocabulary Backup System', () => {
	beforeEach(async () => {
		// Create test directory
		await fs.mkdir(TEST_DIR, { recursive: true });
	});

	afterEach(async () => {
		// Clean up test directory
		try {
			await fs.rm(TEST_DIR, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('createVocabularyBackup', () => {
		it('should create a backup with timestamp', async () => {
			const vocab: Vocabulary = {
				entities: { test: 1 },
				relationships: { knows: 1 },
				concepts: { testing: 1 },
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test-model',
					provider: 'test',
				},
			};

			// Save initial vocabulary
			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			// Create backup
			await createVocabularyBackup(TEST_VOCAB_PATH, 10);

			// Check backup exists
			const backups = await listBackups(TEST_VOCAB_PATH);
			expect(backups.length).toBe(1);
			expect(backups[0].isValid).toBe(true);
			expect(backups[0].filename).toMatch(/vocabulary\.backup\..+\.json/);
		});

		it('should handle non-existent file gracefully', async () => {
			// Should not throw
			await expect(
				createVocabularyBackup('test-vocab-backup/nonexistent.json', 10)
			).resolves.toBeUndefined();

			const backups = await listBackups('test-vocab-backup/nonexistent.json');
			expect(backups.length).toBe(0);
		});

		it('should rotate old backups', async () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 0,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			// Save initial file
			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			// Create 15 backups (should keep only 10)
			for (let i = 0; i < 15; i++) {
				vocab.metadata.total_runs = i;
				await saveVocabulary(vocab, TEST_VOCAB_PATH, false);
				await createVocabularyBackup(TEST_VOCAB_PATH, 10);
				// Small delay to ensure different timestamps
				await new Promise(resolve => setTimeout(resolve, 10));
			}

			const backups = await listBackups(TEST_VOCAB_PATH);
			expect(backups.length).toBeLessThanOrEqual(10);
		});
	});

	describe('saveVocabulary with atomic writes', () => {
		it('should save vocabulary atomically', async () => {
			const vocab: Vocabulary = {
				entities: { alice: 1, bob: 2 },
				relationships: { knows: 3 },
				concepts: { friendship: 1 },
				metadata: {
					total_runs: 5,
					last_updated: new Date().toISOString(),
					model: 'gpt-4',
					provider: 'openai',
				},
			};

			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			const fullPath = path.join(process.cwd(), TEST_VOCAB_PATH);
			const content = await fs.readFile(fullPath, 'utf-8');
			const loaded = JSON.parse(content) as Vocabulary;

			expect(loaded.entities).toEqual(vocab.entities);
			expect(loaded.relationships).toEqual(vocab.relationships);
			expect(loaded.concepts).toEqual(vocab.concepts);
			expect(loaded.metadata.total_runs).toBe(5);
		});

		it('should create backup automatically when enabled', async () => {
			const vocab1: Vocabulary = {
				entities: { test1: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			// First save without backup
			await saveVocabulary(vocab1, TEST_VOCAB_PATH, false);

			// Second save with backup (default)
			const vocab2: Vocabulary = {
				entities: { test2: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 2,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};
			await saveVocabulary(vocab2, TEST_VOCAB_PATH, true);

			const backups = await listBackups(TEST_VOCAB_PATH);
			expect(backups.length).toBeGreaterThan(0);

			// Backup should contain first vocabulary
			const backup = await readBackup(backups[0].path);
			expect(backup.entities).toEqual(vocab1.entities);
		});

		it('should not leave temp files on success', async () => {
			const vocab: Vocabulary = {
				entities: { test: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			const files = await fs.readdir(TEST_DIR);
			expect(files.some(f => f.endsWith('.tmp'))).toBe(false);
		});
	});

	describe('listBackups', () => {
		it('should list backups sorted by timestamp', async () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 0,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			// Create 3 backups
			for (let i = 0; i < 3; i++) {
				await createVocabularyBackup(TEST_VOCAB_PATH, 10);
				await new Promise(resolve => setTimeout(resolve, 50));
			}

			const backups = await listBackups(TEST_VOCAB_PATH);
			expect(backups.length).toBe(3);

			// Should be sorted newest first
			for (let i = 0; i < backups.length - 1; i++) {
				expect(backups[i].timestamp.getTime()).toBeGreaterThanOrEqual(
					backups[i + 1].timestamp.getTime()
				);
			}
		});

		it('should validate backup contents', async () => {
			const validVocab: Vocabulary = {
				entities: { test: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			await saveVocabulary(validVocab, TEST_VOCAB_PATH, false);
			await createVocabularyBackup(TEST_VOCAB_PATH, 10);

			// Create invalid backup manually
			const invalidBackupPath = path.join(TEST_DIR, 'vocabulary.backup.invalid.json');
			await fs.writeFile(invalidBackupPath, '{"invalid": "structure"}');

			const backups = await listBackups(TEST_VOCAB_PATH);
			const validBackups = backups.filter(b => b.isValid);
			const invalidBackups = backups.filter(b => !b.isValid);

			expect(validBackups.length).toBeGreaterThan(0);
			expect(invalidBackups.length).toBeGreaterThan(0);
		});
	});

	describe('restoreBackup', () => {
		it('should restore backup to main file', async () => {
			const originalVocab: Vocabulary = {
				entities: { original: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			const modifiedVocab: Vocabulary = {
				entities: { modified: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 2,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			// Save original and create backup
			await saveVocabulary(originalVocab, TEST_VOCAB_PATH, false);
			await createVocabularyBackup(TEST_VOCAB_PATH, 10);

			// Modify vocabulary
			await saveVocabulary(modifiedVocab, TEST_VOCAB_PATH, false);

			// Restore from backup
			const backups = await listBackups(TEST_VOCAB_PATH);
			await restoreBackup(backups[0].path, TEST_VOCAB_PATH, false);

			// Verify restoration
			const fullPath = path.join(process.cwd(), TEST_VOCAB_PATH);
			const content = await fs.readFile(fullPath, 'utf-8');
			const restored = JSON.parse(content) as Vocabulary;

			expect(restored.entities).toEqual(originalVocab.entities);
			expect(restored.metadata.total_runs).toBe(1);
		});

		it('should create pre-restore backup', async () => {
			const vocab: Vocabulary = {
				entities: { test: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);
			await createVocabularyBackup(TEST_VOCAB_PATH, 10);

			const backups = await listBackups(TEST_VOCAB_PATH);
			await restoreBackup(backups[0].path, TEST_VOCAB_PATH, true);

			const files = await fs.readdir(TEST_DIR);
			expect(files.some(f => f.includes('.pre-restore.'))).toBe(true);
		});

		it('should reject invalid backup files', async () => {
			const invalidBackupPath = path.join(TEST_DIR, 'invalid.json');
			await fs.writeFile(invalidBackupPath, '{"invalid": true}');

			await expect(restoreBackup(invalidBackupPath, TEST_VOCAB_PATH, false)).rejects.toThrow(
				'Invalid backup file'
			);
		});
	});

	describe('compareVocabularies', () => {
		it('should detect vocabulary differences', async () => {
			const vocab1: Vocabulary = {
				entities: { alice: 1, bob: 2 },
				relationships: { knows: 1 },
				concepts: { friendship: 1 },
				metadata: {
					total_runs: 5,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			const vocab2: Vocabulary = {
				entities: { alice: 2, charlie: 1 }, // bob removed, charlie added
				relationships: { knows: 2, likes: 1 }, // likes added
				concepts: { friendship: 1 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			const path1 = path.join(TEST_DIR, 'vocab1.json');
			const path2 = path.join(TEST_DIR, 'vocab2.json');

			await fs.writeFile(path1, JSON.stringify(vocab1, null, 2));
			await fs.writeFile(path2, JSON.stringify(vocab2, null, 2));

			const comparison = await compareVocabularies(path1, path2);

			expect(comparison.entities_added).toBe(1); // charlie
			expect(comparison.entities_removed).toBe(1); // bob
			expect(comparison.relationships_added).toBe(1); // likes
			expect(comparison.relationships_removed).toBe(0);
			expect(comparison.concepts_added).toBe(0);
			expect(comparison.concepts_removed).toBe(0);
			expect(comparison.runs_diff).toBe(5);
		});
	});

	describe('validateVocabulary', () => {
		it('should validate correct vocabulary file', async () => {
			const vocab: Vocabulary = {
				entities: { test: 1 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			const isValid = await validateVocabulary(TEST_VOCAB_PATH);
			expect(isValid).toBe(true);
		});

		it('should reject invalid vocabulary file', async () => {
			const fullPath = path.join(process.cwd(), TEST_VOCAB_PATH);
			await fs.writeFile(fullPath, '{"invalid": true}');

			const isValid = await validateVocabulary(TEST_VOCAB_PATH);
			expect(isValid).toBe(false);
		});

		it('should reject non-existent file', async () => {
			const isValid = await validateVocabulary('test-vocab-backup/nonexistent.json');
			expect(isValid).toBe(false);
		});
	});

	describe('getMostRecentBackup', () => {
		it('should return most recent valid backup', async () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 0,
					last_updated: new Date().toISOString(),
					model: 'test',
					provider: 'test',
				},
			};

			await saveVocabulary(vocab, TEST_VOCAB_PATH, false);

			// Create backups with delays
			for (let i = 0; i < 3; i++) {
				vocab.metadata.total_runs = i;
				await saveVocabulary(vocab, TEST_VOCAB_PATH, false);
				await createVocabularyBackup(TEST_VOCAB_PATH, 10);
				await new Promise(resolve => setTimeout(resolve, 50));
			}

			const mostRecent = await getMostRecentBackup(TEST_VOCAB_PATH);
			expect(mostRecent).not.toBeNull();
			expect(mostRecent?.isValid).toBe(true);
			expect(mostRecent?.metadata?.total_runs).toBe(2);
		});

		it('should return null when no backups exist', async () => {
			const mostRecent = await getMostRecentBackup(TEST_VOCAB_PATH);
			expect(mostRecent).toBeNull();
		});
	});
});
