/**
 * Main entry point for Knowledge Graph MCP Server
 * Supports both STDIO and HTTP transports with consistent functional API
 */

// Load environment variables before anything else

import { startHttpServer } from '~/server/deploy-handlers.js';
import { startStdioServer } from '~/server/stdio-server.js';
import { env } from '~/shared/env.js';
import { redirectConsoleToFiles } from '~/shared/utils/console-redirect.js';

// Server state
interface ServerState {
	stdio?: { stop: () => Promise<void> };
	http?: { stop: () => Promise<void> };
}

const servers: ServerState = {};

// Graceful shutdown handler
async function gracefulShutdown(): Promise<void> {
	console.log('\n🛑 Received shutdown signal, closing servers...');

	const shutdownPromises: Promise<void>[] = [];

	if (servers.stdio) {
		console.log('📡 Stopping STDIO server...');
		shutdownPromises.push(servers.stdio.stop());
	}

	if (servers.http) {
		console.log('🌐 Stopping HTTP server...');
		shutdownPromises.push(servers.http.stop());
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
process.on('uncaughtException', error => {
	console.error('❌ Uncaught Exception:', error);
	gracefulShutdown();
});
process.on('unhandledRejection', (reason, promise) => {
	console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
	gracefulShutdown();
});

// Main server startup
async function main(): Promise<void> {
	try {
		console.log('🚀 Starting Knowledge Graph MCP Server...');
		console.log(`📡 STDIO Transport: ${env.ENABLE_STDIO_TRANSPORT ? 'enabled' : 'disabled'}`);
		console.log(`🌐 HTTP Transport: ${env.ENABLE_HTTP_TRANSPORT ? 'enabled' : 'disabled'}`);

		// Validate at least one transport is enabled
		if (!env.ENABLE_STDIO_TRANSPORT && !env.ENABLE_HTTP_TRANSPORT) {
			throw new Error('At least one transport (STDIO or HTTP) must be enabled');
		}

		// Redirect console output to files to prevent STDIO corruption
		// Only redirect if STDIO transport is enabled
		if (env.ENABLE_STDIO_TRANSPORT) {
			redirectConsoleToFiles('./logs');
		}

		// Start servers concurrently
		const startupPromises: Promise<void>[] = [];

		if (env.ENABLE_STDIO_TRANSPORT) {
			startupPromises.push(
				startStdioServer().then(server => {
					servers.stdio = server;
					console.log('📡 STDIO server started');
				})
			);
		}

		if (env.ENABLE_HTTP_TRANSPORT) {
			startupPromises.push(
				startHttpServer().then(server => {
					servers.http = server;
					console.log(`🌐 HTTP server started on port ${env.HTTP_PORT}`);
				})
			);
		}

		// Wait for all servers to start
		await Promise.all(startupPromises);

		console.log('✅ All servers started successfully');

		// Log available endpoints
		if (env.ENABLE_HTTP_TRANSPORT) {
			console.log(
				`📖 API Documentation: http://localhost:${env.HTTP_PORT}${env.HTTP_BASE_PATH}/capabilities`
			);
			console.log(`❤️  Health Check: http://localhost:${env.HTTP_PORT}${env.HTTP_BASE_PATH}/health`);
		}

		if (env.ENABLE_STDIO_TRANSPORT) {
			console.log('📡 STDIO transport ready for MCP client connections');
		}

		// Keep the process alive
		return new Promise(() => {
			// This promise never resolves, keeping the process running
			// Shutdown will happen via signal handlers
		});
	} catch (error) {
		console.error('❌ Server failed to start:', error);
		await gracefulShutdown();
	}
}

// Start the server
main().catch(error => {
	console.error('❌ Unhandled error:', error);
	process.exit(1);
});
