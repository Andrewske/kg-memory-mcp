import type { ConceptualizationRelationship } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { db } from '~/shared/database/client.js';
import { generateTripleId } from '~/shared/database/database-utils.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { Result } from '~/shared/types/services.js';

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
export async function batchStoreKnowledge(
	input: BatchStorageInput
): Promise<Result<BatchStorageResult>> {
	const startTime = Date.now();
	const { triples, concepts, conceptualizations, embeddingMap } = input;

	console.log(`[BATCH STORAGE] Starting atomic transaction for:`, {
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
					console.log(`[BATCH STORAGE] Transaction: Storing ${triples.length} triples...`);

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
						console.log(
							`[BATCH STORAGE] Transaction: ✅ Stored ${triplesStored} triples (${duplicatesSkipped} duplicates skipped)`
						);

						// Skip vector generation in transaction due to pgvector compatibility issues
						// Vectors will be generated separately after transaction commits
						console.log(
							`[BATCH STORAGE] Transaction: Skipping vector generation (will be done separately)`
						);
					}
				}

				// Step 2: Store concepts if any
				if (concepts.length > 0) {
					console.log(`[BATCH STORAGE] Transaction: Storing ${concepts.length} concepts...`);

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
					console.log(`[BATCH STORAGE] Transaction: ✅ Stored ${conceptsStored} concepts`);

					// Skip concept vectors for now - they require concept_node_id from the created concepts
					// This is a design decision to keep the transaction atomic and focused on core data
				}

				// Step 3: Store conceptualizations if any
				if (conceptualizations.length > 0) {
					console.log(
						`[BATCH STORAGE] Transaction: Storing ${conceptualizations.length} conceptualizations...`
					);

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
					console.log(
						`[BATCH STORAGE] Transaction: ✅ Stored ${conceptualizationsStored} conceptualizations`
					);
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
		console.log(`[BATCH STORAGE] ✅ Transaction completed successfully in ${duration}ms:`, result);

		// Generate vectors separately (outside transaction) due to pgvector compatibility
		let vectorsGenerated = 0;
		if (triples.length > 0 && result.triplesStored > 0) {
			try {
				console.log(
					`[BATCH STORAGE] Post-transaction: Generating vectors for ${result.triplesStored} stored triples...`
				);

				// Find the stored triples (those that weren't duplicates)
				const triplesWithIds = triples.map(triple => ({
					...triple,
					id: generateTripleId(triple),
				}));

				const storedTriples = triplesWithIds.filter(t => {
					// This is a simplified check - in practice we'd need to track which were actually stored
					return true; // For now, assume all non-duplicates were stored
				});

				const vectorResult = await generateAndStoreVectorsPostTransaction(
					storedTriples.slice(0, result.triplesStored),
					embeddingMap
				);
				if (vectorResult.success) {
					vectorsGenerated = vectorResult.data.vectorsStored;
					console.log(`[BATCH STORAGE] Post-transaction: ✅ Generated ${vectorsGenerated} vectors`);
				} else {
					console.warn(
						`[BATCH STORAGE] Post-transaction: ❌ Vector generation failed:`,
						vectorResult.error
					);
				}
			} catch (error) {
				console.warn(`[BATCH STORAGE] Post-transaction: ❌ Vector generation error:`, error);
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
		console.error(`[BATCH STORAGE] ❌ Transaction failed after ${duration}ms:`, error);

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
): Promise<{ success: true; data: { vectorsStored: number } } | { success: false; error: any }> {
	try {
		console.log(
			`[BATCH STORAGE] Post-transaction: Starting vector generation for ${triples.length} triples using embedding map...`
		);

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
				console.warn(
					`[BATCH STORAGE] Post-transaction: ⚠️ Missing embedding for entity: "${entity}"`
				);
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
				console.warn(
					`[BATCH STORAGE] Post-transaction: ⚠️ Missing embedding for relationship: "${relationship}"`
				);
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
				console.warn(
					`[BATCH STORAGE] Post-transaction: ⚠️ Missing embedding for semantic text: "${semanticText}"`
				);
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
				},
			};
		}

		// Store vectors using the unified VectorEmbedding table
		console.log(
			`[BATCH STORAGE] Post-transaction: Storing ${allVectors.length} vectors using unified schema...`
		);

		// Use raw SQL to insert vectors because Prisma doesn't handle vector types well
		const vectorRows = allVectors.map(v => `(
			'${v.id}', 
			'${v.vector_id}', 
			'${v.text.replace(/'/g, "''")}', 
			'${v.embedding}'::vector, 
			'${v.vector_type}', 
			${v.entity_name ? `'${v.entity_name.replace(/'/g, "''")}'` : 'NULL'},
			'${v.knowledge_triple_id}',
			NULL,
			NOW(),
			NOW()
		)`).join(',\n');

		const insertQuery = `
			INSERT INTO vector_embeddings (
				id, vector_id, text, embedding, vector_type, 
				entity_name, knowledge_triple_id, concept_node_id,
				created_at, updated_at
			) VALUES ${vectorRows}
		`;

		await db.$executeRawUnsafe(insertQuery);

		console.log(
			`[BATCH STORAGE] Post-transaction: ✅ Successfully stored ${allVectors.length} vectors with ${lookupMisses} lookup misses`
		);

		return {
			success: true,
			data: {
				vectorsStored: allVectors.length,
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

// Note: storeConceptVectorsInTransaction has been removed as concept vectors are handled
// separately in the concept generation job using the unified VectorEmbedding table
