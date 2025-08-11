/**
 * Transport abstraction layer for Knowledge Graph MCP Server
 * Provides shared tool handling logic across different transports
 */

import type { FusionSearchResult } from '~/features/knowledge-graph/fusion-search.js';
import { searchFusion } from '~/features/knowledge-graph/fusion-search.js';
import { getStats } from '~/features/knowledge-graph/operations.js';
import { searchConcepts } from '~/features/knowledge-graph/search.js';
import {
	getPipelineStatus,
	initiateKnowledgePipeline,
} from '~/features/knowledge-processing/pipeline-coordinator.js';
import type { GraphStats, ToolResult } from '~/shared/types/api.js';
import type { Concept } from '~/shared/types/core.js';

export type ProcessKnowledgeArgs = {
	text: string;
	source: string;
	source_type: string;
	source_date: string;
};

/**
 * Get pipeline status and progress
 */
export async function getPipelineStatusTool(args: { parentJobId: string }): Promise<ToolResult> {
	try {
		const status = await getPipelineStatus(args.parentJobId);

		if (!status) {
			return {
				success: false,
				error: {
					message: 'Pipeline not found',
					operation: 'get_pipeline_status',
				},
			};
		}

		return {
			success: true,
			data: status,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Failed to get pipeline status',
				operation: 'get_pipeline_status',
			},
		};
	}
}

/**
 * Process knowledge using the new 3-job pipeline
 * Simply initiates the pipeline and returns job tracking information
 */
export async function processKnowledge(args: ProcessKnowledgeArgs): Promise<ToolResult> {
	try {
		console.debug('[ProcessKnowledge] Initiating 3-job pipeline', {
			textLength: args.text.length,
			source: args.source,
			source_type: args.source_type,
		});

		// Initiate the pipeline and get parent job ID
		const parentJobId = await initiateKnowledgePipeline(args);

		// Get initial pipeline status
		const status = await getPipelineStatus(parentJobId);

		return {
			success: true,
			data: {
				message: 'Knowledge processing pipeline initiated',
				parentJobId,
				estimatedTime: '2-5 minutes',
				stages: {
					extraction: 'Coordinated parallel extraction',
					concepts: 'Background concept generation',
					deduplication: 'Optional semantic deduplication',
				},
				status,
			},
		};
	} catch (error) {
		console.error('[ProcessKnowledge] Pipeline initiation failed:', error);
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Pipeline initiation failed',
				operation: 'pipeline_initiation',
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
		case 'get_pipeline_status':
			result = await getPipelineStatusTool(args);
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
		description:
			'Extract knowledge triples from text and store them in the knowledge graph using the new 3-job pipeline',
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
				source_type: {
					type: 'string',
					description: 'Type of source (e.g. "thread", "file", "manual")',
				},
				source_date: {
					type: 'string',
					description: 'Source date (ISO format)',
				},
			},
			required: ['text', 'source', 'source_type', 'source_date'],
		},
	},
	{
		name: 'get_pipeline_status',
		description: 'Get the status and progress of a knowledge processing pipeline',
		inputSchema: {
			type: 'object',
			properties: {
				parentJobId: {
					type: 'string',
					description: 'The parent job ID returned from process_knowledge',
				},
			},
			required: ['parentJobId'],
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
