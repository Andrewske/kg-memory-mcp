/**
 * Unit tests for cross-type deduplication fix (DEDUP-001)
 * Tests that triples with identical content but different types are properly deduplicated
 */

import { removeExactDuplicates } from '~/features/deduplication/deduplicate.js';
import type { Triple } from '~/shared/types/core.js';
import type { TripleType } from '@prisma/client';

// Helper to create test triples with all required fields
const createTriple = (
	subject: string,
	predicate: string,
	object: string,
	type: TripleType
): Triple => ({
	subject,
	predicate,
	object,
	type,
	source: 'test',
	source_type: 'test',
	source_date: null,
	extracted_at: new Date(),
	extraction_stage: type,
	confidence: null,
});

describe('Cross-Type Deduplication (DEDUP-001 Fix)', () => {
	it('should remove exact duplicates across different types', () => {
		const triples: Triple[] = [
			createTriple('Mom', 'struggling with', "Dad's retirement", 'ENTITY_ENTITY'),
			createTriple('Mom', 'struggling with', "Dad's retirement", 'EVENT_EVENT'),
			createTriple('Mom', 'struggling with', "Dad's retirement", 'EMOTIONAL_CONTEXT'),
		];

		const result = removeExactDuplicates(triples);

		// Should deduplicate to 1 triple (all three have same content)
		expect(result.uniqueTriples).toHaveLength(1);
		expect(result.duplicatesCount).toBe(2);

		// Verify the kept triple has the correct content
		const kept = result.uniqueTriples[0];
		expect(kept.subject).toBe('Mom');
		expect(kept.predicate).toBe('struggling with');
		expect(kept.object).toBe("Dad's retirement");
	});

	it('should preserve truly different triples even if they share the same type', () => {
		const triples: Triple[] = [
			createTriple('Alice', 'knows', 'Bob', 'ENTITY_ENTITY'),
			createTriple('Alice', 'likes', 'Charlie', 'ENTITY_ENTITY'),
		];

		const result = removeExactDuplicates(triples);

		// Should keep both since they have different content
		expect(result.uniqueTriples).toHaveLength(2);
		expect(result.duplicatesCount).toBe(0);
	});

	it('should handle multiple cross-type duplicate groups', () => {
		const triples: Triple[] = [
			// Group 1: Grandma Helen's hip surgery (appears in 2 types)
			createTriple('Grandma Helen', "can't travel easily due to", 'hip surgery', 'ENTITY_ENTITY'),
			createTriple('Grandma Helen', "can't travel easily due to", 'hip surgery', 'EVENT_EVENT'),
			// Group 2: Claire's postpartum depression (appears in 2 types)
			createTriple('Claire', 'dealing with', 'postpartum depression', 'ENTITY_ENTITY'),
			createTriple('Claire', 'dealing with', 'postpartum depression', 'EMOTIONAL_CONTEXT'),
			// Unique triple
			createTriple('Tom', 'works at', 'TechCorp', 'ENTITY_ENTITY'),
		];

		const result = removeExactDuplicates(triples);

		// Should deduplicate to 3 unique triples (2 groups + 1 unique)
		expect(result.uniqueTriples).toHaveLength(3);
		expect(result.duplicatesCount).toBe(2);

		// Verify we have one of each unique content
		const subjects = result.uniqueTriples.map(t => t.subject).sort();
		expect(subjects).toEqual(['Claire', 'Grandma Helen', 'Tom']);
	});

	it('should handle exact duplicates within the same type', () => {
		const triples: Triple[] = [
			createTriple('John', 'works at', 'Company', 'ENTITY_ENTITY'),
			createTriple('John', 'works at', 'Company', 'ENTITY_ENTITY'),
		];

		const result = removeExactDuplicates(triples);

		// Should deduplicate to 1 triple
		expect(result.uniqueTriples).toHaveLength(1);
		expect(result.duplicatesCount).toBe(1);
	});

	it('should track merged metadata for cross-type duplicates', () => {
		const triples: Triple[] = [
			createTriple('Emma', 'has anxiety around', 'commitment', 'ENTITY_ENTITY'),
			createTriple('Emma', 'has anxiety around', 'commitment', 'EVENT_EVENT'),
			createTriple('Emma', 'has anxiety around', 'commitment', 'EMOTIONAL_CONTEXT'),
		];

		const result = removeExactDuplicates(triples);

		// Should have 2 merge records (3 triples -> 1 unique = 2 merged)
		expect(result.mergedMetadata).toHaveLength(2);
		expect(result.mergedMetadata[0].reason).toBe('exact');
		expect(result.mergedMetadata[1].reason).toBe('exact');
	});

	it('should handle empty triple array', () => {
		const result = removeExactDuplicates([]);

		expect(result.uniqueTriples).toHaveLength(0);
		expect(result.duplicatesCount).toBe(0);
		expect(result.mergedMetadata).toHaveLength(0);
	});

	it('should handle single triple', () => {
		const triples: Triple[] = [
			createTriple('Single', 'test', 'triple', 'ENTITY_ENTITY'),
		];

		const result = removeExactDuplicates(triples);

		expect(result.uniqueTriples).toHaveLength(1);
		expect(result.duplicatesCount).toBe(0);
	});
});
