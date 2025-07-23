import type {
	KnowledgeTriple,
	ConceptNode,
	KnowledgeGraphConfig,
} from '../../shared/types/index.js';
import type { DatabaseAdapter, EmbeddingService, Result } from '~/shared/types/index.js';
import type { GraphStats } from '~/shared/types/index.js';
import type { StoreResult } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export interface EntityEnumerationOptions {
	role?: 'subject' | 'object' | 'both';
	min_occurrence?: number;
	sources?: string[];
	types?: Array<'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context'>;
	limit?: number;
	sort_by?: 'frequency' | 'alphabetical' | 'recent';
}

export interface EntityEnumerationResult {
	entity: string;
	occurrences: number;
	roles: Array<'subject' | 'object'>;
	sources: string[];
	types: Array<'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context'>;
	last_seen: string;
	confidence?: number;
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
	triples: KnowledgeTriple[],
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig,
	embeddingService?: EmbeddingService
): Promise<Result<StoreResult>> {
	try {
		// Generate IDs for each triple
		const triplesWithIds = triples.map(triple => ({
			...triple,
			id: generateTripleId(triple),
		}));

		// Check for existing triples
		const ids = triplesWithIds.map(t => t.id);
		const existingIds = await db.checkExistingTriples(ids);

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
		const storeResult = await db.storeTriples(newTriples);
		if (!storeResult.success) {
			return storeResult;
		}

		// Generate and store vectors for the new triples (if embedding service available)
		let vectorsGenerated = 0;

		console.log(`[VECTOR DEBUG] embeddingService present: ${!!embeddingService}`);
		console.log(`[VECTOR DEBUG] newTriples.length: ${newTriples.length}`);
		console.log(`[VECTOR DEBUG] embeddingService type: ${typeof embeddingService}`);

		if (embeddingService && newTriples.length > 0) {
			try {
				console.log(
					`[VECTOR GENERATION] Starting vector generation for ${newTriples.length} new triples...`
				);
				console.log(
					`[VECTOR GENERATION] Sample triple: "${newTriples[0]?.subject}" → "${newTriples[0]?.predicate}" → "${newTriples[0]?.object}"`
				);

				const vectorResult = await generateAndStoreVectors(
					newTriples,
					embeddingService,
					db,
					config
				);

				console.log(`[VECTOR GENERATION] Vector generation result:`, {
					success: vectorResult.success,
					vectorsStored: vectorResult.success ? vectorResult.data.vectorsStored : 0,
					error: vectorResult.success ? null : vectorResult.error,
				});

				if (vectorResult.success) {
					vectorsGenerated = vectorResult.data.vectorsStored;
					console.log(`[VECTOR GENERATION] ✅ Successfully stored ${vectorsGenerated} vectors`);
				} else {
					console.warn(`[VECTOR GENERATION] ❌ Failed to store vectors:`, vectorResult.error);
					// Don't fail the entire operation if vector generation fails
				}
			} catch (error) {
				console.warn(`[VECTOR GENERATION] ❌ Vector generation error (non-blocking):`, error);
				// Vector generation is non-blocking - continue with success
			}
		} else {
			if (!embeddingService) {
				console.warn(
					`[VECTOR DEBUG] ⚠️  No embedding service provided - vectors will not be generated`
				);
			}
			if (newTriples.length === 0) {
				console.warn(`[VECTOR DEBUG] ⚠️  No new triples to generate vectors for`);
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
	concepts: ConceptNode[],
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig,
	embeddingService?: EmbeddingService
): Promise<Result<{ conceptsStored: number; vectorsGenerated?: number }>> {
	try {
		// Store concepts first
		const result = await db.storeConcepts(concepts);
		if (!result.success) {
			return result;
		}

		let vectorsGenerated: number | undefined = undefined;

		// Generate and store vectors for the concepts (if embedding service available)
		console.log(`[CONCEPT VECTOR DEBUG] embeddingService present: ${!!embeddingService}`);
		console.log(`[CONCEPT VECTOR DEBUG] concepts.length: ${concepts.length}`);

		if (embeddingService && concepts.length > 0) {
			try {
				console.log(
					`[CONCEPT VECTOR GENERATION] Starting vector generation for ${concepts.length} concepts...`
				);
				console.log(`[CONCEPT VECTOR GENERATION] Sample concept: "${concepts[0]?.concept}"`);

				const vectorResult = await generateAndStoreConceptVectors(
					concepts,
					embeddingService,
					db,
					config
				);

				console.log(`[CONCEPT VECTOR GENERATION] Vector generation result:`, {
					success: vectorResult.success,
					vectorsStored: vectorResult.success ? vectorResult.data.vectorsStored : 0,
					error: vectorResult.success ? null : vectorResult.error,
				});

				if (vectorResult.success) {
					vectorsGenerated = vectorResult.data.vectorsStored;
					console.log(
						`[CONCEPT VECTOR GENERATION] ✅ Successfully stored ${vectorsGenerated} concept vectors`
					);
				} else {
					console.warn(
						`[CONCEPT VECTOR GENERATION] ❌ Failed to store concept vectors:`,
						vectorResult.error
					);
					// Don't fail the entire operation if vector generation fails
				}
			} catch (error) {
				console.warn(
					`[CONCEPT VECTOR GENERATION] ❌ Concept vector generation error (non-blocking):`,
					error
				);
				// Vector generation is non-blocking - continue with success
			}
		} else {
			if (!embeddingService) {
				console.warn(
					`[CONCEPT VECTOR DEBUG] ⚠️  No embedding service provided - concept vectors will not be generated`
				);
			}
			if (concepts.length === 0) {
				console.warn(`[CONCEPT VECTOR DEBUG] ⚠️  No concepts to generate vectors for`);
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
export async function getStats(db: DatabaseAdapter): Promise<Result<GraphStats>> {
	try {
		const [totalTriples, totalConcepts, triplesByType] = await Promise.all([
			db.getTripleCount(),
			db.getConceptCount(),
			db.getTripleCountByType(),
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
export function generateTripleId(triple: KnowledgeTriple): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

/**
 * Generate a deterministic ID for a concept
 */
export function generateConceptId(concept: ConceptNode): string {
	const key = `${concept.concept}|${concept.abstraction_level}|${concept.source}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

/**
 * Enumerate entities in the knowledge graph with filtering and sorting
 */
export async function enumerateEntities(
	options: EntityEnumerationOptions,
	db: DatabaseAdapter
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
		const triplesResult = await db.getAllTriples();
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
				types: Set<'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context'>;
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
						last_seen: triple.extracted_at,
					});
				}

				const stats = entityStats.get(entity)!;
				stats.occurrences++;
				stats.roles.add('subject');
				stats.sources.add(triple.source);
				stats.types.add(triple.type);
				if (triple.extracted_at > stats.last_seen) {
					stats.last_seen = triple.extracted_at;
				}
				if (triple.confidence && (!stats.confidence || triple.confidence > stats.confidence)) {
					stats.confidence = triple.confidence;
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
						last_seen: triple.extracted_at,
					});
				}

				const stats = entityStats.get(entity)!;
				stats.occurrences++;
				stats.roles.add('object');
				stats.sources.add(triple.source);
				stats.types.add(triple.type);
				if (triple.extracted_at > stats.last_seen) {
					stats.last_seen = triple.extracted_at;
				}
				if (triple.confidence && (!stats.confidence || triple.confidence > stats.confidence)) {
					stats.confidence = triple.confidence;
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
 * Generate and store vectors for knowledge triples
 * Creates entity, relationship, and semantic vectors for efficient search
 */
async function generateAndStoreVectors(
	triples: KnowledgeTriple[],
	embeddingService: EmbeddingService,
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig
): Promise<Result<{ vectorsStored: number }>> {
	try {
		console.log(`[VECTOR DETAIL] Starting vector generation for ${triples.length} triples`);

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

		// Collect unique entities and relationships for batch embedding generation
		const uniqueEntities = new Set<string>();
		const uniqueRelationships = new Set<string>();
		const semanticTexts: string[] = [];
		const tripleIds: string[] = [];

		for (const triple of triples) {
			uniqueEntities.add(triple.subject);
			uniqueEntities.add(triple.object);
			uniqueRelationships.add(triple.predicate);

			// Generate semantic text combining all parts of the triple
			const semanticText = `${triple.subject} ${triple.predicate} ${triple.object}`;
			semanticTexts.push(semanticText);
			tripleIds.push((triple as any).id);
		}

		console.log(
			`[VECTOR DETAIL] Collected ${uniqueEntities.size} entities, ${uniqueRelationships.size} relationships, ${semanticTexts.length} semantic texts`
		);
		console.log(`[VECTOR DETAIL] Sample semantic text: "${semanticTexts[0]}"`);

		const batchSize = config.embeddings?.batchSize || 32;
		let totalVectors = 0;

		console.log(`[VECTOR DETAIL] Using batch size: ${batchSize}`);

		// Generate entity embeddings
		const entityArray = Array.from(uniqueEntities);
		console.log(
			`[VECTOR DETAIL] Processing ${entityArray.length} entities in ${Math.ceil(entityArray.length / batchSize)} batches`
		);

		for (let i = 0; i < entityArray.length; i += batchSize) {
			const batch = entityArray.slice(i, i + batchSize);
			console.log(
				`[VECTOR DETAIL] Generating embeddings for entity batch ${Math.floor(i / batchSize) + 1}: ${batch.length} entities`
			);

			try {
				const embeddings = await embeddingService.embedBatch(batch);
				console.log(`[VECTOR DETAIL] Entity embeddings result:`, {
					success: embeddings.success,
					dataLength: embeddings.success ? embeddings.data.length : 0,
				});

				if (embeddings.success) {
					for (let j = 0; j < batch.length; j++) {
						const entity = batch[j];
						const embedding = embeddings.data[j];

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
					console.log(`[VECTOR DETAIL] Added ${batch.length} entity vectors for this batch`);
				} else {
					console.warn(`[VECTOR DETAIL] ❌ Entity embedding failed:`, embeddings.error);
				}
			} catch (error) {
				console.warn(`[VECTOR DETAIL] ❌ Entity embedding error:`, error);
			}
		}

		// Generate relationship embeddings
		const relationshipArray = Array.from(uniqueRelationships);
		for (let i = 0; i < relationshipArray.length; i += batchSize) {
			const batch = relationshipArray.slice(i, i + batchSize);
			const embeddings = await embeddingService.embedBatch(batch);

			if (embeddings.success) {
				for (let j = 0; j < batch.length; j++) {
					const relationship = batch[j];
					const embedding = embeddings.data[j];

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
			}
		}

		// Generate semantic embeddings (full triple content)
		console.log(
			`[VECTOR DETAIL] Processing ${semanticTexts.length} semantic texts in ${Math.ceil(semanticTexts.length / batchSize)} batches`
		);

		for (let i = 0; i < semanticTexts.length; i += batchSize) {
			const batch = semanticTexts.slice(i, i + batchSize);
			const batchIds = tripleIds.slice(i, i + batchSize);
			console.log(
				`[VECTOR DETAIL] Generating semantic embeddings for batch ${Math.floor(i / batchSize) + 1}: ${batch.length} texts`
			);
			console.log(`[VECTOR DETAIL] Sample text: "${batch[0]}"`);
			console.log(`[VECTOR DETAIL] Sample triple ID: "${batchIds[0]}"`);

			try {
				const embeddings = await embeddingService.embedBatch(batch);
				console.log(`[VECTOR DETAIL] Semantic embeddings result:`, {
					success: embeddings.success,
					dataLength: embeddings.success ? embeddings.data.length : 0,
					firstEmbeddingLength:
						embeddings.success && embeddings.data[0] ? embeddings.data[0].length : 0,
				});

				if (embeddings.success) {
					for (let j = 0; j < batch.length; j++) {
						semanticVectors.push({
							vector_id: uuidv4(),
							text: batch[j],
							embedding: embeddings.data[j],
							knowledge_triple_id: batchIds[j],
						});
					}
					console.log(`[VECTOR DETAIL] Added ${batch.length} semantic vectors for this batch`);
				} else {
					console.warn(`[VECTOR DETAIL] ❌ Semantic embedding failed:`, embeddings.error);
				}
			} catch (error) {
				console.warn(`[VECTOR DETAIL] ❌ Semantic embedding error:`, error);
			}
		}

		// Store all vectors in database
		totalVectors = entityVectors.length + relationshipVectors.length + semanticVectors.length;
		console.log(
			`[VECTOR DETAIL] Preparing to store ${totalVectors} vectors (${entityVectors.length} entity, ${relationshipVectors.length} relationship, ${semanticVectors.length} semantic)`
		);

		if (totalVectors === 0) {
			console.warn(`[VECTOR DETAIL] ⚠️  No vectors to store - all embedding generations failed`);
			return {
				success: true,
				data: {
					vectorsStored: 0,
				},
			};
		}

		try {
			const storeResult = await db.storeVectors({
				entity: entityVectors,
				relationship: relationshipVectors,
				semantic: semanticVectors,
			});

			console.log(`[VECTOR DETAIL] Vector storage result:`, {
				success: storeResult.success,
				error: storeResult.success ? null : storeResult.error,
			});

			if (!storeResult.success) {
				console.warn(`[VECTOR DETAIL] ❌ Failed to store vectors:`, storeResult.error);
				return storeResult;
			}

			console.log(
				`[VECTOR GENERATION] ✅ Successfully generated and stored ${totalVectors} vectors (${entityVectors.length} entity, ${relationshipVectors.length} relationship, ${semanticVectors.length} semantic)`
			);

			return {
				success: true,
				data: {
					vectorsStored: totalVectors,
				},
			};
		} catch (error) {
			console.warn(`[VECTOR DETAIL] ❌ Vector storage error:`, error);
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
 * Generate and store vectors for concept nodes
 * Creates concept vectors for efficient conceptual similarity search
 */
async function generateAndStoreConceptVectors(
	concepts: ConceptNode[],
	embeddingService: EmbeddingService,
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig
): Promise<Result<{ vectorsStored: number }>> {
	try {
		console.log(
			`[CONCEPT VECTOR DETAIL] Starting concept vector generation for ${concepts.length} concepts`
		);

		if (concepts.length === 0) {
			console.log(`[CONCEPT VECTOR DETAIL] No concepts to process`);
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

		// Generate concept texts for embedding
		const conceptTexts: string[] = [];
		const conceptIds: string[] = [];

		for (const concept of concepts) {
			// Create rich text representation of the concept
			const conceptText = concept.concept; // Start with the concept name
			conceptTexts.push(conceptText);
			conceptIds.push(generateConceptId(concept));
		}

		console.log(`[CONCEPT VECTOR DETAIL] Generated concept texts for ${concepts.length} concepts`);
		console.log(`[CONCEPT VECTOR DETAIL] Sample concept text: "${conceptTexts[0]}"`);

		const batchSize = config.embeddings?.batchSize || 32;
		console.log(`[CONCEPT VECTOR DETAIL] Using batch size: ${batchSize}`);

		// Generate concept embeddings in batches
		for (let i = 0; i < conceptTexts.length; i += batchSize) {
			const batch = conceptTexts.slice(i, i + batchSize);
			const batchIds = conceptIds.slice(i, i + batchSize);

			console.log(
				`[CONCEPT VECTOR DETAIL] Generating concept embeddings for batch ${Math.floor(i / batchSize) + 1}: ${batch.length} concepts`
			);
			console.log(`[CONCEPT VECTOR DETAIL] Sample concept in batch: "${batch[0]}"`);
			console.log(`[CONCEPT VECTOR DETAIL] Sample concept ID: "${batchIds[0]}"`);

			try {
				const embeddings = await embeddingService.embedBatch(batch);
				console.log(`[CONCEPT VECTOR DETAIL] Concept embeddings result:`, {
					success: embeddings.success,
					dataLength: embeddings.success ? embeddings.data.length : 0,
					firstEmbeddingLength:
						embeddings.success && embeddings.data[0] ? embeddings.data[0].length : 0,
				});

				if (embeddings.success) {
					for (let j = 0; j < batch.length; j++) {
						conceptVectors.push({
							vector_id: uuidv4(),
							text: batch[j],
							embedding: embeddings.data[j],
							concept_node_id: batchIds[j],
						});
					}
					console.log(
						`[CONCEPT VECTOR DETAIL] Added ${batch.length} concept vectors for this batch`
					);
				} else {
					console.warn(`[CONCEPT VECTOR DETAIL] ❌ Concept embedding failed:`, embeddings.error);
				}
			} catch (error) {
				console.warn(`[CONCEPT VECTOR DETAIL] ❌ Concept embedding error:`, error);
			}
		}

		// Store concept vectors in database
		const totalVectors = conceptVectors.length;
		console.log(`[CONCEPT VECTOR DETAIL] Preparing to store ${totalVectors} concept vectors`);

		if (totalVectors === 0) {
			console.warn(
				`[CONCEPT VECTOR DETAIL] ⚠️  No concept vectors to store - all embedding generations failed`
			);
			return {
				success: true,
				data: {
					vectorsStored: 0,
				},
			};
		}

		try {
			const storeResult = await db.storeVectors({
				concept: conceptVectors,
			});

			console.log(`[CONCEPT VECTOR DETAIL] Concept vector storage result:`, {
				success: storeResult.success,
				error: storeResult.success ? null : storeResult.error,
			});

			if (!storeResult.success) {
				console.warn(
					`[CONCEPT VECTOR DETAIL] ❌ Failed to store concept vectors:`,
					storeResult.error
				);
				return storeResult;
			}

			console.log(
				`[CONCEPT VECTOR GENERATION] ✅ Successfully generated and stored ${totalVectors} concept vectors`
			);

			return {
				success: true,
				data: {
					vectorsStored: totalVectors,
				},
			};
		} catch (error) {
			console.warn(`[CONCEPT VECTOR DETAIL] ❌ Concept vector storage error:`, error);
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
