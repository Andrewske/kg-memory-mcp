/**
 * Transport abstraction layer for Knowledge Graph MCP Server
 * Provides shared tool handling logic across different transports
 */

import { deduplicateTriples } from '~/features/deduplication/deduplicate';
import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract';
import { searchFusion } from '~/features/knowledge-graph/fusion-search';
import { getStats, storeTriples } from '~/features/knowledge-graph/operations';
import { searchConcepts } from '~/features/knowledge-graph/search';

import type { ToolDependencies, ToolResult } from '~/shared/types';

/**
 * Extract and store knowledge triples from text
 */
export async function processKnowledge(
	args: {
		text: string;
		source: string;
		source_type: string;
		source_date: string;
		processing_batch_id?: string;
		include_concepts?: boolean;
	},
	dependencies: ToolDependencies
): Promise<ToolResult> {
	try {
		const startTime = Date.now();
		const {
			text,
			source,
			source_type,
			source_date,
			processing_batch_id = `batch_${Date.now()}`,
			include_concepts = false,
		} = args;

		console.debug('[ProcessKnowledge] Starting with:', {
			textLength: text.length,
			source,
			source_type,
			include_concepts,
			processing_batch_id,
		});

		const metadata = {
			source,
			source_type, // Assume thread type for transport-manager
			source_date,
			processing_batch_id,
		};

		const { config, db, embeddingService, aiProvider } = dependencies;

		// Extract knowledge
		console.debug('[ProcessKnowledge] Extracting triples...');
		const extractionResult = await extractKnowledgeTriples(
			text,
			metadata,
			aiProvider,
			config,
			false
		);
		if (!extractionResult.success) {
			console.error('[ProcessKnowledge] Extraction failed:', extractionResult.error);
			return {
				success: false,
				error: {
					message: extractionResult.error.message,
					operation: 'knowledge_extraction',
				},
			};
		}

		let { triples } = extractionResult.data;
		console.debug(`[ProcessKnowledge] Extracted ${triples.length} triples`);

		// Always deduplicate triples
		if (triples.length > 0) {
			console.debug('[ProcessKnowledge] Deduplicating triples...');
			const deduplicationResult = await deduplicateTriples(
				triples,
				embeddingService,
				config.deduplication
			);
			if (deduplicationResult.success) {
				const originalCount = triples.length;
				triples = deduplicationResult.data.uniqueTriples;
				console.debug(
					`[ProcessKnowledge] Deduplicated: ${originalCount} → ${triples.length} triples`
				);
			}
		}

		// Store triples with vector generation
		console.debug('[ProcessKnowledge] Storing triples...');
		const storeResult = await storeTriples(triples, db, config, embeddingService);
		if (!storeResult.success) {
			console.error('[ProcessKnowledge] Storage failed:', storeResult.error);
			return {
				success: false,
				error: {
					message: storeResult.error.message,
					operation: 'knowledge_storage',
				},
			};
		}

		// Queue background conceptualization if requested
		if (include_concepts && triples.length > 0) {
			setImmediate(async () => {
				try {
					console.log(`[Background] Starting conceptualization for ${triples.length} triples...`);

					const { generateConcepts, extractElementsFromTriples } = await import(
						'~/features/conceptualization/conceptualize'
					);
					const conceptInput = extractElementsFromTriples(triples);
					const conceptualizeResult = await generateConcepts(
						conceptInput,
						metadata,
						aiProvider,
						config
					);

					if (conceptualizeResult.success && conceptualizeResult.data.concepts.length > 0) {
						const { storeConcepts } = await import('~/features/knowledge-graph/operations');
						const conceptResult = await storeConcepts(
							conceptualizeResult.data.concepts,
							db,
							config,
							embeddingService // Enable concept vector generation
						);

						// Store conceptualization relationships
						const relationshipResult = await db.storeConceptualizations(
							conceptualizeResult.data.relationships
						);

						if (conceptResult.success && relationshipResult.success) {
							const vectorsGenerated = conceptResult.data.vectorsGenerated || 0;
							console.log(
								`[Background] Successfully stored ${conceptualizeResult.data.concepts.length} concepts, ${conceptualizeResult.data.relationships.length} relationships, and ${vectorsGenerated} concept vectors`
							);
						} else {
							if (!conceptResult.success) {
								console.error(`[Background] Failed to store concepts:`, conceptResult.error);
							}
							if (!relationshipResult.success) {
								console.error(
									`[Background] Failed to store conceptualization relationships:`,
									relationshipResult.error
								);
							}
						}
					}
				} catch (error) {
					console.error(`[Background] Conceptualization error:`, error);
				}
			});
		}

		const duration = Date.now() - startTime;
		console.debug(`[ProcessKnowledge] Completed in ${duration}ms`, {
			triplesStored: triples.length,
			conceptsQueued: include_concepts && triples.length > 0,
		});

		return {
			success: true,
			data: {
				triplesStored: triples.length,
				conceptsStored: include_concepts ? 'processing in background' : 0,
				metadata,
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
export async function searchKnowledgeGraph(
	args: {
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
	},
	dependencies: ToolDependencies
): Promise<ToolResult> {
	try {
		const { query, limit = 10, threshold = 0.0, searchTypes, weights } = args;
		const { config, db, embeddingService } = dependencies;

		const searchConfig = {
			...config,
			search: {
				...config.search,
				topK: limit,
				minScore: threshold,
			},
		};

		const searchOptions = {
			limit,
			threshold,
			enabledSearchTypes: searchTypes,
			weights,
		};

		// Use fusion search as default
		const result = await searchFusion(query, db, embeddingService, searchConfig, searchOptions);

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
export async function searchConceptsTool(
	args: {
		query: string;
		abstraction?: string;
	},
	dependencies: ToolDependencies
): Promise<ToolResult> {
	try {
		const { query, abstraction } = args;
		const { db } = dependencies;

		const result = await searchConcepts(query, db, abstraction);

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
export async function getKnowledgeGraphStats(dependencies: ToolDependencies): Promise<ToolResult> {
	try {
		const { db } = dependencies;

		const result = await getStats(db);

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
export async function executeToolFunction(
	toolName: string,
	args: any,
	dependencies: ToolDependencies
): Promise<ToolResult> {
	const startTime = Date.now();
	console.debug(`[ToolDispatcher] Executing ${toolName}...`);

	let result: ToolResult;
	switch (toolName) {
		case 'process_knowledge':
			result = await processKnowledge(args, dependencies);
			break;
		case 'search_knowledge_graph':
			result = await searchKnowledgeGraph(args, dependencies);
			break;
		case 'search_concepts':
			result = await searchConceptsTool(args, dependencies);
			break;
		case 'get_knowledge_graph_stats':
			result = await getKnowledgeGraphStats(dependencies);
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
				processing_batch_id: {
					type: 'string',
					description: 'Optional batch ID for processing',
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
