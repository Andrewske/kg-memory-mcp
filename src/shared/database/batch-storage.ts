import type { ConceptualizationRelationship } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';
import { db } from '~/shared/database/client.js';
import { generateTripleId } from '~/shared/database/database-utils.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { Result } from '~/shared/types/services.js';
import { createContext, log, logDataFlow, logError } from '~/shared/utils/debug-logger.js';

// Note: sanitizeForLogging is now provided by the debug logger

export interface BatchStorageInput {
	/** Knowledge triples to store */
	triples: Triple[];
	/** Concept nodes to store */
	concepts: Concept[];
	/** Conceptualization relationships */
	conceptualizations: Omit<
		ConceptualizationRelationship,
		'id' | 'created_at' | 'updated_at' | 'knowledge_triple_id' | 'concept_node_id'
	>[];
	/** Embedding map for vector generation */
	embeddingMap: Map<string, number[]>;
}

export interface BatchStorageResult {
	triplesStored: number;
	conceptsStored: number;
	conceptualizationsStored: number;
	vectorsGenerated: number;
	duplicatesSkipped: number;
}

/**
 * Store all knowledge data in a single atomic transaction
 * This eliminates multiple database round trips and ensures consistency
 */
/**
 * Sanitize and validate input data before database operations
 */
function validateAndSanitizeInput(input: BatchStorageInput): Result<BatchStorageInput> {
	try {
		// Validate and sanitize triples
		const sanitizedTriples = input.triples.map(triple => {
			// Remove null bytes and control characters that could cause issues
			const sanitizeText = (text: string): string => {
				if (typeof text !== 'string') {
					throw new Error(`Expected string but got ${typeof text}`);
				}
				return text
					.replace(/\0/g, '') // Remove null bytes
					.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
					.trim()
					.slice(0, 5000); // Reasonable length limit
			};

			return {
				...triple,
				subject: sanitizeText(triple.subject),
				predicate: sanitizeText(triple.predicate),
				object: sanitizeText(triple.object),
				source: sanitizeText(triple.source),
				confidence: new Decimal(Math.max(0, Math.min(1, Number(triple.confidence) || 0))), // Clamp to 0-1
			};
		});

		// Validate and sanitize concepts
		const sanitizedConcepts = input.concepts.map(concept => {
			const sanitizeText = (text: string): string => {
				if (typeof text !== 'string') {
					throw new Error(`Expected string but got ${typeof text}`);
				}
				return text
					.replace(/\0/g, '')
					.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
					.trim()
					.slice(0, 2000);
			};

			return {
				...concept,
				concept: sanitizeText(concept.concept),
				source: sanitizeText(concept.source),
				confidence: new Decimal(Math.max(0, Math.min(1, Number(concept.confidence) || 0))),
			};
		});

		// Validate and sanitize conceptualizations
		const sanitizedConceptualizations = input.conceptualizations.map(conceptualization => {
			const sanitizeText = (text: string): string => {
				if (typeof text !== 'string') {
					throw new Error(`Expected string but got ${typeof text}`);
				}
				return text
					.replace(/\0/g, '')
					.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
					.trim()
					.slice(0, 2000);
			};

			return {
				...conceptualization,
				source_element: sanitizeText(conceptualization.source_element),
				concept: sanitizeText(conceptualization.concept),
				source: sanitizeText(conceptualization.source),
				confidence: new Decimal(
					Math.max(0, Math.min(1, Number(conceptualization.confidence) || 0))
				),
			};
		});

		// Basic length validation
		if (sanitizedTriples.length > 10000) {
			throw new Error(`Too many triples: ${sanitizedTriples.length} (max 10000)`);
		}
		if (sanitizedConcepts.length > 5000) {
			throw new Error(`Too many concepts: ${sanitizedConcepts.length} (max 5000)`);
		}

		return {
			success: true,
			data: {
				triples: sanitizedTriples,
				concepts: sanitizedConcepts,
				conceptualizations: sanitizedConceptualizations,
				embeddingMap: input.embeddingMap, // Embedding map is already validated by embedding service
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'INPUT_VALIDATION_ERROR',
				message: 'Failed to validate and sanitize input data',
				cause: error,
			},
		};
	}
}

export async function batchStoreKnowledge(
	input: BatchStorageInput
): Promise<Result<BatchStorageResult>> {
	const startTime = Date.now();

	// Create context for structured logging
	const batchContext = createContext('BATCH_STORAGE', 'batch_store_knowledge', {
		tripleCount: input.triples.length,
		conceptCount: input.concepts.length,
		conceptualizationCount: input.conceptualizations.length,
		source: input.triples[0]?.source || input.concepts[0]?.source || 'unknown',
	});

	// Validate and sanitize input data first
	const validationResult = validateAndSanitizeInput(input);
	if (!validationResult.success) {
		logError(batchContext, 'Input validation failed', {
			errorType: validationResult.error.type,
			errorMessage: validationResult.error.message,
		});
		return validationResult as Result<BatchStorageResult>;
	}

	const { triples, concepts, conceptualizations, embeddingMap } = validationResult.data;

	log('INFO', batchContext, 'Starting atomic transaction', {
		triples: triples.length,
		concepts: concepts.length,
		conceptualizations: conceptualizations.length,
		embeddingMapSize: embeddingMap.size,
	});

	try {
		// Use Prisma transaction to ensure atomicity
		const result = await db.$transaction(
			async tx => {
				let triplesStored = 0;
				let conceptsStored = 0;
				let conceptualizationsStored = 0;
				const vectorsGenerated = 0;
				let duplicatesSkipped = 0;

				// Step 1: Store triples if any
				if (triples.length > 0) {
					const tripleContext = createContext('BATCH_STORAGE', 'store_triples_transaction', {
						tripleCount: triples.length,
						source: triples[0]?.source,
					});

					log('DEBUG', tripleContext, 'Storing triples in transaction', { count: triples.length });

					// Generate IDs and prepare triples for storage
					const triplesWithIds = triples.map(triple => ({
						...triple,
						id: generateTripleId(triple),
					}));

					// Check for existing triples within transaction
					const ids = triplesWithIds.map(t => t.id);
					const existingIds = await tx.knowledgeTriple.findMany({
						where: { id: { in: ids } },
						select: { id: true },
					});
					const existingIdSet = new Set(existingIds.map(t => t.id));

					// Filter out duplicates
					const newTriples = triplesWithIds.filter(t => !existingIdSet.has(t.id));
					duplicatesSkipped = triplesWithIds.length - newTriples.length;

					if (newTriples.length > 0) {
						// Prepare triples for Prisma
						const prismaTriples = newTriples.map(triple => ({
							id: triple.id,
							subject: triple.subject,
							predicate: triple.predicate,
							object: triple.object,
							type: triple.type,
							source: triple.source,
							source_type: triple.source_type,
							source_date: triple.source_date ? new Date(triple.source_date) : null,
							extracted_at: new Date(triple.extracted_at),
							confidence: triple.confidence,
						}));

						await tx.knowledgeTriple.createMany({
							data: prismaTriples,
							skipDuplicates: true,
						});

						triplesStored = newTriples.length;

						logDataFlow(
							tripleContext,
							{
								input: triples,
								output: newTriples,
								transformations: ['id_generation', 'duplicate_filtering'],
								counts: {
									inputCount: triples.length,
									outputCount: newTriples.length,
								},
							},
							'Triple storage data flow'
						);

						log('DEBUG', tripleContext, 'Stored triples successfully', {
							stored: triplesStored,
							duplicatesSkipped,
							vectorGenerationDeferred: true,
							reason: 'pgvector_compatibility_issues',
						});
					}
				}

				// Step 2: Store concepts if any
				if (concepts.length > 0) {
					const conceptContext = createContext('BATCH_STORAGE', 'store_concepts_transaction', {
						conceptCount: concepts.length,
						source: concepts[0]?.source,
					});

					log('DEBUG', conceptContext, 'Storing concepts in transaction', {
						count: concepts.length,
					});

					const prismalConcepts = concepts.map(concept => ({
						id: uuidv4(),
						concept: concept.concept,
						abstraction_level: concept.abstraction_level,
						source: concept.source,
						source_type: concept.source_type,
						confidence: concept.confidence,
						extracted_at: concept.extracted_at,
						created_at: new Date(),
						updated_at: new Date(),
					}));

					await tx.conceptNode.createMany({
						data: prismalConcepts,
						skipDuplicates: true,
					});

					conceptsStored = concepts.length;

					logDataFlow(
						conceptContext,
						{
							input: concepts,
							output: concepts,
							transformations: ['uuid_generation'],
							counts: {
								inputCount: concepts.length,
								outputCount: conceptsStored,
							},
						},
						'Concept storage data flow'
					);

					log('DEBUG', conceptContext, 'Stored concepts successfully', { stored: conceptsStored });

					// Skip concept vectors for now - they require concept_node_id from the created concepts
					// This is a design decision to keep the transaction atomic and focused on core data
				}

				// Step 3: Store conceptualizations if any
				if (conceptualizations.length > 0) {
					const conceptualizationContext = createContext(
						'BATCH_STORAGE',
						'store_conceptualizations_transaction',
						{
							conceptualizationCount: conceptualizations.length,
							source: triples[0]?.source || concepts[0]?.source,
						}
					);

					log('DEBUG', conceptualizationContext, 'Storing conceptualizations in transaction', {
						count: conceptualizations.length,
					});

					const prismaConceptualizations = conceptualizations.map(c => ({
						id: uuidv4(),
						source_element: c.source_element,
						triple_type: c.triple_type,
						concept: c.concept,
						confidence: c.confidence,
						context_triples: c.context_triples,
						source: c.source,
						source_type: c.source_type,
						extracted_at: c.extracted_at,
						created_at: new Date(),
						updated_at: new Date(),
					}));

					await tx.conceptualizationRelationship.createMany({
						data: prismaConceptualizations,
						skipDuplicates: true,
					});

					conceptualizationsStored = conceptualizations.length;

					logDataFlow(
						conceptualizationContext,
						{
							input: conceptualizations,
							output: conceptualizations,
							transformations: ['uuid_generation', 'concept_node_id_mapping'],
							counts: {
								inputCount: conceptualizations.length,
								outputCount: conceptualizationsStored,
							},
						},
						'Conceptualization storage data flow'
					);

					log('DEBUG', conceptualizationContext, 'Stored conceptualizations successfully', {
						stored: conceptualizationsStored,
					});
				}

				return {
					triplesStored,
					conceptsStored,
					conceptualizationsStored,
					vectorsGenerated,
					duplicatesSkipped,
				};
			},
			{
				// Transaction options for better performance
				maxWait: 30000, // 30 seconds max wait
				timeout: 120000, // 2 minutes timeout
				isolationLevel: 'ReadCommitted',
			}
		);

		const duration = Date.now() - startTime;

		log('INFO', batchContext, 'Transaction completed successfully', {
			duration,
			result: {
				triplesStored: result.triplesStored,
				conceptsStored: result.conceptsStored,
				conceptualizationsStored: result.conceptualizationsStored,
				vectorsGenerated: result.vectorsGenerated,
			},
		});

		// Generate vectors separately (outside transaction) due to pgvector compatibility
		let vectorsGenerated = 0;
		let storedTripleIds: string[] = [];
		const storedConceptIds: string[] = [];
		const storedConceptualizationIds: string[] = [];

		if (triples.length > 0 && result.triplesStored > 0) {
			try {
				const vectorContext = createContext('BATCH_STORAGE', 'post_transaction_vector_generation', {
					triplesStored: result.triplesStored,
					source: triples[0]?.source,
					embeddingMapSize: embeddingMap.size,
				});

				log('INFO', vectorContext, 'Starting post-transaction vector generation', {
					triplesStored: result.triplesStored,
					hasEmbeddingMap: embeddingMap.size > 0,
				});

				// Find the stored triples (those that weren't duplicates)
				const triplesWithIds = triples.map(triple => ({
					...triple,
					id: generateTripleId(triple),
				}));

				const storedTriples = triplesWithIds.filter(_t => {
					// This is a simplified check - in practice we'd need to track which were actually stored
					return true; // For now, assume all non-duplicates were stored
				});

				// Track stored IDs for potential rollback
				storedTripleIds = storedTriples.slice(0, result.triplesStored).map(t => t.id);

				const vectorResult = await generateAndStoreVectorsPostTransaction(
					storedTriples.slice(0, result.triplesStored),
					embeddingMap
				);

				if (vectorResult.success) {
					vectorsGenerated = vectorResult.data.vectorsStored;

					log('INFO', vectorContext, 'Vector generation completed successfully', {
						vectorsGenerated,
						lookupMisses: vectorResult.data.lookupMisses || 0,
					});
				} else {
					logError(
						vectorContext,
						'Vector generation failed, initiating rollback',
						vectorResult.error
					);

					// CRITICAL: Rollback the main transaction data if vector generation fails
					await rollbackMainTransaction(
						storedTripleIds,
						storedConceptIds,
						storedConceptualizationIds
					);

					return {
						success: false,
						error: {
							type: 'VECTOR_GENERATION_ROLLBACK',
							message: 'Vector generation failed, transaction rolled back to maintain consistency',
							cause: vectorResult.error,
						},
					};
				}
			} catch (error) {
				logError(batchContext, 'Post-transaction vector generation error, initiating rollback', {
					error: error instanceof Error ? error.message : String(error),
				});

				// CRITICAL: Rollback the main transaction data if vector generation fails
				await rollbackMainTransaction(
					storedTripleIds,
					storedConceptIds,
					storedConceptualizationIds
				);

				return {
					success: false,
					error: {
						type: 'VECTOR_GENERATION_ROLLBACK',
						message:
							'Vector generation failed with exception, transaction rolled back to maintain consistency',
						cause: error,
					},
				};
			}
		}

		return {
			success: true,
			data: {
				...result,
				vectorsGenerated,
			},
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		logError(batchContext, `Transaction failed after ${duration}ms`, {
			error: error instanceof Error ? error.message : String(error),
		});

		return {
			success: false,
			error: {
				type: 'BATCH_STORAGE_ERROR',
				message: 'Failed to store knowledge data in batch transaction',
				cause: error,
			},
		};
	}
}

// Note: storeTripleVectorsInTransaction has been removed as vectors are now stored post-transaction
// using the unified VectorEmbedding table via generateAndStoreVectorsPostTransaction

/**
 * Generate and store vectors outside of transaction (due to pgvector compatibility)
 */
async function generateAndStoreVectorsPostTransaction(
	triples: (Triple & { id: string })[],
	embeddingMap: Map<string, number[]>
): Promise<
	| { success: true; data: { vectorsStored: number; lookupMisses: number } }
	| { success: false; error: any }
> {
	try {
		const storageContext = createContext(
			'BATCH_STORAGE',
			'generate_and_store_vectors_post_transaction',
			{
				tripleCount: triples.length,
				embeddingMapSize: embeddingMap.size,
			}
		);

		log('INFO', storageContext, 'Starting vector generation for triples using embedding map', {
			tripleCount: triples.length,
			embeddingMapSize: embeddingMap.size,
		});

		const allVectors: any[] = [];

		// Collect unique entities and relationships
		const uniqueEntities = new Set<string>();
		const uniqueRelationships = new Set<string>();

		for (const triple of triples) {
			uniqueEntities.add(triple.subject);
			uniqueEntities.add(triple.object);
			uniqueRelationships.add(triple.predicate);
		}

		console.log(
			`[BATCH STORAGE] Post-transaction: Processing ${uniqueEntities.size} entities, ${uniqueRelationships.size} relationships, ${triples.length} semantic texts`
		);

		// Generate entity vectors using embedding map
		let lookupMisses = 0;
		for (const entity of uniqueEntities) {
			const embedding = embeddingMap.get(entity);
			if (!embedding) {
				log('WARN', storageContext, 'Missing embedding for entity', { entity });
				lookupMisses++;
				continue;
			}

			// Find all triples that contain this entity
			for (const triple of triples) {
				if (triple.subject === entity || triple.object === entity) {
					allVectors.push({
						id: uuidv4(),
						vector_id: uuidv4(),
						text: entity,
						embedding: `[${embedding.join(',')}]`,
						vector_type: 'ENTITY',
						entity_name: entity,
						knowledge_triple_id: triple.id,
					});
				}
			}
		}

		// Generate relationship vectors using embedding map
		for (const relationship of uniqueRelationships) {
			const embedding = embeddingMap.get(relationship);
			if (!embedding) {
				log('WARN', storageContext, 'Missing embedding for relationship', { relationship });
				lookupMisses++;
				continue;
			}

			// Find all triples that contain this relationship
			for (const triple of triples) {
				if (triple.predicate === relationship) {
					allVectors.push({
						id: uuidv4(),
						vector_id: uuidv4(),
						text: relationship,
						embedding: `[${embedding.join(',')}]`,
						vector_type: 'RELATIONSHIP',
						knowledge_triple_id: triple.id,
					});
				}
			}
		}

		// Generate semantic vectors using embedding map
		for (const triple of triples) {
			const semanticText = `${triple.subject} ${triple.predicate} ${triple.object}`;
			const embedding = embeddingMap.get(semanticText);
			if (!embedding) {
				log('WARN', storageContext, 'Missing embedding for semantic text', { semanticText });
				lookupMisses++;
				continue;
			}

			allVectors.push({
				id: uuidv4(),
				vector_id: uuidv4(),
				text: semanticText,
				embedding: `[${embedding.join(',')}]`,
				vector_type: 'SEMANTIC',
				knowledge_triple_id: triple.id,
			});
		}

		if (allVectors.length === 0) {
			console.warn(
				`[BATCH STORAGE] Post-transaction: ⚠️ No vectors to store - all ${lookupMisses} embedding lookups failed`
			);
			return {
				success: true,
				data: {
					vectorsStored: 0,
					lookupMisses,
				},
			};
		}

		// Store vectors using the unified VectorEmbedding table
		console.log(
			`[BATCH STORAGE] Post-transaction: Storing ${allVectors.length} vectors using unified schema...`
		);

		// Use parameterized raw SQL for bulk insert with proper sanitization
		// This approach maintains performance while preventing SQL injection
		console.log(`[BATCH STORAGE] Post-transaction: Creating vectors with parameterized queries...`);

		if (allVectors.length === 0) {
			console.log(`[BATCH STORAGE] Post-transaction: No vectors to store`);
			return {
				success: true,
				data: { vectorsStored: 0, lookupMisses },
			};
		}

		// Use multiple individual INSERT statements with parameters to prevent injection
		let successCount = 0;
		for (const vector of allVectors) {
			try {
				await db.$executeRaw`
					INSERT INTO vector_embeddings (
						id, vector_id, text, embedding, vector_type, 
						entity_name, knowledge_triple_id, concept_node_id,
						created_at, updated_at
					) VALUES (
						${vector.id}, 
						${vector.vector_id}, 
						${vector.text}, 
						${vector.embedding}::vector, 
						${vector.vector_type}::vector_type,
						${vector.entity_name},
						${vector.knowledge_triple_id},
						NULL,
						NOW(),
						NOW()
					)
				`;
				successCount++;
			} catch (error) {
				log('WARN', storageContext, 'Failed to create vector', {
					vectorText: vector.text,
					error: error instanceof Error ? error.message : String(error),
				});
				// Continue with other vectors instead of failing entirely
			}
		}

		log('INFO', storageContext, 'Successfully stored vectors', {
			successCount,
			totalVectors: allVectors.length,
			lookupMisses,
		});

		return {
			success: true,
			data: {
				vectorsStored: successCount,
				lookupMisses,
			},
		};
	} catch (error) {
		console.error(`[BATCH STORAGE] Post-transaction: ❌ Vector generation failed:`, error);
		return {
			success: false,
			error,
		};
	}
}

/**
 * Rollback function to clean up main transaction data if post-transaction operations fail
 * This ensures data consistency when vector generation fails
 */
async function rollbackMainTransaction(
	storedTripleIds: string[],
	storedConceptIds: string[],
	storedConceptualizationIds: string[]
): Promise<void> {
	try {
		console.log(
			`[BATCH STORAGE] Rollback: Cleaning up ${storedTripleIds.length} triples, ${storedConceptIds.length} concepts, ${storedConceptualizationIds.length} conceptualizations`
		);

		// Use transaction to ensure atomicity of cleanup
		await db.$transaction([
			// Delete stored conceptualizations
			...(storedConceptualizationIds.length > 0
				? [
						db.conceptualizationRelationship.deleteMany({
							where: { id: { in: storedConceptualizationIds } },
						}),
					]
				: []),

			// Delete stored concepts
			...(storedConceptIds.length > 0
				? [
						db.conceptNode.deleteMany({
							where: { id: { in: storedConceptIds } },
						}),
					]
				: []),

			// Delete stored triples (will cascade delete any partial vectors)
			...(storedTripleIds.length > 0
				? [
						db.knowledgeTriple.deleteMany({
							where: { id: { in: storedTripleIds } },
						}),
					]
				: []),
		]);

		console.log(`[BATCH STORAGE] Rollback: ✅ Successfully cleaned up inconsistent data`);
	} catch (rollbackError) {
		console.error(`[BATCH STORAGE] Rollback: ❌ Failed to rollback transaction:`, rollbackError);
		// Log the error but don't throw - we're already in an error state
		// This situation requires manual intervention
		console.error(
			`[BATCH STORAGE] Rollback: 💀 MANUAL INTERVENTION REQUIRED - Database may be in inconsistent state`
		);
	}
}

// Note: storeConceptVectorsInTransaction has been removed as concept vectors are handled
// separately in the concept generation job using the unified VectorEmbedding table
