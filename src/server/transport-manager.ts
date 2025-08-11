/**
 * Transport abstraction layer for Knowledge Graph MCP Server
 * Provides shared tool handling logic across different transports
 */

import {
	extractElementsFromTriples,
	generateConcepts,
} from '~/features/conceptualization/conceptualize.js';
import { deduplicateTriples } from '~/features/deduplication/deduplicate.js';
import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import type { FusionSearchResult } from '~/features/knowledge-graph/fusion-search.js';
import { searchFusion } from '~/features/knowledge-graph/fusion-search.js';
import { getStats } from '~/features/knowledge-graph/operations.js';
import { searchConcepts } from '~/features/knowledge-graph/search.js';
import { batchStoreKnowledge } from '~/shared/database/batch-storage.js';
import { env } from '~/shared/env.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import type { GraphStats, ToolResult } from '~/shared/types/api.js';
import type { Concept } from '~/shared/types/core.js';
import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { chunkText, mergeChunkResults, type TextChunk } from '~/shared/utils/text-chunking.js';
import { debugLog, infoLog, warnLog, errorLog, perfLog } from '~/shared/utils/conditional-logging.js';

export type ProcessKnowledgeArgs = {
	text: string;
	source: string;
	source_type: string;
	source_date: string;
};

/**
 * Extract and store knowledge triples from text using optimized embedding map approach
 */
export async function processKnowledge(args: ProcessKnowledgeArgs): Promise<ToolResult> {
	try {
		const startTime = Date.now();
		const phaseTimings: Record<string, number> = {};

		const estimatedTokens = Math.ceil(args.text.length / 4); // Rough estimation
		debugLog('[ProcessKnowledge] Starting Phase 3 optimized processing with:', {
			textLength: args.text.length,
			source: args.source,
			source_type: args.source_type,
			estimatedTokens,
		});

		// Check if text needs chunking (>3000 tokens)
		const MAX_TOKENS = 3000;
		if (estimatedTokens > MAX_TOKENS) {
			console.debug(`[ProcessKnowledge] Text is large (${estimatedTokens} tokens), using chunking approach`);
			
			const chunks = chunkText(args.text, {
				maxTokens: MAX_TOKENS,
				overlapTokens: 200,
				preserveParagraphs: true,
			});
			
			console.debug(`[ProcessKnowledge] Split text into ${chunks.length} chunks`);
			
			// Process chunks in parallel for better performance
			const chunkPromises = chunks.map(async (chunk, index) => {
				const chunkArgs = {
					...args,
					text: chunk.text,
					source: `${args.source}_chunk_${index + 1}`,
				};
				
				console.debug(`[ProcessKnowledge] Processing chunk ${index + 1}/${chunks.length} (${chunk.estimatedTokens} tokens)`);
				return await processKnowledgeChunk(chunkArgs);
			});
			
			const chunkResults = await Promise.allSettled(chunkPromises);
			const successfulResults = chunkResults
				.filter((result, index) => {
					if (result.status === 'rejected') {
						console.warn(`[ProcessKnowledge] Chunk ${index + 1} failed:`, result.reason);
						return false;
					}
					return result.value.success;
				})
				.map(result => (result as PromiseFulfilledResult<any>).value);
			
			// Merge all successful chunk results
			let totalTriples = 0;
			let totalConcepts = 0;
			let totalConceptualizations = 0;
			let totalVectors = 0;
			
			for (const result of successfulResults) {
				if (result.data) {
					totalTriples += result.data.triplesStored || 0;
					totalConcepts += result.data.conceptsStored || 0;
					totalConceptualizations += result.data.conceptualizationsStored || 0;
					totalVectors += result.data.vectorsGenerated || 0;
				}
			}
			
			const duration = Date.now() - startTime;
			console.debug(`[ProcessKnowledge] Chunked processing completed in ${duration}ms:`, {
				totalChunks: chunks.length,
				successfulChunks: successfulResults.length,
				failedChunks: chunks.length - successfulResults.length,
				triplesStored: totalTriples,
				conceptsStored: totalConcepts,
				conceptualizationsStored: totalConceptualizations,
				vectorsGenerated: totalVectors,
			});
			
			return {
				success: true,
				data: {
					triplesStored: totalTriples,
					conceptsStored: totalConcepts,
					conceptualizationsStored: totalConceptualizations,
					vectorsGenerated: totalVectors,
					processingTime: duration,
					chunksProcessed: successfulResults.length,
					chunksTotal: chunks.length,
				},
			};
		}

		// For smaller texts, continue with normal processing
		return await processKnowledgeChunk(args);
	} catch (error) {
		console.error('[ProcessKnowledge] Unexpected error:', error);
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Unknown error occurred',
				operation: 'knowledge_processing',
			},
		};
	}
}

/**
 * Process a single chunk of knowledge text (used by both chunked and non-chunked processing)
 */
async function processKnowledgeChunk(args: ProcessKnowledgeArgs): Promise<ToolResult<any>> {
	try {
		const startTime = Date.now();
		const phaseTimings: Record<string, number> = {};

		console.debug('[ProcessKnowledge] Processing chunk with:', {
			textLength: args.text.length,
			source: args.source,
			source_type: args.source_type,
			estimatedTokens: Math.ceil(args.text.length / 4),
		});

		const embeddingService = createEmbeddingService({
			model: env.EMBEDDING_MODEL,
			dimensions: env.EMBEDDING_DIMENSIONS,
			batchSize: env.BATCH_SIZE,
		});

		// Extract knowledge
		const extractionStartTime = Date.now();
		console.debug('[ProcessKnowledge] Phase 3: Extracting triples...');
		const extractionResult = await extractKnowledgeTriples(args);
		phaseTimings.extraction = Date.now() - extractionStartTime;
		if (!extractionResult.success || !extractionResult.data) {
			console.error('[ProcessKnowledge] Extraction failed:', extractionResult.error);
			return {
				success: false,
				error: {
					message: extractionResult.error?.message ?? 'Unknown error',
					operation: 'knowledge_extraction',
				},
			};
		}

		let { triples, concepts, conceptualizations } = extractionResult.data;
		console.debug(`[ProcessKnowledge] Phase 3: Extracted ${triples.length} triples and ${concepts.length} concepts in ${phaseTimings.extraction}ms`);

		// Phase 2 optimization: Generate comprehensive embedding map once for all operations
		const embeddingStartTime = Date.now();
		console.debug('[ProcessKnowledge] Phase 3: Generating comprehensive embedding map...');
		const embeddingMapResult = await generateEmbeddingMap(triples, concepts, embeddingService, env.ENABLE_SEMANTIC_DEDUP);
		phaseTimings.embeddingGeneration = Date.now() - embeddingStartTime;
		
		if (!embeddingMapResult.success) {
			console.error('[ProcessKnowledge] Phase 2: Embedding map generation failed:', embeddingMapResult.error);
			return {
				success: false,
				error: {
					message: `Embedding map generation failed: ${embeddingMapResult.error.message}`,
					operation: 'embedding_generation',
				},
			};
		}

		const embeddingMap = embeddingMapResult.data.embeddings;
		const embeddingStats = embeddingMapResult.data.stats;
		console.debug(`[ProcessKnowledge] Phase 3: ✅ Generated embedding map in ${phaseTimings.embeddingGeneration}ms - ${embeddingStats.uniqueTexts} unique embeddings, ${embeddingStats.duplicatesAverted} duplicates averted, ${embeddingStats.batchCalls} API calls`);

		// Always deduplicate triples using embedding map
		const deduplicationStartTime = Date.now();
		if (triples.length > 0) {
			console.debug('[ProcessKnowledge] Phase 3: Deduplicating triples using embedding map...');
			const deduplicationResult = await deduplicateTriples(triples, embeddingMap);
			if (deduplicationResult.success) {
				const originalCount = triples.length;
				triples = deduplicationResult.data?.uniqueTriples ?? [];
				console.debug(
					`[ProcessKnowledge] Phase 3: Deduplicated: ${originalCount} → ${triples.length} triples using embedding map`
				);
			}
		}
		phaseTimings.deduplication = Date.now() - deduplicationStartTime;

		// Phase 3 optimization: Batch store all knowledge data in single atomic transaction
		const storageStartTime = Date.now();
		console.debug('[ProcessKnowledge] Phase 3: Batch storing all knowledge data in atomic transaction...');
		const batchStorageResult = await batchStoreKnowledge({
			triples,
			concepts,
			conceptualizations,
			embeddingMap,
		});
		phaseTimings.storage = Date.now() - storageStartTime;

		if (!batchStorageResult.success) {
			console.error('[ProcessKnowledge] Phase 3: Batch storage failed:', batchStorageResult.error);
			return {
				success: false,
				error: {
					message: `Batch storage failed: ${batchStorageResult.error.message}`,
					operation: 'batch_knowledge_storage',
				},
			};
		}

		const storageStats = batchStorageResult.data;
		console.debug(`[ProcessKnowledge] Phase 3: ✅ Batch storage completed in ${phaseTimings.storage}ms:`, storageStats);

		// Note: Conceptualization is now handled in the extraction phase and stored in batch storage
		// Background processing removed as it was redundant

		const duration = Date.now() - startTime;
		phaseTimings.total = duration;
		
		console.debug(`[ProcessKnowledge] Phase 3 optimization completed in ${duration}ms`, {
			...storageStats,
			phaseTimings,
			embeddingEfficiency: {
				uniqueEmbeddings: embeddingStats.uniqueTexts,
				duplicatesAverted: embeddingStats.duplicatesAverted,
				apiCallsSaved: embeddingStats.duplicatesAverted > 0 ? Math.floor(embeddingStats.duplicatesAverted / env.BATCH_SIZE) : 0,
				batchCalls: embeddingStats.batchCalls,
			},
		});

		return {
			success: true,
			data: {
				...storageStats,
				metadata: {
					source: args.source,
					source_type: args.source_type,
					optimizations: {
						phase: 'Phase 3 - Batch Transaction Storage + Embedding Map',
						batchTransaction: true,
						embeddingOptimization: {
							uniqueEmbeddings: embeddingStats.uniqueTexts,
							duplicatesAverted: embeddingStats.duplicatesAverted,
							totalBatchCalls: embeddingStats.batchCalls,
							efficiency: embeddingStats.duplicatesAverted > 0 
								? Math.round((embeddingStats.duplicatesAverted / embeddingStats.totalTexts) * 100) 
								: 0,
						},
						performanceTimings: phaseTimings,
					},
				},
			},
		};
	} catch (error) {
		console.error('[ProcessKnowledge] Unexpected error:', error);
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Unknown error occurred',
				operation: 'process_knowledge',
			},
		};
	}
}

/**
 * Search the knowledge graph using fusion search
 */
export async function searchKnowledgeGraph(args: {
	query: string;
	limit?: number;
	threshold?: number;
	searchTypes?: ('entity' | 'relationship' | 'semantic' | 'concept')[];
	weights?: {
		entity?: number;
		relationship?: number;
		semantic?: number;
		concept?: number;
	};
}): Promise<ToolResult<FusionSearchResult[]>> {
	try {
		const { query, limit = 10, threshold = 0.0, searchTypes, weights } = args;

		const searchOptions = {
			limit,
			threshold,
			enabledSearchTypes: searchTypes,
			weights,
		};

		// Use fusion search as default
		const result = await searchFusion(query, searchOptions);

		if (!result.success) {
			return {
				success: false,
				error: {
					message: result.error.message,
					operation: 'search_knowledge_graph',
				},
			};
		}

		return {
			success: true,
			data: result.data,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Unknown error occurred',
				operation: 'search_knowledge_graph',
			},
		};
	}
}

/**
 * Search for concepts in the knowledge graph
 */
export async function searchConceptsTool(args: {
	query: string;
	abstraction?: string;
}): Promise<ToolResult<Concept[]>> {
	try {
		const { query, abstraction } = args;

		const result = await searchConcepts(query, abstraction);

		if (!result.success) {
			return {
				success: false,
				error: {
					message: result.error.message,
					operation: 'search_concepts',
				},
			};
		}

		return {
			success: true,
			data: result.data,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Unknown error occurred',
				operation: 'search_concepts',
			},
		};
	}
}

/**
 * Get knowledge graph statistics
 */
export async function getKnowledgeGraphStats(): Promise<ToolResult<GraphStats>> {
	try {
		const result = await getStats();

		if (!result.success) {
			return {
				success: false,
				error: {
					message: result.error.message,
					operation: 'get_knowledge_graph_stats',
				},
			};
		}

		return {
			success: true,
			data: result.data,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Unknown error occurred',
				operation: 'get_knowledge_graph_stats',
			},
		};
	}
}

/**
 * Tool dispatcher that maps tool names to functions
 */
export async function executeToolFunction(toolName: string, args: any): Promise<ToolResult<any>> {
	const startTime = Date.now();
	console.debug(`[ToolDispatcher] Executing ${toolName}...`);

	let result: ToolResult;
	switch (toolName) {
		case 'process_knowledge':
			result = await processKnowledge(args);
			break;
		case 'search_knowledge_graph':
			result = await searchKnowledgeGraph(args);
			break;
		case 'search_concepts':
			result = await searchConceptsTool(args);
			break;
		case 'get_knowledge_graph_stats':
			result = await getKnowledgeGraphStats();
			break;
		default:
			console.warn(`[ToolDispatcher] Unknown tool requested: ${toolName}`);
			result = {
				success: false,
				error: {
					message: `Unknown tool: ${toolName}`,
					operation: 'tool_dispatch',
				},
			};
	}

	const duration = Date.now() - startTime;
	console.debug(`[ToolDispatcher] ${toolName} completed in ${duration}ms`, {
		success: result.success,
		error: result.success ? undefined : result.error?.operation,
	});

	return result;
}

/**
 * Tool definitions that can be shared across transports
 */
export const TOOL_DEFINITIONS = [
	{
		name: 'process_knowledge',
		description: 'Extract knowledge triples from text and store them in the knowledge graph',
		inputSchema: {
			type: 'object',
			properties: {
				text: {
					type: 'string',
					description: 'The text content to extract knowledge from',
				},
				source: {
					type: 'string',
					description: 'Source identifier for the content',
				},
				thread_id: {
					type: 'string',
					description: 'Optional thread ID for grouping',
				},
				source_date: {
					type: 'string',
					description: 'Optional source date (ISO format)',
				},
				include_concepts: {
					type: 'boolean',
					description: 'Whether to include conceptualization (default: false)',
				},
			},
			required: ['text', 'source'],
		},
	},
	{
		name: 'search_knowledge_graph',
		description:
			'Search the knowledge graph using fusion search (combines entity, relationship, semantic, and concept search)',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query',
				},
				limit: {
					type: 'number',
					description: 'Maximum number of results (default: 10)',
				},
				threshold: {
					type: 'number',
					description: 'Similarity threshold (default: 0.0)',
				},
				searchTypes: {
					type: 'array',
					items: {
						type: 'string',
						enum: ['entity', 'relationship', 'semantic', 'concept'],
					},
					description: 'Which search types to enable (default: all)',
				},
				weights: {
					type: 'object',
					properties: {
						entity: { type: 'number', description: 'Weight for entity search (default: 0.3)' },
						relationship: {
							type: 'number',
							description: 'Weight for relationship search (default: 0.2)',
						},
						semantic: { type: 'number', description: 'Weight for semantic search (default: 0.3)' },
						concept: { type: 'number', description: 'Weight for concept search (default: 0.2)' },
					},
					description: 'Custom weights for fusion ranking',
				},
			},
			required: ['query'],
		},
	},
	{
		name: 'search_concepts',
		description: 'Search for concepts in the knowledge graph',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query',
				},
				abstraction: {
					type: 'string',
					enum: ['high', 'medium', 'low'],
					description: 'Abstraction level filter',
				},
			},
			required: ['query'],
		},
	},
	{
		name: 'get_knowledge_graph_stats',
		description: 'Get knowledge graph statistics',
		inputSchema: {
			type: 'object',
			properties: {},
		},
	},
] as const;
