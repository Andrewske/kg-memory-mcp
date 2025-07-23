/**
 * REST API routes for Knowledge Graph MCP tools
 * Maps HTTP endpoints to MCP tool functions
 */

import { Router, Request, Response } from "express";
import { body, query, validationResult } from "express-validator";

// Import pure functions from features
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
import {
	validateTemporalConsistency,
	generateTemporalReport,
	backfillConversationDates,
} from "~/shared/utils/temporal-migration.js";

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

export interface RoutesDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
}

// Validation middleware
const handleValidationErrors = (
	req: Request,
	res: Response,
	next: Function,
) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({
			error: "Validation Error",
			details: errors.array(),
			timestamp: new Date().toISOString(),
		});
	}
	next();
};

// Error response helper
const createErrorResponse = (error: any, operation: string) => ({
	success: false,
	error: {
		message: error.message || "Unknown error occurred",
		operation,
		timestamp: new Date().toISOString(),
	},
});

// Success response helper
const createSuccessResponse = (data: any, operation: string) => ({
	success: true,
	data,
	operation,
	timestamp: new Date().toISOString(),
});

export function createKnowledgeRoutes(
	dependencies: RoutesDependencies,
): Router {
	const router = Router();
	const { config, db, embeddingService, aiProvider } = dependencies;

	// POST /process-knowledge - Extract and store knowledge from text
	router.post(
		"/process-knowledge",
		[
			body("text")
				.isString()
				.notEmpty()
				.withMessage("Text is required and must be a non-empty string"),
			body("source")
				.isString()
				.notEmpty()
				.withMessage("Source is required and must be a non-empty string"),
			body("thread_id").optional().isString(),
			body("conversation_date")
				.optional()
				.isISO8601()
				.withMessage("Conversation date must be valid ISO 8601 format"),
			body("processing_batch_id").optional().isString(),
			body("include_concepts").optional().isBoolean(),
			body("deduplicate").optional().isBoolean(),
		],
		handleValidationErrors,
		async (req: Request, res: Response) => {
			try {
				const {
					text,
					source,
					thread_id,
					conversation_date,
					processing_batch_id = `batch_${Date.now()}`,
					include_concepts = false,
					deduplicate = true,
				} = req.body;

				const metadata = {
					source,
					thread_id,
					conversation_date,
					processing_batch_id,
				};

				// Extract knowledge (without conceptualization for now)
				const extractionResult = await extractKnowledgeTriples(
					text,
					metadata,
					aiProvider,
					config,
					false,
				);
				if (!extractionResult.success) {
					return res
						.status(500)
						.json(
							createErrorResponse(
								extractionResult.error,
								"knowledge_extraction",
							),
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

				// Store triples
				const storeResult = await storeTriples(triples, db, config);
				if (!storeResult.success) {
					return res
						.status(500)
						.json(createErrorResponse(storeResult.error, "knowledge_storage"));
				}

				// Queue background conceptualization if requested
				if (include_concepts && triples.length > 0) {
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
								);

								if (conceptResult.success) {
									console.log(
										`[Background] Successfully stored ${conceptualizeResult.data.concepts.length} concepts`,
									);
								} else {
									console.error(
										`[Background] Failed to store concepts:`,
										conceptResult.error,
									);
								}
							}
						} catch (error) {
							console.error(`[Background] Conceptualization error:`, error);
						}
					});
				}

				res.json(
					createSuccessResponse(
						{
							triplesStored: triples.length,
							conceptsStored: include_concepts ? "processing in background" : 0,
							metadata,
						},
						"process_knowledge",
					),
				);
			} catch (error) {
				console.error("Process knowledge error:", error);
				res.status(500).json(createErrorResponse(error, "process_knowledge"));
			}
		},
	);

	// POST /search-knowledge - Search knowledge graph by text
	router.post(
		"/search-knowledge",
		[
			body("query")
				.isString()
				.notEmpty()
				.withMessage("Query is required and must be a non-empty string"),
			body("limit")
				.optional()
				.isInt({ min: 1, max: 100 })
				.withMessage("Limit must be between 1 and 100"),
			body("threshold")
				.optional()
				.isFloat({ min: 0, max: 1 })
				.withMessage("Threshold must be between 0 and 1"),
			body("temporal.fromDate")
				.optional()
				.isISO8601()
				.withMessage("fromDate must be valid ISO 8601 format"),
			body("temporal.toDate")
				.optional()
				.isISO8601()
				.withMessage("toDate must be valid ISO 8601 format"),
			body("temporal.timeWindow.value")
				.optional()
				.isInt({ min: 1 })
				.withMessage("timeWindow value must be positive integer"),
			body("temporal.timeWindow.unit")
				.optional()
				.isIn(["days", "weeks", "months", "years"])
				.withMessage("timeWindow unit must be days, weeks, months, or years"),
			body("sources")
				.optional()
				.isArray()
				.withMessage("Sources must be an array"),
			body("types").optional().isArray().withMessage("Types must be an array"),
		],
		handleValidationErrors,
		async (req: Request, res: Response) => {
			try {
				const {
					query,
					limit = 10,
					threshold = 0.0,
					temporal,
					sources,
					types,
				} = req.body;

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
					temporal,
					sources,
					types,
				};

				const result = await searchByText(
					query,
					db,
					embeddingService,
					searchConfig,
					searchOptions,
				);

				if (!result.success) {
					return res
						.status(500)
						.json(createErrorResponse(result.error, "search_knowledge_graph"));
				}

				res.json(createSuccessResponse(result.data, "search_knowledge_graph"));
			} catch (error) {
				console.error("Search knowledge error:", error);
				res
					.status(500)
					.json(createErrorResponse(error, "search_knowledge_graph"));
			}
		},
	);

	// POST /search-concepts - Search concepts
	router.post(
		"/search-concepts",
		[
			body("query")
				.isString()
				.notEmpty()
				.withMessage("Query is required and must be a non-empty string"),
			body("abstraction")
				.optional()
				.isIn(["high", "medium", "low"])
				.withMessage("Abstraction must be high, medium, or low"),
		],
		handleValidationErrors,
		async (req: Request, res: Response) => {
			try {
				const { query, abstraction } = req.body;

				const result = await searchConcepts(query, db, abstraction);

				if (!result.success) {
					return res
						.status(500)
						.json(createErrorResponse(result.error, "search_concepts"));
				}

				res.json(createSuccessResponse(result.data, "search_concepts"));
			} catch (error) {
				console.error("Search concepts error:", error);
				res.status(500).json(createErrorResponse(error, "search_concepts"));
			}
		},
	);

	// POST /deduplicate - Deduplicate triples
	router.post(
		"/deduplicate",
		[
			body("triples").isArray().withMessage("Triples must be an array"),
			body("triples.*.subject")
				.isString()
				.notEmpty()
				.withMessage("Each triple must have a non-empty subject"),
			body("triples.*.predicate")
				.isString()
				.notEmpty()
				.withMessage("Each triple must have a non-empty predicate"),
			body("triples.*.object")
				.isString()
				.notEmpty()
				.withMessage("Each triple must have a non-empty object"),
			body("triples.*.type")
				.isIn([
					"entity-entity",
					"entity-event",
					"event-event",
					"emotional-context",
				])
				.withMessage("Invalid triple type"),
			body("triples.*.source")
				.isString()
				.notEmpty()
				.withMessage("Each triple must have a source"),
			body("triples.*.extracted_at")
				.isISO8601()
				.withMessage("extracted_at must be valid ISO 8601 format"),
		],
		handleValidationErrors,
		async (req: Request, res: Response) => {
			try {
				const { triples } = req.body as { triples: KnowledgeTriple[] };

				const result = await deduplicateTriples(
					triples,
					embeddingService,
					config.deduplication,
				);

				if (!result.success) {
					return res
						.status(500)
						.json(createErrorResponse(result.error, "deduplicate_triples"));
				}

				res.json(createSuccessResponse(result.data, "deduplicate_triples"));
			} catch (error) {
				console.error("Deduplicate triples error:", error);
				res.status(500).json(createErrorResponse(error, "deduplicate_triples"));
			}
		},
	);

	// GET /stats - Get knowledge graph statistics
	router.get("/stats", async (req: Request, res: Response) => {
		try {
			const result = await getStats(db);

			if (!result.success) {
				return res
					.status(500)
					.json(createErrorResponse(result.error, "get_knowledge_graph_stats"));
			}

			res.json(createSuccessResponse(result.data, "get_knowledge_graph_stats"));
		} catch (error) {
			console.error("Get stats error:", error);
			res
				.status(500)
				.json(createErrorResponse(error, "get_knowledge_graph_stats"));
		}
	});

	// GET /entities - Enumerate entities
	router.get(
		"/entities",
		[
			query("role")
				.optional()
				.isIn(["subject", "object", "both"])
				.withMessage("Role must be subject, object, or both"),
			query("min_occurrence")
				.optional()
				.isInt({ min: 1 })
				.withMessage("min_occurrence must be a positive integer"),
			query("sources")
				.optional()
				.isString(), // Will be split into array
			query("types")
				.optional()
				.isString(), // Will be split into array
			query("limit")
				.optional()
				.isInt({ min: 1, max: 1000 })
				.withMessage("Limit must be between 1 and 1000"),
			query("sort_by")
				.optional()
				.isIn(["frequency", "alphabetical", "recent"])
				.withMessage("sort_by must be frequency, alphabetical, or recent"),
		],
		handleValidationErrors,
		async (req: Request, res: Response) => {
			try {
				const options: EntityEnumerationOptions = {
					role: (req.query.role as "subject" | "object" | "both") || "both",
					min_occurrence: req.query.min_occurrence
						? parseInt(req.query.min_occurrence as string)
						: 1,
					sources: req.query.sources
						? (req.query.sources as string).split(",")
						: undefined,
					types: req.query.types
						? ((req.query.types as string).split(",") as any)
						: undefined,
					limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
					sort_by:
						(req.query.sort_by as "frequency" | "alphabetical" | "recent") ||
						"frequency",
				};

				const result = await enumerateEntities(options, db);

				if (!result.success) {
					return res
						.status(500)
						.json(createErrorResponse(result.error, "enumerate_entities"));
				}

				res.json(
					createSuccessResponse(
						{
							entities: result.data,
							stats: {
								totalEntities: result.data.length,
								filters: options,
							},
						},
						"enumerate_entities",
					),
				);
			} catch (error) {
				console.error("Enumerate entities error:", error);
				res.status(500).json(createErrorResponse(error, "enumerate_entities"));
			}
		},
	);

	// GET /temporal/validate - Validate temporal data consistency
	router.get("/temporal/validate", async (req: Request, res: Response) => {
		try {
			const result = await validateTemporalConsistency(db);
			res.json(createSuccessResponse(result, "validate_temporal_consistency"));
		} catch (error) {
			console.error("Temporal validation error:", error);
			res
				.status(500)
				.json(createErrorResponse(error, "validate_temporal_consistency"));
		}
	});

	// GET /temporal/report - Generate temporal analysis report
	router.get("/temporal/report", async (req: Request, res: Response) => {
		try {
			const result = await generateTemporalReport(db);
			res.json(createSuccessResponse(result, "generate_temporal_report"));
		} catch (error) {
			console.error("Temporal report error:", error);
			res
				.status(500)
				.json(createErrorResponse(error, "generate_temporal_report"));
		}
	});

	// POST /temporal/backfill - Backfill conversation dates
	router.post(
		"/temporal/backfill",
		[
			body("dryRun")
				.optional()
				.isBoolean()
				.withMessage("dryRun must be boolean"),
			body("batchSize")
				.optional()
				.isInt({ min: 1, max: 1000 })
				.withMessage("batchSize must be between 1 and 1000"),
			body("defaultDate")
				.optional()
				.isISO8601()
				.withMessage("defaultDate must be valid ISO 8601 format"),
			body("inferFromSource")
				.optional()
				.isBoolean()
				.withMessage("inferFromSource must be boolean"),
			body("sourcePatterns")
				.optional()
				.isObject()
				.withMessage("sourcePatterns must be an object"),
		],
		handleValidationErrors,
		async (req: Request, res: Response) => {
			try {
				const {
					dryRun = true,
					batchSize = 100,
					defaultDate,
					inferFromSource = false,
					sourcePatterns = {},
				} = req.body;

				const options = {
					dryRun,
					batchSize,
					defaultDate,
					inferFromSource,
					sourcePatterns,
				};

				const result = await backfillConversationDates(db, options);
				res.json(createSuccessResponse(result, "backfill_conversation_dates"));
			} catch (error) {
				console.error("Temporal backfill error:", error);
				res
					.status(500)
					.json(createErrorResponse(error, "backfill_conversation_dates"));
			}
		},
	);

	return router;
}
