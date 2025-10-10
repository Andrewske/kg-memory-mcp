/**
 * Unit tests for vocabulary tracking functionality
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type ConceptNode, type KnowledgeTriple } from '@prisma/client';
import {
	normalizeTerm,
	extractTerms,
	updateVocabulary,
	loadVocabulary,
	saveVocabulary,
	analyzeNovelty,
	getTopFrequent,
	getTotalVocabularySize,
	calculateVocabularyGrowth,
	createVocabularyBackup,
	type Vocabulary,
	type ExtractedTerms,
} from '../vocabulary-tracker.js';

// Mock data helpers
function createMockTriple(
	subject: string,
	predicate: string,
	object: string
): Partial<KnowledgeTriple> {
	return {
		id: 'test-id',
		subject,
		predicate,
		object,
		type: 'ENTITY_ENTITY',
		confidence: new Prisma.Decimal(0.9),
		source: 'test',
		source_type: 'test',
		extracted_at: new Date(),
	};
}

function createMockConcept(concept: string): Partial<ConceptNode> {
	return {
		id: 'test-concept-id',
		concept,
		abstraction_level: 'HIGH',
		confidence: new Prisma.Decimal(0.9),
		source: 'test',
		source_type: 'test',
		extracted_at: new Date(),
	};
}

describe('Vocabulary Tracker', () => {
	const testVocabPath = 'benchmarks/test-vocabulary.json';
	const fullPath = path.join(process.cwd(), testVocabPath);

	beforeEach(async () => {
		// Clean up test vocabulary file before each test
		try {
			await fs.unlink(fullPath);
		} catch {
			// File might not exist
		}

		// Clean up backups
		const dir = path.dirname(fullPath);
		try {
			const files = await fs.readdir(dir);
			const backupFiles = files.filter(f => f.includes('.backup.'));
			await Promise.all(backupFiles.map(f => fs.unlink(path.join(dir, f))));
		} catch {
			// Directory might not exist
		}
	});

	afterEach(async () => {
		// Clean up test vocabulary file after each test
		try {
			await fs.unlink(fullPath);
		} catch {
			// File might not exist
		}

		// Clean up backups
		const dir = path.dirname(fullPath);
		try {
			const files = await fs.readdir(dir);
			const backupFiles = files.filter(f => f.includes('.backup.'));
			await Promise.all(backupFiles.map(f => fs.unlink(path.join(dir, f))));
		} catch {
			// Directory might not exist
		}
	});

	describe('normalizeTerm', () => {
		it('should convert to lowercase', () => {
			expect(normalizeTerm('Work Life Balance')).toBe('work_life_balance');
			expect(normalizeTerm('WORK LIFE BALANCE')).toBe('work_life_balance');
			expect(normalizeTerm('WoRk LiFe BaLaNcE')).toBe('work_life_balance');
		});

		it('should replace spaces with underscores', () => {
			expect(normalizeTerm('work life balance')).toBe('work_life_balance');
			expect(normalizeTerm('alice and bob')).toBe('alice_and_bob');
		});

		it('should replace hyphens with underscores', () => {
			expect(normalizeTerm('work-life-balance')).toBe('work_life_balance');
			expect(normalizeTerm('post-traumatic-stress')).toBe('post_traumatic_stress');
		});

		it('should handle mixed spaces and hyphens', () => {
			expect(normalizeTerm('work-life balance')).toBe('work_life_balance');
			expect(normalizeTerm('post traumatic-stress')).toBe('post_traumatic_stress');
		});

		it('should collapse multiple underscores', () => {
			expect(normalizeTerm('work   life   balance')).toBe('work_life_balance');
			expect(normalizeTerm('work---life---balance')).toBe('work_life_balance');
		});

		it('should trim whitespace', () => {
			expect(normalizeTerm('  work life balance  ')).toBe('work_life_balance');
			expect(normalizeTerm('\twork life balance\t')).toBe('work_life_balance');
		});

		it('should remove leading/trailing underscores', () => {
			expect(normalizeTerm('_work life balance_')).toBe('work_life_balance');
			expect(normalizeTerm('-work life balance-')).toBe('work_life_balance');
		});

		it('should handle single words', () => {
			expect(normalizeTerm('Alice')).toBe('alice');
			expect(normalizeTerm('Work')).toBe('work');
		});

		it('should handle empty strings', () => {
			expect(normalizeTerm('')).toBe('');
			expect(normalizeTerm('   ')).toBe('');
		});
	});

	describe('extractTerms', () => {
		it('should extract entities from triples', () => {
			const triples = [
				createMockTriple('Alice', 'knows', 'Bob'),
				createMockTriple('Bob', 'works_at', 'Company'),
			] as KnowledgeTriple[];

			const terms = extractTerms(triples, []);

			expect(terms.entities).toContain('alice');
			expect(terms.entities).toContain('bob');
			expect(terms.entities).toContain('company');
		});

		it('should extract relationships from triples', () => {
			const triples = [
				createMockTriple('Alice', 'knows', 'Bob'),
				createMockTriple('Bob', 'works_at', 'Company'),
			] as KnowledgeTriple[];

			const terms = extractTerms(triples, []);

			expect(terms.relationships).toContain('knows');
			expect(terms.relationships).toContain('works_at');
		});

		it('should extract concepts', () => {
			const concepts = [
				createMockConcept('Family Dynamics'),
				createMockConcept('Work Life Balance'),
			] as ConceptNode[];

			const terms = extractTerms([], concepts);

			expect(terms.concepts).toContain('family_dynamics');
			expect(terms.concepts).toContain('work_life_balance');
		});

		it('should extract unique terms only', () => {
			const triples = [
				createMockTriple('Alice', 'knows', 'Bob'),
				createMockTriple('Alice', 'works_with', 'Bob'),
				createMockTriple('Bob', 'knows', 'Alice'),
			] as KnowledgeTriple[];

			const terms = extractTerms(triples, []);

			// Should have unique entities
			const aliceCount = terms.entities.filter(e => e === 'alice').length;
			const bobCount = terms.entities.filter(e => e === 'bob').length;

			expect(aliceCount).toBe(1);
			expect(bobCount).toBe(1);
		});

		it('should normalize extracted terms', () => {
			const triples = [
				createMockTriple('Work Life Balance', 'is', 'Important'),
			] as KnowledgeTriple[];

			const terms = extractTerms(triples, []);

			expect(terms.entities).toContain('work_life_balance');
			expect(terms.entities).toContain('important');
		});

		it('should handle empty inputs', () => {
			const terms = extractTerms([], []);

			expect(terms.entities).toEqual([]);
			expect(terms.relationships).toEqual([]);
			expect(terms.concepts).toEqual([]);
		});
	});

	describe('updateVocabulary', () => {
		it('should increment frequency counts for new terms', () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 0,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: ['alice', 'bob'],
				relationships: ['knows'],
				concepts: ['social_network'],
			};

			const updated = updateVocabulary(vocab, terms);

			expect(updated.entities['alice']).toBe(1);
			expect(updated.entities['bob']).toBe(1);
			expect(updated.relationships['knows']).toBe(1);
			expect(updated.concepts['social_network']).toBe(1);
		});

		it('should increment frequency counts for existing terms', () => {
			const vocab: Vocabulary = {
				entities: { alice: 5, bob: 3 },
				relationships: { knows: 10 },
				concepts: { social_network: 2 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: ['alice', 'bob'],
				relationships: ['knows'],
				concepts: ['social_network'],
			};

			const updated = updateVocabulary(vocab, terms);

			expect(updated.entities['alice']).toBe(6);
			expect(updated.entities['bob']).toBe(4);
			expect(updated.relationships['knows']).toBe(11);
			expect(updated.concepts['social_network']).toBe(3);
		});

		it('should increment run count', () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 5,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: ['alice'],
				relationships: ['knows'],
				concepts: ['social_network'],
			};

			const updated = updateVocabulary(vocab, terms);

			expect(updated.metadata.total_runs).toBe(6);
		});

		it('should handle empty terms', () => {
			const vocab: Vocabulary = {
				entities: { alice: 5 },
				relationships: { knows: 10 },
				concepts: { social_network: 2 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: [],
				relationships: [],
				concepts: [],
			};

			const updated = updateVocabulary(vocab, terms);

			// Should still increment run count
			expect(updated.metadata.total_runs).toBe(11);
			// Should not change existing counts
			expect(updated.entities['alice']).toBe(5);
		});
	});

	describe('loadVocabulary and saveVocabulary', () => {
		it('should save and load vocabulary correctly', async () => {
			const vocab: Vocabulary = {
				entities: { alice: 5, bob: 3 },
				relationships: { knows: 10 },
				concepts: { social_network: 2 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			await saveVocabulary(vocab, testVocabPath, false);
			const loaded = await loadVocabulary(testVocabPath, 'gpt-4o-mini', 'openai');

			expect(loaded.entities).toEqual(vocab.entities);
			expect(loaded.relationships).toEqual(vocab.relationships);
			expect(loaded.concepts).toEqual(vocab.concepts);
			expect(loaded.metadata.total_runs).toBe(vocab.metadata.total_runs);
		});

		it('should create empty vocabulary if file does not exist', async () => {
			const loaded = await loadVocabulary(testVocabPath, 'gpt-4o-mini', 'openai');

			expect(loaded.entities).toEqual({});
			expect(loaded.relationships).toEqual({});
			expect(loaded.concepts).toEqual({});
			expect(loaded.metadata.total_runs).toBe(0);
			expect(loaded.metadata.model).toBe('gpt-4o-mini');
			expect(loaded.metadata.provider).toBe('openai');
		});

		it('should update last_updated timestamp on save', async () => {
			const vocab: Vocabulary = {
				entities: { alice: 5 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 10,
					last_updated: '2025-01-01T00:00:00.000Z',
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			await saveVocabulary(vocab, testVocabPath, false);
			const loaded = await loadVocabulary(testVocabPath, 'gpt-4o-mini', 'openai');

			// last_updated should be newer than the original
			expect(new Date(loaded.metadata.last_updated).getTime()).toBeGreaterThan(
				new Date('2025-01-01T00:00:00.000Z').getTime()
			);
		});
	});

	describe('createVocabularyBackup', () => {
		it('should create backup file with timestamp', async () => {
			const vocab: Vocabulary = {
				entities: { alice: 5 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			await saveVocabulary(vocab, testVocabPath, false);
			await createVocabularyBackup(testVocabPath, 10);

			const dir = path.dirname(fullPath);
			const files = await fs.readdir(dir);
			const backupFiles = files.filter(f => f.includes('.backup.'));

			expect(backupFiles.length).toBe(1);
			expect(backupFiles[0]).toMatch(/test-vocabulary\.backup\..+\.json/);
		});

		it('should rotate old backups', async () => {
			const vocab: Vocabulary = {
				entities: { alice: 5 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 1,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			await saveVocabulary(vocab, testVocabPath, false);

			// Create 15 backups
			for (let i = 0; i < 15; i++) {
				await createVocabularyBackup(testVocabPath, 10);
				// Small delay to ensure different timestamps
				await new Promise(resolve => setTimeout(resolve, 10));
			}

			const dir = path.dirname(fullPath);
			const files = await fs.readdir(dir);
			const backupFiles = files.filter(f => f.includes('.backup.'));

			// Should keep only 10 most recent
			expect(backupFiles.length).toBe(10);
		});

		it('should not error if vocabulary file does not exist', async () => {
			await expect(createVocabularyBackup(testVocabPath, 10)).resolves.toBeUndefined();
		});
	});

	describe('analyzeNovelty', () => {
		it('should identify new terms', () => {
			const vocab: Vocabulary = {
				entities: { alice: 5, bob: 3 },
				relationships: { knows: 10 },
				concepts: { social_network: 2 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: ['alice', 'charlie'], // charlie is new
				relationships: ['knows', 'works_with'], // works_with is new
				concepts: ['social_network', 'professional_network'], // professional_network is new
			};

			const analysis = analyzeNovelty(vocab, terms);

			expect(analysis.total_terms).toBe(6);
			expect(analysis.new_terms).toBe(3);
			expect(analysis.known_terms).toBe(3);
			expect(analysis.novelty_rate).toBeCloseTo(0.5);
			expect(analysis.recognition_rate).toBeCloseTo(0.5);
			expect(analysis.new_term_list.entities).toContain('charlie');
			expect(analysis.new_term_list.relationships).toContain('works_with');
			expect(analysis.new_term_list.concepts).toContain('professional_network');
		});

		it('should handle all new terms', () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 0,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: ['alice'],
				relationships: ['knows'],
				concepts: ['social_network'],
			};

			const analysis = analyzeNovelty(vocab, terms);

			expect(analysis.total_terms).toBe(3);
			expect(analysis.new_terms).toBe(3);
			expect(analysis.known_terms).toBe(0);
			expect(analysis.novelty_rate).toBe(1);
			expect(analysis.recognition_rate).toBe(0);
		});

		it('should handle all known terms', () => {
			const vocab: Vocabulary = {
				entities: { alice: 5 },
				relationships: { knows: 10 },
				concepts: { social_network: 2 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: ['alice'],
				relationships: ['knows'],
				concepts: ['social_network'],
			};

			const analysis = analyzeNovelty(vocab, terms);

			expect(analysis.total_terms).toBe(3);
			expect(analysis.new_terms).toBe(0);
			expect(analysis.known_terms).toBe(3);
			expect(analysis.novelty_rate).toBe(0);
			expect(analysis.recognition_rate).toBe(1);
		});

		it('should handle empty terms', () => {
			const vocab: Vocabulary = {
				entities: { alice: 5 },
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const terms: ExtractedTerms = {
				entities: [],
				relationships: [],
				concepts: [],
			};

			const analysis = analyzeNovelty(vocab, terms);

			expect(analysis.total_terms).toBe(0);
			expect(analysis.new_terms).toBe(0);
			expect(analysis.known_terms).toBe(0);
			expect(analysis.novelty_rate).toBe(0);
			expect(analysis.recognition_rate).toBe(0);
		});
	});

	describe('getTopFrequent', () => {
		it('should return top N most frequent terms', () => {
			const frequencyMap = {
				alice: 10,
				bob: 5,
				charlie: 15,
				david: 3,
				eve: 20,
			};

			const top3 = getTopFrequent(frequencyMap, 3);

			expect(top3.length).toBe(3);
			expect(top3[0]).toEqual({ term: 'eve', count: 20 });
			expect(top3[1]).toEqual({ term: 'charlie', count: 15 });
			expect(top3[2]).toEqual({ term: 'alice', count: 10 });
		});

		it('should return all terms if limit exceeds map size', () => {
			const frequencyMap = {
				alice: 10,
				bob: 5,
			};

			const top10 = getTopFrequent(frequencyMap, 10);

			expect(top10.length).toBe(2);
		});

		it('should handle empty frequency map', () => {
			const top10 = getTopFrequent({}, 10);
			expect(top10).toEqual([]);
		});
	});

	describe('getTotalVocabularySize', () => {
		it('should calculate total size across all categories', () => {
			const vocab: Vocabulary = {
				entities: { alice: 5, bob: 3, charlie: 2 },
				relationships: { knows: 10, works_with: 5 },
				concepts: { social_network: 2 },
				metadata: {
					total_runs: 10,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const size = getTotalVocabularySize(vocab);
			expect(size).toBe(6); // 3 entities + 2 relationships + 1 concept
		});

		it('should return 0 for empty vocabulary', () => {
			const vocab: Vocabulary = {
				entities: {},
				relationships: {},
				concepts: {},
				metadata: {
					total_runs: 0,
					last_updated: new Date().toISOString(),
					model: 'gpt-4o-mini',
					provider: 'openai',
				},
			};

			const size = getTotalVocabularySize(vocab);
			expect(size).toBe(0);
		});
	});

	describe('calculateVocabularyGrowth', () => {
		it('should calculate growth and growth rate', () => {
			const result = calculateVocabularyGrowth(100, 120);

			expect(result.growth).toBe(20);
			expect(result.growthRate).toBe(0.2); // 20% growth
		});

		it('should handle zero growth', () => {
			const result = calculateVocabularyGrowth(100, 100);

			expect(result.growth).toBe(0);
			expect(result.growthRate).toBe(0);
		});

		it('should handle negative growth', () => {
			const result = calculateVocabularyGrowth(100, 80);

			expect(result.growth).toBe(-20);
			expect(result.growthRate).toBe(-0.2); // -20% growth
		});

		it('should handle growth from zero', () => {
			const result = calculateVocabularyGrowth(0, 50);

			expect(result.growth).toBe(50);
			expect(result.growthRate).toBe(0); // Can't calculate rate from zero
		});
	});
});
