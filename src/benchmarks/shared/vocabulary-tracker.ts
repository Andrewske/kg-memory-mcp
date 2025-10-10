/**
 * Vocabulary Frequency Tracker
 *
 * Tracks cumulative frequency of extracted entities, relationships, and concepts
 * across all benchmark runs. Enables analysis of extraction consistency and
 * vocabulary evolution over time.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConceptNode, KnowledgeTriple } from '@prisma/client';

/**
 * Frequency map for a category of terms
 */
export type FrequencyMap = Record<string, number>;

/**
 * Vocabulary storage structure
 */
export interface Vocabulary {
	entities: FrequencyMap;
	relationships: FrequencyMap;
	concepts: FrequencyMap;
	metadata: {
		total_runs: number;
		last_updated: string;
		model: string;
		provider: string;
	};
}

/**
 * Term with frequency count
 */
export interface FrequentTerm {
	term: string;
	count: number;
}

/**
 * Novelty analysis result
 */
export interface NoveltyAnalysis {
	total_terms: number;
	new_terms: number;
	known_terms: number;
	novelty_rate: number;
	recognition_rate: number;
	new_term_list: {
		entities: string[];
		relationships: string[];
		concepts: string[];
	};
}

/**
 * Terms extracted from a benchmark run
 */
export interface ExtractedTerms {
	entities: string[];
	relationships: string[];
	concepts: string[];
}

/**
 * Normalize a term for consistent tracking
 * - Converts to lowercase
 * - Standardizes delimiters to underscores
 * - Trims whitespace
 */
export function normalizeTerm(term: string): string {
	return term
		.toLowerCase()
		.trim()
		.replace(/[\s-]+/g, '_') // Replace spaces and hyphens with underscores
		.replace(/_+/g, '_') // Collapse multiple underscores
		.replace(/^_|_$/g, ''); // Remove leading/trailing underscores
}

/**
 * Load vocabulary from disk or create empty if doesn't exist
 */
export async function loadVocabulary(
	vocabularyPath: string,
	model: string,
	provider: string
): Promise<Vocabulary> {
	const fullPath = path.join(process.cwd(), vocabularyPath);

	try {
		const content = await fs.readFile(fullPath, 'utf-8');
		return JSON.parse(content) as Vocabulary;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			// File doesn't exist, create empty vocabulary
			return createEmptyVocabulary(model, provider);
		}
		throw error;
	}
}

/**
 * Create an empty vocabulary structure
 */
function createEmptyVocabulary(model: string, provider: string): Vocabulary {
	return {
		entities: {},
		relationships: {},
		concepts: {},
		metadata: {
			total_runs: 0,
			last_updated: new Date().toISOString(),
			model,
			provider,
		},
	};
}

/**
 * Create a timestamped backup of the vocabulary file
 */
export async function createVocabularyBackup(
	vocabularyPath: string,
	maxBackups: number = 10
): Promise<void> {
	const fullPath = path.join(process.cwd(), vocabularyPath);

	// Check if vocabulary file exists
	try {
		await fs.access(fullPath);
	} catch {
		// No file to backup
		return;
	}

	const dir = path.dirname(fullPath);
	const ext = path.extname(fullPath);
	const basename = path.basename(fullPath, ext);

	// Create backup filename with ISO timestamp
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = path.join(dir, `${basename}.backup.${timestamp}${ext}`);

	// Copy current file to backup
	await fs.copyFile(fullPath, backupPath);

	// Rotate old backups (keep only maxBackups most recent)
	await rotateBackups(dir, basename, ext, maxBackups);
}

/**
 * Remove old backups, keeping only the most recent N files
 */
async function rotateBackups(
	dir: string,
	basename: string,
	ext: string,
	maxBackups: number
): Promise<void> {
	const backupPattern = new RegExp(`^${basename}\\.backup\\..+${ext.replace('.', '\\.')}$`);

	// List all backup files
	const files = await fs.readdir(dir);
	const backups = files
		.filter(f => backupPattern.test(f))
		.map(f => ({
			name: f,
			path: path.join(dir, f),
		}));

	// Sort by modification time (newest first)
	const backupsWithStats = await Promise.all(
		backups.map(async b => ({
			...b,
			stat: await fs.stat(b.path),
		}))
	);

	backupsWithStats.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

	// Delete old backups beyond maxBackups
	const toDelete = backupsWithStats.slice(maxBackups);
	await Promise.all(toDelete.map(b => fs.unlink(b.path)));
}

/**
 * Save vocabulary to disk with atomic writes and automatic backup
 */
export async function saveVocabulary(
	vocabulary: Vocabulary,
	vocabularyPath: string,
	createBackup: boolean = true,
	maxBackups: number = 10
): Promise<void> {
	const fullPath = path.join(process.cwd(), vocabularyPath);

	// Ensure directory exists
	await fs.mkdir(path.dirname(fullPath), { recursive: true });

	// Create backup before overwriting (if file exists and backup enabled)
	if (createBackup) {
		await createVocabularyBackup(vocabularyPath, maxBackups);
	}

	// Update metadata
	vocabulary.metadata.last_updated = new Date().toISOString();

	// Atomic write: write to temp file, then rename
	const tempPath = `${fullPath}.tmp`;
	await fs.writeFile(tempPath, JSON.stringify(vocabulary, null, 2));
	await fs.rename(tempPath, fullPath);
}

/**
 * Extract terms from triples and concepts
 */
export function extractTerms(triples: KnowledgeTriple[], concepts: ConceptNode[]): ExtractedTerms {
	const entities = new Set<string>();
	const relationships = new Set<string>();

	// Extract from triples
	for (const triple of triples) {
		if (triple.subject) entities.add(normalizeTerm(triple.subject));
		if (triple.object) entities.add(normalizeTerm(triple.object));
		if (triple.predicate) relationships.add(normalizeTerm(triple.predicate));
	}

	// Extract from concepts
	const conceptTerms = concepts
		.map(c => normalizeTerm(c.concept))
		.filter(concept => concept.length > 0);

	return {
		entities: Array.from(entities),
		relationships: Array.from(relationships),
		concepts: conceptTerms,
	};
}

/**
 * Update vocabulary with new terms
 */
export function updateVocabulary(vocabulary: Vocabulary, terms: ExtractedTerms): Vocabulary {
	// Update entities
	for (const entity of terms.entities) {
		vocabulary.entities[entity] = (vocabulary.entities[entity] || 0) + 1;
	}

	// Update relationships
	for (const relationship of terms.relationships) {
		vocabulary.relationships[relationship] = (vocabulary.relationships[relationship] || 0) + 1;
	}

	// Update concepts
	for (const concept of terms.concepts) {
		vocabulary.concepts[concept] = (vocabulary.concepts[concept] || 0) + 1;
	}

	// Increment run count
	vocabulary.metadata.total_runs += 1;

	return vocabulary;
}

/**
 * Analyze novelty of current terms compared to existing vocabulary
 */
export function analyzeNovelty(vocabulary: Vocabulary, terms: ExtractedTerms): NoveltyAnalysis {
	const newEntities: string[] = [];
	const newRelationships: string[] = [];
	const newConcepts: string[] = [];

	let totalTerms = 0;
	let newTerms = 0;
	let knownTerms = 0;

	// Check entities
	for (const entity of terms.entities) {
		totalTerms++;
		if (vocabulary.entities[entity]) {
			knownTerms++;
		} else {
			newTerms++;
			newEntities.push(entity);
		}
	}

	// Check relationships
	for (const relationship of terms.relationships) {
		totalTerms++;
		if (vocabulary.relationships[relationship]) {
			knownTerms++;
		} else {
			newTerms++;
			newRelationships.push(relationship);
		}
	}

	// Check concepts
	for (const concept of terms.concepts) {
		totalTerms++;
		if (vocabulary.concepts[concept]) {
			knownTerms++;
		} else {
			newTerms++;
			newConcepts.push(concept);
		}
	}

	const noveltyRate = totalTerms > 0 ? newTerms / totalTerms : 0;
	const recognitionRate = totalTerms > 0 ? knownTerms / totalTerms : 0;

	return {
		total_terms: totalTerms,
		new_terms: newTerms,
		known_terms: knownTerms,
		novelty_rate: noveltyRate,
		recognition_rate: recognitionRate,
		new_term_list: {
			entities: newEntities,
			relationships: newRelationships,
			concepts: newConcepts,
		},
	};
}

/**
 * Get top N most frequent terms from a category
 */
export function getTopFrequent(frequencyMap: FrequencyMap, limit: number = 10): FrequentTerm[] {
	return Object.entries(frequencyMap)
		.map(([term, count]) => ({ term, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit);
}

/**
 * Get total vocabulary size across all categories
 */
export function getTotalVocabularySize(vocabulary: Vocabulary): number {
	return (
		Object.keys(vocabulary.entities).length +
		Object.keys(vocabulary.relationships).length +
		Object.keys(vocabulary.concepts).length
	);
}

/**
 * Calculate vocabulary growth from new terms
 */
export function calculateVocabularyGrowth(
	oldSize: number,
	newSize: number
): { growth: number; growthRate: number } {
	const growth = newSize - oldSize;
	const growthRate = oldSize > 0 ? growth / oldSize : 0;
	return { growth, growthRate };
}
