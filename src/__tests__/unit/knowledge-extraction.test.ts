/**
 * Unit tests for knowledge extraction functions
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('~/shared/services/ai-provider-service.js');
vi.mock('~/shared/utils/retry-mechanism.js');
vi.mock('~/shared/utils/token-tracking.js');
vi.mock('~/features/conceptualization/conceptualize.js');
vi.mock('~/shared/env.js');

import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import { env } from '~/shared/env.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { retryAIOperation, withCircuitBreaker } from '~/shared/utils/retry-mechanism.js';
import { trackTokenUsage } from '~/shared/utils/token-tracking.js';
import { errorScenarios, mockAIExtractions, testTexts } from '../fixtures/test-data.js';
import {
	createMockAIProvider,
	createSuccessResult,
	createTestArgs,
	mockEnv,
} from '../helpers/mock-factories.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

// Simple valid response that works for all extraction stages
const SIMPLE_VALID_RESPONSE = JSON.stringify({
	triples: [
		{
			subject: 'Test Subject',
			predicate: 'test predicate',
			object: 'Test Object',
			confidence: 0.9,
		},
	],
});

const SIMPLE_USAGE = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

describe('Knowledge Extraction', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockAIProvider = createMockAIProvider();

		// Setup mocks
		(createAIProvider as vi.Mock).mockReturnValue(mockAIProvider);
		Object.assign(env, { ...mockEnv });
		(trackTokenUsage as vi.Mock).mockImplementation(usage => usage);

		// Mock retry mechanism to pass through function calls
		(retryAIOperation as vi.MockedFunction<typeof retryAIOperation>).mockImplementation(
			async <T>(fn: () => Promise<T>) => await fn()
		);
		(withCircuitBreaker as vi.MockedFunction<typeof withCircuitBreaker>).mockImplementation(
			async <T>(fn: () => Promise<T>) => await fn()
		);
	});

	describe('extractKnowledgeTriples', () => {
		it('should extract triples using four-stage method', async () => {
			const args = createTestArgs({ text: testTexts.medium });

			// Mock successful responses for all four stages
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEntity.response,
						usage: mockAIExtractions.fourStage.entityEntity.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEvent.response,
						usage: mockAIExtractions.fourStage.entityEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.eventEvent.response,
						usage: mockAIExtractions.fourStage.eventEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.emotionalContext.response,
						usage: mockAIExtractions.fourStage.emotionalContext.usage,
					})
				);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(mockAIProvider.generateText).toHaveBeenCalledTimes(4);

			// Verify all triple types are extracted
			const triples = result.data?.triples || [];
			expect(triples.some(t => t.type === 'ENTITY_ENTITY')).toBe(true);
			expect(triples.some(t => t.type === 'ENTITY_EVENT')).toBe(true);
			expect(triples.some(t => t.type === 'EVENT_EVENT')).toBe(true);
			expect(triples.some(t => t.type === 'EMOTIONAL_CONTEXT')).toBe(true);
		});

		it('should handle malformed JSON responses gracefully', async () => {
			const args = createTestArgs();

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: errorScenarios.malformedJSON.response,
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(false);
			expect(result.error?.type).toBe('EXTRACTION_ERROR');
			expect(result.error?.message).toContain('Failed to extract knowledge');
		});

		it('should clean markdown formatting from responses', async () => {
			const args = createTestArgs();

			const markdownResponse = `\`\`\`json\n${SIMPLE_VALID_RESPONSE}\n\`\`\``;
			// All 4 stages will get the same markdown-wrapped response
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: markdownResponse,
					usage: SIMPLE_USAGE,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(result.data?.triples).toBeDefined();
			// Should have 4 triples (one from each stage)
			expect(result.data?.triples.length).toBe(4);
		});

		it('should filter out empty triples before validation', async () => {
			const args = createTestArgs();

			const responseWithEmptyTriples = JSON.stringify({
				triples: [
					{
						subject: 'John Smith',
						predicate: 'works at',
						object: 'Tech Corp',
						confidence: 0.9,
						semantic_content: 'John Smith works at Tech Corp',
						type: 'ENTITY_ENTITY',
						source_context: 'Employment',
					},
					{
						subject: '',
						predicate: 'invalid',
						object: '',
						confidence: 0.5,
						semantic_content: '',
						type: 'ENTITY_ENTITY',
						source_context: 'Invalid',
					},
				],
			});

			// All 4 stages get the same response with mixed valid/invalid triples
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: responseWithEmptyTriples,
					usage: SIMPLE_USAGE,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			// Each of 4 stages filters out the empty triple, keeping only the valid one
			expect(result.data?.triples).toHaveLength(4);
			expect(result.data?.triples[0].subject).toBe('John Smith');
		});

		it('should use retry mechanism for AI operations', async () => {
			const args = createTestArgs();

			(retryAIOperation as vi.MockedFunction<typeof retryAIOperation>).mockImplementation(
				async <T>(
					operation: () => Promise<T>,
					operationName: string,
					customOptions?: Partial<any>
				) => {
					expect(operationName).toContain('extraction_');
					expect(customOptions?.maxRetries).toBe(2);
					return await operation();
				}
			);

			// All 4 stages use the retry mechanism
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: SIMPLE_VALID_RESPONSE,
					usage: SIMPLE_USAGE,
				})
			);

			await extractKnowledgeTriples(args);

			// Should be called 4 times (once per stage)
			expect(retryAIOperation).toHaveBeenCalledTimes(4);
		});

		it('should use circuit breaker for AI operations', async () => {
			const args = createTestArgs();

			(withCircuitBreaker as vi.MockedFunction<typeof withCircuitBreaker>).mockImplementation(
				async <T>(
					fn: () => Promise<T>,
					operationKey: string,
					options?: { failureThreshold: number; timeout: number; resetTimeout: number }
				) => {
					expect(operationKey).toContain(`text_extraction_${args.source}`);
					expect(options?.failureThreshold).toBe(3);
					expect(options?.timeout).toBe(45000);
					return await fn();
				}
			);

			// All 4 stages use the circuit breaker
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: SIMPLE_VALID_RESPONSE,
					usage: SIMPLE_USAGE,
				})
			);

			await extractKnowledgeTriples(args);

			// Should be called 4 times (once per stage)
			expect(withCircuitBreaker).toHaveBeenCalledTimes(4);
		});

		it('should track token usage correctly', async () => {
			const args = createTestArgs();

			// Mock responses for all four extraction stages
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEntity.response,
						usage: mockAIExtractions.fourStage.entityEntity.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEvent.response,
						usage: mockAIExtractions.fourStage.entityEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.eventEvent.response,
						usage: mockAIExtractions.fourStage.eventEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.emotionalContext.response,
						usage: mockAIExtractions.fourStage.emotionalContext.usage,
					})
				);

			await extractKnowledgeTriples(args);

			// Should track token usage for each of the 4 extraction stages
			expect(trackTokenUsage).toHaveBeenCalledTimes(4);
			// Verify the structure of token tracking calls
			const tokenTrackingCalls = (trackTokenUsage as vi.Mock).mock.calls;
			expect(tokenTrackingCalls.length).toBe(4);
			// Each call should have the result data (with 'data' and 'usage' fields) and context
			tokenTrackingCalls.forEach((call: any[]) => {
				expect(call[0]).toHaveProperty('data'); // Raw JSON response
				expect(call[0]).toHaveProperty('usage');
				expect(call[0].usage).toMatchObject({
					promptTokens: expect.any(Number),
					completionTokens: expect.any(Number),
					totalTokens: expect.any(Number),
				});
				expect(call[1]).toMatchObject({
					source: 'test-source',
					source_type: 'test',
					operation_type: 'extraction',
					operation_context: expect.objectContaining({
						extraction_method: 'four-stage',
						extraction_optimization: 'text_generation',
					}),
				});
			});
		});

		it('should handle AI provider failures gracefully', async () => {
			const args = createTestArgs();

			mockAIProvider.generateText.mockRejectedValue(new Error('AI service unavailable'));

			// Mock retry mechanism to propagate the error for all stages
			(retryAIOperation as vi.MockedFunction<typeof retryAIOperation>).mockImplementation(
				async <_T>() => {
					throw new Error('AI service unavailable');
				}
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(false);
			// Error is wrapped by extractKnowledgeTriples
			expect(result.error?.message).toContain('Failed to extract knowledge');
		});

		it('should generate concepts from extracted elements', async () => {
			const args = createTestArgs();

			// Mock four-stage extraction responses
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEntity.response,
						usage: mockAIExtractions.fourStage.entityEntity.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEvent.response,
						usage: mockAIExtractions.fourStage.entityEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.eventEvent.response,
						usage: mockAIExtractions.fourStage.eventEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.emotionalContext.response,
						usage: mockAIExtractions.fourStage.emotionalContext.usage,
					})
				);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(result.data?.concepts).toBeDefined();
			// Concepts are now empty in extraction stage (generated separately)
			expect(result.data?.concepts).toEqual([]);
		});

		it('should handle partial extraction failures in four-stage mode', async () => {
			const args = createTestArgs();

			// Mock successful responses for all stages
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: SIMPLE_VALID_RESPONSE,
					usage: SIMPLE_USAGE,
				})
			);

			// Mock retry to fail only for ENTITY_EVENT stage
			(retryAIOperation as vi.MockedFunction<typeof retryAIOperation>).mockImplementation(
				async <T>(
					operation: () => Promise<T>,
					operationName: string,
					_customOptions?: Partial<any>
				) => {
					// Fail only for ENTITY_EVENT extraction
					if (operationName.includes('ENTITY_EVENT')) {
						throw new Error('Network timeout');
					}
					// Pass through for all other stages
					return await operation();
				}
			);

			const result = await extractKnowledgeTriples(args);

			// Should still succeed with partial results (3 out of 4 stages succeeded)
			expect(result.success).toBe(true);
			const triples = result.data?.triples || [];
			// Should have 3 triples from 3 successful stages
			expect(triples.length).toBe(3);
			// Each successful stage contributes one triple with its type
			expect(triples.some(t => t.type === 'ENTITY_ENTITY')).toBe(true);
			expect(triples.some(t => t.type === 'EVENT_EVENT')).toBe(true);
			expect(triples.some(t => t.type === 'EMOTIONAL_CONTEXT')).toBe(true);
			// Should not have ENTITY_EVENT triples due to failure
			expect(triples.some(t => t.type === 'ENTITY_EVENT')).toBe(false);
		});

		it('should validate confidence scores are within valid range', async () => {
			const args = createTestArgs();

			const invalidConfidenceResponse = JSON.stringify({
				triples: [
					{
						subject: 'John Smith',
						predicate: 'works at',
						object: 'Tech Corp',
						confidence: 1.5, // Invalid: > 1.0
						semantic_content: 'John Smith works at Tech Corp',
						type: 'ENTITY_ENTITY',
						source_context: 'Employment',
					},
					{
						subject: 'Tech Corp',
						predicate: 'located in',
						object: 'San Francisco',
						confidence: 0.8, // Valid
						semantic_content: 'Tech Corp is located in San Francisco',
						type: 'ENTITY_ENTITY',
						source_context: 'Location',
					},
				],
			});

			const emptyResponse = JSON.stringify({ triples: [] });

			// Mock four-stage extraction: first stage has invalid confidence, others empty
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: invalidConfidenceResponse,
						usage: mockAIExtractions.singlePass.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: emptyResponse,
						usage: mockAIExtractions.singlePass.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: emptyResponse,
						usage: mockAIExtractions.singlePass.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: emptyResponse,
						usage: mockAIExtractions.singlePass.usage,
					})
				);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			// Should filter out invalid confidence scores during validation
			expect(result.data?.triples).toHaveLength(1);
			// Confidence is stored as Decimal, convert to number for comparison
			const confidenceValue =
				typeof result.data?.triples[0].confidence === 'object'
					? Number(result.data?.triples[0].confidence.toString())
					: result.data?.triples[0].confidence;
			expect(confidenceValue).toBe(0.8);
		});
	});
});
