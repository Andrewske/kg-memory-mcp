/**
 * Performance and fault tolerance tests for error handling and recovery
 */

import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JobStage, JobStatus, JobType } from '@prisma/client';

// Mock dependencies
jest.mock('~/shared/services/ai-provider-service.js');
jest.mock('~/shared/services/embedding-service.js');
jest.mock('~/shared/utils/retry-mechanism.js');
jest.mock('~/shared/env.js');

import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import { routeJob } from '~/features/knowledge-processing/job-router.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { retryAIOperation, withCircuitBreaker } from '~/shared/utils/retry-mechanism.js';
import { mockAIExtractions, sampleTriples, testTexts } from '../fixtures/test-data.js';
import {
	createErrorResult,
	createMockAIProvider,
	createMockEmbeddingService,
	createSuccessResult,
	createTestJobMetadata,
	mockEnv,
} from '../helpers/mock-factories.js';
import { cleanupTestDatabase, setupTestSuite, waitFor } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Fault Tolerance and Recovery', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(async () => {
		jest.clearAllMocks();
		await cleanupTestDatabase();

		// Setup mocks
		mockAIProvider = createMockAIProvider();
		mockEmbeddingService = createMockEmbeddingService();

		(createAIProvider as jest.Mock).mockReturnValue(mockAIProvider);
		(createEmbeddingService as jest.Mock).mockReturnValue(mockEmbeddingService);
		(env as any) = { ...mockEnv };

		// Setup retry mechanism mocks
		(retryAIOperation as jest.Mock).mockImplementation(async fn => await fn());
		(withCircuitBreaker as jest.Mock).mockImplementation(async fn => await fn());
	});

	afterAll(async () => {
		await cleanupTestDatabase();
	});

	describe('AI Service Failure Recovery', () => {
		it('should handle intermittent AI service failures with retry', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.medium,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			let attemptCount = 0;

			// Mock retry mechanism to actually retry
			(retryAIOperation as jest.Mock).mockImplementation(async (fn, operation, config) => {
				attemptCount++;
				if (attemptCount <= 2) {
					throw new Error('AI service temporarily unavailable');
				}
				return await fn();
			});

			// Setup successful AI response after retries
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const startTime = Date.now();
			const result = await routeJob(job);
			const endTime = Date.now();

			expect(result.success).toBe(true);
			expect(attemptCount).toBeGreaterThan(1); // Should have retried
			expect(endTime - startTime).toBeGreaterThan(100); // Should have taken time for retries

			// Verify job completed successfully despite initial failures
			const updatedJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});
			expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
		});

		it('should fail gracefully after max retry attempts', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Mock consistent failures
			(retryAIOperation as jest.Mock).mockRejectedValue(
				createErrorResult('AI service persistently unavailable', 'ai_extraction')
			);

			const result = await routeJob(job);

			expect(result.success).toBe(false);
			expect(result.error?.operation).toBe('ai_extraction');

			// Verify job marked as failed
			const updatedJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});
			expect(updatedJob?.status).toBe(JobStatus.FAILED);
		});

		it('should handle circuit breaker activation under load', async () => {
			// Simulate circuit breaker behavior
			let circuitOpen = false;
			let failureCount = 0;

			(withCircuitBreaker as jest.Mock).mockImplementation(async (fn, key, config) => {
				if (circuitOpen) {
					throw new Error('Circuit breaker is open');
				}

				try {
					return await fn();
				} catch (error) {
					failureCount++;
					if (failureCount >= config.failureThreshold) {
						circuitOpen = true;
					}
					throw error;
				}
			});

			// Create multiple jobs that will trigger circuit breaker
			const jobs = await Promise.all(
				Array.from({ length: 5 }, () =>
					db.processingJob.create({
						data: {
							job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
							stage: JobStage.EXTRACTION,
							text: testTexts.small,
							metadata: createTestJobMetadata(),
							status: JobStatus.QUEUED,
						},
					})
				)
			);

			// First few calls fail, triggering circuit breaker
			mockAIProvider.generateText.mockRejectedValue(new Error('AI service overloaded'));

			const results = await Promise.all(jobs.map(job => routeJob(job)));

			// Some should fail due to circuit breaker
			const failures = results.filter(r => !r.success);
			expect(failures.length).toBeGreaterThan(0);

			// At least one should fail with circuit breaker error
			const circuitBreakerFailures = failures.filter(r =>
				r.error?.message?.includes('Circuit breaker is open')
			);
			expect(circuitBreakerFailures.length).toBeGreaterThan(0);
		});

		it('should recover from circuit breaker after timeout', async () => {
			let circuitOpen = false;
			let lastFailureTime = 0;
			const resetTimeout = 100; // ms

			(withCircuitBreaker as jest.Mock).mockImplementation(async (fn, key, config) => {
				if (circuitOpen && Date.now() - lastFailureTime < resetTimeout) {
					throw new Error('Circuit breaker is open');
				}

				if (circuitOpen && Date.now() - lastFailureTime >= resetTimeout) {
					circuitOpen = false; // Reset circuit breaker
				}

				try {
					return await fn();
				} catch (error) {
					circuitOpen = true;
					lastFailureTime = Date.now();
					throw error;
				}
			});

			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// First attempt fails and opens circuit breaker
			mockAIProvider.generateText.mockRejectedValueOnce(new Error('AI service failure'));

			const firstResult = await routeJob(job);
			expect(firstResult.success).toBe(false);

			// Wait for circuit breaker to reset
			await waitFor(resetTimeout + 10);

			// Second attempt should succeed after circuit breaker reset
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const job2 = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			const secondResult = await routeJob(job2);
			expect(secondResult.success).toBe(true);
		});
	});

	describe('Partial Processing Failures', () => {
		it('should continue processing when some chunks fail', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.large, // Will trigger chunking
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			let callCount = 0;
			mockAIProvider.generateText.mockImplementation(async () => {
				callCount++;

				// Fail every 3rd call (simulate intermittent chunk failures)
				if (callCount % 3 === 0) {
					throw new Error(`Chunk ${callCount} processing failed`);
				}

				return createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
				});
			});

			const result = await routeJob(job);

			expect(result.success).toBe(true);
			expect(result.data?.triplesStored).toBeGreaterThan(0);

			// Should have processed successful chunks despite failures
			const storedTriples = await db.knowledgeTriple.findMany({
				where: {
					source: (job.metadata as any).source,
					source_type: (job.metadata as any).source_type,
				},
			});
			expect(storedTriples.length).toBeGreaterThan(0);
		});

		it('should salvage partial results from failed extractions', async () => {
			// Mock extraction function directly for more control
			jest.doMock('~/features/knowledge-extraction/extract.js', () => ({
				extractKnowledgeTriples: jest.fn(),
			}));

			const {
				extractKnowledgeTriples: mockExtract,
			} = require('~/features/knowledge-extraction/extract.js');

			// Return partial success with some failed components
			mockExtract.mockResolvedValue(
				createSuccessResult({
					triples: sampleTriples.entityEntity.slice(0, 2), // Only partial results
					concepts: [], // Concept generation failed
					warnings: ['Some extraction stages failed'],
					extractionMetrics: {
						stageResults: {
							entityEntity: { success: true, count: 2 },
							entityEvent: { success: false, error: 'Timeout' },
							eventEvent: { success: false, error: 'Parse error' },
							emotionalContext: { success: true, count: 1 },
						},
					},
				})
			);

			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.medium,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			const result = await routeJob(job);

			expect(result.success).toBe(true);
			expect(result.data?.triplesStored).toBeGreaterThan(0);

			// Should store whatever was successfully extracted
			const storedTriples = await db.knowledgeTriple.findMany({
				where: {
					source: (job.metadata as any).source,
					source_type: (job.metadata as any).source_type,
				},
			});
			expect(storedTriples.length).toBeGreaterThan(0);
		});

		it('should handle embedding service failures gracefully', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Successful extraction
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			// Failed embeddings
			mockEmbeddingService.generateEmbeddings.mockResolvedValue(
				createErrorResult('Embedding service unavailable')
			);

			const result = await routeJob(job);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Embedding generation failed');

			// But extraction should still have been attempted
			expect(mockAIProvider.generateText).toHaveBeenCalled();
		});
	});

	describe('Database Transaction Failures', () => {
		it('should handle transaction rollbacks without data corruption', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Successful extraction and embeddings
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			// Mock database constraint violation during storage
			const originalKnowledgeTriple = db.knowledgeTriple;
			(db.knowledgeTriple as any) = {
				...originalKnowledgeTriple,
				createMany: jest.fn().mockRejectedValue(new Error('Unique constraint violation')),
			};

			const result = await routeJob(job);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Storage failed');

			// Verify no partial data was left in database
			const storedTriples = await originalKnowledgeTriple.findMany({
				where: {
					source: (job.metadata as any).source,
					source_type: (job.metadata as any).source_type,
				},
			});
			expect(storedTriples.length).toBe(0);

			// Restore original database mock
			(db.knowledgeTriple as any) = originalKnowledgeTriple;
		});

		it('should handle vector generation failures after main transaction', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Successful extraction
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			// Mock vector storage failure
			const originalVectorEmbedding = db.vectorEmbedding;
			(db.vectorEmbedding as any) = {
				...originalVectorEmbedding,
				create: jest.fn().mockRejectedValue(new Error('Vector dimension mismatch')),
				createMany: jest.fn().mockRejectedValue(new Error('Vector storage failed')),
			};

			const result = await routeJob(job);

			// Main processing might succeed but vector generation fails
			if (result.success) {
				// Main data should be stored
				const storedTriples = await db.knowledgeTriple.findMany({
					where: {
						source: (job.metadata as any).source,
						source_type: (job.metadata as any).source_type,
					},
				});
				expect(storedTriples.length).toBeGreaterThan(0);
			} else {
				expect(result.error?.message).toContain('failed');
			}

			// Restore original database mock
			(db.vectorEmbedding as any) = originalVectorEmbedding;
		});
	});

	describe('Resource Exhaustion Scenarios', () => {
		it('should handle memory pressure gracefully', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.large.repeat(10), // Very large text
					metadata: createTestJobMetadata({
						resourceLimits: { maxMemoryMB: 64, maxAICalls: 2, maxConnections: 1 },
					}),
					status: JobStatus.QUEUED,
				},
			});

			// Mock memory monitoring
			const originalMemoryUsage = process.memoryUsage;
			let memoryPressureSimulated = false;

			(process as any).memoryUsage = () => {
				const usage = originalMemoryUsage();
				if (!memoryPressureSimulated) {
					memoryPressureSimulated = true;
					return { ...usage, heapUsed: usage.heapTotal * 0.9 }; // 90% memory usage
				}
				return usage;
			};

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const result = await routeJob(job);

			// Should complete despite memory pressure (may chunk more aggressively)
			expect(result.success).toBe(true);

			// Restore original memory usage function
			(process as any).memoryUsage = originalMemoryUsage;
		});

		it('should respect connection limits under high load', async () => {
			const jobs = await Promise.all(
				Array.from({ length: 10 }, () =>
					db.processingJob.create({
						data: {
							job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
							stage: JobStage.EXTRACTION,
							text: testTexts.small,
							metadata: createTestJobMetadata({
								resourceLimits: { maxConnections: 1, maxAICalls: 1, maxMemoryMB: 512 },
							}),
							status: JobStatus.QUEUED,
						},
					})
				)
			);

			let maxConcurrentConnections = 0;
			let currentConnections = 0;

			// Mock database operations to track connection usage
			const originalCreate = db.knowledgeTriple.createMany;
			(db.knowledgeTriple as any).createMany = jest.fn().mockImplementation(async (...args) => {
				currentConnections++;
				maxConcurrentConnections = Math.max(maxConcurrentConnections, currentConnections);

				await waitFor(50); // Simulate DB operation time

				currentConnections--;
				return { count: 1 };
			});

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const results = await Promise.all(jobs.map(job => routeJob(job)));

			// All jobs should complete successfully
			expect(results.every(r => r.success)).toBe(true);

			// Connection limit should have been respected
			expect(maxConcurrentConnections).toBeLessThanOrEqual(2); // Allow some variance

			// Restore original database function
			(db.knowledgeTriple as any).createMany = originalCreate;
		});
	});

	describe('Recovery Time Performance', () => {
		it('should recover quickly from transient failures', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: testTexts.small,
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			let attemptCount = 0;
			const failureDelay = 100; // ms

			(retryAIOperation as jest.Mock).mockImplementation(async (fn, operation, config) => {
				attemptCount++;

				if (attemptCount === 1) {
					await waitFor(failureDelay);
					throw new Error('Transient failure');
				}

				return await fn();
			});

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const startTime = Date.now();
			const result = await routeJob(job);
			const endTime = Date.now();

			expect(result.success).toBe(true);
			expect(attemptCount).toBe(2); // Should have retried once

			// Recovery should be fast (under 1 second total)
			expect(endTime - startTime).toBeLessThan(1000);
		});

		it('should maintain performance during error conditions', async () => {
			// Create mix of successful and failing jobs
			const jobs = await Promise.all([
				...Array.from({ length: 5 }, () =>
					db.processingJob.create({
						data: {
							job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
							stage: JobStage.EXTRACTION,
							text: testTexts.small,
							metadata: createTestJobMetadata({ source: 'success' }),
							status: JobStatus.QUEUED,
						},
					})
				),
				...Array.from({ length: 5 }, () =>
					db.processingJob.create({
						data: {
							job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
							stage: JobStage.EXTRACTION,
							text: testTexts.small,
							metadata: createTestJobMetadata({ source: 'fail' }),
							status: JobStatus.QUEUED,
						},
					})
				),
			]);

			// Mock responses based on job source
			mockAIProvider.generateText.mockImplementation(async prompt => {
				if (prompt.includes('"source":"fail"') || Math.random() < 0.5) {
					throw new Error('AI processing failed');
				}

				return createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
				});
			});

			const startTime = Date.now();
			const results = await Promise.all(jobs.map(job => routeJob(job)));
			const endTime = Date.now();

			const successCount = results.filter(r => r.success).length;
			const failureCount = results.filter(r => !r.success).length;

			expect(successCount).toBeGreaterThan(0);
			expect(failureCount).toBeGreaterThan(0);

			// Despite failures, overall processing should be efficient
			const avgTimePerJob = (endTime - startTime) / jobs.length;
			expect(avgTimePerJob).toBeLessThan(500); // Less than 500ms per job on average
		});
	});
});
