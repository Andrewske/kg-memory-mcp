/**
 * Functional concept handler - Pure function extracted from ConceptJobHandler
 */

import type { ProcessingJob } from '@prisma/client';
import {
	extractElementsFromTriples,
	generateConcepts,
} from '~/features/conceptualization/conceptualize.js';
import type { ConceptWithStatus } from '~/shared/types/extraction-metadata.js';
import { db } from '~/shared/database/client.js';
import {
	createContext,
	log,
	logDataFlow,
	logError,
	logQueryResult,
} from '~/shared/utils/debug-logger.js';
import type { JobMetadata, JobResult } from '../job-types.js';
import { updateJobProgress } from '../pipeline-coordinator.js';

/**
 * Execute concept generation logic - pure function version
 * @param job Processing job with metadata
 * @param skipQStashUpdates Skip QStash progress updates for testing
 * @param onProgress Optional progress callback for testing
 * @param updateProgressFn Optional dependency injection for progress updates
 */
export async function executeConcepts(
	job: ProcessingJob,
	skipQStashUpdates: boolean = false,
	onProgress?: (progress: number) => void,
	updateProgressFn = updateJobProgress
): Promise<JobResult> {
	const updateProgress = async (progress: number) => {
		onProgress?.(progress);
		if (!skipQStashUpdates) {
			await updateProgressFn(job.id, progress);
		}
	};

	const metadata = job.metadata as unknown as JobMetadata;

	const context = createContext('CONCEPT_GENERATION', 'execute_concepts', {
		jobId: job.id,
		source: metadata.source,
	});

	try {
		log('DEBUG', context, 'Starting concept generation', {
			jobId: job.id,
			source: metadata.source,
			source_type: metadata.source_type,
		});

		await updateProgress(10);

		// Skip idempotency check for benchmarks (they clean before each run)
		if (metadata.source_type !== 'benchmark') {
			// Check if concepts already exist (idempotency check)
			const existingConceptsCount = await db.conceptNode.count({
				where: {
					source: metadata.source,
					source_type: metadata.source_type,
				},
			});

			if (existingConceptsCount > 0) {
				log('DEBUG', context, 'Concepts already exist, skipping generation', {
					source: metadata.source,
					existingCount: existingConceptsCount,
				});
				await updateProgress(100);
				return {
					success: true,
					data: {
						message: 'Concepts already generated',
						conceptsFound: existingConceptsCount,
						skipped: true,
					},
				};
			}
		}

		await updateProgress(20);

		// Read all triples stored by extraction job (account for chunk suffixes)
		log('DEBUG', context, 'Loading triples from database', {
			sourcePattern: `${metadata.source}*`,
		});
		const allTriples = await db.knowledgeTriple.findMany({
			where: {
				source: {
					startsWith: metadata.source,
				},
				source_type: metadata.source_type,
			},
		});
		logQueryResult(
			context,
			{
				source_pattern: `${metadata.source}*`,
				source_type: metadata.source_type,
			},
			allTriples,
			`Found triples matching source pattern: ${metadata.source}*`
		);

		if (allTriples.length === 0) {
			log('WARN', context, 'No triples found for conceptualization', { source: metadata.source });
			await updateProgress(100);
			return {
				success: true,
				data: {
					message: 'No triples found for conceptualization',
					conceptsStored: 0,
					relationshipsStored: 0,
				},
			};
		}

		log('DEBUG', context, 'Processing triples for conceptualization', {
			tripleCount: allTriples.length,
		});
		await updateProgress(40);

		// Extract elements for conceptualization
		const conceptInput = extractElementsFromTriples(allTriples);
		logDataFlow(
			context,
			{
				input: allTriples,
				output: conceptInput,
				counts: {
					inputCount: allTriples.length,
					outputCount: conceptInput.entities.length + conceptInput.events.length,
				},
				transformations: ['element_extraction'],
			},
			'Elements extracted from triples'
		);

		await updateProgress(50);

		// Generate concepts using AI
		log('DEBUG', context, 'Starting AI concept generation', {
			entityCount: conceptInput.entities.length,
			eventCount: conceptInput.events.length,
		});
		const conceptResult = await generateConcepts(conceptInput, {
			source: metadata.source,
			source_type: metadata.source_type,
		});

		if (!conceptResult.success) {
			return {
				success: false,
				error: {
					message: `Concept generation failed: ${conceptResult.error?.message}`,
					operation: 'concept_generation',
				},
			};
		}

		const concepts = conceptResult.data?.concepts || [];
		const relationships = conceptResult.data?.relationships || [];
		logDataFlow(
			context,
			{
				input: conceptInput,
				output: { concepts, relationships },
				counts: {
					inputCount: conceptInput.entities.length + conceptInput.events.length,
					outputCount: concepts.length + relationships.length,
				},
				transformations: ['ai_concept_generation'],
			},
			'AI concept generation completed'
		);

		await updateProgress(70);

		// Store concepts and relationships in database
		log('DEBUG', context, 'Starting database storage', {
			conceptCount: concepts.length,
			relationshipCount: relationships.length,
		});
		const storageResult = await storeConceptsAndRelationships(concepts, relationships, allTriples);

		if (!storageResult.success) {
			return storageResult;
		}

		await updateProgress(100);

		return {
			success: true,
			data: {
				conceptsStored: storageResult.data?.conceptsStored || 0,
				conceptsGenerated: concepts.length, // NEW: Total concepts generated by AI
				conceptsWithStatus: storageResult.data?.conceptsWithStatus || [], // NEW: All concepts with status markers
				relationshipsStored: storageResult.data?.relationshipsStored || 0,
				processingTime: Date.now() - job.createdAt.getTime(),
			},
		};
	} catch (error) {
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'concept_generation',
		});
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Concept generation failed',
				operation: 'concept_generation',
				cause: error,
			},
		};
	}
}

async function storeConceptsAndRelationships(
	concepts: any[],
	relationships: any[],
	triples: any[]
): Promise<JobResult> {
	const context = createContext('CONCEPT_GENERATION', 'store_concepts_and_relationships', {
		conceptCount: concepts.length,
		relationshipCount: relationships.length,
	});

	try {
		// Create a map of triple IDs for efficient lookup
		const _tripleIdMap = new Map(
			triples.map(t => [`${t.subject}-${t.predicate}-${t.object}`, t.id])
		);

		// Use transaction for atomic storage
		const result = await db.$transaction(async tx => {
			// Check which concepts already exist
			const existingConcepts = await tx.conceptNode.findMany({
				where: {
					concept: { in: concepts.map(c => c.concept) },
					source: concepts[0]?.source,
					source_type: concepts[0]?.source_type,
				},
				select: { concept: true, abstraction_level: true },
			});

			const existingConceptSet = new Set(
				existingConcepts.map(c => `${c.concept}|${c.abstraction_level}`)
			);

			// Track concepts with status
			const conceptsWithStatus: ConceptWithStatus[] = [];

			// Store concept nodes and track status
			const conceptNodes: any[] = [];
			for (const concept of concepts) {
				const key = `${concept.concept}|${concept.abstraction_level}`;
				const isDuplicate = existingConceptSet.has(key);

				conceptsWithStatus.push({
					concept: concept.concept,
					abstraction_level: concept.abstraction_level,
					confidence: Number(concept.confidence || 0),
					status: isDuplicate ? 'EXACT_DUPLICATE' : 'KEPT',
				});

				// Only create if not duplicate
				if (!isDuplicate) {
					const created = await tx.conceptNode.create({
						data: {
							concept: concept.concept,
							abstraction_level: concept.abstraction_level,
							confidence: concept.confidence,
							source: concept.source,
							source_type: concept.source_type,
							extracted_at: new Date(),
						},
					});
					conceptNodes.push(created);
				}
			}

			// Create a map of concept names to IDs
			const conceptIdMap = new Map(conceptNodes.map(node => [node.concept, node.id]));

			// Store conceptualization relationships with proper linking and deduplication
			const uniqueRelationships = new Map<string, any>();

			for (const rel of relationships) {
				// Create unique key to prevent duplicates
				const key = `${rel.source_element}|${rel.triple_type}|${rel.concept}`;

				// Only process if we haven't seen this relationship and the concept exists
				const conceptNodeId = conceptIdMap.get(rel.concept);
				if (!uniqueRelationships.has(key) && conceptNodeId) {
					// Find relevant triple IDs for context
					const contextTripleIds = triples
						.filter(
							t =>
								t.subject === rel.source_element ||
								t.object === rel.source_element ||
								t.predicate === rel.source_element
						)
						.slice(0, 5) // Limit to 5 context triples
						.map(t => t.id);

					uniqueRelationships.set(key, {
						source_element: rel.source_element,
						triple_type: rel.triple_type,
						concept: rel.concept,
						concept_node_id: conceptNodeId, // Link to actual concept node
						confidence: rel.confidence,
						context_triples: contextTripleIds,
						source: rel.source,
						source_type: rel.source_type,
						extracted_at: new Date(),
					});
				}
			}

			// Create relationships from deduplicated set using upsert to handle existing relationships
			const conceptualizations = [];
			for (const relData of uniqueRelationships.values()) {
				try {
					const created = await tx.conceptualizationRelationship.upsert({
						where: {
							source_element_triple_type_concept: {
								source_element: relData.source_element,
								triple_type: relData.triple_type,
								concept: relData.concept,
							},
						},
						update: {
							// Update fields if the relationship already exists
							confidence: relData.confidence,
							context_triples: relData.context_triples,
							concept_node_id: relData.concept_node_id,
							extracted_at: relData.extracted_at,
						},
						create: relData,
					});
					conceptualizations.push(created);
				} catch (error) {
					// Log the error and skip this relationship
					console.error('Failed to upsert relationship:', {
						error: error instanceof Error ? error.message : String(error),
						data: relData,
					});
					// Continue with other relationships
				}
			}

			return {
				conceptsStored: conceptNodes.length,
				relationshipsStored: conceptualizations.length,
				conceptsWithStatus, // NEW: Return concepts with status markers
			};
		});

		log('INFO', context, 'Storage completed successfully', result);

		return {
			success: true,
			data: result,
		};
	} catch (error) {
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'concept_storage',
		});
		return {
			success: false,
			error: {
				message: 'Failed to store concepts and relationships',
				operation: 'concept_storage',
				cause: error,
			},
		};
	}
}
