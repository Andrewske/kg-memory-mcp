/**
 * Vocabulary Recovery Utilities
 *
 * Provides functions to list, inspect, and restore vocabulary backups.
 * Enables recovery from corrupted or accidentally modified vocabulary files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Vocabulary } from './vocabulary-tracker.js';

/**
 * Information about a vocabulary backup file
 */
export interface BackupInfo {
	filename: string;
	path: string;
	timestamp: Date;
	size: number;
	isValid: boolean;
	metadata?: {
		total_runs: number;
		last_updated: string;
		model: string;
		provider: string;
	};
}

/**
 * Comparison between two vocabularies
 */
export interface VocabularyComparison {
	entities_added: number;
	entities_removed: number;
	relationships_added: number;
	relationships_removed: number;
	concepts_added: number;
	concepts_removed: number;
	runs_diff: number;
}

/**
 * List all available backups for a vocabulary file
 */
export async function listBackups(vocabularyPath: string): Promise<BackupInfo[]> {
	const fullPath = path.join(process.cwd(), vocabularyPath);
	const dir = path.dirname(fullPath);
	const ext = path.extname(fullPath);
	const basename = path.basename(fullPath, ext);

	const backupPattern = new RegExp(`^${basename}\\.backup\\..+${ext.replace('.', '\\.')}$`);

	// List all backup files
	const files = await fs.readdir(dir);
	const backupFiles = files.filter(f => backupPattern.test(f));

	// Get info for each backup
	const backups = await Promise.all(
		backupFiles.map(async filename => {
			const backupPath = path.join(dir, filename);
			const stat = await fs.stat(backupPath);

			// Try to parse the backup to validate it
			let isValid = false;
			let metadata: BackupInfo['metadata'] | undefined;

			try {
				const content = await fs.readFile(backupPath, 'utf-8');
				const vocab = JSON.parse(content) as Vocabulary;

				// Validate structure
				if (
					vocab.entities &&
					vocab.relationships &&
					vocab.concepts &&
					vocab.metadata &&
					typeof vocab.metadata.total_runs === 'number'
				) {
					isValid = true;
					metadata = vocab.metadata;
				}
			} catch {
				// Invalid backup
			}

			return {
				filename,
				path: backupPath,
				timestamp: stat.mtime,
				size: stat.size,
				isValid,
				metadata,
			};
		})
	);

	// Sort by timestamp (newest first)
	return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Read and parse a specific backup file
 */
export async function readBackup(backupPath: string): Promise<Vocabulary> {
	const content = await fs.readFile(backupPath, 'utf-8');
	return JSON.parse(content) as Vocabulary;
}

/**
 * Restore a backup to the main vocabulary file
 */
export async function restoreBackup(
	backupPath: string,
	vocabularyPath: string,
	createBackupFirst: boolean = true
): Promise<void> {
	const fullVocabPath = path.join(process.cwd(), vocabularyPath);

	// Validate backup before restoring
	const vocab = await readBackup(backupPath);
	if (!vocab.entities || !vocab.relationships || !vocab.concepts || !vocab.metadata) {
		throw new Error('Invalid backup file: missing required fields');
	}

	// Create backup of current state before restoring
	if (createBackupFirst) {
		try {
			await fs.access(fullVocabPath);
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const dir = path.dirname(fullVocabPath);
			const ext = path.extname(fullVocabPath);
			const basename = path.basename(fullVocabPath, ext);
			const preRestoreBackupPath = path.join(
				dir,
				`${basename}.pre-restore.${timestamp}${ext}`
			);
			await fs.copyFile(fullVocabPath, preRestoreBackupPath);
		} catch {
			// No current file exists, skip backup
		}
	}

	// Ensure directory exists
	await fs.mkdir(path.dirname(fullVocabPath), { recursive: true });

	// Atomic restore: write to temp, then rename
	const tempPath = `${fullVocabPath}.tmp`;
	await fs.writeFile(tempPath, JSON.stringify(vocab, null, 2));
	await fs.rename(tempPath, fullVocabPath);
}

/**
 * Compare two vocabularies and return differences
 */
export async function compareVocabularies(
	vocab1Path: string,
	vocab2Path: string
): Promise<VocabularyComparison> {
	const vocab1 = await readBackup(vocab1Path);
	const vocab2 = await readBackup(vocab2Path);

	const entities1 = new Set(Object.keys(vocab1.entities));
	const entities2 = new Set(Object.keys(vocab2.entities));
	const relationships1 = new Set(Object.keys(vocab1.relationships));
	const relationships2 = new Set(Object.keys(vocab2.relationships));
	const concepts1 = new Set(Object.keys(vocab1.concepts));
	const concepts2 = new Set(Object.keys(vocab2.concepts));

	// Calculate differences (vocab2 vs vocab1)
	const entitiesAdded = Array.from(entities2).filter(e => !entities1.has(e)).length;
	const entitiesRemoved = Array.from(entities1).filter(e => !entities2.has(e)).length;
	const relationshipsAdded = Array.from(relationships2).filter(r => !relationships1.has(r))
		.length;
	const relationshipsRemoved = Array.from(relationships1).filter(r => !relationships2.has(r))
		.length;
	const conceptsAdded = Array.from(concepts2).filter(c => !concepts1.has(c)).length;
	const conceptsRemoved = Array.from(concepts1).filter(c => !concepts2.has(c)).length;

	return {
		entities_added: entitiesAdded,
		entities_removed: entitiesRemoved,
		relationships_added: relationshipsAdded,
		relationships_removed: relationshipsRemoved,
		concepts_added: conceptsAdded,
		concepts_removed: conceptsRemoved,
		runs_diff: vocab2.metadata.total_runs - vocab1.metadata.total_runs,
	};
}

/**
 * Get the most recent valid backup
 */
export async function getMostRecentBackup(
	vocabularyPath: string
): Promise<BackupInfo | null> {
	const backups = await listBackups(vocabularyPath);
	const validBackups = backups.filter(b => b.isValid);
	return validBackups.length > 0 ? validBackups[0] : null;
}

/**
 * Validate a vocabulary file
 */
export async function validateVocabulary(vocabularyPath: string): Promise<boolean> {
	try {
		const fullPath = path.join(process.cwd(), vocabularyPath);
		const content = await fs.readFile(fullPath, 'utf-8');
		const vocab = JSON.parse(content) as Vocabulary;

		return !!(
			vocab.entities &&
			vocab.relationships &&
			vocab.concepts &&
			vocab.metadata &&
			typeof vocab.metadata.total_runs === 'number'
		);
	} catch {
		return false;
	}
}
