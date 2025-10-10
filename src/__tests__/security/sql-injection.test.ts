/**
 * SQL Injection Prevention Tests
 *
 * This test suite validates that the batch storage system is protected
 * against SQL injection attacks through various attack vectors.
 */

import { Decimal } from '@prisma/client/runtime/library';
import { db } from '~/shared/database/client.js';
import { batchStoreKnowledge } from '~/shared/database/batch-storage.js';
import type { Triple } from '~/shared/types/core.js';

describe('SQL Injection Prevention', () => {
	// Helper function to create a valid embedding array
	const createEmbedding = (): number[] => Array(1536).fill(0.1);

	// Helper function to create embedding map for a triple
	const createEmbeddingMap = (triple: Triple): Map<string, number[]> => {
		const map = new Map<string, number[]>();
		map.set(triple.subject, createEmbedding());
		map.set(triple.predicate, createEmbedding());
		map.set(triple.object, createEmbedding());
		map.set(`${triple.subject} ${triple.predicate} ${triple.object}`, createEmbedding());
		return map;
	};

	// Helper function to create a test triple with proper types
	const createTestTriple = (subject: string, predicate: string, object: string): Triple => ({
		subject,
		predicate,
		object,
		type: 'ENTITY_ENTITY',
		source: 'security-test',
		source_type: 'test',
		source_date: null,
		extracted_at: new Date(),
		extraction_stage: null,
		confidence: new Decimal(0.9),
	});

	afterEach(async () => {
		// Clean up test data
		await db.vectorEmbedding.deleteMany({
			where: {
				knowledge_triple: {
					source: 'security-test',
				},
			},
		});
		await db.knowledgeTriple.deleteMany({
			where: { source: 'security-test' },
		});
	});

	afterAll(async () => {
		await db.$disconnect();
	});

	it('should safely handle SQL injection attempt with DROP TABLE', async () => {
		const maliciousTriple = createTestTriple(
			"'; DROP TABLE vector_embeddings; --",
			'contains',
			'malicious code'
		);

		const result = await batchStoreKnowledge({
			triples: [maliciousTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(maliciousTriple),
		});

		expect(result.success).toBe(true);

		// Verify table still exists and data was stored as literal text
		const count = await db.vectorEmbedding.count();
		expect(count).toBeGreaterThanOrEqual(0);

		// Verify the malicious string was stored as literal text
		const vectors = await db.vectorEmbedding.findMany({
			where: {
				knowledge_triple: {
					source: 'security-test',
				},
			},
		});

		const entityVector = vectors.find(v => v.text === "'; DROP TABLE vector_embeddings; --");
		expect(entityVector).toBeDefined();
	});

	it('should safely handle SQL injection with UNION SELECT', async () => {
		const maliciousTriple = createTestTriple(
			"test' UNION SELECT * FROM users; --",
			'contains',
			'data'
		);

		const result = await batchStoreKnowledge({
			triples: [maliciousTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(maliciousTriple),
		});

		expect(result.success).toBe(true);

		// Verify the malicious string was stored as literal text
		const vectors = await db.vectorEmbedding.findMany({
			where: {
				text: "test' UNION SELECT * FROM users; --",
			},
		});
		expect(vectors.length).toBeGreaterThan(0);
	});

	it('should safely handle unicode exploits and control characters', async () => {
		const unicodeTriple = createTestTriple(
			'test\u202E\u2066\u2067',
			'contains',
			'unicode\x00null'
		);

		const result = await batchStoreKnowledge({
			triples: [unicodeTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(unicodeTriple),
		});

		// Should succeed - sanitization removes dangerous control characters
		expect(result.success).toBe(true);
	});

	it('should safely handle nested quotes and escape sequences', async () => {
		const quotesTriple = createTestTriple(
			`Alice's "special" friend`,
			`said "it's working"`,
			`She said: "It's Bob's turn"`
		);

		const result = await batchStoreKnowledge({
			triples: [quotesTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(quotesTriple),
		});

		expect(result.success).toBe(true);

		// Verify quotes were stored correctly
		const triple = await db.knowledgeTriple.findFirst({
			where: {
				source: 'security-test',
				subject: `Alice's "special" friend`,
			},
		});
		expect(triple).toBeDefined();
		expect(triple?.predicate).toBe(`said "it's working"`);
	});

	it('should safely handle SQL keywords in text', async () => {
		const sqlKeywordsTriple = createTestTriple(
			'SELECT INSERT UPDATE DELETE',
			'FROM WHERE JOIN',
			'CREATE DROP ALTER'
		);

		const result = await batchStoreKnowledge({
			triples: [sqlKeywordsTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(sqlKeywordsTriple),
		});

		expect(result.success).toBe(true);

		// Verify SQL keywords stored as literal text
		const triple = await db.knowledgeTriple.findFirst({
			where: {
				source: 'security-test',
				subject: 'SELECT INSERT UPDATE DELETE',
			},
		});
		expect(triple).toBeDefined();
	});

	it('should safely handle backslashes and escape characters', async () => {
		const backslashTriple = createTestTriple(
			'test\\nbackslash\\tescapes',
			'contains\\r\\n',
			'escape\\\\sequences'
		);

		const result = await batchStoreKnowledge({
			triples: [backslashTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(backslashTriple),
		});

		expect(result.success).toBe(true);
	});

	it('should safely handle semicolons and statement terminators', async () => {
		const semicolonTriple = createTestTriple(
			'test; DELETE FROM users;',
			'contains; DROP DATABASE;',
			'data; TRUNCATE TABLE;'
		);

		const result = await batchStoreKnowledge({
			triples: [semicolonTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: createEmbeddingMap(semicolonTriple),
		});

		expect(result.success).toBe(true);

		// Verify semicolons stored as literal text
		const vectors = await db.vectorEmbedding.findMany({
			where: {
				text: 'test; DELETE FROM users;',
			},
		});
		expect(vectors.length).toBeGreaterThan(0);
	});

	it('should handle batch of mixed safe and malicious triples', async () => {
		const triples: Triple[] = [
			createTestTriple('Normal Entity', 'relates to', 'Another Entity'),
			createTestTriple("'; DROP TABLE users; --", 'malicious', 'injection'),
			createTestTriple('Safe Entity', 'is safe', 'Very Safe'),
		];

		const embeddingMap = new Map<string, number[]>();
		for (const triple of triples) {
			const tripleMap = createEmbeddingMap(triple);
			for (const [key, value] of tripleMap.entries()) {
				embeddingMap.set(key, value);
			}
		}

		const result = await batchStoreKnowledge({
			triples,
			concepts: [],
			conceptualizations: [],
			embeddingMap,
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.triplesStored).toBe(3);
		}

		// Verify all triples were stored correctly
		const storedTriples = await db.knowledgeTriple.findMany({
			where: { source: 'security-test' },
		});
		expect(storedTriples.length).toBe(3);
	});

	it('should reject invalid embedding dimensions', async () => {
		const validTriple = createTestTriple('Valid Entity', 'relates to', 'Another Entity');

		// Create embedding with wrong dimension
		const invalidEmbeddingMap = new Map<string, number[]>();
		invalidEmbeddingMap.set(validTriple.subject, Array(512).fill(0.1)); // Wrong dimension

		const result = await batchStoreKnowledge({
			triples: [validTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: invalidEmbeddingMap,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.type).toBe('INPUT_VALIDATION_ERROR');
		}
	});

	it('should reject non-numeric embedding values', async () => {
		const validTriple = createTestTriple('Valid Entity', 'relates to', 'Another Entity');

		// Create embedding with invalid values
		const invalidEmbeddingMap = new Map<string, number[]>();
		const invalidEmbedding = Array(1536).fill(0.1);
		invalidEmbedding[0] = NaN; // Invalid value
		invalidEmbeddingMap.set(validTriple.subject, invalidEmbedding);

		const result = await batchStoreKnowledge({
			triples: [validTriple],
			concepts: [],
			conceptualizations: [],
			embeddingMap: invalidEmbeddingMap,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.type).toBe('INPUT_VALIDATION_ERROR');
		}
	});
});
