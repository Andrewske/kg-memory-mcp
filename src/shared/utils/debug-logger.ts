/**
 * Enhanced Debug Logger - Functional logging system for knowledge graph operations
 *
 * Designed to solve critical debugging issues:
 * - Source field mismatches (pipeline-test-123 vs pipeline-test-123_chunk_0)
 * - Timing issues with post-transaction operations
 * - Query relationship problems with vector embeddings
 * - Lack of visibility into data flow transformations
 */

import { env } from '~/shared/env.js';

// ================================================================================================
// Types
// ================================================================================================

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

// Type-safe metadata for different logging contexts
export type LoggableValue = string | number | boolean | null | undefined;
export type LogMetadata = Record<string, LoggableValue | LoggableValue[]>;

// Specific data types for different operations
export type DatabaseQueryData = {
	query?: string;
	table?: string;
	operation?: string;
	params?: LoggableValue[];
	resultCount?: number;
	duration?: number;
};

export type ExtractionData = {
	textLength?: number;
	source?: string;
	chunkCount?: number;
	tripleCount?: number;
	conceptCount?: number;
};

export type PipelineData = {
	jobId?: string;
	stage?: string;
	progress?: number;
	status?: string;
};

export type LogData =
	| LogMetadata
	| DatabaseQueryData
	| ExtractionData
	| PipelineData
	| Record<string, unknown>;

export interface LogContext {
	readonly component: string;
	readonly operation: string;
	readonly startTime: number;
	readonly metadata: LogMetadata;
	readonly requestId?: string;
}

export interface DataFlowLog<TInput = unknown, TOutput = unknown> {
	readonly input: TInput;
	readonly output: TOutput;
	readonly transformations?: string[];
	readonly counts?: {
		readonly inputCount: number;
		readonly outputCount: number;
	};
}

export interface TimingResult<T> {
	readonly result: T;
	readonly duration: number;
	readonly context: LogContext;
}

// ================================================================================================
// Configuration & Performance Optimization
// ================================================================================================

const LOG_LEVELS = {
	ERROR: 0,
	WARN: 1,
	INFO: 2,
	DEBUG: 3,
	TRACE: 4,
} as const;

// Fast boolean lookups for performance
const currentLevel = LOG_LEVELS[env.LOG_LEVEL as keyof typeof LOG_LEVELS] ?? LOG_LEVELS.INFO;
const isDebugEnabled = currentLevel >= LOG_LEVELS.DEBUG;
const isTraceEnabled = currentLevel >= LOG_LEVELS.TRACE;
const isInfoEnabled = currentLevel >= LOG_LEVELS.INFO;

// Granular debug controls
const debugExtraction = env.DEBUG_EXTRACTION;
const debugDatabase = env.DEBUG_DATABASE;
const debugPipeline = env.DEBUG_PIPELINE;
const debugTiming = env.DEBUG_TIMING;

// ================================================================================================
// Core Logging Function
// ================================================================================================

/**
 * Primary logging function - all logging flows through here
 * Optimized for performance with fast-path disabled logging
 */
export function log(level: LogLevel, context: LogContext, message: string, data?: LogData): void {
	// Fast-path check for disabled logging levels
	const levelNum = LOG_LEVELS[level];
	if (levelNum > currentLevel) return;

	// Check granular debug controls for specific components
	if (level === 'DEBUG' || level === 'TRACE') {
		const comp = context.component.toLowerCase();
		if (comp.includes('extract') && !debugExtraction) return;
		if (comp.includes('database') && !debugDatabase) return;
		if (comp.includes('pipeline') && !debugPipeline) return;
		if (comp.includes('timing') && !debugTiming) return;
	}

	// Generate structured log entry
	const timestamp = new Date().toISOString();
	const duration = Date.now() - context.startTime;

	const logEntry = {
		timestamp,
		level,
		component: context.component,
		operation: context.operation,
		message,
		duration,
		...(context.requestId && { requestId: context.requestId }),
		...(Object.keys(context.metadata).length > 0 && { metadata: context.metadata }),
		...(data !== undefined && { data: sanitizeForLogging(data) }),
	};

	// Output based on log level
	switch (level) {
		case 'ERROR':
			console.error(JSON.stringify(logEntry));
			break;
		case 'WARN':
			console.warn(JSON.stringify(logEntry));
			break;
		case 'TRACE':
			console.debug(JSON.stringify(logEntry));
			break;
		default:
			console.log(JSON.stringify(logEntry));
	}
}

// ================================================================================================
// Context Management
// ================================================================================================

/**
 * Create structured context for operation tracking
 * Essential for debugging data flow and timing issues
 */
export function createContext(
	component: string,
	operation: string,
	metadata: LogMetadata = {},
	requestId?: string
): LogContext {
	return {
		component,
		operation,
		startTime: Date.now(),
		metadata,
		requestId,
	};
}

/**
 * Create child context for sub-operations
 * Preserves parent context while tracking sub-operation timing
 */
export function createChildContext(
	parent: LogContext,
	operation: string,
	metadata: LogMetadata = {}
): LogContext {
	return {
		component: parent.component,
		operation: `${parent.operation}.${operation}`,
		startTime: Date.now(),
		metadata: { ...parent.metadata, ...metadata },
		requestId: parent.requestId,
	};
}

// ================================================================================================
// Data Flow Tracking
// ================================================================================================

/**
 * Log data transformations to catch source field mismatches and count discrepancies
 * Critical for debugging pipeline issues where data gets lost or transformed unexpectedly
 */
export function logDataFlow(
	context: LogContext,
	flow: DataFlowLog,
	message: string = 'Data flow'
): void {
	if (!isDebugEnabled) return;

	const inputCount = Array.isArray(flow.input)
		? flow.input.length
		: flow.input && typeof flow.input === 'object'
			? Object.keys(flow.input).length
			: 1;

	const outputCount = Array.isArray(flow.output)
		? flow.output.length
		: flow.output && typeof flow.output === 'object'
			? Object.keys(flow.output).length
			: 1;

	const flowData = {
		...flow,
		counts: flow.counts || { inputCount, outputCount },
		...(flow.transformations && { transformations: flow.transformations }),
	};

	log('DEBUG', context, message, flowData);
}

/**
 * Log query parameters and results to debug source pattern matching issues
 * Tracks what was queried vs what was found
 */
// Type for database query objects
type DatabaseQuery = Record<string, LoggableValue | LoggableValue[]>;

// Type for results with common ID fields
type QueryResultItem = {
	id?: string;
	source?: string;
	[key: string]: unknown;
};

export function logQueryResult<T extends QueryResultItem>(
	context: LogContext,
	query: DatabaseQuery,
	results: T[],
	message: string = 'Query executed'
): void {
	if (!isDebugEnabled) return;

	const queryData = {
		query: sanitizeForLogging(query),
		resultCount: results.length,
		...(results.length > 0 &&
			results.length <= 5 && {
				sampleResults: results.slice(0, 3).map(sanitizeForLogging),
			}),
		...(results.length > 5 && {
			sampleResultIds: results.slice(0, 3).map(r => r.id || r.source || 'no-id'),
		}),
	};

	log('DEBUG', context, message, queryData);
}

/**
 * Log source field transformations to catch mismatches
 * Critical for debugging source pattern issues (test-123 vs test-123_chunk_0)
 */
export function logSourceTransformation(
	context: LogContext,
	originalSource: string,
	transformedSource: string,
	transformation: string
): void {
	if (!isDebugEnabled) return;

	log('DEBUG', context, 'Source transformation', {
		originalSource,
		transformedSource,
		transformation,
		mismatch: originalSource !== transformedSource,
	});
}

// ================================================================================================
// Timing & Performance
// ================================================================================================

/**
 * Execute function with automatic timing logging
 * Essential for debugging timing boundary issues between transactions
 */
export async function withTiming<T>(
	context: LogContext,
	fn: () => Promise<T>,
	message: string = 'Operation completed'
): Promise<TimingResult<T>> {
	const startTime = Date.now();

	if (debugTiming) {
		log('DEBUG', context, `${message} - starting`);
	}

	try {
		const result = await fn();
		const duration = Date.now() - startTime;

		if (debugTiming) {
			log('DEBUG', context, message, { duration, success: true });
		}

		return { result, duration, context };
	} catch (error) {
		const duration = Date.now() - startTime;

		log('ERROR', context, `${message} - failed`, {
			duration,
			error: error instanceof Error ? error.message : String(error),
		});

		throw error;
	}
}

/**
 * Synchronous version of withTiming for non-async operations
 */
export function withTimingSync<T>(
	context: LogContext,
	fn: () => T,
	message: string = 'Operation completed'
): TimingResult<T> {
	const startTime = Date.now();

	if (debugTiming) {
		log('DEBUG', context, `${message} - starting`);
	}

	try {
		const result = fn();
		const duration = Date.now() - startTime;

		if (debugTiming) {
			log('DEBUG', context, message, { duration, success: true });
		}

		return { result, duration, context };
	} catch (error) {
		const duration = Date.now() - startTime;

		log('ERROR', context, `${message} - failed`, {
			duration,
			error: error instanceof Error ? error.message : String(error),
		});

		throw error;
	}
}

// ================================================================================================
// Specialized Logging Functions
// ================================================================================================

/**
 * Log errors with full context and optional stack traces
 */
export function logError(context: LogContext, error: Error | string, data?: LogData): void {
	const errorData = {
		...(typeof error === 'string'
			? { message: error }
			: {
					message: error.message,
					...(env.LOG_STACK_TRACE && { stack: error.stack }),
				}),
		...(data && { additionalData: sanitizeForLogging(data) }),
	};

	log('ERROR', context, 'Error occurred', errorData);
}

/**
 * Log performance metrics and timing information
 */
export function logPerformance(
	context: LogContext,
	metrics: Record<string, number>,
	message: string = 'Performance metrics'
): void {
	if (!debugTiming) return;

	log('DEBUG', context, message, { metrics });
}

/**
 * Log state changes for debugging data consistency issues
 */
export function logStateChange<T>(
	context: LogContext,
	before: T,
	after: T,
	operation: string
): void {
	if (!isDebugEnabled) return;

	log('DEBUG', context, `State change: ${operation}`, {
		before: sanitizeForLogging(before),
		after: sanitizeForLogging(after),
		operation,
	});
}

// ================================================================================================
// Data Sanitization
// ================================================================================================

/**
 * Sanitize data for secure logging - prevent information leakage
 * Enhanced version that handles knowledge graph specific data types
 */
function sanitizeForLogging(data: unknown): unknown {
	if (typeof data === 'string') {
		// Truncate long strings and mask sensitive content
		const truncated = data.length > 200 ? `${data.substring(0, 200)}...` : data;
		return truncated
			.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
			.replace(/sk-[a-zA-Z0-9]{48}/g, '[API_KEY]')
			.replace(/eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, '[JWT_TOKEN]')
			.replace(/[a-f0-9]{64}/g, '[HASH_64]')
			.replace(/[a-f0-9]{32}/g, '[HASH_32]');
	}

	if (Array.isArray(data)) {
		// Log first few items with count for arrays
		return {
			count: data.length,
			sample: data.slice(0, 3).map(sanitizeForLogging),
			...(data.length > 3 && { truncated: true }),
		};
	}

	if (typeof data === 'object' && data !== null) {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			// Skip sensitive keys entirely
			if (
				['embedding', 'password', 'secret', 'key', 'token', 'apiKey'].some(sensitive =>
					key.toLowerCase().includes(sensitive)
				)
			) {
				sanitized[key] = '[REDACTED]';
			} else {
				sanitized[key] = sanitizeForLogging(value);
			}
		}
		return sanitized;
	}

	return data;
}

// ================================================================================================
// Configuration Helpers
// ================================================================================================

/**
 * Check if specific debug category is enabled
 */
export function isDebugCategoryEnabled(
	category: 'extraction' | 'database' | 'pipeline' | 'timing'
): boolean {
	switch (category) {
		case 'extraction':
			return debugExtraction;
		case 'database':
			return debugDatabase;
		case 'pipeline':
			return debugPipeline;
		case 'timing':
			return debugTiming;
		default:
			return false;
	}
}

/**
 * Get current logging configuration
 */
export function getLoggingConfig() {
	return {
		level: env.LOG_LEVEL,
		debugExtraction,
		debugDatabase,
		debugPipeline,
		debugTiming,
		isDebugEnabled,
		isTraceEnabled,
		isInfoEnabled,
	};
}
