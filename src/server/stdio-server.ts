/**
 * STDIO Server for Knowledge Graph MCP Server
 * Provides MCP protocol over standard input/output
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type {
	AIProvider,
	DatabaseAdapter,
	EmbeddingService,
	KnowledgeGraphConfig,
} from '~/shared/types/index.js';
// Import unified tool functions
import { executeToolFunction, TOOL_DEFINITIONS } from './transport-manager.js';
export interface StdioServerDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
}

export class KnowledgeGraphStdioServer {
	private server: Server;
	private dependencies: StdioServerDependencies;

	constructor(dependencies: StdioServerDependencies) {
		this.dependencies = dependencies;
		this.server = new Server(
			{
				name: 'knowledge-graph-mcp',
				version: '1.0.0',
			},
			{
				capabilities: {
					tools: {},
				},
			}
		);

		this.setupTools();
	}

	private setupTools(): void {
		// Use TOOL_DEFINITIONS from transport-manager for consistency
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: TOOL_DEFINITIONS.map(tool => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				})),
			};
		});

		// Call tool handler using unified dispatcher
		this.server.setRequestHandler(CallToolRequestSchema, async request => {
			try {
				const { config, db, embeddingService, aiProvider } = this.dependencies;
				const { name, arguments: args } = request.params;

				// Use the unified tool dispatcher
				const result = await executeToolFunction(name, args, {
					config,
					db,
					embeddingService,
					aiProvider,
				});

				if (!result.success) {
					throw new McpError(ErrorCode.InternalError, result.error?.message || 'Unknown error');
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
				if (error instanceof McpError) {
					throw error;
				}
				throw new McpError(
					ErrorCode.InternalError,
					`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		});
	}

	public async start(): Promise<void> {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.log('🔌 STDIO MCP Server started');
	}

	public async stop(): Promise<void> {
		await this.server.close();
		console.log('🛑 STDIO MCP Server stopped');
	}
}
