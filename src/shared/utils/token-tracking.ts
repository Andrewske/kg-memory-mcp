import type {
	AIConfig,
	AIResponseWithUsage,
	Result,
	TokenUsage,
} from '../types/index.js';
import { db } from '../database/client.js';

/**
 * Context information for token tracking
 */
export interface TokenTrackingContext {
	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
	source_type: string; // "thread", "file", "manual", "api", etc.
	operation_type: string; // "extraction", "conceptualization", "embedding", "search", "deduplication"
	processing_batch_id?: string; // Batch ID for grouped processing
	operation_context?: Record<string, any>; // Additional operation-specific context
	tools_used?: string[]; // Array of tool names used
}

/**
 * Track token usage from AI operations
 * Converts AIResponseWithUsage to TokenUsage format and stores in database
 */
export async function trackTokenUsage<T>(
	aiResponse: AIResponseWithUsage<T>,
	context: TokenTrackingContext,
	config: AIConfig
): Promise<Result<void>> {
	try {
		// Convert AIResponseWithUsage to TokenUsage format
		const tokenUsage: TokenUsage = {
			// Context information
			source: context.source,
			source_type: context.source_type,
			operation_type: context.operation_type,
			provider: config.provider,
			model: config.model,

			// Standard token counts (required fields)
			input_tokens: aiResponse.usage.promptTokens,
			output_tokens: aiResponse.usage.completionTokens,
			total_tokens: aiResponse.usage.totalTokens,

			// Advanced token types (optional)
			thinking_tokens: aiResponse.usage.thinkingTokens,
			reasoning_tokens: aiResponse.usage.reasoningTokens,
			cached_read_tokens: aiResponse.usage.cachedReadTokens,
			cached_write_tokens: aiResponse.usage.cachedWriteTokens,

			// Reasoning and context metadata
			reasoning_steps: aiResponse.reasoning,
			operation_context: context.operation_context,

			// Performance tracking
			duration_ms: aiResponse.duration_ms || 0,
			estimated_cost: calculateEstimatedCost(aiResponse.usage, config),

			// Processing context
			processing_batch_id: context.processing_batch_id,
			tools_used: context.tools_used || [],

			// Timestamp (will be set by database)
			timestamp: new Date().toISOString(),
		};

		// Store the token usage in the database
		return await db.tokenUsage.create({
			data: {
				source: tokenUsage.source,
				source_type: tokenUsage.source_type,
				operation_type: tokenUsage.operation_type,
				provider: tokenUsage.provider,
				model: tokenUsage.model,
				input_tokens: tokenUsage.input_tokens,
				output_tokens: tokenUsage.output_tokens,
				total_tokens: tokenUsage.total_tokens,
				thinking_tokens: tokenUsage.thinking_tokens,
				reasoning_tokens: tokenUsage.reasoning_tokens,
				cached_read_tokens: tokenUsage.cached_read_tokens,
				cached_write_tokens: tokenUsage.cached_write_tokens,
				reasoning_steps: tokenUsage.reasoning_steps ?? undefined,
				operation_context: tokenUsage.operation_context ?? undefined,
				duration_ms: tokenUsage.duration_ms,
				estimated_cost: tokenUsage.estimated_cost ?? null,
				processing_batch_id: tokenUsage.processing_batch_id,
				tools_used: tokenUsage.tools_used || [],
				timestamp: new Date(),
			},
		}).then(() => ({ success: true as const, data: undefined }))
		  .catch((error: any) => ({
			success: false as const,
			error: {
				type: 'DATABASE_ERROR' as const,
				message: 'Failed to store token usage',
				cause: error,
			},
		  }));
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'TOKEN_TRACKING_ERROR',
				message: 'Failed to track token usage',
				cause: error,
			},
		};
	}
}

/**
 * Calculate estimated cost based on provider and model pricing
 * Returns cost in USD, or undefined if pricing information is not available
 */
function calculateEstimatedCost(
	usage: AIResponseWithUsage<any>['usage'],
	config: AIConfig
): number | undefined {
	// Pricing information (as of 2024, subject to change)
	const pricing: Record<string, { input: number; output: number }> = {
		// OpenAI pricing (per 1K tokens)
		'gpt-4': { input: 0.03, output: 0.06 },
		'gpt-4-turbo': { input: 0.01, output: 0.03 },
		'gpt-4o': { input: 0.005, output: 0.015 },
		'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
		'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },

		// Anthropic pricing (per 1K tokens)
		'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
		'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
		'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
		'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
		'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
	};

	const modelPricing = pricing[config.model];
	if (!modelPricing) {
		return undefined; // Pricing not available for this model
	}

	// Calculate cost based on token usage
	const inputCost = (usage.promptTokens / 1000) * modelPricing.input;
	const outputCost = (usage.completionTokens / 1000) * modelPricing.output;

	// Add thinking/reasoning token costs (usually same as output tokens)
	const thinkingCost =
		usage.thinkingTokens && usage.reasoningTokens
			? ((usage.thinkingTokens + usage.reasoningTokens) / 1000) * modelPricing.output
			: 0;

	return inputCost + outputCost + thinkingCost;
}
