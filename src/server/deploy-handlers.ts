import type { Request, Response } from 'express';
import { env } from '~/shared/env';
import { handleMcpRequest } from './http-server';

// Express.js adapter
export async function createExpressAdapter() {
	const { default: express } = await import('express');
	const { default: compression } = await import('compression');
	const { default: helmet } = await import('helmet');

	const app = express();

	// Middleware
	app.use(
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

	app.use(compression());
	app.use(express.json({ limit: '10mb' }));
	app.use(express.urlencoded({ extended: true, limit: '10mb' }));

	// Request logging
	app.use((req, res, next) => {
		const start = Date.now();
		res.on('finish', () => {
			const duration = Date.now() - start;
			console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
		});
		next();
	});

	// Handle all requests through our framework-agnostic handler
	app.use(async (req: Request, res: Response) => {
		const response = await handleMcpRequest(req);

		if (response.headers) {
			Object.entries(response.headers).forEach(([key, value]) => {
				res.setHeader(key, value);
			});
		}

		res.status(response.status).json(response.body);
	});

	return app;
}

// Railway/Render startup function
export async function startHttpServer(): Promise<{ stop: () => Promise<void> }> {
	const app = await createExpressAdapter();

	return new Promise((resolve, reject) => {
		const server = app.listen(env.HTTP_PORT, () => {
			console.log(`🌐 HTTP Server started on port ${env.HTTP_PORT}`);
			console.log(
				`📖 API documentation: http://localhost:${env.HTTP_PORT}${env.HTTP_BASE_PATH}/capabilities`
			);
			console.log(`❤️  Health check: http://localhost:${env.HTTP_PORT}${env.HTTP_BASE_PATH}/health`);

			resolve({
				stop: () =>
					new Promise((stopResolve, stopReject) => {
						server.close(error => {
							if (error) {
								console.error('Error stopping HTTP server:', error);
								stopReject(error);
							} else {
								console.log('🛑 HTTP Server stopped');
								stopResolve();
							}
						});
					}),
			});
		});

		server.on('error', reject);
	});
}
