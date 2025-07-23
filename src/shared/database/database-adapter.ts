import { db } from './client.js';
import type {
	KnowledgeTriple,
	ConceptNode,
	ConceptualizationRelationship,
	TripleType,
	TokenUsage,
} from '../types/index.js';
import type {
	DatabaseAdapter,
	Result,
	DatabaseConfig,
	SearchOptions,
	TemporalFilter,
} from '../types/index.js';
import type { EntityType } from '../types/core.js';

/**
 * Build temporal filter for Prisma queries
 */
function buildTemporalFilter(temporal?: TemporalFilter) {
	if (!temporal) return {};

	const filter: any = {};

	// Handle direct date range
	if (temporal.fromDate || temporal.toDate) {
		filter.source_date = {};
		if (temporal.fromDate) {
			filter.source_date.gte = new Date(temporal.fromDate);
		}
		if (temporal.toDate) {
			filter.source_date.lte = new Date(temporal.toDate);
		}
	}

	// Handle time window
	if (temporal.timeWindow) {
		const fromDate =
			temporal.timeWindow.from === 'now' ? new Date() : new Date(temporal.timeWindow.from);

		const toDate = new Date(fromDate);

		// Calculate the time range based on unit
		switch (temporal.timeWindow.unit) {
			case 'days':
				fromDate.setDate(fromDate.getDate() - temporal.timeWindow.value);
				break;
			case 'weeks':
				fromDate.setDate(fromDate.getDate() - temporal.timeWindow.value * 7);
				break;
			case 'months':
				fromDate.setMonth(fromDate.getMonth() - temporal.timeWindow.value);
				break;
			case 'years':
				fromDate.setFullYear(fromDate.getFullYear() - temporal.timeWindow.value);
				break;
		}

		filter.source_date = {
			gte: fromDate,
			lte: toDate,
		};
	}

	return filter;
}

/**
 * Database adapter implementation using Prisma
 * Implements the DatabaseAdapter interface for dependency injection
 */
export function createDatabaseAdapter(config: DatabaseConfig): DatabaseAdapter {
	return {
		// Triple operations
		async storeTriples(triples: KnowledgeTriple[]): Promise<Result<void>> {
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
		},

		async checkExistingTriples(ids: string[]): Promise<string[]> {
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
		},

		async tripleExists(id: string): Promise<boolean> {
			try {
				const count = await db.knowledgeTriple.count({
					where: { id },
				});
				return count > 0;
			} catch (error) {
				console.error('Error checking triple existence:', error);
				return false;
			}
		},

		async getTriplesByIds(ids: string[]): Promise<KnowledgeTriple[]> {
			try {
				const triples = await db.knowledgeTriple.findMany({
					where: { id: { in: ids } },
				});
				return triples.map(mapPrismaTriple);
			} catch (error) {
				console.error('Error getting triples by IDs:', error);
				return [];
			}
		},

		async getAllTriples(): Promise<Result<KnowledgeTriple[]>> {
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
		},

		async searchByText(query: string, searchType: string): Promise<Result<KnowledgeTriple[]>> {
			try {
				// Simple text search - in real implementation, this would use full-text search
				const triples = await db.knowledgeTriple.findMany({
					where: {
						OR: [
							{ subject: { contains: query, mode: 'insensitive' } },
							{ predicate: { contains: query, mode: 'insensitive' } },
							{ object: { contains: query, mode: 'insensitive' } },
						],
					},
					take: 50,
				});

				return {
					success: true,
					data: triples.map(mapPrismaTriple),
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by text',
						cause: error,
					},
				};
			}
		},

		async searchByEmbedding(
			embedding: number[],
			topK: number,
			minScore: number,
			options?: SearchOptions
		): Promise<Result<KnowledgeTriple[]>> {
			try {
				console.log(
					`[DB DEBUG] searchByEmbedding: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
				);

				// Convert embedding to pgvector format
				const vectorString = `[${embedding.join(',')}]`;

				// Build filter conditions for joins
				let whereClause = '1=1';
				const params: any[] = [vectorString, topK, minScore];
				let paramIndex = 3;

				// Add temporal filtering
				const temporalFilter = buildTemporalFilter(options?.temporal);
				if (temporalFilter.source_date) {
					if (temporalFilter.source_date.gte) {
						whereClause += ` AND kt.source_date >= $${++paramIndex}`;
						params.push(temporalFilter.source_date.gte);
					}
					if (temporalFilter.source_date.lte) {
						whereClause += ` AND kt.source_date <= $${++paramIndex}`;
						params.push(temporalFilter.source_date.lte);
					}
				}

				// Add source filtering
				if (options?.sources && options.sources.length > 0) {
					whereClause += ` AND kt.source = ANY($${++paramIndex})`;
					params.push(options.sources);
				}

				// Add type filtering
				if (options?.types && options.types.length > 0) {
					const enumTypes = options.types.map(type => {
						switch (type) {
							case 'entity-entity':
								return 'ENTITY_ENTITY';
							case 'entity-event':
								return 'ENTITY_EVENT';
							case 'event-event':
								return 'EVENT_EVENT';
							case 'emotional-context':
								return 'EMOTIONAL_CONTEXT';
							default:
								return;
						}
					});
					whereClause += ` AND kt.type = ANY($${++paramIndex})`;
					params.push(enumTypes);
				}

				// Perform vector similarity search using semantic vectors
				// This searches by the semantic meaning of complete triples
				const query = `
					SELECT DISTINCT kt.*, 
						   (sv.embedding <-> $1::vector) as distance,
						   (1 - (sv.embedding <-> $1::vector)) as similarity
					FROM knowledge_triples kt
					JOIN semantic_vectors sv ON kt.id = sv.knowledge_triple_id
					WHERE ${whereClause}
						AND (1 - (sv.embedding <-> $1::vector)) >= $3
					ORDER BY sv.embedding <-> $1::vector ASC
					LIMIT $2
				`;

				console.log(`[DB DEBUG] Executing semantic vector query: ${query.slice(0, 200)}...`);
				console.log(`[DB DEBUG] Query params: ${params.slice(1)}`); // Skip the long embedding

				const results = await db.$queryRawUnsafe(query, ...params);

				console.log(
					`[DB DEBUG] Semantic vector query returned ${Array.isArray(results) ? results.length : 'non-array'} results`
				);

				if (!Array.isArray(results)) {
					return {
						success: true,
						data: [],
					};
				}

				// Map results to KnowledgeTriple format
				const triples = results.map((row: any) => ({
					subject: row.subject,
					predicate: row.predicate,
					object: row.object,
					type: unmapTripleType(row.type),
					source: row.source,
					source_type: row.source_type,
					source_date: row.source_date?.toISOString(),
					extracted_at: row.extracted_at.toISOString(),
					processing_batch_id: row.processing_batch_id,
					confidence: row.confidence,
					// Add similarity score for debugging
					_similarity: row.similarity,
				}));

				return {
					success: true,
					data: triples,
				};
			} catch (error) {
				console.error('Vector search error:', error);
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by embedding',
						cause: error,
					},
				};
			}
		},

		// Multi-index search methods
		async searchByEntity(
			entityQuery: string,
			topK: number,
			options?: SearchOptions
		): Promise<Result<KnowledgeTriple[]>> {
			try {
				// Build filter conditions
				const whereConditions: any = {};

				// Add temporal filtering
				const temporalFilter = buildTemporalFilter(options?.temporal);
				Object.assign(whereConditions, temporalFilter);

				// Add source filtering
				if (options?.sources && options.sources.length > 0) {
					whereConditions.source = { in: options.sources };
				}

				// Add type filtering
				if (options?.types && options.types.length > 0) {
					const enumTypes = options.types.map(type => {
						switch (type) {
							case 'entity-entity':
								return 'ENTITY_ENTITY';
							case 'entity-event':
								return 'ENTITY_EVENT';
							case 'event-event':
								return 'EVENT_EVENT';
							case 'emotional-context':
								return 'EMOTIONAL_CONTEXT';
							default:
								return;
						}
					});
					whereConditions.type = { in: enumTypes };
				}

				// Entity search: find triples where entity appears as subject or object
				whereConditions.OR = [
					{ subject: { contains: entityQuery, mode: 'insensitive' } },
					{ object: { contains: entityQuery, mode: 'insensitive' } },
				];

				const triples = await db.knowledgeTriple.findMany({
					where: whereConditions,
					take: topK,
					orderBy: [
						// Exact matches first
						{ subject: entityQuery === undefined ? 'asc' : 'desc' },
						{ object: entityQuery === undefined ? 'asc' : 'desc' },
						// Then by recency
						{ created_at: 'desc' },
					],
				});

				return {
					success: true,
					data: triples.map(mapPrismaTriple),
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by entity',
						cause: error,
					},
				};
			}
		},

		async searchByRelationship(
			relationshipQuery: string,
			topK: number,
			options?: SearchOptions
		): Promise<Result<KnowledgeTriple[]>> {
			try {
				// Build filter conditions
				const whereConditions: any = {};

				// Add temporal filtering
				const temporalFilter = buildTemporalFilter(options?.temporal);
				Object.assign(whereConditions, temporalFilter);

				// Add source filtering
				if (options?.sources && options.sources.length > 0) {
					whereConditions.source = { in: options.sources };
				}

				// Add type filtering
				if (options?.types && options.types.length > 0) {
					const enumTypes = options.types.map(type => {
						switch (type) {
							case 'entity-entity':
								return 'ENTITY_ENTITY';
							case 'entity-event':
								return 'ENTITY_EVENT';
							case 'event-event':
								return 'EVENT_EVENT';
							case 'emotional-context':
								return 'EMOTIONAL_CONTEXT';
							default:
								return;
						}
					});
					whereConditions.type = { in: enumTypes };
				}

				// Relationship search: find triples where relationship appears in predicate
				whereConditions.predicate = {
					contains: relationshipQuery,
					mode: 'insensitive',
				};

				const triples = await db.knowledgeTriple.findMany({
					where: whereConditions,
					take: topK,
					orderBy: [
						// Exact matches first
						{ predicate: relationshipQuery === undefined ? 'asc' : 'desc' },
						// Then by recency
						{ created_at: 'desc' },
					],
				});

				return {
					success: true,
					data: triples.map(mapPrismaTriple),
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by relationship',
						cause: error,
					},
				};
			}
		},

		async searchByConcept(
			conceptQuery: string,
			topK: number,
			options?: SearchOptions
		): Promise<Result<KnowledgeTriple[]>> {
			try {
				// Build filter conditions for joins
				let whereClause = '1=1';
				const params: any[] = [conceptQuery, topK];
				let paramIndex = 2;

				// Add temporal filtering
				const temporalFilter = buildTemporalFilter(options?.temporal);
				if (temporalFilter.source_date) {
					if (temporalFilter.source_date.gte) {
						whereClause += ` AND kt.source_date >= $${++paramIndex}`;
						params.push(temporalFilter.source_date.gte);
					}
					if (temporalFilter.source_date.lte) {
						whereClause += ` AND kt.source_date <= $${++paramIndex}`;
						params.push(temporalFilter.source_date.lte);
					}
				}

				// Add source filtering
				if (options?.sources && options.sources.length > 0) {
					whereClause += ` AND kt.source = ANY($${++paramIndex})`;
					params.push(options.sources);
				}

				// Add type filtering
				if (options?.types && options.types.length > 0) {
					const enumTypes = options.types.map(type => {
						switch (type) {
							case 'entity-entity':
								return 'ENTITY_ENTITY';
							case 'entity-event':
								return 'ENTITY_EVENT';
							case 'event-event':
								return 'EVENT_EVENT';
							case 'emotional-context':
								return 'EMOTIONAL_CONTEXT';
							default:
									return;
						}
					});
					whereClause += ` AND kt.type = ANY($${++paramIndex})`;
					params.push(enumTypes);
				}

				// Concept search: find triples connected to concepts via conceptualization relationships
				const query = `
					SELECT DISTINCT kt.*, cr.confidence as concept_confidence
					FROM knowledge_triples kt
					JOIN conceptualization_relationships cr ON (
						kt.subject = cr.source_element OR 
						kt.object = cr.source_element OR 
						kt.predicate = cr.source_element
					)
					WHERE ${whereClause}
						AND cr.concept ILIKE '%' || $1 || '%'
					ORDER BY cr.confidence DESC, kt.created_at DESC
					LIMIT $2
				`;

				const results = await db.$queryRawUnsafe(query, ...params);

				if (!Array.isArray(results)) {
					return {
						success: true,
						data: [],
					};
				}

				// Map results to KnowledgeTriple format
				const triples = results.map((row: any) => ({
					subject: row.subject,
					predicate: row.predicate,
					object: row.object,
					type: unmapTripleType(row.type),
					source: row.source,
					source_type: row.source_type,
					source_date: row.source_date?.toISOString(),
					extracted_at: row.extracted_at.toISOString(),
					processing_batch_id: row.processing_batch_id,
					confidence: row.confidence,
					// Add concept confidence for debugging
					_concept_confidence: row.concept_confidence,
				}));

				return {
					success: true,
					data: triples,
				};
			} catch (error) {
				console.error('Concept search error:', error);
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by concept',
						cause: error,
					},
				};
			}
		},

		// Vector-based search methods for true fusion search
		async searchByEntityVector(
			embedding: number[],
			topK: number,
			minScore: number,
			options?: SearchOptions
		): Promise<Result<KnowledgeTriple[]>> {
			try {
				console.log(
					`[DB DEBUG] searchByEntityVector: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
				);

				// Convert embedding to pgvector format
				const vectorString = `[${embedding.join(',')}]`;

				// Build filter conditions for joins
				let whereClause = '1=1';
				const params: any[] = [vectorString, topK, minScore];
				let paramIndex = 3;

				// Add temporal filtering
				const temporalFilter = buildTemporalFilter(options?.temporal);
				if (temporalFilter.source_date) {
					if (temporalFilter.source_date.gte) {
						whereClause += ` AND kt.source_date >= $${++paramIndex}`;
						params.push(temporalFilter.source_date.gte);
					}
					if (temporalFilter.source_date.lte) {
						whereClause += ` AND kt.source_date <= $${++paramIndex}`;
						params.push(temporalFilter.source_date.lte);
					}
				}

				// Add source filtering
				if (options?.sources && options.sources.length > 0) {
					whereClause += ` AND kt.source = ANY($${++paramIndex})`;
					params.push(options.sources);
				}

				// Add type filtering
				if (options?.types && options.types.length > 0) {
					const enumTypes = options.types.map(type => {
						switch (type) {
							case 'entity-entity':
								return 'ENTITY_ENTITY';
							case 'entity-event':
								return 'ENTITY_EVENT';
							case 'event-event':
								return 'EVENT_EVENT';
							case 'emotional-context':
								return 'EMOTIONAL_CONTEXT';
							default:
								return;
						}
					});
					whereClause += ` AND kt.type = ANY($${++paramIndex})`;
					params.push(enumTypes);
				}

				// Perform entity vector similarity search
				// This searches by entity similarity using entity vectors
				const query = `
					SELECT DISTINCT kt.*, 
						   (ev.embedding <-> $1::vector) as distance,
						   (1 - (ev.embedding <-> $1::vector)) as similarity
					FROM knowledge_triples kt
					JOIN entity_vectors ev ON kt.id = ev.knowledge_triple_id
					WHERE ${whereClause}
						AND (1 - (ev.embedding <-> $1::vector)) >= $3
					ORDER BY ev.embedding <-> $1::vector ASC
					LIMIT $2
				`;

				console.log(`[DB DEBUG] Executing entity vector query: ${query.slice(0, 200)}...`);
				console.log(`[DB DEBUG] Query params: ${params.slice(1)}`); // Skip the long embedding

				const results = await db.$queryRawUnsafe(query, ...params);

				console.log(
					`[DB DEBUG] Entity vector query returned ${Array.isArray(results) ? results.length : 'non-array'} results`
				);

				if (!Array.isArray(results)) {
					return {
						success: true,
						data: [],
					};
				}

				// Map results to KnowledgeTriple format
				const triples = results.map((row: any) => ({
					subject: row.subject,
					predicate: row.predicate,
					object: row.object,
					type: unmapTripleType(row.type),
					source: row.source,
					source_type: row.source_type,
					source_date: row.source_date?.toISOString(),
					extracted_at: row.extracted_at.toISOString(),
					processing_batch_id: row.processing_batch_id,
					confidence: row.confidence,
					// Add similarity score for debugging
					_similarity: row.similarity,
				}));

				return {
					success: true,
					data: triples,
				};
			} catch (error) {
				console.error('Entity vector search error:', error);
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by entity vector',
						cause: error,
					},
				};
			}
		},

		async searchByRelationshipVector(
			embedding: number[],
			topK: number,
			minScore: number,
			options?: SearchOptions
		): Promise<Result<KnowledgeTriple[]>> {
			try {
				console.log(
					`[DB DEBUG] searchByRelationshipVector: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
				);

				// Convert embedding to pgvector format
				const vectorString = `[${embedding.join(',')}]`;

				// Build filter conditions for joins
				let whereClause = '1=1';
				const params: any[] = [vectorString, topK, minScore];
				let paramIndex = 3;

				// Add temporal filtering
				const temporalFilter = buildTemporalFilter(options?.temporal);
				if (temporalFilter.source_date) {
					if (temporalFilter.source_date.gte) {
						whereClause += ` AND kt.source_date >= $${++paramIndex}`;
						params.push(temporalFilter.source_date.gte);
					}
					if (temporalFilter.source_date.lte) {
						whereClause += ` AND kt.source_date <= $${++paramIndex}`;
						params.push(temporalFilter.source_date.lte);
					}
				}

				// Add source filtering
				if (options?.sources && options.sources.length > 0) {
					whereClause += ` AND kt.source = ANY($${++paramIndex})`;
					params.push(options.sources);
				}

				// Add type filtering
				if (options?.types && options.types.length > 0) {
					const enumTypes = options.types.map(type => {
						switch (type) {
							case 'entity-entity':
								return 'ENTITY_ENTITY';
							case 'entity-event':
								return 'ENTITY_EVENT';
							case 'event-event':
								return 'EVENT_EVENT';
							case 'emotional-context':
								return 'EMOTIONAL_CONTEXT';
							default:
								return;
						}
					});
					whereClause += ` AND kt.type = ANY($${++paramIndex})`;
					params.push(enumTypes);
				}

				// Perform relationship vector similarity search
				// This searches by relationship similarity using relationship vectors
				const query = `
					SELECT DISTINCT kt.*, 
						   (rv.embedding <-> $1::vector) as distance,
						   (1 - (rv.embedding <-> $1::vector)) as similarity
					FROM knowledge_triples kt
					JOIN relationship_vectors rv ON kt.id = rv.knowledge_triple_id
					WHERE ${whereClause}
						AND (1 - (rv.embedding <-> $1::vector)) >= $3
					ORDER BY rv.embedding <-> $1::vector ASC
					LIMIT $2
				`;

				console.log(`[DB DEBUG] Executing relationship vector query: ${query.slice(0, 200)}...`);
				console.log(`[DB DEBUG] Query params: ${params.slice(1)}`); // Skip the long embedding

				const results = await db.$queryRawUnsafe(query, ...params);

				console.log(
					`[DB DEBUG] Relationship vector query returned ${Array.isArray(results) ? results.length : 'non-array'} results`
				);

				if (!Array.isArray(results)) {
					return {
						success: true,
						data: [],
					};
				}

				// Map results to KnowledgeTriple format
				const triples = results.map((row: any) => ({
					subject: row.subject,
					predicate: row.predicate,
					object: row.object,
					type: unmapTripleType(row.type),
					source: row.source,
					source_type: row.source_type,
					source_date: row.source_date?.toISOString(),
					extracted_at: row.extracted_at.toISOString(),
					processing_batch_id: row.processing_batch_id,
					confidence: row.confidence,
					// Add similarity score for debugging
					_similarity: row.similarity,
				}));

				return {
					success: true,
					data: triples,
				};
			} catch (error) {
				console.error('Relationship vector search error:', error);
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search by relationship vector',
						cause: error,
					},
				};
			}
		},

		// Concept operations
		async storeConcepts(concepts: ConceptNode[]): Promise<Result<void>> {
			try {
				const prismaConcepts = concepts.map(concept => ({
					id: generateConceptId(concept),
					concept: concept.concept,
					abstraction_level: mapAbstractionLevel(concept.abstraction_level),
					confidence: concept.confidence,
					source: concept.source,
					source_type: concept.source_type,
					extracted_at: new Date(concept.extracted_at),
					processing_batch_id: concept.processing_batch_id,
				}));

				await db.conceptNode.createMany({
					data: prismaConcepts,
					skipDuplicates: true,
				});

				return { success: true, data: undefined };
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to store concepts',
						cause: error,
					},
				};
			}
		},

		async searchConcepts(query: string, abstraction?: string): Promise<Result<ConceptNode[]>> {
			try {
				const where: any = {
					concept: { contains: query, mode: 'insensitive' },
				};

				if (abstraction) {
					where.abstraction_level = mapAbstractionLevel(abstraction as any);
				}

				const concepts = await db.conceptNode.findMany({
					where,
					take: 50,
				});

				return {
					success: true,
					data: concepts.map(mapPrismaConcept),
				};
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search concepts',
						cause: error,
					},
				};
			}
		},

		async searchConceptsByEmbedding(
			embedding: number[],
			topK: number,
			minScore: number
		): Promise<Result<ConceptNode[]>> {
			try {
				// Convert embedding to pgvector format
				const vectorString = `[${embedding.join(',')}]`;

				// Perform vector similarity search using concept vectors
				const query = `
					SELECT DISTINCT cn.*, 
						   (cv.embedding <-> $1::vector) as distance,
						   (1 - (cv.embedding <-> $1::vector)) as similarity
					FROM concept_nodes cn
					JOIN concept_vectors cv ON cn.id = cv.concept_node_id
					WHERE (1 - (cv.embedding <-> $1::vector)) >= $3
					ORDER BY cv.embedding <-> $1::vector ASC
					LIMIT $2
				`;

				const results = await db.$queryRawUnsafe(query, vectorString, topK, minScore);

				if (!Array.isArray(results)) {
					return {
						success: true,
						data: [],
					};
				}

				// Map results to ConceptNode format
				const concepts = results.map((row: any) => ({
					concept: row.concept,
					abstraction_level: unmapAbstractionLevel(row.abstraction_level),
					confidence: row.confidence,
					source: row.source,
					source_type: row.source_type,
					extracted_at: row.extracted_at.toISOString(),
					processing_batch_id: row.processing_batch_id,
					// Add similarity score for debugging
					_similarity: row.similarity,
				}));

				return {
					success: true,
					data: concepts,
				};
			} catch (error) {
				console.error('Concept embedding search error:', error);
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to search concepts by embedding',
						cause: error,
					},
				};
			}
		},

		async getConceptsByIds(ids: string[]): Promise<ConceptNode[]> {
			try {
				const concepts = await db.conceptNode.findMany({
					where: { id: { in: ids } },
				});
				return concepts.map(mapPrismaConcept);
			} catch (error) {
				console.error('Error getting concepts by IDs:', error);
				return [];
			}
		},

		// Conceptualization relationship operations
		async storeConceptualizations(
			relationships: ConceptualizationRelationship[]
		): Promise<Result<void>> {
			try {
				const prismaRelationships = relationships.map(rel => ({
					id: generateConceptualizationId(rel),
					source_element: rel.source_element,
					entity_type: mapEntityType(rel.entity_type as EntityType),
					concept: rel.concept,
					confidence: rel.confidence,
					context_triples: rel.context_triples || [],
					source: rel.source,
					source_type: rel.source_type,
					extracted_at: new Date(rel.extracted_at),
					processing_batch_id: rel.processing_batch_id,
				}));

				await db.conceptualizationRelationship.createMany({
					data: prismaRelationships,
					skipDuplicates: true,
				});

				return { success: true, data: undefined };
			} catch (error) {
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to store conceptualizations',
						cause: error,
					},
				};
			}
		},

		async getConceptualizationsByElement(
			element: string,
			entityType?: EntityType
		): Promise<ConceptualizationRelationship[]> {
			try {
				const where: any = { source_element: element };
				if (entityType) {
					where.entity_type = entityType;
				}

				const relationships = await db.conceptualizationRelationship.findMany({
					where,
				});

				return relationships.map(mapPrismaConceptualization);
			} catch (error) {
				console.error('Error getting conceptualizations by element:', error);
				return [];
			}
		},

		async getConceptualizationsByConcept(
			concept: string
		): Promise<ConceptualizationRelationship[]> {
			try {
				const relationships = await db.conceptualizationRelationship.findMany({
					where: { concept },
				});

				return relationships.map(mapPrismaConceptualization);
			} catch (error) {
				console.error('Error getting conceptualizations by concept:', error);
				return [];
			}
		},

		async getTriplesByConceptualization(concept: string): Promise<KnowledgeTriple[]> {
			try {
				// Get all elements that map to this concept
				const conceptualizations = await db.conceptualizationRelationship.findMany({
					where: { concept },
				});

				const elements = conceptualizations.map(rel => rel.source_element);

				// Find triples that contain any of these elements
				const triples = await db.knowledgeTriple.findMany({
					where: {
						OR: [
							{ subject: { in: elements } },
							{ object: { in: elements } },
							{ predicate: { in: elements } },
						],
					},
				});

				return triples.map(mapPrismaTriple);
			} catch (error) {
				console.error('Error getting triples by conceptualization:', error);
				return [];
			}
		},

		// Vector operations
		async storeVectors(vectors: {
			entity?: Array<{
				vector_id: string;
				text: string;
				embedding: number[];
				entity_name: string;
				knowledge_triple_id: string;
			}>;
			relationship?: Array<{
				vector_id: string;
				text: string;
				embedding: number[];
				knowledge_triple_id: string;
			}>;
			semantic?: Array<{
				vector_id: string;
				text: string;
				embedding: number[];
				knowledge_triple_id: string;
			}>;
			concept?: Array<{
				vector_id: string;
				text: string;
				embedding: number[];
				concept_node_id: string;
			}>;
		}): Promise<Result<void>> {
			try {
				// Validate embedding dimensions before attempting storage
				const expectedDimensions = 1536; // Based on text-embedding-3-small model

				for (const [vectorType, vectorArray] of Object.entries(vectors)) {
					if (!vectorArray || vectorArray.length === 0) continue;

					for (const vector of vectorArray) {
						if (vector.embedding.length !== expectedDimensions) {
							console.warn(
								`[VECTOR STORAGE] Dimension mismatch in ${vectorType} vector: expected ${expectedDimensions}, got ${vector.embedding.length}`
							);
							return {
								success: false,
								error: {
									type: 'VECTOR_DIMENSION_ERROR',
									message: `Invalid embedding dimensions: expected ${expectedDimensions}, got ${vector.embedding.length} for ${vectorType} vector`,
								},
							};
						}
					}
				}

				const operations: Promise<any>[] = [];
				console.log(`[VECTOR STORAGE] Starting storage of vectors:`, {
					entity: vectors.entity?.length || 0,
					relationship: vectors.relationship?.length || 0,
					semantic: vectors.semantic?.length || 0,
					concept: vectors.concept?.length || 0,
				});

				// Store entity vectors
				if (vectors.entity && vectors.entity.length > 0) {
					const entityVectors = vectors.entity.map(v => ({
						id: v.vector_id,
						vector_id: v.vector_id,
						text: v.text,
						embedding: `[${v.embedding.join(',')}]`,
						entity_name: v.entity_name,
						knowledge_triple_id: v.knowledge_triple_id,
					}));

					operations.push(
						db.$executeRawUnsafe(
							`
							INSERT INTO entity_vectors (id, vector_id, text, embedding, entity_name, knowledge_triple_id, created_at, updated_at)
							VALUES ${entityVectors.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}::vector, $${i * 6 + 5}, $${i * 6 + 6}, NOW(), NOW())`).join(', ')}
							ON CONFLICT (vector_id) DO UPDATE SET
								text = EXCLUDED.text,
								embedding = EXCLUDED.embedding,
								entity_name = EXCLUDED.entity_name,
								knowledge_triple_id = EXCLUDED.knowledge_triple_id,
								updated_at = NOW()
						`,
							...entityVectors.flatMap(v => [
								v.id,
								v.vector_id,
								v.text,
								v.embedding,
								v.entity_name,
								v.knowledge_triple_id,
							])
						)
					);
				}

				// Store relationship vectors
				if (vectors.relationship && vectors.relationship.length > 0) {
					const relationshipVectors = vectors.relationship.map(v => ({
						id: v.vector_id,
						vector_id: v.vector_id,
						text: v.text,
						embedding: `[${v.embedding.join(',')}]`,
						knowledge_triple_id: v.knowledge_triple_id,
					}));

					operations.push(
						db.$executeRawUnsafe(
							`
							INSERT INTO relationship_vectors (id, vector_id, text, embedding, knowledge_triple_id, created_at, updated_at)
							VALUES ${relationshipVectors.map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::vector, $${i * 5 + 5}, NOW(), NOW())`).join(', ')}
							ON CONFLICT (vector_id) DO UPDATE SET
								text = EXCLUDED.text,
								embedding = EXCLUDED.embedding,
								knowledge_triple_id = EXCLUDED.knowledge_triple_id,
								updated_at = NOW()
						`,
							...relationshipVectors.flatMap(v => [
								v.id,
								v.vector_id,
								v.text,
								v.embedding,
								v.knowledge_triple_id,
							])
						)
					);
				}

				// Store semantic vectors
				if (vectors.semantic && vectors.semantic.length > 0) {
					const semanticVectors = vectors.semantic.map(v => ({
						id: v.vector_id,
						vector_id: v.vector_id,
						text: v.text,
						embedding: `[${v.embedding.join(',')}]`,
						knowledge_triple_id: v.knowledge_triple_id,
					}));

					operations.push(
						db.$executeRawUnsafe(
							`
							INSERT INTO semantic_vectors (id, vector_id, text, embedding, knowledge_triple_id, created_at, updated_at)
							VALUES ${semanticVectors.map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::vector, $${i * 5 + 5}, NOW(), NOW())`).join(', ')}
							ON CONFLICT (vector_id) DO UPDATE SET
								text = EXCLUDED.text,
								embedding = EXCLUDED.embedding,
								knowledge_triple_id = EXCLUDED.knowledge_triple_id,
								updated_at = NOW()
						`,
							...semanticVectors.flatMap(v => [
								v.id,
								v.vector_id,
								v.text,
								v.embedding,
								v.knowledge_triple_id,
							])
						)
					);
				}

				// Store concept vectors
				if (vectors.concept && vectors.concept.length > 0) {
					const conceptVectors = vectors.concept.map(v => ({
						id: v.vector_id,
						vector_id: v.vector_id,
						text: v.text,
						embedding: `[${v.embedding.join(',')}]`,
						concept_node_id: v.concept_node_id,
					}));

					operations.push(
						db.$executeRawUnsafe(
							`
							INSERT INTO concept_vectors (id, vector_id, text, embedding, concept_node_id, created_at, updated_at)
							VALUES ${conceptVectors.map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::vector, $${i * 5 + 5}, NOW(), NOW())`).join(', ')}
							ON CONFLICT (vector_id) DO UPDATE SET
								text = EXCLUDED.text,
								embedding = EXCLUDED.embedding,
								concept_node_id = EXCLUDED.concept_node_id,
								updated_at = NOW()
						`,
							...conceptVectors.flatMap(v => [
								v.id,
								v.vector_id,
								v.text,
								v.embedding,
								v.concept_node_id,
							])
						)
					);
				}

				// Execute all operations
				await Promise.all(operations);

				return { success: true, data: undefined };
			} catch (error) {
				console.error('Error storing vectors:', error);
				return {
					success: false,
					error: {
						type: 'DATABASE_ERROR',
						message: 'Failed to store vectors',
						cause: error,
					},
				};
			}
		},

		// Stats operations
		async getTripleCount(): Promise<number> {
			try {
				return await db.knowledgeTriple.count();
			} catch (error) {
				console.error('Error getting triple count:', error);
				return 0;
			}
		},

		async getConceptCount(): Promise<number> {
			try {
				return await db.conceptNode.count();
			} catch (error) {
				console.error('Error getting concept count:', error);
				return 0;
			}
		},

		async getTripleCountByType(): Promise<Record<TripleType, number>> {
			try {
				const counts = await db.knowledgeTriple.groupBy({
					by: ['type'],
					_count: true,
				});

				const result: Record<TripleType, number> = {
					'entity-entity': 0,
					'entity-event': 0,
					'event-event': 0,
					'emotional-context': 0,
				};

				counts.forEach(({ type, _count }) => {
					const mappedType = unmapTripleType(type);
					result[mappedType] = _count;
				});

				return result;
			} catch (error) {
				console.error('Error getting triple count by type:', error);
				return {
					'entity-entity': 0,
					'entity-event': 0,
					'event-event': 0,
					'emotional-context': 0,
				};
			}
		},

		// Token usage operations
		async storeTokenUsage(usage: TokenUsage): Promise<Result<void>> {
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
						processing_batch_id: usage.processing_batch_id,
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
		},

		async getTokenUsage(filters?: {
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

				const mappedUsage: TokenUsage[] = usageRecords.map(record => ({
					source: record.source,
					source_type: record.source_type,
					operation_type: record.operation_type,
					provider: record.provider,
					model: record.model,
					input_tokens: record.input_tokens,
					output_tokens: record.output_tokens,
					total_tokens: record.total_tokens,
					thinking_tokens: record.thinking_tokens ?? undefined,
					reasoning_tokens: record.reasoning_tokens ?? undefined,
					cached_read_tokens: record.cached_read_tokens ?? undefined,
					cached_write_tokens: record.cached_write_tokens ?? undefined,
					reasoning_steps: Array.isArray(record.reasoning_steps)
						? (record.reasoning_steps as any[])
						: undefined,
					operation_context:
						record.operation_context && typeof record.operation_context === 'object'
							? (record.operation_context as Record<string, any>)
							: undefined,
					duration_ms: record.duration_ms,
					estimated_cost: record.estimated_cost ? Number(record.estimated_cost) : undefined,
					processing_batch_id: record.processing_batch_id ?? undefined,
					tools_used: record.tools_used,
					timestamp: record.timestamp.toISOString(),
				}));

				return {
					success: true,
					data: mappedUsage,
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
		},
	};
}

// Helper functions
function generateTripleId(triple: KnowledgeTriple): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

function generateConceptId(concept: ConceptNode): string {
	const key = `${concept.concept}|${concept.abstraction_level}|${concept.source}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

function generateConceptualizationId(rel: ConceptualizationRelationship): string {
	const key = `${rel.source_element}|${rel.source_type}|${rel.concept}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

function mapTripleType(
	type: TripleType
): 'ENTITY_ENTITY' | 'ENTITY_EVENT' | 'EVENT_EVENT' | 'EMOTIONAL_CONTEXT' {
	const mapping = {
		'entity-entity': 'ENTITY_ENTITY' as const,
		'entity-event': 'ENTITY_EVENT' as const,
		'event-event': 'EVENT_EVENT' as const,
		'emotional-context': 'EMOTIONAL_CONTEXT' as const,
	};
	return mapping[type];
}

function unmapTripleType(
	type: 'ENTITY_ENTITY' | 'ENTITY_EVENT' | 'EVENT_EVENT' | 'EMOTIONAL_CONTEXT'
): TripleType {
	const mapping = {
		ENTITY_ENTITY: 'entity-entity' as const,
		ENTITY_EVENT: 'entity-event' as const,
		EVENT_EVENT: 'event-event' as const,
		EMOTIONAL_CONTEXT: 'emotional-context' as const,
	};
	return mapping[type];
}

function mapAbstractionLevel(level: 'high' | 'medium' | 'low'): 'HIGH' | 'MEDIUM' | 'LOW' {
	const mapping = {
		high: 'HIGH' as const,
		medium: 'MEDIUM' as const,
		low: 'LOW' as const,
	};
	return mapping[level];
}

function unmapAbstractionLevel(level: 'HIGH' | 'MEDIUM' | 'LOW'): 'high' | 'medium' | 'low' {
	const mapping = {
		HIGH: 'high' as const,
		MEDIUM: 'medium' as const,
		LOW: 'low' as const,
	};
	return mapping[level];
}

function mapEntityType(type: EntityType): 'ENTITY' | 'EVENT' | 'RELATION' {
	const mapping = {
		entity: 'ENTITY' as const,
		event: 'EVENT' as const,
		relation: 'RELATION' as const,
	};
	return mapping[type as keyof typeof mapping];
}

function unmapEntityType(type: 'ENTITY' | 'EVENT' | 'RELATION'): 'entity' | 'event' | 'relation' {
	const mapping = {
		ENTITY: 'entity' as const,
		EVENT: 'event' as const,
		RELATION: 'relation' as const,
	};
	return mapping[type];
}

function mapPrismaTriple(prismaTriple: any): KnowledgeTriple {
	return {
		subject: prismaTriple.subject,
		predicate: prismaTriple.predicate,
		object: prismaTriple.object,
		type: unmapTripleType(prismaTriple.type),
		source: prismaTriple.source,
		source_type: prismaTriple.source_type,
		source_date: prismaTriple.source_date?.toISOString(),
		extracted_at: prismaTriple.extracted_at.toISOString(),
		processing_batch_id: prismaTriple.processing_batch_id,
		confidence: prismaTriple.confidence,
	};
}

function mapPrismaConcept(prismaConcept: any): ConceptNode {
	return {
		concept: prismaConcept.concept,
		abstraction_level: unmapAbstractionLevel(prismaConcept.abstraction_level),
		confidence: prismaConcept.confidence,
		source: prismaConcept.source,
		source_type: prismaConcept.source_type,
		extracted_at: prismaConcept.extracted_at.toISOString(),
		processing_batch_id: prismaConcept.processing_batch_id,
	};
}

function mapPrismaConceptualization(prismaRel: any): ConceptualizationRelationship {
	return {
		source_element: prismaRel.source_element,
		entity_type: unmapEntityType(prismaRel.entity_type),
		concept: prismaRel.concept,
		confidence: prismaRel.confidence,
		context_triples: prismaRel.context_triples,
		source: prismaRel.source,
		source_type: prismaRel.source_type,
		extracted_at: prismaRel.extracted_at.toISOString(),
		processing_batch_id: prismaRel.processing_batch_id,
	};
}
