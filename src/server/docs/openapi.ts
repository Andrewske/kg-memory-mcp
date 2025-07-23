/**
 * OpenAPI documentation configuration for Knowledge Graph MCP Server
 */

import swaggerJsdoc from "swagger-jsdoc";
import type { Options } from "swagger-jsdoc";

const options: Options = {
	definition: {
		openapi: "3.0.0",
		info: {
			title: "Knowledge Graph MCP Server API",
			version: "1.0.0",
			description:
				"REST API for the Knowledge Graph Model Context Protocol Server",
			contact: {
				name: "Knowledge Graph MCP Server",
				url: "https://github.com/your-repo/full-context-mcp",
			},
			license: {
				name: "MIT",
				url: "https://opensource.org/licenses/MIT",
			},
		},
		servers: [
			{
				url: "http://localhost:3000/api",
				description: "Development server",
			},
			{
				url: "https://your-domain.com/api",
				description: "Production server",
			},
		],
		components: {
			schemas: {
				KnowledgeTriple: {
					type: "object",
					required: [
						"subject",
						"predicate",
						"object",
						"type",
						"source",
						"extracted_at",
					],
					properties: {
						subject: {
							type: "string",
							description: "The subject entity of the triple",
							example: "John",
						},
						predicate: {
							type: "string",
							description: "The relationship or predicate",
							example: "works_at",
						},
						object: {
							type: "string",
							description: "The object entity of the triple",
							example: "OpenAI",
						},
						type: {
							type: "string",
							enum: [
								"entity-entity",
								"entity-event",
								"event-event",
								"emotional-context",
							],
							description: "The type of knowledge triple",
							example: "entity-entity",
						},
						source: {
							type: "string",
							description: "Source identifier for the content",
							example: "conversation-123",
						},
						thread_id: {
							type: "string",
							description: "Optional thread ID for grouping",
							example: "thread-456",
						},
						conversation_date: {
							type: "string",
							format: "date-time",
							description: "Optional conversation date",
							example: "2024-01-01T00:00:00Z",
						},
						extracted_at: {
							type: "string",
							format: "date-time",
							description: "When the triple was extracted",
							example: "2024-01-01T00:00:00Z",
						},
						processing_batch_id: {
							type: "string",
							description: "Optional batch ID for processing",
							example: "batch_1234567890",
						},
						confidence: {
							type: "number",
							minimum: 0,
							maximum: 1,
							description: "Confidence score for the extraction",
							example: 0.95,
						},
					},
				},
				ProcessKnowledgeRequest: {
					type: "object",
					required: ["text", "source"],
					properties: {
						text: {
							type: "string",
							description: "The text content to extract knowledge from",
							example: "John works at OpenAI and lives in San Francisco.",
						},
						source: {
							type: "string",
							description: "Source identifier for the content",
							example: "conversation-123",
						},
						thread_id: {
							type: "string",
							description: "Optional thread ID for grouping",
							example: "thread-456",
						},
						conversation_date: {
							type: "string",
							format: "date-time",
							description: "Optional conversation date",
							example: "2024-01-01T00:00:00Z",
						},
						processing_batch_id: {
							type: "string",
							description: "Optional batch ID for processing",
							example: "batch_1234567890",
						},
						include_concepts: {
							type: "boolean",
							description: "Whether to include conceptualization",
							default: false,
							example: false,
						},
						deduplicate: {
							type: "boolean",
							description: "Whether to deduplicate triples before storing",
							default: true,
							example: true,
						},
					},
				},
				SearchKnowledgeRequest: {
					type: "object",
					required: ["query"],
					properties: {
						query: {
							type: "string",
							description: "Search query for knowledge graph",
							example: "John OpenAI",
						},
						limit: {
							type: "integer",
							minimum: 1,
							maximum: 100,
							description: "Maximum number of results",
							default: 10,
							example: 5,
						},
						threshold: {
							type: "number",
							minimum: 0,
							maximum: 1,
							description: "Similarity threshold",
							default: 0.0,
							example: 0.7,
						},
					},
				},
				SearchConceptsRequest: {
					type: "object",
					required: ["query"],
					properties: {
						query: {
							type: "string",
							description: "Search query for concepts",
							example: "technology companies",
						},
						abstraction: {
							type: "string",
							enum: ["high", "medium", "low"],
							description: "Abstraction level filter",
							example: "high",
						},
					},
				},
				DeduplicateRequest: {
					type: "object",
					required: ["triples"],
					properties: {
						triples: {
							type: "array",
							items: {
								$ref: "#/components/schemas/KnowledgeTriple",
							},
							description: "Array of knowledge triples to deduplicate",
						},
					},
				},
				SuccessResponse: {
					type: "object",
					properties: {
						success: {
							type: "boolean",
							example: true,
						},
						data: {
							type: "object",
							description: "Response data",
						},
						operation: {
							type: "string",
							description: "Operation name",
							example: "process_knowledge",
						},
						timestamp: {
							type: "string",
							format: "date-time",
							description: "Response timestamp",
							example: "2024-01-01T00:00:00Z",
						},
					},
				},
				ErrorResponse: {
					type: "object",
					properties: {
						success: {
							type: "boolean",
							example: false,
						},
						error: {
							type: "object",
							properties: {
								message: {
									type: "string",
									description: "Error message",
									example: "Validation failed",
								},
								operation: {
									type: "string",
									description: "Operation that failed",
									example: "process_knowledge",
								},
								timestamp: {
									type: "string",
									format: "date-time",
									description: "Error timestamp",
									example: "2024-01-01T00:00:00Z",
								},
							},
						},
					},
				},
				ValidationError: {
					type: "object",
					properties: {
						error: {
							type: "string",
							example: "Validation Error",
						},
						details: {
							type: "array",
							items: {
								type: "object",
								properties: {
									field: {
										type: "string",
										example: "text",
									},
									message: {
										type: "string",
										example: "Text is required",
									},
								},
							},
						},
						timestamp: {
							type: "string",
							format: "date-time",
							example: "2024-01-01T00:00:00Z",
						},
					},
				},
			},
			responses: {
				ValidationError: {
					description: "Validation error",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ValidationError",
							},
						},
					},
				},
				InternalServerError: {
					description: "Internal server error",
					content: {
						"application/json": {
							schema: {
								$ref: "#/components/schemas/ErrorResponse",
							},
						},
					},
				},
			},
		},
		paths: {
			"/process-knowledge": {
				post: {
					tags: ["Knowledge Extraction"],
					summary: "Extract and store knowledge from text",
					description:
						"Extracts knowledge triples from provided text and stores them in the knowledge graph",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/ProcessKnowledgeRequest",
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Knowledge successfully processed",
							content: {
								"application/json": {
									schema: {
										allOf: [
											{ $ref: "#/components/schemas/SuccessResponse" },
											{
												type: "object",
												properties: {
													data: {
														type: "object",
														properties: {
															triplesStored: {
																type: "integer",
																example: 5,
															},
															conceptsStored: {
																oneOf: [
																	{ type: "integer" },
																	{
																		type: "string",
																		enum: ["processing in background"],
																	},
																],
																example: "processing in background",
															},
															metadata: {
																type: "object",
																properties: {
																	source: { type: "string" },
																	thread_id: { type: "string" },
																	conversation_date: { type: "string" },
																	processing_batch_id: { type: "string" },
																},
															},
														},
													},
												},
											},
										],
									},
								},
							},
						},
						"400": { $ref: "#/components/responses/ValidationError" },
						"500": { $ref: "#/components/responses/InternalServerError" },
					},
				},
			},
			"/search-knowledge": {
				post: {
					tags: ["Knowledge Search"],
					summary: "Search the knowledge graph",
					description:
						"Search for relevant knowledge triples using semantic similarity",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/SearchKnowledgeRequest",
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Search results",
							content: {
								"application/json": {
									schema: {
										allOf: [
											{ $ref: "#/components/schemas/SuccessResponse" },
											{
												type: "object",
												properties: {
													data: {
														type: "array",
														items: {
															allOf: [
																{
																	$ref: "#/components/schemas/KnowledgeTriple",
																},
																{
																	type: "object",
																	properties: {
																		similarity_score: {
																			type: "number",
																			description:
																				"Similarity score for the search",
																			example: 0.85,
																		},
																	},
																},
															],
														},
													},
												},
											},
										],
									},
								},
							},
						},
						"400": { $ref: "#/components/responses/ValidationError" },
						"500": { $ref: "#/components/responses/InternalServerError" },
					},
				},
			},
			"/search-concepts": {
				post: {
					tags: ["Concept Search"],
					summary: "Search for concepts",
					description:
						"Search for concepts in the knowledge graph at different abstraction levels",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/SearchConceptsRequest",
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Concept search results",
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/SuccessResponse",
									},
								},
							},
						},
						"400": { $ref: "#/components/responses/ValidationError" },
						"500": { $ref: "#/components/responses/InternalServerError" },
					},
				},
			},
			"/deduplicate": {
				post: {
					tags: ["Data Processing"],
					summary: "Deduplicate knowledge triples",
					description: "Remove duplicate knowledge triples from a provided set",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/DeduplicateRequest",
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Deduplication results",
							content: {
								"application/json": {
									schema: {
										allOf: [
											{ $ref: "#/components/schemas/SuccessResponse" },
											{
												type: "object",
												properties: {
													data: {
														type: "object",
														properties: {
															uniqueTriples: {
																type: "array",
																items: {
																	$ref: "#/components/schemas/KnowledgeTriple",
																},
															},
															duplicatesRemoved: {
																type: "integer",
																example: 3,
															},
														},
													},
												},
											},
										],
									},
								},
							},
						},
						"400": { $ref: "#/components/responses/ValidationError" },
						"500": { $ref: "#/components/responses/InternalServerError" },
					},
				},
			},
			"/stats": {
				get: {
					tags: ["Statistics"],
					summary: "Get knowledge graph statistics",
					description: "Retrieve statistics about the knowledge graph",
					responses: {
						"200": {
							description: "Knowledge graph statistics",
							content: {
								"application/json": {
									schema: {
										allOf: [
											{ $ref: "#/components/schemas/SuccessResponse" },
											{
												type: "object",
												properties: {
													data: {
														type: "object",
														properties: {
															totalTriples: {
																type: "integer",
																example: 1000,
															},
															totalEntities: {
																type: "integer",
																example: 500,
															},
															totalConcepts: {
																type: "integer",
																example: 50,
															},
															triplesByType: {
																type: "object",
																properties: {
																	"entity-entity": {
																		type: "integer",
																		example: 400,
																	},
																	"entity-event": {
																		type: "integer",
																		example: 300,
																	},
																	"event-event": {
																		type: "integer",
																		example: 200,
																	},
																	"emotional-context": {
																		type: "integer",
																		example: 100,
																	},
																},
															},
														},
													},
												},
											},
										],
									},
								},
							},
						},
						"500": { $ref: "#/components/responses/InternalServerError" },
					},
				},
			},
			"/entities": {
				get: {
					tags: ["Entity Management"],
					summary: "Enumerate entities",
					description:
						"List entities in the knowledge graph with filtering and sorting options",
					parameters: [
						{
							name: "role",
							in: "query",
							description: "Which role to enumerate entities for",
							schema: {
								type: "string",
								enum: ["subject", "object", "both"],
								default: "both",
							},
						},
						{
							name: "min_occurrence",
							in: "query",
							description: "Minimum times entity must appear",
							schema: {
								type: "integer",
								minimum: 1,
								default: 1,
							},
						},
						{
							name: "sources",
							in: "query",
							description: "Filter by specific sources (comma-separated)",
							schema: {
								type: "string",
								example: "source1,source2",
							},
						},
						{
							name: "types",
							in: "query",
							description: "Filter by triple types (comma-separated)",
							schema: {
								type: "string",
								example: "entity-entity,entity-event",
							},
						},
						{
							name: "limit",
							in: "query",
							description: "Maximum entities to return",
							schema: {
								type: "integer",
								minimum: 1,
								maximum: 1000,
								default: 100,
							},
						},
						{
							name: "sort_by",
							in: "query",
							description: "How to sort results",
							schema: {
								type: "string",
								enum: ["frequency", "alphabetical", "recent"],
								default: "frequency",
							},
						},
					],
					responses: {
						"200": {
							description: "Entity enumeration results",
							content: {
								"application/json": {
									schema: {
										allOf: [
											{ $ref: "#/components/schemas/SuccessResponse" },
											{
												type: "object",
												properties: {
													data: {
														type: "object",
														properties: {
															entities: {
																type: "array",
																items: {
																	type: "object",
																	properties: {
																		name: { type: "string", example: "John" },
																		frequency: { type: "integer", example: 5 },
																		lastSeen: {
																			type: "string",
																			format: "date-time",
																		},
																	},
																},
															},
															stats: {
																type: "object",
																properties: {
																	totalEntities: {
																		type: "integer",
																		example: 25,
																	},
																	filters: {
																		type: "object",
																		description: "Applied filters",
																	},
																},
															},
														},
													},
												},
											},
										],
									},
								},
							},
						},
						"400": { $ref: "#/components/responses/ValidationError" },
						"500": { $ref: "#/components/responses/InternalServerError" },
					},
				},
			},
		},
		tags: [
			{
				name: "Knowledge Extraction",
				description: "Extract knowledge triples from text",
			},
			{
				name: "Knowledge Search",
				description: "Search and retrieve knowledge",
			},
			{
				name: "Concept Search",
				description: "Search for conceptual abstractions",
			},
			{
				name: "Data Processing",
				description: "Process and deduplicate data",
			},
			{
				name: "Statistics",
				description: "Get system statistics",
			},
			{
				name: "Entity Management",
				description: "Manage and enumerate entities",
			},
		],
	},
	apis: [], // No file-based JSDoc comments needed since we define everything here
};

export const openApiSpec = swaggerJsdoc(options);
