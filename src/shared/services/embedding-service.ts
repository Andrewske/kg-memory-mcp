import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import type { EmbeddingService, Result, EmbeddingConfig } from '../types/index.js';

/**
 * OpenAI embedding service implementation
 */
export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
	return {
		async embed(
			text: string,
			context?: { operation_type?: string; thread_id?: string }
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
			context?: { operation_type?: string; thread_id?: string }
		): Promise<Result<number[][]>> {
			try {
				const modelConfig = { ...config };
				const batchSize = modelConfig.batchSize || 32;
				const embeddings: number[][] = [];

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
