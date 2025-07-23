#!/usr/bin/env node
/**
 * Main entry point for the Knowledge Graph MCP Server
 * Supports both STDIO and HTTP transports
 */

import { config } from 'dotenv';
// Import service implementations
import { createDatabaseAdapter } from '~/shared/database/database-adapter';
import { createAIProvider } from '~/shared/services/ai-provider-service';
import { createEmbeddingService } from '~/shared/services/embedding-service';
import type { KnowledgeGraphConfig } from '~/shared/types';
import { redirectConsoleToFiles } from '~/shared/utils/console-redirect';
import { createHttpServerConfig, KnowledgeGraphHttpServer } from './server/http-server';
// Import server implementations
import { KnowledgeGraphStdioServer } from './server/stdio-server';

// Load environment variables
config();

// Create configuration - simplified for stateless architecture
const createDefaultConfig = (): KnowledgeGraphConfig => ({
	embeddings: {
		model: process.env.KG_EMBEDDING_MODEL || 'text-embedding-3-small',
		dimensions: parseInt(process.env.KG_EMBEDDING_DIMENSIONS || '1536'),
		batchSize: parseInt(process.env.KG_BATCH_SIZE || '32'),
	},
	search: {
		topK: parseInt(process.env.KG_SEARCH_TOP_K || '10'),
		minScore: parseFloat(process.env.KG_MIN_SCORE || '0.7'),
	},
	database: {
		url: process.env.DATABASE_URL || '',
		maxConnections: parseInt(process.env.KG_DB_MAX_CONNECTIONS || '10'),
		timeout: parseInt(process.env.KG_DB_CONNECTION_TIMEOUT || '5000'),
	},
	extraction: {
		extractionMethod:
			(process.env.KG_EXTRACTION_METHOD as 'single-pass' | 'four-stage') || 'four-stage',
		delayBetweenTypes: parseInt(process.env.KG_DELAY_BETWEEN_TYPES || '2000'),
		maxChunkTokens: parseInt(process.env.KG_MAX_CHUNK_TOKENS || '1500'),
		model: process.env.KG_EXTRACTION_MODEL || 'gpt-4o-mini',
		temperature: parseFloat(process.env.KG_EXTRACTION_TEMPERATURE || '0.1'),
	},
	deduplication: {
		enableSemanticDeduplication: process.env.KG_ENABLE_SEMANTIC_DEDUP === 'true',
		semanticSimilarityThreshold: parseFloat(process.env.KG_SEMANTIC_THRESHOLD || '0.85'),
		exactMatchFields: ['subject', 'predicate', 'object', 'type'],
	},
	ai: {
		provider: (process.env.KG_AI_PROVIDER as 'openai' | 'anthropic') || 'openai',
		model: process.env.KG_AI_MODEL || 'gpt-4o-mini',
		temperature: parseFloat(process.env.KG_AI_TEMPERATURE || '0.1'),
		maxTokens: parseInt(process.env.KG_AI_MAX_TOKENS || '4000'),
	},
});

// Transport configuration
interface TransportConfig {
	enableStdio: boolean;
	enableHttp: boolean;
}

function getTransportConfig(): TransportConfig {
	const enableHttp = process.env.ENABLE_HTTP_TRANSPORT === 'true';
	const enableStdio = process.env.ENABLE_STDIO_TRANSPORT !== 'false'; // Default to true

	// If no specific transport is enabled, default to STDIO only
	if (!enableHttp && !enableStdio) {
		return { enableStdio: true, enableHttp: false };
	}

	return { enableStdio, enableHttp };
}

// Global server instances
let stdioServer: KnowledgeGraphStdioServer | null = null;
let httpServer: KnowledgeGraphHttpServer | null = null;

// Graceful shutdown handler
async function gracefulShutdown(): Promise<void> {
	console.log('\n🛑 Received shutdown signal, closing servers...');

	const shutdownPromises: Promise<void>[] = [];

	if (stdioServer) {
		shutdownPromises.push(stdioServer.stop());
	}

	if (httpServer) {
		shutdownPromises.push(httpServer.stop());
	}

	try {
		await Promise.all(shutdownPromises);
		console.log('✅ All servers closed gracefully');
		process.exit(0);
	} catch (error) {
		console.error('❌ Error during shutdown:', error);
		process.exit(1);
	}
}

// Set up signal handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Main server startup
async function main(): Promise<void> {
	try {
		// Redirect console output to files to prevent STDIO corruption
		// Only redirect if STDIO transport is enabled
		const transportConfig = getTransportConfig();
		if (transportConfig.enableStdio) {
			redirectConsoleToFiles('./logs');
		}

		// Initialize shared services
		const serverConfig = createDefaultConfig();
		const db = createDatabaseAdapter(serverConfig.database);
		const embeddingService = createEmbeddingService(serverConfig.embeddings);
		const aiProvider = createAIProvider(serverConfig.ai);

		const dependencies = {
			config: serverConfig,
			db,
			embeddingService,
			aiProvider,
		};

		console.log('🚀 Starting Knowledge Graph MCP Server...');
		console.log(`📡 STDIO Transport: ${transportConfig.enableStdio ? 'enabled' : 'disabled'}`);
		console.log(`🌐 HTTP Transport: ${transportConfig.enableHttp ? 'enabled' : 'disabled'}`);

		// Start servers based on configuration
		const startupPromises: Promise<void>[] = [];

		if (transportConfig.enableStdio) {
			stdioServer = new KnowledgeGraphStdioServer(dependencies);
			startupPromises.push(stdioServer.start());
		}

		if (transportConfig.enableHttp) {
			const httpConfig = createHttpServerConfig();
			httpServer = new KnowledgeGraphHttpServer(httpConfig, dependencies);
			startupPromises.push(httpServer.start());
		}

		// Wait for all servers to start
		await Promise.all(startupPromises);

		console.log('✅ All servers started successfully');

		// Log available endpoints
		if (transportConfig.enableHttp) {
			const httpConfig = createHttpServerConfig();
			console.log(
				`📖 API Documentation: http://localhost:${httpConfig.port}${httpConfig.basePath}/capabilities`
			);
			console.log(
				`❤️  Health Check: http://localhost:${httpConfig.port}${httpConfig.basePath}/health`
			);
		}
	} catch (error) {
		console.error('❌ Server failed to start:', error);
		process.exit(1);
	}
}

// Start the server
main().catch(error => {
	console.error('❌ Unhandled error:', error);
	process.exit(1);
});
