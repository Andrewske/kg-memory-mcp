import { Client } from '@upstash/qstash';
import { env } from '~/shared/env.js';

let qstashInstance: Client | null = null;

export function getQStash(): Client | null {
	if (!qstashInstance && env.QSTASH_TOKEN) {
		qstashInstance = new Client({
			token: env.QSTASH_TOKEN,
		});
	}
	return qstashInstance;
}

// Optional: Export the client directly if you prefer
export const qstash = getQStash();

// Cleanup function for graceful shutdown
export function closeQStash(): void {
	qstashInstance = null;
}
