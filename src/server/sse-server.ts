/**
 * SSE (Server-Sent Events) Server for Knowledge Graph MCP Server
 * Provides MCP protocol over HTTP/SSE for web-based clients
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";

import {
	ToolHandler,
	TOOL_DEFINITIONS,
	type ToolDependencies,
} from "./transport-manager.js";
import type { KnowledgeTriple } from "~/shared/types/index.js";

export interface SSEServerConfig {
	endpoint: string; // e.g., '/mcp' or '/api/sse'
}

export class KnowledgeGraphSSEServer {
	private server: Server;
	private toolHandler: ToolHandler;
	private sseConfig: SSEServerConfig;

	constructor(sseConfig: SSEServerConfig, dependencies: ToolDependencies) {
		this.sseConfig = sseConfig;
		this.toolHandler = new ToolHandler(dependencies);

		this.server = new Server(
			{
				name: "knowledge-graph-mcp",
				version: "1.0.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		this.setupTools();
	}

	private setupTools(): void {
		// Register tools
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools: TOOL_DEFINITIONS };
		});

		// Register tool handlers using the abstracted tool handler
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;

			try {
				let result;

				switch (name) {
					case "process_knowledge":
						result = await this.toolHandler.processKnowledge(args as any);
						break;
					case "search_knowledge_graph":
						result = await this.toolHandler.searchKnowledgeGraph(args as any);
						break;
					case "search_concepts":
						result = await this.toolHandler.searchConcepts(args as any);
						break;
					case "deduplicate_triples":
						result = await this.toolHandler.deduplicateTriples(
							args as { triples: KnowledgeTriple[] },
						);
						break;
					case "get_knowledge_graph_stats":
						result = await this.toolHandler.getKnowledgeGraphStats();
						break;
					case "enumerate_entities":
						result = await this.toolHandler.enumerateEntities(args as any);
						break;
					default:
						throw new McpError(
							ErrorCode.MethodNotFound,
							`Unknown tool: ${name}`,
						);
				}

				if (!result.success) {
					throw new McpError(
						ErrorCode.InternalError,
						result.error?.message || "Tool execution failed",
					);
				}

				return {
					content: [
						{
							type: "text",
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
					`Tool execution failed: ${error}`,
				);
			}
		});
	}

	/**
	 * Create Express middleware for SSE endpoint
	 */
	public createSSEMiddleware() {
		return async (req: Request, res: Response) => {
			try {
				// Set SSE headers
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers":
						"Content-Type, Authorization, X-MCP-Version",
					"X-MCP-Version": "2024-11-05",
				});

				// Create SSE transport
				const transport = new SSEServerTransport(this.sseConfig.endpoint, res);

				// Connect server to transport
				await this.server.connect(transport);

				console.log("🔗 SSE MCP client connected");

				// Handle client disconnect
				req.on("close", () => {
					console.log("🔌 SSE MCP client disconnected");
					this.server.close().catch(console.error);
				});

				req.on("error", (error) => {
					console.error("SSE connection error:", error);
					this.server.close().catch(console.error);
				});
			} catch (error) {
				console.error("SSE setup error:", error);
				res.status(500).json({
					error: "Failed to establish SSE connection",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			}
		};
	}

	/**
	 * Create Express middleware for SSE endpoint info
	 */
	public createSSEInfoMiddleware() {
		return (req: Request, res: Response) => {
			res.json({
				transport: "sse",
				protocol: "MCP",
				version: "2024-11-05",
				endpoint: this.sseConfig.endpoint,
				description: "Model Context Protocol over Server-Sent Events",
				usage: {
					connect: `Connect to ${this.sseConfig.endpoint} with EventSource or MCP SSE client`,
					tools: TOOL_DEFINITIONS.length,
					capabilities: [
						"knowledge-extraction",
						"search",
						"concepts",
						"deduplication",
					],
				},
				example: {
					javascript: `const eventSource = new EventSource('${this.sseConfig.endpoint}');`,
					mcp: `import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const transport = new SSEClientTransport('${this.sseConfig.endpoint}');
const client = new McpClient({ name: 'my-client', version: '1.0.0' });
await client.connect(transport);`,
				},
			});
		};
	}

	public getServer(): Server {
		return this.server;
	}
}
