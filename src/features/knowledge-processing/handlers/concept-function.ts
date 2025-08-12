/**
 * Functional concept handler - Pure function extracted from ConceptJobHandler
 */

import { type ProcessingJob } from '@prisma/client';
import {
	extractElementsFromTriples,
	generateConcepts,
} from '~/features/conceptualization/conceptualize.js';
import { db } from '~/shared/database/client.js';
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

	try {
		console.debug('[ConceptGeneration] Starting concept generation', {
			jobId: job.id,
			source: metadata.source,
			source_type: metadata.source_type,
		});

		await updateProgress(10);

		// Check if concepts already exist (idempotency check)
		const existingConceptsCount = await db.conceptNode.count({
			where: {
				source: metadata.source,
				source_type: metadata.source_type,
			},
		});

		if (existingConceptsCount > 0) {
			console.debug(`[ConceptGeneration] Concepts already exist for source ${metadata.source}`);
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

		await updateProgress(20);

		// Read all triples stored by extraction job
		console.debug('[ConceptGeneration] Loading triples from database...');
		const allTriples = await db.knowledgeTriple.findMany({
			where: {
				source: metadata.source,
				source_type: metadata.source_type,
			},
		});

		if (allTriples.length === 0) {
			console.warn('[ConceptGeneration] No triples found for conceptualization');
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

		console.debug(`[ConceptGeneration] Found ${allTriples.length} triples for conceptualization`);
		await updateProgress(40);

		// Extract elements for conceptualization
		const conceptInput = extractElementsFromTriples(allTriples);
		console.debug(
			`[ConceptGeneration] Extracted ${conceptInput.entities.length} entities and ${conceptInput.events.length} events`
		);

		await updateProgress(50);

		// Generate concepts using AI
		console.debug('[ConceptGeneration] Generating concepts...');
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
		console.debug(
			`[ConceptGeneration] Generated ${concepts.length} concepts and ${relationships.length} relationships`
		);

		await updateProgress(70);

		// Store concepts and relationships in database
		console.debug('[ConceptGeneration] Storing concepts and relationships...');
		const storageResult = await storeConceptsAndRelationships(concepts, relationships, allTriples);

		if (!storageResult.success) {
			return storageResult;
		}

		await updateProgress(100);

		return {
			success: true,
			data: {
				conceptsStored: storageResult.data.conceptsStored,
				relationshipsStored: storageResult.data.relationshipsStored,
				processingTime: Date.now() - job.createdAt.getTime(),
			},
		};
	} catch (error) {
		console.error('[ConceptGeneration] Failed:', error);
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
	try {
		// Create a map of triple IDs for efficient lookup
		const tripleIdMap = new Map(
			triples.map(t => [`${t.subject}-${t.predicate}-${t.object}`, t.id])
		);

		// Use transaction for atomic storage
		const result = await db.$transaction(async tx => {
			// Store concept nodes
			const conceptNodes = await Promise.all(
				concepts.map(concept =>
					tx.conceptNode.create({
						data: {
							concept: concept.concept,
							abstraction_level: concept.abstraction_level,
							confidence: concept.confidence,
							source: concept.source,
							source_type: concept.source_type,
							extracted_at: new Date(),
						},
					})
				)
			);

			// Store conceptualization relationships
			const conceptualizations = await Promise.all(
				relationships.map(rel => {
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

					return tx.conceptualizationRelationship.create({
						data: {
							source_element: rel.source_element,
							triple_type: rel.triple_type,
							concept: rel.concept,
							confidence: rel.confidence,
							context_triples: contextTripleIds,
							source: rel.source,
							source_type: rel.source_type,
							extracted_at: new Date(),
						},
					});
				})
			);

			return {
				conceptsStored: conceptNodes.length,
				relationshipsStored: conceptualizations.length,
			};
		});

		console.debug('[ConceptGeneration] Storage completed:', result);

		return {
			success: true,
			data: result,
		};
	} catch (error) {
		console.error('[ConceptGeneration] Storage failed:', error);
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
