/**
 * STDIO Server for Knowledge Graph MCP Server
 * Provides MCP protocol over standard input/output
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Import pure functions
import { extractKnowledgeTriples } from "~/features/knowledge-extraction/extract.js";
import {
	storeTriples,
	getStats,
	enumerateEntities,
} from "~/features/knowledge-graph/operations.js";
import {
	searchByText,
	searchConcepts,
} from "~/features/knowledge-graph/search.js";
import { deduplicateTriples } from "~/features/deduplication/deduplicate.js";

import type {
	KnowledgeGraphConfig,
	KnowledgeTriple,
} from "~/shared/types/index.js";
import type {
	DatabaseAdapter,
	EmbeddingService,
	AIProvider,
} from "~/shared/services/types.js";
import type { TokenTrackingService } from "~/shared/services/token-tracking-service.js";

export interface StdioServerDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
	tokenTracker?: TokenTrackingService;
}

export class KnowledgeGraphStdioServer {
	private server: Server;
	private dependencies: StdioServerDependencies;

	constructor(dependencies: StdioServerDependencies) {
		this.dependencies = dependencies;
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
		// Tool definitions
		const tools = [
			{
				name: "process_knowledge",
				description:
					"Extract knowledge triples from text and store them in the knowledge graph",
				inputSchema: {
					type: "object",
					properties: {
						text: {
							type: "string",
							description: "The text content to extract knowledge from",
						},
						source: {
							type: "string",
							description: "Source identifier for the content",
						},
						thread_id: {
							type: "string",
							description: "Optional thread ID for grouping",
						},
						conversation_date: {
							type: "string",
							description: "Optional conversation date (ISO format)",
						},
						processing_batch_id: {
							type: "string",
							description: "Optional batch ID for processing",
						},
						include_concepts: {
							type: "boolean",
							description:
								"Whether to include conceptualization (default: false)",
						},
						deduplicate: {
							type: "boolean",
							description:
								"Whether to deduplicate triples before storing (default: true)",
						},
					},
					required: ["text", "source"],
				},
			},
			{
				name: "search_knowledge_graph",
				description: "Search the knowledge graph for relevant triples",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Search query",
						},
						limit: {
							type: "number",
							description: "Maximum number of results (default: 10)",
						},
						threshold: {
							type: "number",
							description: "Similarity threshold (default: 0.0)",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "search_concepts",
				description: "Search for concepts in the knowledge graph",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Search query",
						},
						abstraction: {
							type: "string",
							enum: ["high", "medium", "low"],
							description: "Abstraction level filter",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "deduplicate_triples",
				description: "Deduplicate knowledge triples",
				inputSchema: {
					type: "object",
					properties: {
						triples: {
							type: "array",
							items: {
								type: "object",
								properties: {
									subject: { type: "string" },
									predicate: { type: "string" },
									object: { type: "string" },
									type: {
										type: "string",
										enum: [
											"entity-entity",
											"entity-event",
											"event-event",
											"emotional-context",
										],
									},
									source: { type: "string" },
									thread_id: { type: "string" },
									conversation_date: { type: "string" },
									extracted_at: { type: "string" },
									processing_batch_id: { type: "string" },
									confidence: { type: "number" },
								},
								required: [
									"subject",
									"predicate",
									"object",
									"type",
									"source",
									"extracted_at",
								],
							},
						},
					},
					required: ["triples"],
				},
			},
			{
				name: "get_knowledge_graph_stats",
				description: "Get knowledge graph statistics",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "enumerate_entities",
				description:
					"Enumerate entities in the knowledge graph with filtering and sorting options",
				inputSchema: {
					type: "object",
					properties: {
						role: {
							type: "string",
							enum: ["subject", "object", "both"],
							description:
								"Which role to enumerate entities for (default: both)",
						},
						min_occurrence: {
							type: "number",
							description: "Minimum times entity must appear (default: 1)",
						},
						sources: {
							type: "array",
							items: {
								type: "string",
							},
							description: "Filter by specific sources",
						},
						types: {
							type: "array",
							items: {
								type: "string",
								enum: [
									"entity-entity",
									"entity-event",
									"event-event",
									"emotional-context",
								],
							},
							description: "Filter by triple types",
						},
						limit: {
							type: "number",
							description: "Maximum entities to return (default: 100)",
						},
						sort_by: {
							type: "string",
							enum: ["frequency", "alphabetical", "recent"],
							description: "How to sort results (default: frequency)",
						},
					},
				},
			},
		];

		// Register tools
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools };
		});

		// Register tool handlers
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;
			const { config, db, embeddingService, aiProvider } = this.dependencies;

			try {
				switch (name) {
					case "process_knowledge": {
						const {
							text,
							source,
							thread_id,
							conversation_date,
							processing_batch_id = `batch_${Date.now()}`,
							include_concepts = false,
							deduplicate = true,
						} = args as any;

						const metadata = {
							source,
							thread_id,
							conversation_date,
							processing_batch_id,
						};

						// Extract knowledge (without conceptualization)
						const extractionResult = await extractKnowledgeTriples(
							text,
							metadata,
							aiProvider,
							config,
							false,
						);
						if (!extractionResult.success) {
							throw new McpError(
								ErrorCode.InternalError,
								extractionResult.error.message,
							);
						}

						let { triples } = extractionResult.data;

						// Deduplicate if requested
						if (deduplicate && triples.length > 0) {
							const deduplicationResult = await deduplicateTriples(
								triples,
								embeddingService,
								config.deduplication,
							);
							if (deduplicationResult.success) {
								triples = deduplicationResult.data.uniqueTriples;
							}
						}

						// Store triples with vector generation
						const storeResult = await storeTriples(triples, db, config, embeddingService);
						if (!storeResult.success) {
							throw new McpError(
								ErrorCode.InternalError,
								storeResult.error.message,
							);
						}

						// Queue background conceptualization if requested
						if (include_concepts && triples.length > 0) {
							setImmediate(async () => {
								try {
									console.log(
										`[Background] Starting conceptualization for ${triples.length} triples...`,
									);

									const { generateConcepts, extractElementsFromTriples } =
										await import(
											"~/features/conceptualization/conceptualize.js"
										);
									const conceptInput = extractElementsFromTriples(triples);
									const conceptualizeResult = await generateConcepts(
										conceptInput,
										metadata,
										aiProvider,
										config,
									);

									if (
										conceptualizeResult.success &&
										conceptualizeResult.data.concepts.length > 0
									) {
										const { storeConcepts } = await import(
											"~/features/knowledge-graph/operations.js"
										);
										const conceptResult = await storeConcepts(
											conceptualizeResult.data.concepts,
											db,
											config,
											embeddingService, // Enable concept vector generation
										);

										// Store conceptualization relationships  
										const relationshipResult = await db.storeConceptualizations(
											conceptualizeResult.data.relationships,
										);

										if (conceptResult.success && relationshipResult.success) {
											const vectorsGenerated = conceptResult.data.vectorsGenerated || 0;
											console.log(
												`[Background] Successfully stored ${conceptualizeResult.data.concepts.length} concepts, ${conceptualizeResult.data.relationships.length} relationships, and ${vectorsGenerated} concept vectors`,
											);
										} else {
											if (!conceptResult.success) {
												console.error(
													`[Background] Failed to store concepts:`,
													conceptResult.error,
												);
											}
											if (!relationshipResult.success) {
												console.error(
													`[Background] Failed to store conceptualization relationships:`,
													relationshipResult.error,
												);
											}
										}
									}
								} catch (error) {
									console.error(`[Background] Conceptualization error:`, error);
								}
							});
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											success: true,
											data: {
												triplesStored: triples.length,
												conceptsStored: include_concepts
													? "processing in background"
													: 0,
												metadata,
											},
										},
										null,
										2,
									),
								},
							],
						};
					}

					case "search_knowledge_graph": {
						const { query } = args as { query: string };
						const result = await searchByText(
							query,
							db,
							embeddingService,
							config,
						);

						if (!result.success) {
							throw new McpError(ErrorCode.InternalError, result.error.message);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.data, null, 2),
								},
							],
						};
					}

					case "search_concepts": {
						const { query, abstraction } = args as {
							query: string;
							abstraction?: string;
						};
						const result = await searchConcepts(query, db, abstraction);

						if (!result.success) {
							throw new McpError(ErrorCode.InternalError, result.error.message);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.data, null, 2),
								},
							],
						};
					}

					case "deduplicate_triples": {
						const { triples } = args as { triples: KnowledgeTriple[] };
						const result = await deduplicateTriples(
							triples,
							embeddingService,
							config.deduplication,
						);

						if (!result.success) {
							throw new McpError(ErrorCode.InternalError, result.error.message);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.data, null, 2),
								},
							],
						};
					}

					case "get_knowledge_graph_stats": {
						const result = await getStats(db);

						if (!result.success) {
							throw new McpError(ErrorCode.InternalError, result.error.message);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.data, null, 2),
								},
							],
						};
					}

					case "enumerate_entities": {
						const options = args as any;
						const result = await enumerateEntities(options, db);

						if (!result.success) {
							throw new McpError(ErrorCode.InternalError, result.error.message);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											entities: result.data,
											stats: {
												totalEntities: result.data.length,
												filters: {
													role: options.role || "both",
													min_occurrence: options.min_occurrence || 1,
													sources: options.sources || [],
													types: options.types || [],
													limit: options.limit || 100,
													sort_by: options.sort_by || "frequency",
												},
											},
										},
										null,
										2,
									),
								},
							],
						};
					}

					default:
						throw new McpError(
							ErrorCode.MethodNotFound,
							`Unknown tool: ${name}`,
						);
				}
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

	public async start(): Promise<void> {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.log("📡 STDIO MCP Server started");
	}

	public async stop(): Promise<void> {
		await this.server.close();
		console.log("🛑 STDIO MCP Server stopped");
	}

	public getServer(): Server {
		return this.server;
	}
}
