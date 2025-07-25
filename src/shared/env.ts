import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({

	server: {
		// Core
		DATABASE_URL: z.string().url(),
		NODE_ENV: z.enum(['development', 'test', 'production']),
		OPENAI_API_KEY: z.string().optional(),
		ANTHROPIC_API_KEY: z.string().optional(),

		// QStash
		QSTASH_TOKEN: z.string().optional(),
		QSTASH_URL: z.string().optional(),
		HTTP_SERVER_URL: z.string().optional(),

		// Embeddings
		EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
		EMBEDDING_DIMENSIONS: z.string().default('1536').transform(val => parseInt(val)),
		BATCH_SIZE: z.string().default('32').transform(val => parseInt(val)),

		// HTTP
		HTTP_PORT: z.string().default('3000').transform(val => parseInt(val)),
		HTTP_BASE_PATH: z.string().default('/api'),
		HTTP_CORS_ORIGINS: z.string().default('*'),
		ENABLE_HTTP_TRANSPORT: z.string().transform(val => val === 'true').default('false'),
		ENABLE_STDIO_TRANSPORT: z.string().transform(val => val === 'true').default('false'),

		// Search
		SEARCH_TOP_K: z.string().default('10').transform(val => parseInt(val)),
		MIN_SCORE: z.string().default('0.7').transform(val => parseFloat(val)),

		// Database
		DB_MAX_CONNECTIONS: z.string().default('10').transform(val => parseInt(val)),
		DB_CONNECTION_TIMEOUT: z.string().default('5000').transform(val => parseInt(val)),

		// Extraction
		EXTRACTION_METHOD: z.enum(['single-pass', 'four-stage']).default('four-stage'),
		DELAY_BETWEEN_TYPES: z.string().default('2000').transform(val => parseInt(val)),
		MAX_CHUNK_TOKENS: z.string().default('1500').transform(val => parseInt(val)),
		EXTRACTION_MODEL: z.string().default('gpt-4o-mini'),
		EXTRACTION_TEMPERATURE: z.string().default('0.1').transform(val => parseFloat(val)),

		// Deduplication
		ENABLE_SEMANTIC_DEDUP: z.string().transform(val => val === 'true').default('false'),
		SEMANTIC_THRESHOLD: z.string().default('0.85').transform(val => parseFloat(val)),

		// AI
		AI_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
		AI_MODEL: z.string().default('gpt-4o-mini'),
		AI_TEMPERATURE: z.string().default('0.1').transform(val => parseFloat(val)),
		AI_MAX_TOKENS: z.string().default('10000').transform(val => parseInt(val)),

		// Logging
		LOG_LEVEL: z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']).default('INFO'),
		LOG_TO_STDERR: z.string().transform(val => val === 'true').default('false'),
		LOG_STACK_TRACE: z.string().transform(val => val === 'true').default('false'),
		DIAGNOSTIC_MODE: z.string().transform(val => val === 'true').default('false'),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: process.env,

	emptyStringAsUndefined: true,
});
