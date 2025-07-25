import type { Request, Response } from 'express';
import { handleMcpRequest } from '~/server/http-server';

export default async function handler(req: Request, res: Response) {
		const response = await handleMcpRequest(req);

		if (response.headers) {
			Object.entries(response.headers).forEach(([key, value]) => {
				res.setHeader(key, value);
			});
		}

		res.status(response.status).json(response.body);
	};

