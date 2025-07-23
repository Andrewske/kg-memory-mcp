/**
 * REST API routes for Knowledge Graph MCP tools
 * Maps HTTP endpoints to MCP tool functions
 */

import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { RoutesDependencies } from '~/shared/types/index.js';
// Import unified tool functions
import {
	getKnowledgeGraphStats,
	processKnowledge,
	searchConceptsTool,
	searchKnowledgeGraph,
} from '../transport-manager.js';

// Zod validation schemas
const processKnowledgeSchema = z.object({
	text: z.string().min(1, 'Text is required'),
	source: z.string().min(1, 'Source is required'),
	thread_id: z.string().optional(),
	source_date: z.string().datetime().optional(),
	processing_batch_id: z.string().optional(),
	include_concepts: z.boolean().optional().default(false),
});

const searchKnowledgeSchema = z.object({
	query: z.string().min(1, 'Query is required'),
	limit: z.number().int().min(1).max(100).optional().default(10),
	threshold: z.number().min(0).max(1).optional().default(0.0),
	searchTypes: z.array(z.enum(['entity', 'relationship', 'semantic', 'concept'])).optional(),
	weights: z
		.object({
			entity: z.number().min(0).max(1).optional(),
			relationship: z.number().min(0).max(1).optional(),
			semantic: z.number().min(0).max(1).optional(),
			concept: z.number().min(0).max(1).optional(),
		})
		.optional(),
});

const searchConceptsSchema = z.object({
	query: z.string().min(1, 'Query is required'),
	abstraction: z.enum(['high', 'medium', 'low']).optional(),
});

// Validation middleware
const validateSchema = (schema: z.ZodSchema) => {
	return (req: Request, res: Response, next: Function) => {
		try {
			req.body = schema.parse(req.body);
			next();
		} catch (error) {
			if (error instanceof z.ZodError) {
				res.status(400).json({
					error: 'Validation Error',
					details: error.errors,
					timestamp: new Date().toISOString(),
				});
			} else {
				res.status(400).json({
					error: 'Validation Error',
					details: 'Invalid request body',
					timestamp: new Date().toISOString(),
				});
			}
		}
	};
};

// Error response helper
const createErrorResponse = (error: any, operation: string) => ({
	success: false,
	error: {
		message: error.message || 'Unknown error occurred',
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

export function createKnowledgeRoutes(dependencies: RoutesDependencies): Router {
	const router = Router();
	const { config, db, embeddingService, aiProvider } = dependencies;

	// POST /process-knowledge - Extract and store knowledge from text
	router.post(
		'/process-knowledge',
		validateSchema(processKnowledgeSchema),
		async (req: Request, res: Response) => {
			try {
				const {
					text,
					source,
					thread_id,
					source_date,
					processing_batch_id = `batch_${Date.now()}`,
					include_concepts = false,
				} = req.body;

				// Note: metadata is not actually used in the current implementation
				// but is kept for potential future use

				// Use the unified processKnowledge function
				const result = await processKnowledge(req.body, {
					config,
					db,
					embeddingService,
					aiProvider,
				});

				if (!result.success) {
					return res.status(500).json(createErrorResponse(result.error, 'process_knowledge'));
				}

				res.json(createSuccessResponse(result.data, 'process_knowledge'));
			} catch (error) {
				console.error('Process knowledge error:', error);
				res.status(500).json(createErrorResponse(error, 'process_knowledge'));
			}
		}
	);

	// POST /search-knowledge - Search knowledge graph by text
	router.post(
		'/search-knowledge',
		validateSchema(searchKnowledgeSchema),
		async (req: Request, res: Response) => {
			try {
				// Use the unified searchKnowledgeGraph function
				const result = await searchKnowledgeGraph(req.body, {
					config,
					db,
					embeddingService,
					aiProvider,
				});

				if (!result.success) {
					return res.status(500).json(createErrorResponse(result.error, 'search_knowledge_graph'));
				}

				res.json(createSuccessResponse(result.data, 'search_knowledge_graph'));
			} catch (error) {
				console.error('Search knowledge error:', error);
				res.status(500).json(createErrorResponse(error, 'search_knowledge_graph'));
			}
		}
	);

	// POST /search-concepts - Search concepts
	router.post(
		'/search-concepts',
		validateSchema(searchConceptsSchema),
		async (req: Request, res: Response) => {
			try {
				// Use the unified searchConceptsTool function
				const result = await searchConceptsTool(req.body, {
					config,
					db,
					embeddingService,
					aiProvider,
				});

				if (!result.success) {
					return res.status(500).json(createErrorResponse(result.error, 'search_concepts'));
				}

				res.json(createSuccessResponse(result.data, 'search_concepts'));
			} catch (error) {
				console.error('Search concepts error:', error);
				res.status(500).json(createErrorResponse(error, 'search_concepts'));
			}
		}
	);

	// GET /stats - Get knowledge graph statistics
	router.get('/stats', async (req: Request, res: Response) => {
		try {
			// Use the unified getKnowledgeGraphStats function
			const result = await getKnowledgeGraphStats({ config, db, embeddingService, aiProvider });

			if (!result.success) {
				return res.status(500).json(createErrorResponse(result.error, 'get_knowledge_graph_stats'));
			}

			res.json(createSuccessResponse(result.data, 'get_knowledge_graph_stats'));
		} catch (error) {
			console.error('Get stats error:', error);
			res.status(500).json(createErrorResponse(error, 'get_knowledge_graph_stats'));
		}
	});

	return router;
}
