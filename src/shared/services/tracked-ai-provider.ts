import type { z } from "zod";
import type { AIProvider, Result, AIConfig, EmbeddingService } from "./types.js";
import type { AIResponseWithUsage } from "../types/index.js";
import type { TokenTrackingService } from "./token-tracking-service.js";
import { countTokens, countTokensBatch } from "../utils/token-counter.js";

/**
 * Creates an AI provider wrapper that automatically tracks token usage
 * This wrapper intercepts AI calls and logs token usage to the database
 */
export function createTrackedAIProvider(
	baseProvider: AIProvider,
	tokenTracker: TokenTrackingService,
	defaultContext?: {
		thread_id?: string;
		provider: string;
		model: string;
	},
): AIProvider {
	return {
		async generateObject<T>(
			prompt: string,
			schema: z.ZodType<T>,
			overrideConfig?: Partial<AIConfig>,
			context?: {
				operation_type?: string;
				thread_id?: string;
				processing_batch_id?: string;
			},
		): Promise<Result<AIResponseWithUsage<T>>> {
			// Call the base provider
			const result = await baseProvider.generateObject(
				prompt,
				schema,
				overrideConfig,
				context,
			);

			// If successful, track token usage
			if (result.success && defaultContext) {
				// Check if token usage is provided by the AI SDK
				if (!result.data.usage || result.data.usage.totalTokens === 0) {
					// Count tokens using tiktoken if not provided
					const promptTokens = countTokens(prompt, defaultContext.model);
					result.data.usage = {
						promptTokens,
						completionTokens: 0, // Cannot estimate without knowing the response
						totalTokens: promptTokens,
					};
				}

				const trackingContext = {
					thread_id:
						context?.thread_id || defaultContext.thread_id || "unknown",
					operation_type: context?.operation_type || "unknown",
					provider: defaultContext.provider,
					model: defaultContext.model,
					processing_batch_id: context?.processing_batch_id,
				};

				// Track token usage in background (non-blocking)
				tokenTracker
					.logTokenUsage(result.data, trackingContext)
					.catch((error) => {
						console.warn("Failed to track token usage:", error);
					});
			}

			return result;
		},

		async generateText(
			prompt: string,
			overrideConfig?: Partial<AIConfig>,
			context?: {
				operation_type?: string;
				thread_id?: string;
				processing_batch_id?: string;
			},
		): Promise<Result<AIResponseWithUsage<string>>> {
			// Call the base provider
			const result = await baseProvider.generateText(
				prompt,
				overrideConfig,
				context,
			);

			// If successful, track token usage
			if (result.success && defaultContext) {
				// Check if token usage is provided by the AI SDK
				if (!result.data.usage || result.data.usage.totalTokens === 0) {
					// Count tokens using tiktoken if not provided
					const promptTokens = countTokens(prompt, defaultContext.model);
					result.data.usage = {
						promptTokens,
						completionTokens: 0, // Cannot estimate without knowing the response
						totalTokens: promptTokens,
					};
				}

				const trackingContext = {
					thread_id:
						context?.thread_id || defaultContext.thread_id || "unknown",
					operation_type: context?.operation_type || "unknown",
					provider: defaultContext.provider,
					model: defaultContext.model,
					processing_batch_id: context?.processing_batch_id,
				};

				// Track token usage in background (non-blocking)
				tokenTracker
					.logTokenUsage(result.data, trackingContext)
					.catch((error) => {
						console.warn("Failed to track token usage:", error);
					});
			}

			return result;
		},
	};
}

/**
 * Creates a tracked embedding service wrapper
 * Since embedding services don't return token usage in the AI SDK,
 * we use tiktoken to count tokens accurately
 */
export function createTrackedEmbeddingService(
	baseService: EmbeddingService,
	tokenTracker: TokenTrackingService,
	config: {
		provider: string;
		model: string;
	},
): EmbeddingService {
	return {
		async embed(
			text: string,
			context?: { operation_type?: string; thread_id?: string },
		): Promise<Result<number[]>> {
			const startTime = Date.now();
			const result = await baseService.embed(text, context);

			if (result.success) {
				// Embeddings never return token usage, so always count
				const tokenCount = countTokens(text, config.model);

				const mockResponse: AIResponseWithUsage<number[]> = {
					data: result.data,
					usage: {
						promptTokens: tokenCount,
						completionTokens: 0,
						totalTokens: tokenCount,
					},
					duration_ms: Date.now() - startTime,
				};

				// Track token usage in background (non-blocking)
				tokenTracker
					.logTokenUsage(mockResponse, {
						thread_id: context?.thread_id || "unknown",
						operation_type: context?.operation_type || "embedding",
						provider: config.provider,
						model: config.model,
					})
					.catch((error) => {
						console.warn("Failed to track embedding token usage:", error);
					});
			}

			return result;
		},

		async embedBatch(
			texts: string[],
			context?: { operation_type?: string; thread_id?: string },
		): Promise<Result<number[][]>> {
			const startTime = Date.now();
			const result = await baseService.embedBatch(texts, context);

			if (result.success) {
				// Count all tokens in batch
				const totalTokens = countTokensBatch(texts, config.model);

				const mockResponse: AIResponseWithUsage<number[][]> = {
					data: result.data,
					usage: {
						promptTokens: totalTokens,
						completionTokens: 0,
						totalTokens: totalTokens,
					},
					duration_ms: Date.now() - startTime,
				};

				// Track token usage in background (non-blocking)
				tokenTracker
					.logTokenUsage(mockResponse, {
						thread_id: context?.thread_id || "unknown",
						operation_type: context?.operation_type || "embedding_batch",
						provider: config.provider,
						model: config.model,
					})
					.catch((error) => {
						console.warn("Failed to track embedding batch token usage:", error);
					});
			}

			return result;
		},
	};
}
