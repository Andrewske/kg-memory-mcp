// api/[...path].ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMcpRequest } from '~/server/http-server.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
	try {
		console.log('Attempting to import http-server...');

		// Try to import and log what we get
		console.log('Import successful, module keys:', Object.keys(handleMcpRequest));

		if (!handleMcpRequest) {
			return res.status(500).json({
				error: 'handleMcpRequest not found',
				availableFunctions: Object.keys(handleMcpRequest),
			});
		}

		const response = await handleMcpRequest(req);

		if (response.headers) {
			Object.entries(response.headers).forEach(([key, value]) => {
				res.setHeader(key, value as string);
			});
		}

		res.status(response.status).json(response.body);
	} catch (error) {
		console.error('Error in handler:', error);
		return res.status(500).json({
			error: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
			name: error instanceof Error ? error.name : undefined,
		});
	}
}
