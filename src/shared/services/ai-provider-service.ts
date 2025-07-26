import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import type { z } from 'zod';
import { env } from '~/shared/env.js';
import type { AIConfig } from '~/shared/types/config.js';
import type { AIResponseWithUsage } from '~/shared/types/core.js';
import type { AIProvider, Result } from '~/shared/types/services.js';

/**
 * AI provider service implementation with comprehensive token tracking
 * Supports both OpenAI and Anthropic models with advanced token extraction
 */
export function createAIProvider(): AIProvider {
	const defaultConfig = {
		model: env.AI_MODEL,
		temperature: env.AI_TEMPERATURE,
		maxTokens: env.AI_MAX_TOKENS,
		provider: env.AI_PROVIDER,
	};
	return {
		async generateObject<T>(
			prompt: string,
			schema: z.ZodType<T>,
			overrideConfig?: Partial<AIConfig>
		): Promise<Result<AIResponseWithUsage<T>>> {
			try {
				const modelConfig = { ...defaultConfig, ...overrideConfig };
				const model = getModel(modelConfig);

				const startTime = Date.now();
				const response = await generateObject({
					model,
					prompt,
					schema,
					temperature: modelConfig.temperature,
					maxTokens: modelConfig.maxTokens,
				});
				const endTime = Date.now();

				// Extract comprehensive token usage and metadata
				const aiResponseWithUsage = extractTokenUsage(response, modelConfig, endTime - startTime);

				return {
					success: true,
					data: {
						...aiResponseWithUsage,
						data: response.object,
					},
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'AI_ERROR',
						message: 'Failed to generate object',
						cause: error,
					},
				};
			}
		},

		async generateText(
			prompt: string,
			overrideConfig?: Partial<AIConfig>
		): Promise<Result<AIResponseWithUsage<string>>> {
			try {
				const modelConfig = { ...defaultConfig, ...overrideConfig };
				const model = getModel(modelConfig);

				const startTime = Date.now();
				const response = await generateText({
					model,
					prompt,
					temperature: modelConfig.temperature,
					maxTokens: modelConfig.maxTokens,
				});
				const endTime = Date.now();

				// Extract comprehensive token usage and metadata
				const aiResponseWithUsage = extractTokenUsage(response, modelConfig, endTime - startTime);

				return {
					success: true,
					data: {
						...aiResponseWithUsage,
						data: response.text,
					},
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'AI_ERROR',
						message: 'Failed to generate text',
						cause: error,
					},
				};
			}
		},
	};
}

/**
 * Extract comprehensive token usage from AI SDK response
 * Supports advanced token types like thinking tokens and cached tokens
 */
function extractTokenUsage(
	response: any,
	config: AIConfig,
	duration_ms: number
): Omit<AIResponseWithUsage<any>, 'data'> {
	// Extract basic usage (available in all responses)
	const basicUsage = response.usage || {};

	// Extract advanced token types from provider-specific metadata
	let thinkingTokens: number | undefined;
	let reasoningTokens: number | undefined;
	let cachedReadTokens: number | undefined;
	let cachedWriteTokens: number | undefined;
	let reasoning: any[] | undefined;
	let providerMetadata: Record<string, any> | undefined;

	// Provider-specific token extraction
	if (config.provider === 'anthropic') {
		// Anthropic-specific advanced tokens
		const anthropicMeta = response.providerMetadata?.anthropic;
		if (anthropicMeta) {
			// Extract cached tokens (prompt caching)
			cachedReadTokens = anthropicMeta.cache_read_input_tokens;
			cachedWriteTokens = anthropicMeta.cache_creation_input_tokens;

			// Extract reasoning tokens for supported models
			thinkingTokens = anthropicMeta.thinking_tokens;
			reasoningTokens = anthropicMeta.reasoning_tokens;
		}

		// Extract reasoning steps if available
		reasoning = response.reasoning;
		providerMetadata = anthropicMeta;
	} else if (config.provider === 'openai') {
		// OpenAI-specific advanced tokens
		const openaiMeta = response.providerMetadata?.openai;
		if (openaiMeta) {
			// Extract cached tokens (prompt caching)
			cachedReadTokens = openaiMeta.cached_tokens;

			// Extract thinking tokens for o1 models
			if (config.model.includes('o1')) {
				reasoningTokens = openaiMeta.reasoning_tokens;
			}
		}

		providerMetadata = openaiMeta;
	}

	return {
		usage: {
			promptTokens: basicUsage.promptTokens || basicUsage.prompt_tokens || 0,
			completionTokens: basicUsage.completionTokens || basicUsage.completion_tokens || 0,
			totalTokens: basicUsage.totalTokens || basicUsage.total_tokens || 0,
			// Advanced token types
			thinkingTokens,
			reasoningTokens,
			cachedReadTokens,
			cachedWriteTokens,
		},
		reasoning,
		providerMetadata,
		duration_ms,
	};
}

function getModel(config: AIConfig) {
	if (config.provider === 'anthropic') {
		return anthropic(config.model);
	} else {
		return openai(config.model);
	}
}
