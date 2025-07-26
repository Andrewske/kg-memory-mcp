/**
 * Functional STDIO Server for Knowledge Graph MCP
 * Provides consistent API with HTTP server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import {
	processKnowledgeSchema,
	searchConceptsSchema,
	searchKnowledgeSchema,
} from '~/server/routes/knowledge-routes.js';
import {
	getKnowledgeGraphStats,
	processKnowledge,
	searchConceptsTool,
	searchKnowledgeGraph,
} from '~/server/transport-manager.js';

import type { ToolResult } from '~/shared/types/api.js';

// Server state
interface StdioServerState {
	server: Server;
	transport: StdioServerTransport;
	isRunning: boolean;
}

let serverState: StdioServerState | null = null;

export async function startStdioServer(): Promise<{ stop: () => Promise<void> }> {
	if (serverState?.isRunning) {
		throw new Error('STDIO server is already running');
	}

	// Create MCP server
	const server = new Server(
		{
			name: 'knowledge-graph-mcp',
			version: '1.0.0',
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				prompts: {},
				logging: {},
			},
		}
	);

	// Register tools
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return {
			tools: [
				{
					name: 'process_knowledge',
					description: 'Extract knowledge triples from text and store them in the knowledge graph',
					inputSchema: {
						type: 'object',
						properties: {
							text: { type: 'string', description: 'Text to process' },
							source: { type: 'string', description: 'Source identifier' },
							thread_id: { type: 'string', description: 'Optional thread ID' },
							source_date: { type: 'string', description: 'Optional source date (ISO string)' },
							include_concepts: {
								type: 'boolean',
								description: 'Whether to include conceptualization',
							},
						},
						required: ['text', 'source'],
					},
				},
				{
					name: 'search_knowledge_graph',
					description: 'Search the knowledge graph using fusion search',
					inputSchema: {
						type: 'object',
						properties: {
							query: { type: 'string', description: 'Search query' },
							limit: { type: 'number', description: 'Maximum results to return', default: 10 },
							threshold: { type: 'number', description: 'Similarity threshold', default: 0.0 },
							searchTypes: {
								type: 'array',
								items: { type: 'string', enum: ['entity', 'relationship', 'semantic', 'concept'] },
								description: 'Types of search to perform',
							},
							weights: {
								type: 'object',
								properties: {
									entity: { type: 'number' },
									relationship: { type: 'number' },
									semantic: { type: 'number' },
									concept: { type: 'number' },
								},
								description: 'Weights for different search types',
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
							query: { type: 'string', description: 'Search query' },
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
					description: 'Get statistics about the knowledge graph',
					inputSchema: {
						type: 'object',
						properties: {},
					},
				},
			],
		};
	});

	// Register tool handlers
	server.setRequestHandler(CallToolRequestSchema, async request => {
		const { name, arguments: args } = request.params;

		try {
			let result: ToolResult;

			switch (name) {
				case 'process_knowledge': {
					const parsedArgs = processKnowledgeSchema.parse(args);
					// Transform to match function signature
					const transformedArgs = {
						text: parsedArgs.text,
						source: parsedArgs.source,
						source_type: 'thread', // Default source type
						source_date: parsedArgs.source_date || new Date().toISOString(),
					};
					result = await processKnowledge(transformedArgs);
					break;
				}
				case 'search_knowledge_graph':
					result = await searchKnowledgeGraph(searchKnowledgeSchema.parse(args));
					break;
				case 'search_concepts':
					result = await searchConceptsTool(searchConceptsSchema.parse(args));
					break;
				case 'get_knowledge_graph_stats':
					result = await getKnowledgeGraphStats();
					break;
				default:
					throw new Error(`Unknown tool: ${name}`);
			}

			if (!result.success) {
				return {
					isError: true,
					content: [
						{
							type: 'text',
							text: `Error: ${result.error?.message || 'Unknown error occurred'}`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(result.data, null, 2),
					},
				],
			};
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
					},
				],
			};
		}
	});

	// Create transport
	const transport = new StdioServerTransport();

	// Start server
	await server.connect(transport);

	serverState = {
		server,
		transport,
		isRunning: true,
	};

	console.log('📡 STDIO server connected and ready');

	// Return stop function
	return {
		stop: async (): Promise<void> => {
			if (!serverState?.isRunning) {
				return;
			}

			try {
				await serverState.server.close();
				serverState.isRunning = false;
				serverState = null;
				console.log('📡 STDIO server stopped');
			} catch (error) {
				console.error('Error stopping STDIO server:', error);
				throw error;
			}
		},
	};
}

// Health check function (can be called externally)
export function getStdioServerStatus(): { isRunning: boolean; uptime?: number } {
	return {
		isRunning: serverState?.isRunning ?? false,
		uptime: serverState?.isRunning ? process.uptime() : undefined,
	};
}
