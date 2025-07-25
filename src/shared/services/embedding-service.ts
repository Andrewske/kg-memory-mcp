import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import tiktoken from 'tiktoken';
import { storeTokenUsage } from '../database/stats-operations';
import type { EmbeddingConfig, EmbeddingService, Result } from '../types';
/**
 * OpenAI embedding service implementation
 */
export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
	return {
		async embed(
			text: string
		): Promise<Result<number[]>> {
			try {
				const modelConfig = { ...config };

				const { embedding } = await embed({
					model: openai.embedding(modelConfig.model),
					value: text,
				});

				return {
					success: true,
					data: embedding,
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'EMBEDDING_ERROR',
						message: 'Failed to generate embedding',
						cause: error,
					},
				};
			}
		},

		async embedBatch(
			texts: string[],
			context?: { source_type?: string; source?: string }
		): Promise<Result<number[][]>> {
			try {
				const modelConfig = { ...config };
				const batchSize = modelConfig.batchSize || 32;
				const embeddings: number[][] = [];
				const encoder = tiktoken.encoding_for_model('text-embedding-3-small');

				const tokens = texts.map(text => encoder.encode(text).length);
				const totalTokens = tokens.reduce((acc, curr) => acc + curr, 0);

				// Process in batches to avoid rate limits
				for (let i = 0; i < texts.length; i += batchSize) {
					const batch = texts.slice(i, i + batchSize);

					const batchPromises = batch.map(async text => {
						const { embedding } = await embed({
							model: openai.embedding(modelConfig.model),
							value: text,
						});
						return embedding;
					});

					const batchEmbeddings = await Promise.all(batchPromises);
					embeddings.push(...batchEmbeddings);

					// Add small delay between batches to respect rate limits
					if (i + batchSize < texts.length) {
						await new Promise(resolve => setTimeout(resolve, 100));
					}
				}

				await storeTokenUsage({
					source: context?.source || 'embedding',
					source_type: context?.source_type || 'batch',
					operation_type: 'embed',
					provider: 'openai',
					model: modelConfig.model,
					input_tokens: totalTokens,
					output_tokens: 0,
					total_tokens: totalTokens,
					estimated_cost: totalTokens * 0.02 / 1000000,
					timestamp: new Date().toISOString(),
					duration_ms: 0,
					reasoning_tokens: 0,
					thinking_tokens: 0,
				});

				return {
					success: true,
					data: embeddings,
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'EMBEDDING_ERROR',
						message: 'Failed to generate batch embeddings',
						cause: error,
					},
				};
			}
		},
	};
}
