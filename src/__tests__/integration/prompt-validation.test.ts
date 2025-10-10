/**
 * Integration tests for extraction prompts
 *
 * These tests actually call AI providers to validate that prompts produce valid schema responses.
 * They are EXPENSIVE and should only run when explicitly enabled via ENABLE_AI_INTEGRATION_TESTS=true
 *
 * Usage:
 *   ENABLE_AI_INTEGRATION_TESTS=true pnpm test:integration
 */

import type { TripleType } from '@prisma/client';
import { describe, expect, it } from '@jest/globals';
import { extractByType } from '~/features/knowledge-extraction/extract.js';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';

const INTEGRATION_TESTS_ENABLED = process.env.ENABLE_AI_INTEGRATION_TESTS === 'true';

// Skip all tests in this suite unless explicitly enabled
const describeIfEnabled = INTEGRATION_TESTS_ENABLED ? describe : describe.skip;

/**
 * Helper to create test arguments
 */
function createTestArgs(text: string): ProcessKnowledgeArgs {
	return {
		text,
		source: 'integration-test',
		source_type: 'test',
		source_date: new Date().toISOString(),
	};
}

describeIfEnabled('Prompt Integration Tests (AI-powered)', () => {
	// Increase timeout for AI calls
	jest.setTimeout(30000);

	describe('Entity-Entity Extraction', () => {
		it('should produce valid schema for simple relationships', async () => {
			const text = 'Alice works at TechCorp with Bob. She leads the AI research team.';
			const result = await extractByType(createTestArgs(text), 'ENTITY_ENTITY');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			expect(data).toBeDefined();
			expect(Array.isArray(data)).toBe(true);
			expect(data!.length).toBeGreaterThan(0);

			// Validate schema of first triple
			const triple = data![0];
			expect(triple).toHaveProperty('subject');
			expect(triple).toHaveProperty('predicate');
			expect(triple).toHaveProperty('object');
			expect(triple).toHaveProperty('type');
			expect(triple.type).toBe('ENTITY_ENTITY');

			// Validate field types
			expect(typeof triple.subject).toBe('string');
			expect(typeof triple.predicate).toBe('string');
			expect(typeof triple.object).toBe('string');
			expect(triple.subject.length).toBeGreaterThan(0);
			expect(triple.predicate.length).toBeGreaterThan(0);
			expect(triple.object.length).toBeGreaterThan(0);
		});

		it('should handle complex text with multiple entities', async () => {
			const text = `
        Dr. Sarah Chen is the lead researcher at MIT. She collaborates with
        Dr. James Wilson from Stanford University. Together they published
        groundbreaking findings in Nature journal about neural networks.
      `;
			const result = await extractByType(createTestArgs(text), 'ENTITY_ENTITY');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			expect(data!.length).toBeGreaterThan(2); // Should extract multiple relationships
		});
	});

	describe('Entity-Event Extraction', () => {
		it('should produce valid schema for entity-event relationships', async () => {
			const text = 'Sarah participated in the budget committee meeting. The team completed the Q3 review.';
			const result = await extractByType(createTestArgs(text), 'ENTITY_EVENT');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			expect(data).toBeDefined();
			expect(Array.isArray(data)).toBe(true);
			expect(data!.length).toBeGreaterThan(0);

			const triple = data![0];
			expect(triple.type).toBe('ENTITY_EVENT');
			expect(typeof triple.subject).toBe('string');
			expect(typeof triple.predicate).toBe('string');
			expect(typeof triple.object).toBe('string');
		});
	});

	describe('Event-Event Extraction', () => {
		it('should produce valid schema for event relationships', async () => {
			const text = 'The meeting was postponed due to the storm. After the delay, they rescheduled for next week.';
			const result = await extractByType(createTestArgs(text), 'EVENT_EVENT');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			expect(data).toBeDefined();
			expect(data!.length).toBeGreaterThan(0);

			const triple = data![0];
			expect(triple.type).toBe('EVENT_EVENT');
			expect(typeof triple.predicate).toBe('string');
		});

		it('should capture causal relationships', async () => {
			const text = 'The product launch succeeded, which enabled the company to expand into new markets.';
			const result = await extractByType(createTestArgs(text), 'EVENT_EVENT');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			expect(data!.length).toBeGreaterThan(0);

			// Check that predicates capture causality
			const predicates = data!.map(t => t.predicate.toLowerCase());
			const hasCausalPredicate = predicates.some(
				p =>
					p.includes('caused') ||
					p.includes('enabled') ||
					p.includes('led') ||
					p.includes('resulted')
			);
			expect(hasCausalPredicate).toBe(true);
		});
	});

	describe('Emotional-Context Extraction', () => {
		it('should produce valid schema for emotional states', async () => {
			const text = 'Tom felt overwhelmed by the promotion. The team was anxious about the deadline.';
			const result = await extractByType(createTestArgs(text), 'EMOTIONAL_CONTEXT');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			expect(data).toBeDefined();
			expect(data!.length).toBeGreaterThan(0);

			const triple = data![0];
			expect(triple.type).toBe('EMOTIONAL_CONTEXT');
		});
	});

	describe('Schema Validation', () => {
		const extractionTypes: TripleType[] = [
			'ENTITY_ENTITY',
			'ENTITY_EVENT',
			'EVENT_EVENT',
			'EMOTIONAL_CONTEXT',
		];

		it.each(extractionTypes)(
			'%s prompt should consistently return triples field',
			async extractionType => {
				const text = 'Alice works at TechCorp. She participated in the meeting that succeeded.';

				// Run extraction 3 times to check consistency
				const results = await Promise.all([
					extractByType(createTestArgs(text), extractionType),
					extractByType(createTestArgs(text), extractionType),
					extractByType(createTestArgs(text), extractionType),
				]);

				// All should succeed
				for (const result of results) {
					expect(result.success).toBe(true);
					if (!result.success) continue; // Type guard
					expect(result.data).toBeDefined();
					expect(Array.isArray(result.data)).toBe(true);
				}

				// Schema should be consistent across runs
				for (const result of results) {
					if (result.success && result.data && result.data.length > 0) {
						const triple = result.data[0];
						expect(triple).toHaveProperty('subject');
						expect(triple).toHaveProperty('predicate');
						expect(triple).toHaveProperty('object');
						expect(triple).toHaveProperty('type');
					}
				}
			}
		);

		it('should never return incompatible field names like "relationships"', async () => {
			const text = 'Alice works at TechCorp with Bob.';

			// Test all extraction types
			for (const type of extractionTypes) {
				const result = await extractByType(createTestArgs(text), type);

				// If extraction succeeded, validate it returned proper format
				if (result.success && result.data) {
					expect(Array.isArray(result.data)).toBe(true);

					// Should NOT have these incorrect field names
					expect((result as any).relationships).toBeUndefined();
					expect((result as any).event_relationships).toBeUndefined();
					expect((result as any).emotional_states).toBeUndefined();
				}
			}
		});
	});

	describe('Confidence Scoring', () => {
		it('should include confidence scores in valid range', async () => {
			const text = 'Alice works at TechCorp.';
			const result = await extractByType(createTestArgs(text), 'ENTITY_ENTITY');

			expect(result.success).toBe(true);
			if (!result.success) return; // Type guard

			const data = result.data;
			for (const triple of data!) {
				if (triple.confidence !== null) {
					expect(triple.confidence).toBeGreaterThanOrEqual(0);
					expect(triple.confidence).toBeLessThanOrEqual(1);
				}
			}
		});
	});
});

// Show helpful message when tests are skipped
if (!INTEGRATION_TESTS_ENABLED) {
	describe('Prompt Integration Tests (SKIPPED)', () => {
		it('requires ENABLE_AI_INTEGRATION_TESTS=true to run', () => {
			console.log('\n⚠️  Prompt integration tests are DISABLED');
			console.log('   To run these tests (costs money):');
			console.log('   ENABLE_AI_INTEGRATION_TESTS=true pnpm test:integration\n');
			expect(true).toBe(true); // Dummy assertion
		});
	});
}
