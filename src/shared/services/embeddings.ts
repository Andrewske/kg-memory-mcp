import type { EmbeddingConfig, Result } from '../types';

export interface EmbeddingService {
	embed(text: string, config?: Partial<EmbeddingConfig>): Promise<Result<number[]>>;

	embedBatch(texts: string[], config?: Partial<EmbeddingConfig>): Promise<Result<number[][]>>;
}
