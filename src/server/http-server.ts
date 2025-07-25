/**
 * Framework-Agnostic HTTP Handler for Knowledge Graph MCP Server
 * Can be deployed to Vercel, Railway, or any platform
 */

import type { Request } from 'express';
import type { z } from 'zod';
import {
	type processKnowledgeSchema,
	searchConceptsSchema,
	searchKnowledgeSchema,
} from '~/server/routes/knowledge-routes';
import { handleProcessJob } from '~/server/routes/queue';
import { getAllTriples } from '~/shared/database/triple-operations';
import { env } from '~/shared/env';
import { addJobToQueue, handleGetJobStatus } from '~/shared/services/queue-service';
// Import your existing unified functions
import {
	getKnowledgeGraphStats,
	searchConceptsTool,
	searchKnowledgeGraph,
} from './transport-manager';

// Validation helper
function validateRequest<T>(
	schema: z.ZodSchema<T>,
	data: any
): { success: true; data: T } | { success: false; error: any } {
	try {
		const validData = schema.parse(data);
		return { success: true, data: validData };
	} catch (error) {
		return { success: false, error };
	}
}

// Response helpers (from your existing code)

const createSuccessResponse = (data: any, operation: string) => ({
	success: true,
	data,
	operation,
	timestamp: new Date().toISOString(),
});

async function handleSearchKnowledge(body: z.infer<typeof searchKnowledgeSchema>) {
	// Validate input
	const validation = validateRequest(searchKnowledgeSchema, body);
	if (!validation.success) {
		throw new Error(
			`Validation Error: ${JSON.stringify(validation.error.errors || validation.error)}`
		);
	}

	// Use your existing function
	const result = await searchKnowledgeGraph(validation.data);

	if (!result.success) {
		throw new Error(result.error?.message || 'Search failed');
	}

	return createSuccessResponse(result.data, 'search_knowledge_graph');
}

async function handleSearchConcepts(body: z.infer<typeof searchConceptsSchema>) {
	// Validate input
	const validation = validateRequest(searchConceptsSchema, body);
	if (!validation.success) {
		throw new Error(
			`Validation Error: ${JSON.stringify(validation.error.errors || validation.error)}`
		);
	}

	// Use your existing function
	const result = await searchConceptsTool(validation.data);

	if (!result.success) {
		throw new Error(result.error?.message || 'Concept search failed');
	}

	return createSuccessResponse(result.data, 'search_concepts');
}

async function handleGetStats() {
	// Use your existing function
	const result = await getKnowledgeGraphStats();

	if (!result.success) {
		throw new Error(result.error?.message || 'Stats retrieval failed');
	}

	return createSuccessResponse(result.data, 'get_knowledge_graph_stats');
}

// Queue processing for large jobs
async function queueKnowledgeProcessing(data: z.infer<typeof processKnowledgeSchema>) {
	try {
		const jobId = await addJobToQueue(data);
		return {
			jobId,
			message: 'Knowledge processing job queued',
		};
	} catch (error) {
		console.error('Failed to queue knowledge processing job:', error);
		throw new Error('Failed to queue knowledge processing job');
	}
}

// Health check utilities
async function checkDatabaseHealth(): Promise<{
	status: string;
	message?: string;
	responseTime?: string;
}> {
	const startTime = Date.now();
	try {
		await getAllTriples();
		const responseTime = Date.now() - startTime;
		return {
			status: 'healthy',
			message: 'Database connection successful',
			responseTime: `${responseTime}ms`,
		};
	} catch (error) {
		const responseTime = Date.now() - startTime;
		return {
			status: 'unhealthy',
			message: error instanceof Error ? error.message : 'Database connection failed',
			responseTime: `${responseTime}ms`,
		};
	}
}

async function checkAIProviderHealth(): Promise<{
	status: string;
	message?: string;
	provider?: string;
}> {
	try {
		const hasApiKey = env.AI_PROVIDER === 'openai' ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY;

		if (!hasApiKey) {
			return {
				status: 'degraded',
				message: `${env.AI_PROVIDER} API key not configured`,
				provider: env.AI_PROVIDER,
			};
		}

		return {
			status: 'healthy',
			message: `${env.AI_PROVIDER} provider configured`,
			provider: env.AI_PROVIDER,
		};
	} catch (error) {
		return {
			status: 'unhealthy',
			message: error instanceof Error ? error.message : 'AI provider check failed',
		};
	}
}

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	const parts = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0) parts.push(`${secs}s`);

	return parts.join(' ') || '0s';
}

function createMcpHeaders() {
	return {
		'X-MCP-Version': '2024-11-05',
		'X-MCP-Server-Name': 'knowledge-graph-mcp',
		'X-MCP-Capabilities': 'tools,resources',
	};
}

function createCorsHeaders(corsOrigins: string | string[]) {
	const origin = Array.isArray(corsOrigins) ? corsOrigins[0] : corsOrigins;
	return {
		'Access-Control-Allow-Origin': origin === '*' ? '*' : origin,
		'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
		'Access-Control-Allow-Headers':
			'Content-Type,Authorization,X-MCP-Version,X-MCP-Client-Name,X-MCP-Client-Version',
		'Access-Control-Expose-Headers': 'X-MCP-Version,X-MCP-Server-Name,X-MCP-Capabilities',
	};
}

// Main framework-agnostic handler
export async function handleMcpRequest(req: Request) {
	const { method, path, body, headers, query } = req;

	// Default headers for all responses
	const defaultHeaders = {
		'Content-Type': 'application/json',
		...createMcpHeaders(),
		...createCorsHeaders(env.HTTP_CORS_ORIGINS),
	};

	// Handle CORS preflight
	if (method === 'OPTIONS') {
		return {
			status: 200,
			body: {},
			headers: defaultHeaders,
		};
	}

	// Log MCP client information
	const clientName = headers['x-mcp-client-name'];
	const clientVersion = headers['x-mcp-client-version'];
	const mcpVersion = headers['x-mcp-version'];

	if (clientName || clientVersion || mcpVersion) {
		console.log(
			`MCP Client: ${clientName || 'unknown'}@${clientVersion || 'unknown'} (MCP ${mcpVersion || 'unknown'})`
		);
	}

	// Remove base path from URL for routing
	const routePath = path.replace(env.HTTP_BASE_PATH, '') || '/';

	try {
		// Route handling
		switch (`${method} ${routePath}`) {
			case 'GET /':
				return {
					status: 200,
					body: {
						service: 'Knowledge Graph MCP Server',
						version: '1.0.0',
						transports: ['http'],
						endpoints: {
							capabilities: `${env.HTTP_BASE_PATH}/capabilities`,
							health: `${env.HTTP_BASE_PATH}/health`,
							metrics: `${env.HTTP_BASE_PATH}/metrics`,
						},
					},
					headers: defaultHeaders,
				};

			case 'GET /health': {
				const startTime = Date.now();
				const dbHealth = await checkDatabaseHealth();
				const aiHealth = await checkAIProviderHealth();
				const responseTime = Date.now() - startTime;
				const overallStatus =
					dbHealth.status === 'healthy' && aiHealth.status === 'healthy' ? 'healthy' : 'degraded';

				return {
					status: overallStatus === 'healthy' ? 200 : 503,
					body: {
						status: overallStatus,
						timestamp: new Date().toISOString(),
						service: 'knowledge-graph-mcp',
						version: '1.0.0',
						transport: 'http',
						responseTime: `${responseTime}ms`,
						checks: { database: dbHealth, aiProvider: aiHealth },
						uptime: process.uptime(),
						memory: {
							used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
							total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
							external: Math.round(process.memoryUsage().external / 1024 / 1024),
						},
						environment: {
							nodeVersion: process.version,
							platform: process.platform,
							arch: process.arch,
						},
					},
					headers: defaultHeaders,
				};
			}

			case 'GET /version':
				return {
					status: 200,
					body: {
						service: 'knowledge-graph-mcp',
						version: '1.0.0',
						transport: 'http',
						capabilities: ['knowledge-extraction', 'search', 'concepts', 'deduplication'],
					},
					headers: defaultHeaders,
				};

			case 'GET /metrics': {
				const memUsage = process.memoryUsage();
				const cpuUsage = process.cpuUsage();

				return {
					status: 200,
					body: {
						timestamp: new Date().toISOString(),
						uptime: {
							seconds: process.uptime(),
							human: formatUptime(process.uptime()),
						},
						memory: {
							heap: {
								used: Math.round(memUsage.heapUsed / 1024 / 1024),
								total: Math.round(memUsage.heapTotal / 1024 / 1024),
							},
							external: Math.round(memUsage.external / 1024 / 1024),
							rss: Math.round(memUsage.rss / 1024 / 1024),
						},
						cpu: { user: cpuUsage.user, system: cpuUsage.system },
						process: {
							pid: process.pid,
							nodeVersion: process.version,
							platform: process.platform,
							arch: process.arch,
						},
						environment: {
							transport: {
								stdio: env.ENABLE_STDIO_TRANSPORT,
								http: env.ENABLE_HTTP_TRANSPORT,
							},
							aiProvider: env.AI_PROVIDER,
							embeddingModel: env.EMBEDDING_MODEL,
						},
					},
					headers: defaultHeaders,
				};
			}

			case 'GET /capabilities': {
				const clientMcpVersion = headers['x-mcp-version'];
				const serverMcpVersion = '2024-11-05';
				const isCompatible = !clientMcpVersion || clientMcpVersion <= serverMcpVersion;

				if (!isCompatible) {
					return {
						status: 400,
						body: {
							error: 'Incompatible MCP version',
							clientVersion: clientMcpVersion,
							serverVersion: serverMcpVersion,
							message: 'Client MCP version is newer than server version',
						},
						headers: defaultHeaders,
					};
				}

				return {
					status: 200,
					body: {
						protocolVersion: serverMcpVersion,
						capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
						serverInfo: { name: 'knowledge-graph-mcp', version: '1.0.0' },
						tools: [
							{
								name: 'process_knowledge',
								description:
									'Extract knowledge triples from text and store them in the knowledge graph',
								endpoint: `${env.HTTP_BASE_PATH}/process-knowledge`,
								method: 'POST',
							},
							{
								name: 'search_knowledge_graph',
								description: 'Search the knowledge graph using fusion search',
								endpoint: `${env.HTTP_BASE_PATH}/search-knowledge`,
								method: 'POST',
							},
							{
								name: 'search_concepts',
								description: 'Search for concepts in the knowledge graph',
								endpoint: `${env.HTTP_BASE_PATH}/search-concepts`,
								method: 'POST',
							},
							{
								name: 'get_knowledge_graph_stats',
								description: 'Get knowledge graph statistics',
								endpoint: `${env.HTTP_BASE_PATH}/stats`,
								method: 'GET',
							},
						],
					},
					headers: defaultHeaders,
				};
			}

			// API endpoints
			case 'POST /process-knowledge': {
				const result = await queueKnowledgeProcessing(body);
				return { status: 200, body: result, headers: defaultHeaders };
			}

			case 'POST /search-knowledge': {
				const result = await handleSearchKnowledge(body);
				return { status: 200, body: result, headers: defaultHeaders };
			}

			case 'POST /search-concepts': {
				const result = await handleSearchConcepts(body);
				return { status: 200, body: result, headers: defaultHeaders };
			}

			case 'GET /stats': {
				const result = await handleGetStats();
				return { status: 200, body: result, headers: defaultHeaders };
			}

			case 'POST /process-job': {
				const result = await handleProcessJob(body);
				return { status: 200, body: result, headers: defaultHeaders };
			}

			case 'GET /job-status': {
				const jobId = query.jobId as string;
				if (!jobId) {
					return { status: 400, body: { error: 'Job ID is required' }, headers: defaultHeaders };
				}
				const result = await handleGetJobStatus(jobId);
				return { status: 200, body: result, headers: defaultHeaders };
			}

			default:
				return {
					status: 404,
					body: {
						error: 'Not Found',
						message: `Endpoint ${routePath} not found`,
						availableEndpoints: `${env.HTTP_BASE_PATH}/capabilities`,
					},
					headers: defaultHeaders,
				};
		}
	} catch (error) {
		console.error('HTTP Handler Error:', error);
		return {
			status: 500,
			body: {
				error: 'Internal Server Error',
				message: 'An unexpected error occurred',
				timestamp: new Date().toISOString(),
			},
			headers: defaultHeaders,
		};
	}
}
