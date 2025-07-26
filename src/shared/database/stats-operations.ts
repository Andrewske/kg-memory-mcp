import type { TokenUsage, TripleType } from '@prisma/client';
import { db } from '~/shared/database/client.js';
import type { Result } from '~/shared/types/services.js';

/**
 * Get total count of knowledge triples
 */
export async function getTripleCount(): Promise<number> {
	try {
		return await db.knowledgeTriple.count();
	} catch (error) {
		console.error('Error getting triple count:', error);
		return 0;
	}
}

/**
 * Get total count of concept nodes
 */
export async function getConceptCount(): Promise<number> {
	try {
		return await db.conceptNode.count();
	} catch (error) {
		console.error('Error getting concept count:', error);
		return 0;
	}
}

/**
 * Get count of triples by type
 */
export async function getTripleCountByType(): Promise<Record<TripleType, number>> {
	try {
		const counts = await db.knowledgeTriple.groupBy({
			by: ['type'],
			_count: true,
		});

		const result: Record<TripleType, number> = {
			ENTITY_ENTITY: 0,
			ENTITY_EVENT: 0,
			EVENT_EVENT: 0,
			EMOTIONAL_CONTEXT: 0,
		};

		counts.forEach(({ type, _count }) => {
			result[type] = _count;
		});

		return result;
	} catch (error) {
		console.error('Error getting triple count by type:', error);
		return {
			ENTITY_ENTITY: 0,
			ENTITY_EVENT: 0,
			EVENT_EVENT: 0,
			EMOTIONAL_CONTEXT: 0,
		};
	}
}

/**
 * Store token usage information
 */
export async function storeTokenUsage(
	usage: Omit<TokenUsage, 'id' | 'created_at' | 'updated_at'>
): Promise<Result<void>> {
	try {
		await db.tokenUsage.create({
			data: {
				source: usage.source,
				source_type: usage.source_type,
				operation_type: usage.operation_type,
				provider: usage.provider,
				model: usage.model,
				input_tokens: usage.input_tokens,
				output_tokens: usage.output_tokens,
				total_tokens: usage.total_tokens,
				thinking_tokens: usage.thinking_tokens,
				reasoning_tokens: usage.reasoning_tokens,
				cached_read_tokens: usage.cached_read_tokens,
				cached_write_tokens: usage.cached_write_tokens,
				reasoning_steps: usage.reasoning_steps ?? undefined,
				operation_context: usage.operation_context ?? undefined,
				duration_ms: usage.duration_ms,
				estimated_cost: usage.estimated_cost ?? null,
				tools_used: usage.tools_used || [],
				timestamp: new Date(),
			},
		});

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to store token usage',
				cause: error,
			},
		};
	}
}

/**
 * Get token usage with optional filtering
 */
export async function getTokenUsage(filters?: {
	source?: string;
	source_type?: string;
	operation_type?: string;
	provider?: string;
	model?: string;
	start_time?: string;
	end_time?: string;
}): Promise<Result<TokenUsage[]>> {
	try {
		const where: any = {};

		if (filters) {
			if (filters.source) {
				where.source = filters.source;
			}
			if (filters.source_type) {
				where.source_type = filters.source_type;
			}
			if (filters.operation_type) {
				where.operation_type = filters.operation_type;
			}
			if (filters.provider) {
				where.provider = filters.provider;
			}
			if (filters.model) {
				where.model = filters.model;
			}
			if (filters.start_time || filters.end_time) {
				where.timestamp = {};
				if (filters.start_time) {
					where.timestamp.gte = new Date(filters.start_time);
				}
				if (filters.end_time) {
					where.timestamp.lte = new Date(filters.end_time);
				}
			}
		}

		const usageRecords = await db.tokenUsage.findMany({
			where,
			orderBy: { timestamp: 'desc' },
		});

		return {
			success: true,
			data: usageRecords,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to get token usage',
				cause: error,
			},
		};
	}
}
