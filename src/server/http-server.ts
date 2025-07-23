/**
 * HTTP Server for Knowledge Graph MCP Server
 * Provides REST API endpoints alongside STDIO MCP transport
 */

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import type { Server } from 'http';

import { createKnowledgeRoutes } from './routes/knowledge-routes.js';
import type { KnowledgeGraphConfig } from '~/shared/types/index.js';
import type { DatabaseAdapter, EmbeddingService, AIProvider } from '~/shared/types/index.js';
export interface HttpServerConfig {
	port: number;
	basePath: string;
	corsOrigins: string | string[];
}

export interface HttpServerDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
}

export class KnowledgeGraphHttpServer {
	private app: express.Application;
	private server: Server | null = null;
	private httpConfig: HttpServerConfig;
	private dependencies: HttpServerDependencies;

	constructor(httpConfig: HttpServerConfig, dependencies: HttpServerDependencies) {
		this.httpConfig = httpConfig;
		this.dependencies = dependencies;
		this.app = express();
		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// Security headers
		this.app.use(
			helmet({
				contentSecurityPolicy: {
					directives: {
						defaultSrc: ["'self'"],
						styleSrc: ["'self'", "'unsafe-inline'"],
						scriptSrc: ["'self'"],
						imgSrc: ["'self'", 'data:', 'https:'],
					},
				},
			})
		);

		// CORS configuration
		this.app.use(
			cors({
				origin: this.httpConfig.corsOrigins,
				methods: ['GET', 'POST', 'OPTIONS'],
				allowedHeaders: [
					'Content-Type',
					'Authorization',
					'X-MCP-Version',
					'X-MCP-Client-Name',
					'X-MCP-Client-Version',
				],
				exposedHeaders: ['X-MCP-Version', 'X-MCP-Server-Name', 'X-MCP-Capabilities'],
				credentials: false,
			})
		);

		// Compression
		this.app.use(compression());

		// Body parsing
		this.app.use(express.json({ limit: '10mb' }));
		this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

		// MCP Headers middleware
		this.app.use((req, res, next) => {
			// Add MCP server headers to all responses
			res.setHeader('X-MCP-Version', '2024-11-05');
			res.setHeader('X-MCP-Server-Name', 'knowledge-graph-mcp');
			res.setHeader('X-MCP-Capabilities', 'tools,resources');

			// Log MCP client information if provided
			const clientName = req.get('X-MCP-Client-Name');
			const clientVersion = req.get('X-MCP-Client-Version');
			const mcpVersion = req.get('X-MCP-Version');

			if (clientName || clientVersion || mcpVersion) {
				console.log(
					`MCP Client: ${clientName || 'unknown'}@${clientVersion || 'unknown'} (MCP ${mcpVersion || 'unknown'})`
				);
			}

			next();
		});

		// Request logging middleware
		this.app.use((req, res, next) => {
			const start = Date.now();
			res.on('finish', () => {
				const duration = Date.now() - start;
				console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
			});
			next();
		});
	}

	private setupRoutes(): void {
		const router = express.Router();

		// Enhanced health check endpoint
		router.get('/health', async (req, res) => {
			const startTime = Date.now();

			try {
				// Test database connection
				const dbHealth = await this.checkDatabaseHealth();

				// Test AI provider connection
				const aiHealth = await this.checkAIProviderHealth();

				const responseTime = Date.now() - startTime;
				const overallStatus =
					dbHealth.status === 'healthy' && aiHealth.status === 'healthy' ? 'healthy' : 'degraded';

				const healthResponse = {
					status: overallStatus,
					timestamp: new Date().toISOString(),
					service: 'knowledge-graph-mcp',
					version: '1.0.0',
					transport: 'http',
					responseTime: `${responseTime}ms`,
					checks: {
						database: dbHealth,
						aiProvider: aiHealth,
					},
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
				};

				// Return appropriate status code
				const statusCode = overallStatus === 'healthy' ? 200 : 503;
				res.status(statusCode).json(healthResponse);
			} catch (error) {
				const responseTime = Date.now() - startTime;
				res.status(503).json({
					status: 'unhealthy',
					timestamp: new Date().toISOString(),
					service: 'knowledge-graph-mcp',
					version: '1.0.0',
					transport: 'http',
					responseTime: `${responseTime}ms`,
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		});

		// Version endpoint
		router.get('/version', (req, res) => {
			res.json({
				service: 'knowledge-graph-mcp',
				version: '1.0.0',
				transport: 'http',
				capabilities: ['knowledge-extraction', 'search', 'concepts', 'deduplication'],
			});
		});

		// Metrics endpoint
		router.get('/metrics', (req, res) => {
			const memUsage = process.memoryUsage();
			const cpuUsage = process.cpuUsage();

			res.json({
				timestamp: new Date().toISOString(),
				uptime: {
					seconds: process.uptime(),
					human: this.formatUptime(process.uptime()),
				},
				memory: {
					heap: {
						used: Math.round(memUsage.heapUsed / 1024 / 1024),
						total: Math.round(memUsage.heapTotal / 1024 / 1024),
					},
					external: Math.round(memUsage.external / 1024 / 1024),
					rss: Math.round(memUsage.rss / 1024 / 1024),
				},
				cpu: {
					user: cpuUsage.user,
					system: cpuUsage.system,
				},
				process: {
					pid: process.pid,
					nodeVersion: process.version,
					platform: process.platform,
					arch: process.arch,
				},
				environment: {
					transport: {
						stdio: process.env.ENABLE_STDIO_TRANSPORT !== 'false',
						http: process.env.ENABLE_HTTP_TRANSPORT === 'true',
						sse: process.env.HTTP_ENABLE_SSE === 'true',
					},
					aiProvider: this.dependencies.config.ai.provider,
					embeddingModel: this.dependencies.config.embeddings.model,
				},
			});
		});

		// MCP capabilities negotiation endpoint
		router.get('/capabilities', (req, res) => {
			const clientMcpVersion = req.get('X-MCP-Version');
			const serverMcpVersion = '2024-11-05';

			// Simple version compatibility check
			const isCompatible = !clientMcpVersion || clientMcpVersion <= serverMcpVersion;

			if (!isCompatible) {
				return res.status(400).json({
					error: 'Incompatible MCP version',
					clientVersion: clientMcpVersion,
					serverVersion: serverMcpVersion,
					message: 'Client MCP version is newer than server version',
				});
			}

			res.json({
				protocolVersion: serverMcpVersion,
				capabilities: {
					tools: {},
					resources: {},
					prompts: {},
					logging: {},
				},
				serverInfo: {
					name: 'knowledge-graph-mcp',
					version: '1.0.0',
				},
				tools: [
					{
						name: 'process_knowledge',
						description:
							'Extract knowledge triples from text and store them in the knowledge graph',
						endpoint: `${this.httpConfig.basePath}/process-knowledge`,
						method: 'POST',
					},
					{
						name: 'search_knowledge_graph',
						description:
							'Search the knowledge graph using fusion search (combines entity, relationship, semantic, and concept search)',
						endpoint: `${this.httpConfig.basePath}/search-knowledge`,
						method: 'POST',
					},
					{
						name: 'search_concepts',
						description: 'Search for concepts in the knowledge graph',
						endpoint: `${this.httpConfig.basePath}/search-concepts`,
						method: 'POST',
					},
					{
						name: 'get_knowledge_graph_stats',
						description: 'Get knowledge graph statistics',
						endpoint: `${this.httpConfig.basePath}/stats`,
						method: 'GET',
					},
				],
			});
		});

		// Create and mount knowledge routes
		const knowledgeRoutes = createKnowledgeRoutes(this.dependencies);
		router.use('/', knowledgeRoutes);

		// Mount router at base path
		this.app.use(this.httpConfig.basePath, router);

		// Root endpoint
		this.app.get('/', (req, res) => {
			const response: any = {
				service: 'Knowledge Graph MCP Server',
				version: '1.0.0',
				transports: ['http'],
				endpoints: {
					capabilities: `${this.httpConfig.basePath}/capabilities`,
					health: `${this.httpConfig.basePath}/health`,
					metrics: `${this.httpConfig.basePath}/metrics`,
				},
			};

			res.json(response);
		});

		// 404 handler
		this.app.use((req, res) => {
			res.status(404).json({
				error: 'Not Found',
				message: `Endpoint ${req.path} not found`,
				availableEndpoints: `${this.httpConfig.basePath}/capabilities`,
			});
		});

		// Error handler
		this.app.use(
			(err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
				console.error('HTTP Server Error:', err);
				res.status(500).json({
					error: 'Internal Server Error',
					message: 'An unexpected error occurred',
					timestamp: new Date().toISOString(),
				});
			}
		);
	}

	public async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.server = this.app.listen(this.httpConfig.port, () => {
					console.log(`🌐 HTTP Server started on port ${this.httpConfig.port}`);
					console.log(
						`📖 API documentation: http://localhost:${this.httpConfig.port}${this.httpConfig.basePath}/capabilities`
					);
					console.log(
						`❤️  Health check: http://localhost:${this.httpConfig.port}${this.httpConfig.basePath}/health`
					);
					resolve();
				});

				this.server.on('error', error => {
					console.error('HTTP Server failed to start:', error);
					reject(error);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	public async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.server) {
				resolve();
				return;
			}

			this.server.close(error => {
				if (error) {
					console.error('Error stopping HTTP server:', error);
					reject(error);
				} else {
					console.log('🛑 HTTP Server stopped');
					this.server = null;
					resolve();
				}
			});
		});
	}

	private async checkDatabaseHealth(): Promise<{
		status: string;
		message?: string;
		responseTime?: string;
	}> {
		const startTime = Date.now();
		try {
			// Simple database connectivity test using getAllTriples which is available
			const result = await this.dependencies.db.getAllTriples();
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

	private async checkAIProviderHealth(): Promise<{
		status: string;
		message?: string;
		provider?: string;
	}> {
		try {
			// Simple AI provider test - just check if the service is configured
			const config = this.dependencies.config.ai;
			const hasApiKey =
				config.provider === 'openai'
					? !!process.env.OPENAI_API_KEY
					: !!process.env.ANTHROPIC_API_KEY;

			if (!hasApiKey) {
				return {
					status: 'degraded',
					message: `${config.provider} API key not configured`,
					provider: config.provider,
				};
			}

			return {
				status: 'healthy',
				message: `${config.provider} provider configured`,
				provider: config.provider,
			};
		} catch (error) {
			return {
				status: 'unhealthy',
				message: error instanceof Error ? error.message : 'AI provider check failed',
			};
		}
	}

	private formatUptime(seconds: number): string {
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

	public getApp(): express.Application {
		return this.app;
	}
}

export function createHttpServerConfig(): HttpServerConfig {
	return {
		port: parseInt(process.env.HTTP_PORT || '3000'),
		basePath: process.env.HTTP_BASE_PATH || '/api',
		corsOrigins:
			process.env.HTTP_CORS_ORIGINS === '*'
				? '*'
				: process.env.HTTP_CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
	};
}
