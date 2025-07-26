// Service interface types for dependency injection

import type { TripleType } from '@prisma/client';
import type { z } from 'zod';
import type { AIConfig } from '~/shared/types/config.js';
import type { AIResponseWithUsage } from '~/shared/types/core.js';

// Result type for consistent error handling
export type Result<T> = { success: true; data: T } | { success: false; error: OperationError };

export interface OperationError {
	type: string;
	message: string;
	cause?: unknown;
}

export interface EmbeddingService {
	embed(text: string): Promise<Result<number[]>>;
	embedBatch(
		texts: string[],
		context?: { source_type?: string; source?: string }
	): Promise<Result<number[][]>>;
}

export interface AIProvider {
	generateObject<T>(
		prompt: string,
		schema: z.ZodType<T>,
		overrideConfig?: Partial<AIConfig>,
		context?: {
			operation_type?: string;
			source?: string;
			source_type?: string;
			triple_type?: TripleType;
			source_date?: string;
		}
	): Promise<Result<AIResponseWithUsage<T>>>;

	generateText(
		prompt: string,
		overrideConfig?: Partial<AIConfig>,
		context?: {
			operation_type?: string;
			thread_id?: string;
		}
	): Promise<Result<AIResponseWithUsage<string>>>;
}
