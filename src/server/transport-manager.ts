/**
 * Transport abstraction layer for Knowledge Graph MCP Server
 * Provides shared tool handling logic across different transports
 */

import { extractKnowledgeTriples } from "~/features/knowledge-extraction/extract.js";
import {
	storeTriples,
	getStats,
	enumerateEntities,
} from "~/features/knowledge-graph/operations.js";
import {
	searchByText,
	searchConcepts,
	searchFusion,
	searchByEntity,
	searchByRelationship,
	searchBySemantic,
	searchByConcept,
	type FusionSearchWeights,
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
import type { EntityEnumerationOptions } from "~/features/knowledge-graph/operations.js";
import {
	createTokenTrackingService,
	type TokenTrackingService,
} from "~/shared/services/token-tracking-service.js";
import { createTrackedAIProvider } from "~/shared/services/tracked-ai-provider.js";

export interface ToolDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
	tokenTracker?: TokenTrackingService;
}

export interface ToolResult<T = any> {
	success: boolean;
	data?: T;
	error?: {
		message: string;
		code?: string;
		operation: string;
	};
}

/**
 * Abstract tool handler that can be used by any transport
 */
export class ToolHandler {
	private tokenTracker: TokenTrackingService;
	private trackedAIProvider: AIProvider;

	constructor(private dependencies: ToolDependencies) {
		// Initialize token tracker if not provided
		this.tokenTracker =
			dependencies.tokenTracker || createTokenTrackingService(dependencies.db);

		// Create tracked AI provider that automatically logs token usage
		this.trackedAIProvider = createTrackedAIProvider(
			dependencies.aiProvider,
			this.tokenTracker,
			{
				provider: dependencies.config.ai.provider,
				model: dependencies.config.ai.model,
			},
		);

		// Update dependencies with token tracker for downstream use
		this.dependencies.tokenTracker = this.tokenTracker;
	}

	async processKnowledge(args: {
		text: string;
		source: string;
		thread_id?: string;
		conversation_date?: string;
		processing_batch_id?: string;
		include_concepts?: boolean;
		deduplicate?: boolean;
	}): Promise<ToolResult> {
		try {
			const {
				text,
				source,
				thread_id,
				conversation_date,
				processing_batch_id = `batch_${Date.now()}`,
				include_concepts = false,
				deduplicate = true,
			} = args;

			const metadata = {
				source,
				thread_id,
				conversation_date,
				processing_batch_id,
			};

			const { config, db, embeddingService } = this.dependencies;

			// Extract knowledge using tracked AI provider
			const extractionResult = await extractKnowledgeTriples(
				text,
				metadata,
				this.trackedAIProvider,
				config,
				false,
			);
			if (!extractionResult.success) {
				return {
					success: false,
					error: {
						message: extractionResult.error.message,
						operation: "knowledge_extraction",
					},
				};
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
				return {
					success: false,
					error: {
						message: storeResult.error.message,
						operation: "knowledge_storage",
					},
				};
			}

			// Queue background conceptualization if requested
			if (include_concepts && triples.length > 0) {
				// Capture services in closure scope to avoid 'this' context issues
				const backgroundEmbeddingService = embeddingService;
				const backgroundAIProvider = this.trackedAIProvider;
				setImmediate(async () => {
					try {
						console.log(
							`[Background] Starting conceptualization for ${triples.length} triples...`,
						);

						const { generateConcepts, extractElementsFromTriples } =
							await import("~/features/conceptualization/conceptualize.js");
						const conceptInput = extractElementsFromTriples(triples);
						const conceptualizeResult = await generateConcepts(
							conceptInput,
							metadata,
							backgroundAIProvider,
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
								backgroundEmbeddingService, // Enable concept vector generation
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
				success: true,
				data: {
					triplesStored: triples.length,
					conceptsStored: include_concepts ? "processing in background" : 0,
					metadata,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: {
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "process_knowledge",
				},
			};
		}
	}

	async searchKnowledgeGraph(args: {
		query: string;
		limit?: number;
		threshold?: number;
	}): Promise<ToolResult> {
		try {
			const { query, limit = 10, threshold = 0.0 } = args;
			const { config, db, embeddingService } = this.dependencies;

			const searchConfig = {
				...config,
				search: {
					...config.search,
					topK: limit,
					minScore: threshold,
				},
			};

			const result = await searchByText(
				query,
				db,
				embeddingService,
				searchConfig,
			);

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "search_knowledge_graph",
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
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "search_knowledge_graph",
				},
			};
		}
	}

	async searchConcepts(args: {
		query: string;
		abstraction?: string;
	}): Promise<ToolResult> {
		try {
			const { query, abstraction } = args;
			const { db } = this.dependencies;

			const result = await searchConcepts(query, db, abstraction);

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "search_concepts",
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
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "search_concepts",
				},
			};
		}
	}

	async searchKnowledgeGraphFusion(args: {
		query: string;
		limit?: number;
		threshold?: number;
		searchTypes?: ("entity" | "relationship" | "semantic" | "concept")[];
		weights?: Partial<FusionSearchWeights>;
	}): Promise<ToolResult> {
		try {
			const { query, limit = 10, threshold = 0.0, searchTypes, weights } = args;
			const { config, db, embeddingService } = this.dependencies;

			const searchConfig = {
				...config,
				search: {
					...config.search,
					topK: limit,
					minScore: threshold,
				},
			};

			const result = await searchFusion(
				query,
				db,
				embeddingService,
				searchConfig,
				{
					limit,
					threshold,
					enabledSearchTypes: searchTypes,
					weights,
				},
			);

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "search_knowledge_graph_fusion",
					},
				};
			}

			return {
				success: true,
				data: {
					results: result.data,
					searchInfo: {
						totalResults: result.data.length,
						enabledSearchTypes: searchTypes || [
							"entity",
							"relationship",
							"semantic",
							"concept",
						],
						weights: weights || {
							entity: 0.3,
							relationship: 0.2,
							semantic: 0.3,
							concept: 0.2,
						},
						query,
						limit,
						threshold,
					},
				},
			};
		} catch (error) {
			return {
				success: false,
				error: {
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "search_knowledge_graph_fusion",
				},
			};
		}
	}

	async searchKnowledgeGraphByType(args: {
		query: string;
		searchType: "entity" | "relationship" | "semantic" | "concept";
		limit?: number;
		threshold?: number;
	}): Promise<ToolResult> {
		try {
			const { query, searchType, limit = 10, threshold = 0.0 } = args;
			const { config, db, embeddingService } = this.dependencies;

			let result;

			switch (searchType) {
				case "entity":
					result = await searchByEntity(query, db, config, {
						limit,
						threshold,
					});
					break;
				case "relationship":
					result = await searchByRelationship(query, db, config, {
						limit,
						threshold,
					});
					break;
				case "semantic":
					result = await searchBySemantic(query, db, embeddingService, config, {
						limit,
						threshold,
					});
					break;
				case "concept":
					result = await searchByConcept(query, db, config, {
						limit,
						threshold,
					});
					break;
				default:
					return {
						success: false,
						error: {
							message: `Invalid search type: ${searchType}`,
							operation: "search_knowledge_graph_by_type",
						},
					};
			}

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "search_knowledge_graph_by_type",
					},
				};
			}

			return {
				success: true,
				data: {
					results: result.data,
					searchType,
					query,
					totalResults: result.data.length,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: {
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "search_knowledge_graph_by_type",
				},
			};
		}
	}

	async deduplicateTriples(args: {
		triples: KnowledgeTriple[];
	}): Promise<ToolResult> {
		try {
			const { triples } = args;
			const { embeddingService, config } = this.dependencies;

			const result = await deduplicateTriples(
				triples,
				embeddingService,
				config.deduplication,
			);

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "deduplicate_triples",
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
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "deduplicate_triples",
				},
			};
		}
	}

	async getKnowledgeGraphStats(): Promise<ToolResult> {
		try {
			const { db } = this.dependencies;

			const result = await getStats(db);

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "get_knowledge_graph_stats",
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
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "get_knowledge_graph_stats",
				},
			};
		}
	}

	async enumerateEntities(args: {
		role?: string;
		min_occurrence?: number;
		sources?: string[];
		types?: string[];
		limit?: number;
		sort_by?: string;
	}): Promise<ToolResult> {
		try {
			const options: EntityEnumerationOptions = {
				role: (args.role as "subject" | "object" | "both") || "both",
				min_occurrence: args.min_occurrence || 1,
				sources: args.sources,
				types: args.types as
					| Array<
							| "entity-entity"
							| "entity-event"
							| "event-event"
							| "emotional-context"
					  >
					| undefined,
				limit: args.limit || 100,
				sort_by:
					(args.sort_by as "frequency" | "alphabetical" | "recent") ||
					"frequency",
			};

			const { db } = this.dependencies;

			const result = await enumerateEntities(options, db);

			if (!result.success) {
				return {
					success: false,
					error: {
						message: result.error.message,
						operation: "enumerate_entities",
					},
				};
			}

			return {
				success: true,
				data: {
					entities: result.data,
					stats: {
						totalEntities: result.data.length,
						filters: options,
					},
				},
			};
		} catch (error) {
			return {
				success: false,
				error: {
					message:
						error instanceof Error ? error.message : "Unknown error occurred",
					operation: "enumerate_entities",
				},
			};
		}
	}
}

/**
 * Tool definitions that can be shared across transports
 */
export const TOOL_DEFINITIONS = [
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
					description: "Whether to include conceptualization (default: false)",
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
					description: "Which role to enumerate entities for (default: both)",
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
	{
		name: "search_knowledge_graph_fusion",
		description:
			"Search using AutoSchemaKG fusion method - combines entity, relationship, semantic, and concept search with weighted ranking",
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
				searchTypes: {
					type: "array",
					items: {
						type: "string",
						enum: ["entity", "relationship", "semantic", "concept"],
					},
					description: "Which search types to enable (default: all)",
				},
				weights: {
					type: "object",
					properties: {
						entity: {
							type: "number",
							description: "Weight for entity search (default: 0.3)",
						},
						relationship: {
							type: "number",
							description: "Weight for relationship search (default: 0.2)",
						},
						semantic: {
							type: "number",
							description: "Weight for semantic search (default: 0.3)",
						},
						concept: {
							type: "number",
							description: "Weight for concept search (default: 0.2)",
						},
					},
					description: "Custom weights for fusion ranking",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "search_knowledge_graph_by_type",
		description:
			"Search using a specific AutoSchemaKG search type (entity, relationship, semantic, or concept)",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query",
				},
				searchType: {
					type: "string",
					enum: ["entity", "relationship", "semantic", "concept"],
					description: "Which search type to use",
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
			required: ["query", "searchType"],
		},
	},
] as const;
