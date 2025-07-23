import type { TokenUsage, AIResponseWithUsage } from "../types/index.js";
import type { DatabaseAdapter, Result, AIConfig } from "./types.js";

/**
 * Token tracking service that bridges AI provider responses and database storage
 * Handles conversion between AI SDK response format and TokenUsage database model
 */
export interface TokenTrackingService {
	/**
	 * Log token usage from AI provider response
	 */
	logTokenUsage<T>(
		response: AIResponseWithUsage<T>,
		context: {
			source: string; // The actual identifier (thread_12345, filename.txt, etc.)
			source_type: string; // "thread", "file", "manual", "api", etc.
			operation_type: string;
			provider: string;
			model: string;
			processing_batch_id?: string;
			tools_used?: string[];
		},
	): Promise<Result<void>>;

	/**
	 * Get token usage statistics with optional filtering
	 */
	getTokenUsage(filters?: {
		source?: string;
		source_type?: string;
		operation_type?: string;
		provider?: string;
		model?: string;
		start_time?: string;
		end_time?: string;
	}): Promise<Result<TokenUsage[]>>;

	/**
	 * Calculate estimated cost for token usage
	 */
	calculateCost(
		usage: {
			input_tokens: number;
			output_tokens: number;
			thinking_tokens?: number;
			cached_read_tokens?: number;
			cached_write_tokens?: number;
		},
		provider: string,
		model: string,
	): number;
}

/**
 * Token cost rates per 1K tokens (USD)
 * Updated rates as of January 2025
 */
const TOKEN_COST_RATES: Record<
	string,
	{
		input: number;
		output: number;
		thinking?: number; // For reasoning models
		cached_read?: number; // Cache hit discount
		cached_write?: number; // Cache creation cost
	}
> = {
	// OpenAI Models
	"gpt-4": { input: 0.03, output: 0.06 },
	"gpt-4-turbo": { input: 0.01, output: 0.03 },
	"gpt-4o": { input: 0.005, output: 0.015 },
	"gpt-4o-mini": { input: 0.00015, output: 0.0006 },
	"o1-preview": {
		input: 0.015,
		output: 0.06,
		thinking: 0.015, // Reasoning tokens charged as input
	},
	"o1-mini": {
		input: 0.003,
		output: 0.012,
		thinking: 0.003,
	},
	"gpt-3.5-turbo": { input: 0.001, output: 0.002 },

	// Anthropic Models
	"claude-3-opus": {
		input: 0.015,
		output: 0.075,
		cached_read: 0.0015, // 90% discount
		cached_write: 0.01875, // 25% premium
	},
	"claude-3-sonnet": {
		input: 0.003,
		output: 0.015,
		cached_read: 0.0003,
		cached_write: 0.00375,
	},
	"claude-3-haiku": {
		input: 0.00025,
		output: 0.00125,
		cached_read: 0.000025,
		cached_write: 0.0003125,
	},
	"claude-3-5-sonnet": {
		input: 0.003,
		output: 0.015,
		cached_read: 0.0003,
		cached_write: 0.00375,
	},

	// Embedding Models
	"text-embedding-3-small": { input: 0.00002, output: 0 },
	"text-embedding-3-large": { input: 0.00013, output: 0 },
	"text-embedding-ada-002": { input: 0.0001, output: 0 },
};

export function createTokenTrackingService(
	db: DatabaseAdapter,
): TokenTrackingService {
	return {
		async logTokenUsage<T>(
			response: AIResponseWithUsage<T>,
			context: {
				source: string; // The actual identifier (thread_12345, filename.txt, etc.)
				source_type: string; // "thread", "file", "manual", "api", etc.
				operation_type: string;
				provider: string;
				model: string;
				processing_batch_id?: string;
				tools_used?: string[];
			},
		): Promise<Result<void>> {
			try {
				// Calculate estimated cost
				const estimatedCost = this.calculateCost(
					{
						input_tokens: response.usage.promptTokens,
						output_tokens: response.usage.completionTokens,
						thinking_tokens: response.usage.thinkingTokens,
						cached_read_tokens: response.usage.cachedReadTokens,
						cached_write_tokens: response.usage.cachedWriteTokens,
					},
					context.provider,
					context.model,
				);

				// Convert AI response to TokenUsage format
				const tokenUsage: TokenUsage = {
					source: context.source,
					source_type: context.source_type,
					operation_type: context.operation_type,
					provider: context.provider,
					model: context.model,

					// Standard tokens
					input_tokens: response.usage.promptTokens,
					output_tokens: response.usage.completionTokens,
					total_tokens: response.usage.totalTokens,

					// Advanced token types
					thinking_tokens: response.usage.thinkingTokens,
					reasoning_tokens: response.usage.reasoningTokens,
					cached_read_tokens: response.usage.cachedReadTokens,
					cached_write_tokens: response.usage.cachedWriteTokens,

					// Reasoning and context metadata
					reasoning_steps: response.reasoning,
					operation_context: {
						provider_metadata: response.providerMetadata,
						tools_used: context.tools_used,
					},

					// Performance and cost tracking
					duration_ms: response.duration_ms || 0,
					estimated_cost: estimatedCost,

					// Processing context
					processing_batch_id: context.processing_batch_id,
					tools_used: context.tools_used || [],

					// Timestamp
					timestamp: new Date().toISOString(),
				};

				// Store in database
				return await db.storeTokenUsage(tokenUsage);
			} catch (error) {
				return {
					success: false,
					error: {
						type: "TOKEN_TRACKING_ERROR",
						message: "Failed to log token usage",
						cause: error,
					},
				};
			}
		},

		async getTokenUsage(filters?: {
			thread_id?: string;
			operation_type?: string;
			provider?: string;
			model?: string;
			start_time?: string;
			end_time?: string;
		}): Promise<Result<TokenUsage[]>> {
			return await db.getTokenUsage(filters);
		},

		calculateCost(
			usage: {
				input_tokens: number;
				output_tokens: number;
				thinking_tokens?: number;
				cached_read_tokens?: number;
				cached_write_tokens?: number;
			},
			provider: string,
			model: string,
		): number {
			// Find matching cost rates (case insensitive, partial match)
			const modelKey = Object.keys(TOKEN_COST_RATES).find((key) =>
				model.toLowerCase().includes(key.toLowerCase()),
			);

			if (!modelKey) {
				// Fallback rates for unknown models
				const fallbackRates =
					provider === "anthropic"
						? { input: 0.003, output: 0.015 }
						: { input: 0.001, output: 0.002 };

				return (
					(usage.input_tokens * fallbackRates.input +
						usage.output_tokens * fallbackRates.output) /
					1000
				);
			}

			const rates = TOKEN_COST_RATES[modelKey];
			let totalCost = 0;

			// Standard tokens
			totalCost += (usage.input_tokens * rates.input) / 1000;
			totalCost += (usage.output_tokens * rates.output) / 1000;

			// Thinking/reasoning tokens (usually charged as input tokens)
			if (usage.thinking_tokens && rates.thinking) {
				totalCost += (usage.thinking_tokens * rates.thinking) / 1000;
			}

			// Cached tokens
			if (usage.cached_read_tokens && rates.cached_read) {
				totalCost += (usage.cached_read_tokens * rates.cached_read) / 1000;
			}
			if (usage.cached_write_tokens && rates.cached_write) {
				totalCost += (usage.cached_write_tokens * rates.cached_write) / 1000;
			}

			return Math.round(totalCost * 1000000) / 1000000; // Round to 6 decimal places
		},
	};
}

/**
 * Helper function to create a token tracking wrapper for AI operations
 */
export function withTokenTracking<T>(
	tokenTracker: TokenTrackingService,
	context: {
		thread_id?: string;
		operation_type: string;
		provider: string;
		model: string;
		processing_batch_id?: string;
		tools_used?: string[];
	},
) {
	return {
		async track(response: AIResponseWithUsage<T>): Promise<Result<T>> {
			// Log token usage in background (don't block operation)
			tokenTracker.logTokenUsage(response, context).catch((error) => {
				console.warn("Failed to log token usage:", error);
			});

			// Return the original data
			return {
				success: true,
				data: response.data,
			};
		},
	};
}
