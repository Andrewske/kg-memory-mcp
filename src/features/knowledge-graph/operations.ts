import type { TripleType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { createConcepts } from '~/shared/database/concept-operations.js';
import {
	getConceptCount,
	getTripleCount,
	getTripleCountByType,
} from '~/shared/database/stats-operations.js';
import {
	checkExistingTriples,
	createTriples,
	getAllTriples,
} from '~/shared/database/triple-operations.js';
import { createVectors } from '~/shared/database/vector-operations.js';
import { env } from '~/shared/env.js';
import type { GraphStats } from '~/shared/types/api.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { EmbeddingService, Result } from '~/shared/types/services.js';

export interface EntityEnumerationOptions {
	role?: 'subject' | 'object' | 'both';
	min_occurrence?: number;
	sources?: string[];
	types?: Array<TripleType>;
	limit?: number;
	sort_by?: 'frequency' | 'alphabetical' | 'recent';
}

export interface EntityEnumerationResult {
	entity: string;
	occurrences: number;
	roles: Array<'subject' | 'object'>;
	sources: string[];
	types: Array<TripleType>;
	last_seen: string;
	confidence?: number;
}

export interface StoreResult {
	triplesStored: number;
	conceptsStored: number;
	duplicatesSkipped: number;
	vectorsGenerated?: number;
}

/**
 * Store knowledge triples in the database with automatic vector generation
 * Pure function that takes all dependencies as parameters
 *
 * @param triples - Knowledge triples to store
 * @param db - Database adapter for storage operations
 * @param config - Knowledge graph configuration
 * @param embeddingService - Optional embedding service for vector generation
 */
export async function storeTriples(
	triples: Triple[],
	embeddingMap?: Map<string, number[]>
): Promise<Result<StoreResult>> {
	try {
		// Generate IDs for each triple
		const triplesWithIds = triples.map(triple => ({
			...triple,
			id: generateTripleId(triple),
		}));

		// Check for existing triples
		const ids = triplesWithIds.map(t => t.id);
		const existingIds = await checkExistingTriples(ids);

		// Filter out duplicates
		const newTriples = triplesWithIds.filter(t => !existingIds.includes(t.id));

		if (newTriples.length === 0) {
			return {
				success: true,
				data: {
					triplesStored: 0,
					conceptsStored: 0,
					duplicatesSkipped: triples.length,
				},
			};
		}

		// Store new triples
		const createResult = await createTriples(newTriples);
		if (!createResult.success) {
			return createResult;
		}

		// Generate and store vectors for the new triples (using embedding map if available)
		let vectorsGenerated = 0;

		console.log(`[VECTOR DEBUG] embeddingMap available: ${!!embeddingMap}`);
		console.log(`[VECTOR DEBUG] newTriples.length: ${newTriples.length}`);

		if (embeddingMap && newTriples.length > 0) {
			try {
				console.log(
					`[VECTOR GENERATION OPTIMIZED] Starting optimized vector generation for ${newTriples.length} new triples using embedding map...`
				);
				console.log(
					`[VECTOR GENERATION OPTIMIZED] Sample triple: "${newTriples[0]?.subject}" → "${newTriples[0]?.predicate}" → "${newTriples[0]?.object}"`
				);

				const vectorResult = await generateAndStoreVectors(newTriples, embeddingMap);

				console.log(`[VECTOR GENERATION OPTIMIZED] Vector generation result:`, {
					success: vectorResult.success,
					vectorsStored: vectorResult.success ? vectorResult.data.vectorsStored : 0,
					error: vectorResult.success ? null : vectorResult.error,
				});

				if (vectorResult.success) {
					vectorsGenerated = vectorResult.data.vectorsStored;
					console.log(`[VECTOR GENERATION OPTIMIZED] ✅ Successfully stored ${vectorsGenerated} vectors using embedding map`);
				} else {
					console.warn(`[VECTOR GENERATION OPTIMIZED] ❌ Failed to store vectors:`, vectorResult.error);
					// Don't fail the entire operation if vector generation fails
				}
			} catch (error) {
				console.warn(`[VECTOR GENERATION OPTIMIZED] ❌ Vector generation error (non-blocking):`, error);
				// Vector generation is non-blocking - continue with success
			}
		} else {
			if (!embeddingMap) {
				console.warn(
					`[VECTOR DEBUG] ⚠️ No embedding map provided - vectors will not be generated`
				);
			}
			if (newTriples.length === 0) {
				console.warn(`[VECTOR DEBUG] ⚠️ No new triples to generate vectors for`);
			}
		}

		return {
			success: true,
			data: {
				triplesStored: newTriples.length,
				conceptsStored: 0,
				duplicatesSkipped: existingIds.length,
				vectorsGenerated,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'STORAGE_ERROR',
				message: 'Failed to store triples',
				cause: error,
			},
		};
	}
}

/**
 * Store concept nodes in the database with automatic vector generation
 * Pure function that takes all dependencies as parameters
 *
 * @param concepts - Concept nodes to store
 * @param db - Database adapter for storage operations
 * @param config - Knowledge graph configuration
 * @param embeddingService - Optional embedding service for vector generation
 */
export async function storeConcepts(
	concepts: Concept[],
	embeddingMap?: Map<string, number[]>
): Promise<Result<{ conceptsStored: number; vectorsGenerated?: number }>> {
	try {
		// Store concepts first
		const result = await createConcepts(concepts);
		if (!result.success) {
			return result;
		}

		let vectorsGenerated: number | undefined;

		// Generate and store vectors for the concepts (using embedding map if available)
		console.log(`[CONCEPT VECTOR DEBUG] embeddingMap available: ${!!embeddingMap}`);
		console.log(`[CONCEPT VECTOR DEBUG] concepts.length: ${concepts.length}`);

		if (embeddingMap && concepts.length > 0) {
			try {
				console.log(
					`[CONCEPT VECTOR GENERATION OPTIMIZED] Starting optimized vector generation for ${concepts.length} concepts using embedding map...`
				);
				console.log(`[CONCEPT VECTOR GENERATION OPTIMIZED] Sample concept: "${concepts[0]?.concept}"`);

				const vectorResult = await generateAndStoreConceptVectors(concepts, embeddingMap);

				console.log(`[CONCEPT VECTOR GENERATION OPTIMIZED] Vector generation result:`, {
					success: vectorResult.success,
					vectorsStored: vectorResult.success ? vectorResult.data.vectorsStored : 0,
					error: vectorResult.success ? null : vectorResult.error,
				});

				if (vectorResult.success) {
					vectorsGenerated = vectorResult.data.vectorsStored;
					console.log(
						`[CONCEPT VECTOR GENERATION OPTIMIZED] ✅ Successfully stored ${vectorsGenerated} concept vectors using embedding map`
					);
				} else {
					console.warn(
						`[CONCEPT VECTOR GENERATION OPTIMIZED] ❌ Failed to store concept vectors:`,
						vectorResult.error
					);
					// Don't fail the entire operation if vector generation fails
				}
			} catch (error) {
				console.warn(
					`[CONCEPT VECTOR GENERATION OPTIMIZED] ❌ Concept vector generation error (non-blocking):`,
					error
				);
				// Vector generation is non-blocking - continue with success
			}
		} else {
			if (!embeddingMap) {
				console.warn(
					`[CONCEPT VECTOR DEBUG] ⚠️ No embedding map provided - concept vectors will not be generated`
				);
			}
			if (concepts.length === 0) {
				console.warn(`[CONCEPT VECTOR DEBUG] ⚠️ No concepts to generate vectors for`);
			}
		}

		return {
			success: true,
			data: {
				conceptsStored: concepts.length,
				vectorsGenerated,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'STORAGE_ERROR',
				message: 'Failed to store concepts',
				cause: error,
			},
		};
	}
}

/**
 * Get knowledge graph statistics
 */
export async function getStats(): Promise<Result<GraphStats>> {
	try {
		const [totalTriples, totalConcepts, triplesByType] = await Promise.all([
			getTripleCount(),
			getConceptCount(),
			getTripleCountByType(),
		]);

		return {
			success: true,
			data: {
				totalTriples,
				totalConcepts,
				triplesByType,
				lastUpdated: new Date().toISOString(),
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'STORAGE_ERROR',
				message: 'Failed to get graph statistics',
				cause: error,
			},
		};
	}
}

/**
 * Generate a deterministic ID for a triple
 */
export function generateTripleId(triple: Triple): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

/**
 * Generate a deterministic ID for a concept
 */
export function generateConceptId(concept: Concept) {
	const key = `${concept.concept}|${concept.abstraction_level}|${concept.source}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

/**
 * Enumerate entities in the knowledge graph with filtering and sorting
 */
export async function enumerateEntities(
	options: EntityEnumerationOptions
): Promise<Result<EntityEnumerationResult[]>> {
	try {
		const {
			role = 'both',
			min_occurrence = 1,
			sources = [],
			types = [],
			limit = 100,
			sort_by = 'frequency',
		} = options;

		// Get all triples from database
		const triplesResult = await getAllTriples();
		if (!triplesResult.success) {
			return triplesResult;
		}

		const triples = triplesResult.data;
		const entityStats = new Map<
			string,
			{
				occurrences: number;
				roles: Set<'subject' | 'object'>;
				sources: Set<string>;
				types: Set<TripleType>;
				last_seen: string;
				confidence?: number;
			}
		>();

		// Collect entity statistics
		for (const triple of triples) {
			// Apply type filter
			if (types.length > 0 && !types.includes(triple.type)) {
				continue;
			}

			// Apply source filter
			if (sources.length > 0 && !sources.includes(triple.source)) {
				continue;
			}

			// Process subject
			if (role === 'subject' || role === 'both') {
				const entity = triple.subject;
				if (!entityStats.has(entity)) {
					entityStats.set(entity, {
						occurrences: 0,
						roles: new Set(),
						sources: new Set(),
						types: new Set(),
						last_seen: triple.extracted_at.toISOString(),
					});
				}

				const stats = entityStats.get(entity)!;
				stats.occurrences++;
				stats.roles.add('subject');
				stats.sources.add(triple.source);
				stats.types.add(triple.type);
				if (triple.extracted_at.toISOString() > stats.last_seen) {
					stats.last_seen = triple.extracted_at.toISOString();
				}
				if (
					triple.confidence &&
					(!stats.confidence || triple.confidence.greaterThan(stats.confidence))
				) {
					stats.confidence = triple.confidence.toNumber();
				}
			}

			// Process object
			if (role === 'object' || role === 'both') {
				const entity = triple.object;
				if (!entityStats.has(entity)) {
					entityStats.set(entity, {
						occurrences: 0,
						roles: new Set(),
						sources: new Set(),
						types: new Set(),
						last_seen: triple.extracted_at.toISOString(),
					});
				}

				const stats = entityStats.get(entity)!;
				stats.occurrences++;
				stats.roles.add('object');
				stats.sources.add(triple.source);
				stats.types.add(triple.type);
				if (triple.extracted_at.toISOString() > stats.last_seen) {
					stats.last_seen = triple.extracted_at.toISOString();
				}
				if (
					triple.confidence &&
					(!stats.confidence || triple.confidence.greaterThan(stats.confidence))
				) {
					stats.confidence = triple.confidence.toNumber();
				}
			}
		}

		// Convert to results and apply min_occurrence filter
		let results: EntityEnumerationResult[] = Array.from(entityStats.entries())
			.filter(([_, stats]) => stats.occurrences >= min_occurrence)
			.map(([entity, stats]) => ({
				entity,
				occurrences: stats.occurrences,
				roles: Array.from(stats.roles),
				sources: Array.from(stats.sources),
				types: Array.from(stats.types),
				last_seen: stats.last_seen,
				confidence: stats.confidence,
			}));

		// Sort results
		switch (sort_by) {
			case 'frequency':
				results.sort((a, b) => b.occurrences - a.occurrences);
				break;
			case 'alphabetical':
				results.sort((a, b) => a.entity.localeCompare(b.entity));
				break;
			case 'recent':
				results.sort((a, b) => b.last_seen.localeCompare(a.last_seen));
				break;
		}

		// Apply limit
		if (limit > 0) {
			results = results.slice(0, limit);
		}

		return {
			success: true,
			data: results,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'ENUMERATION_ERROR',
				message: 'Failed to enumerate entities',
				cause: error,
			},
		};
	}
}

/**
 * Generate and store vectors for knowledge triples using pre-generated embedding map
 * Creates entity, relationship, and semantic vectors for efficient search
 */
async function generateAndStoreVectors(
	triples: Triple[],
	embeddingMap: Map<string, number[]>
): Promise<Result<{ vectorsStored: number }>> {
	try {
		console.log(`[VECTOR OPTIMIZED] Starting optimized vector generation for ${triples.length} triples using embedding map`);

		const entityVectors: Array<{
			vector_id: string;
			text: string;
			embedding: number[];
			entity_name: string;
			knowledge_triple_id: string;
		}> = [];

		const relationshipVectors: Array<{
			vector_id: string;
			text: string;
			embedding: number[];
			knowledge_triple_id: string;
		}> = [];

		const semanticVectors: Array<{
			vector_id: string;
			text: string;
			embedding: number[];
			knowledge_triple_id: string;
		}> = [];

		// Collect unique entities and relationships
		const uniqueEntities = new Set<string>();
		const uniqueRelationships = new Set<string>();

		for (const triple of triples) {
			uniqueEntities.add(triple.subject);
			uniqueEntities.add(triple.object);
			uniqueRelationships.add(triple.predicate);
		}

		console.log(
			`[VECTOR OPTIMIZED] Processing ${uniqueEntities.size} entities, ${uniqueRelationships.size} relationships, ${triples.length} semantic texts`
		);

		// Generate entity vectors using embedding map
		let entityLookupMisses = 0;
		for (const entity of uniqueEntities) {
			const embedding = embeddingMap.get(entity);
			if (!embedding) {
				console.warn(`[VECTOR OPTIMIZED] ⚠️ Missing embedding for entity: "${entity}"`);
				entityLookupMisses++;
				continue;
			}

			// Find all triples that contain this entity
			for (const triple of triples) {
				if (triple.subject === entity || triple.object === entity) {
					entityVectors.push({
						vector_id: uuidv4(),
						text: entity,
						embedding,
						entity_name: entity,
						knowledge_triple_id: (triple as any).id,
					});
				}
			}
		}

		// Generate relationship vectors using embedding map
		let relationshipLookupMisses = 0;
		for (const relationship of uniqueRelationships) {
			const embedding = embeddingMap.get(relationship);
			if (!embedding) {
				console.warn(`[VECTOR OPTIMIZED] ⚠️ Missing embedding for relationship: "${relationship}"`);
				relationshipLookupMisses++;
				continue;
			}

			// Find all triples that contain this relationship
			for (const triple of triples) {
				if (triple.predicate === relationship) {
					relationshipVectors.push({
						vector_id: uuidv4(),
						text: relationship,
						embedding,
						knowledge_triple_id: (triple as any).id,
					});
				}
			}
		}

		// Generate semantic vectors using embedding map
		let semanticLookupMisses = 0;
		for (const triple of triples) {
			const semanticText = `${triple.subject} ${triple.predicate} ${triple.object}`;
			const embedding = embeddingMap.get(semanticText);
			if (!embedding) {
				console.warn(`[VECTOR OPTIMIZED] ⚠️ Missing embedding for semantic text: "${semanticText}"`);
				semanticLookupMisses++;
				continue;
			}

			semanticVectors.push({
				vector_id: uuidv4(),
				text: semanticText,
				embedding,
				knowledge_triple_id: (triple as any).id,
			});
		}

		// Report embedding lookup results
		const totalLookupMisses = entityLookupMisses + relationshipLookupMisses + semanticLookupMisses;
		if (totalLookupMisses > 0) {
			console.warn(`[VECTOR OPTIMIZED] ⚠️ ${totalLookupMisses} embedding lookups failed (${entityLookupMisses} entities, ${relationshipLookupMisses} relationships, ${semanticLookupMisses} semantic)`);
		} else {
			console.log(`[VECTOR OPTIMIZED] ✅ All embedding lookups successful - no API calls needed!`);
		}

		// Store all vectors in database
		const totalVectors = entityVectors.length + relationshipVectors.length + semanticVectors.length;
		console.log(
			`[VECTOR OPTIMIZED] Preparing to store ${totalVectors} vectors (${entityVectors.length} entity, ${relationshipVectors.length} relationship, ${semanticVectors.length} semantic)`
		);

		if (totalVectors === 0) {
			console.warn(`[VECTOR OPTIMIZED] ⚠️ No vectors to store - all embedding lookups failed`);
			return {
				success: true,
				data: {
					vectorsStored: 0,
				},
			};
		}

		try {
			const storeResult = await createVectors({
				entity: entityVectors,
				relationship: relationshipVectors,
				semantic: semanticVectors,
			});

			console.log(`[VECTOR OPTIMIZED] Vector storage result:`, {
				success: storeResult.success,
				error: storeResult.success ? null : storeResult.error,
			});

			if (!storeResult.success) {
				console.warn(`[VECTOR OPTIMIZED] ❌ Failed to store vectors:`, storeResult.error);
				return storeResult;
			}

			console.log(
				`[VECTOR OPTIMIZED] ✅ Successfully generated and stored ${totalVectors} vectors using embedding map (${entityVectors.length} entity, ${relationshipVectors.length} relationship, ${semanticVectors.length} semantic)`
			);

			return {
				success: true,
				data: {
					vectorsStored: totalVectors,
				},
			};
		} catch (error) {
			console.warn(`[VECTOR OPTIMIZED] ❌ Vector storage error:`, error);
			return {
				success: false,
				error: {
					type: 'VECTOR_STORAGE_ERROR',
					message: 'Failed to store vectors in database',
					cause: error,
				},
			};
		}
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'VECTOR_GENERATION_ERROR',
				message: 'Failed to generate and store vectors',
				cause: error,
			},
		};
	}
}

/**
 * Generate and store vectors for concept nodes using pre-generated embedding map
 * Creates concept vectors for efficient conceptual similarity search
 */
async function generateAndStoreConceptVectors(
	concepts: Concept[],
	embeddingMap: Map<string, number[]>
): Promise<Result<{ vectorsStored: number }>> {
	try {
		console.log(
			`[CONCEPT VECTOR OPTIMIZED] Starting optimized concept vector generation for ${concepts.length} concepts using embedding map`
		);

		if (concepts.length === 0) {
			console.log(`[CONCEPT VECTOR OPTIMIZED] No concepts to process`);
			return {
				success: true,
				data: {
					vectorsStored: 0,
				},
			};
		}

		const conceptVectors: Array<{
			vector_id: string;
			text: string;
			embedding: number[];
			concept_node_id: string;
		}> = [];

		// Generate concept vectors using embedding map
		let conceptLookupMisses = 0;
		for (const concept of concepts) {
			const conceptText = concept.concept;
			const embedding = embeddingMap.get(conceptText);
			
			if (!embedding) {
				console.warn(`[CONCEPT VECTOR OPTIMIZED] ⚠️ Missing embedding for concept: "${conceptText}"`);
				conceptLookupMisses++;
				continue;
			}

			conceptVectors.push({
				vector_id: uuidv4(),
				text: conceptText,
				embedding,
				concept_node_id: generateConceptId(concept),
			});
		}

		// Report embedding lookup results
		if (conceptLookupMisses > 0) {
			console.warn(`[CONCEPT VECTOR OPTIMIZED] ⚠️ ${conceptLookupMisses} concept embedding lookups failed`);
		} else {
			console.log(`[CONCEPT VECTOR OPTIMIZED] ✅ All concept embedding lookups successful - no API calls needed!`);
		}

		// Store concept vectors in database
		const totalVectors = conceptVectors.length;
		console.log(`[CONCEPT VECTOR OPTIMIZED] Preparing to store ${totalVectors} concept vectors`);

		if (totalVectors === 0) {
			console.warn(
				`[CONCEPT VECTOR OPTIMIZED] ⚠️ No concept vectors to store - all embedding lookups failed`
			);
			return {
				success: true,
				data: {
					vectorsStored: 0,
				},
			};
		}

		try {
			const storeResult = await createVectors({
				concept: conceptVectors,
			});

			console.log(`[CONCEPT VECTOR OPTIMIZED] Concept vector storage result:`, {
				success: storeResult.success,
				error: storeResult.success ? null : storeResult.error,
			});

			if (!storeResult.success) {
				console.warn(
					`[CONCEPT VECTOR OPTIMIZED] ❌ Failed to store concept vectors:`,
					storeResult.error
				);
				return storeResult;
			}

			console.log(
				`[CONCEPT VECTOR OPTIMIZED] ✅ Successfully generated and stored ${totalVectors} concept vectors using embedding map`
			);

			return {
				success: true,
				data: {
					vectorsStored: totalVectors,
				},
			};
		} catch (error) {
			console.warn(`[CONCEPT VECTOR OPTIMIZED] ❌ Concept vector storage error:`, error);
			return {
				success: false,
				error: {
					type: 'CONCEPT_VECTOR_STORAGE_ERROR',
					message: 'Failed to store concept vectors in database',
					cause: error,
				},
			};
		}
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'CONCEPT_VECTOR_GENERATION_ERROR',
				message: 'Failed to generate and store concept vectors',
				cause: error,
			},
		};
	}
}
