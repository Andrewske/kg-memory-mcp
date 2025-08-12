import { Decimal } from '@prisma/client/runtime/library';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import type { AIResponseWithUsage } from '~/shared/types/core.js';

/**
 * Context information for token tracking
 */
export interface TokenTrackingContext {
	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
	source_type: string; // "thread", "file", "manual", "api", etc.
	operation_type: string; // "extraction", "conceptualization", "embedding", "search", "deduplication"
	operation_context?: Record<string, string | number | boolean | null | undefined>;
	tools_used?: string[]; // Array of tool names used
}

/**
 * Track token usage from AI operations
 * Converts AIResponseWithUsage to TokenUsage format and stores in database
 */
export async function trackTokenUsage<T>(
	aiResponse: AIResponseWithUsage<T>,
	context: TokenTrackingContext
) {
	try {
		// Convert AIResponseWithUsage to TokenUsage format
		const tokenUsage = {
			// Context information
			source: context.source,
			source_type: context.source_type,
			operation_type: context.operation_type,
			provider: env.AI_PROVIDER,
			model: env.AI_MODEL,

			// Standard token counts (required fields)
			input_tokens: aiResponse.usage.promptTokens,
			output_tokens: aiResponse.usage.completionTokens,
			total_tokens: aiResponse.usage.totalTokens,

			// Advanced token types (optional)
			thinking_tokens: aiResponse.usage.thinkingTokens ?? null,
			reasoning_tokens: aiResponse.usage.reasoningTokens ?? null,
			cached_read_tokens: aiResponse.usage.cachedReadTokens ?? null,
			cached_write_tokens: aiResponse.usage.cachedWriteTokens ?? null,

			// Reasoning and context metadata
			reasoning_steps: aiResponse.reasoning ?? null,
			operation_context: context.operation_context,

			// Performance tracking
			duration_ms: aiResponse.duration_ms || 0,
			estimated_cost:
				calculateEstimatedCost({
					promptTokens: aiResponse.usage.promptTokens,
					completionTokens: aiResponse.usage.completionTokens,
					thinkingTokens: aiResponse.usage.thinkingTokens ?? 0,
					reasoningTokens: aiResponse.usage.reasoningTokens ?? 0,
				}) ?? null,

			// Processing context

			tools_used: context.tools_used || [],

			// Timestamp (will be set by database)
			timestamp: new Date(),
		};

		// Store the token usage in the database
		await db.tokenUsage
			.create({
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
					reasoning_steps: tokenUsage.reasoning_steps
						? JSON.parse(JSON.stringify(tokenUsage.reasoning_steps))
						: null,
					operation_context: tokenUsage.operation_context,
					duration_ms: tokenUsage.duration_ms,
					estimated_cost: tokenUsage.estimated_cost ?? null,
					tools_used: tokenUsage.tools_used || [],
					timestamp: new Date(),
				},
			})
			.then(() => ({ success: true as const, data: undefined }))
			.catch(error => ({
				success: false as const,
				error: {
					type: 'DATABASE_ERROR' as const,
					message: 'Failed to store token usage',
					cause: error,
				},
			}));

		return tokenUsage;
	} catch (_error) {
		// return {
		// 	success: false,
		// 	error: {
		// 		type: 'TOKEN_TRACKING_ERROR',
		// 		message: 'Failed to track token usage',
		// 		cause: error,
		// 	},
		// };
		return null;
	}
}

/**
 * Calculate estimated cost based on provider and model pricing
 * Returns cost in USD, or undefined if pricing information is not available
 */
function calculateEstimatedCost({
	promptTokens,
	completionTokens,
	thinkingTokens,
	reasoningTokens,
}: {
	promptTokens: number;
	completionTokens: number;
	thinkingTokens: number;
	reasoningTokens: number;
}): Decimal | undefined {
	// Pricing information (as of 2024, subject to change)
	const pricing: Record<string, { input: number; output: number }> = {
		// OpenAI pricing (per 1K tokens)
		'gpt-4': { input: 0.03, output: 0.06 },
		'gpt-4-turbo': { input: 0.01, output: 0.03 },
		'gpt-4o': { input: 0.005, output: 0.015 },
		'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
		'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
		'gpt-5-nano': { input: 0.00005, output: 0.0004 },

		// Anthropic pricing (per 1K tokens)
		'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
		'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
		'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
		'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
		'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
	};

	const modelPricing = pricing[env.AI_MODEL];
	if (!modelPricing) {
		return undefined; // Pricing not available for this model
	}

	// Calculate cost based on token usage
	const inputCost = (promptTokens / 1000) * modelPricing.input;
	const outputCost = (completionTokens / 1000) * modelPricing.output;

	// Add thinking/reasoning token costs (usually same as output tokens)
	const thinkingCost =
		thinkingTokens && reasoningTokens
			? ((thinkingTokens + reasoningTokens) / 1000) * modelPricing.output
			: 0;

	return new Decimal(inputCost + outputCost + thinkingCost);
}
