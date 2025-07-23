import type { KnowledgeTriple, Result } from '~/shared/types';
import { db } from './client';
import { generateTripleId, mapPrismaTriple, mapTripleType } from './database-utils';

/**
 * Store knowledge triples in the database
 */
export async function storeTriples(triples: KnowledgeTriple[]): Promise<Result<void>> {
	try {
		const prismaTriples = triples.map(triple => ({
			id: generateTripleId(triple),
			subject: triple.subject,
			predicate: triple.predicate,
			object: triple.object,
			type: mapTripleType(triple.type),
			source: triple.source,
			source_type: triple.source_type,
			source_date: triple.source_date ? new Date(triple.source_date) : null,
			extracted_at: new Date(triple.extracted_at),
			processing_batch_id: triple.processing_batch_id,
			confidence: triple.confidence,
		}));

		await db.knowledgeTriple.createMany({
			data: prismaTriples,
			skipDuplicates: true,
		});

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to store triples',
				cause: error,
			},
		};
	}
}

/**
 * Check which triple IDs already exist in the database
 */
export async function checkExistingTriples(ids: string[]): Promise<string[]> {
	try {
		const existing = await db.knowledgeTriple.findMany({
			where: { id: { in: ids } },
			select: { id: true },
		});
		return existing.map(t => t.id);
	} catch (error) {
		console.error('Error checking existing triples:', error);
		return [];
	}
}

/**
 * Check if a specific triple exists
 */
export async function tripleExists(id: string): Promise<boolean> {
	try {
		const count = await db.knowledgeTriple.count({
			where: { id },
		});
		return count > 0;
	} catch (error) {
		console.error('Error checking triple existence:', error);
		return false;
	}
}

/**
 * Get triples by their IDs
 */
export async function getTriplesByIds(ids: string[]): Promise<KnowledgeTriple[]> {
	try {
		const triples = await db.knowledgeTriple.findMany({
			where: { id: { in: ids } },
		});
		return triples.map(mapPrismaTriple);
	} catch (error) {
		console.error('Error getting triples by IDs:', error);
		return [];
	}
}

/**
 * Get all triples from the database
 */
export async function getAllTriples(): Promise<Result<KnowledgeTriple[]>> {
	try {
		const triples = await db.knowledgeTriple.findMany();
		return {
			success: true,
			data: triples.map(mapPrismaTriple),
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to get all triples',
				cause: error,
			},
		};
	}
}