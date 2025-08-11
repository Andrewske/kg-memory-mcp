/**
 * Retry mechanism with exponential backoff
 * Used for handling transient failures in AI API calls
 */

export interface RetryOptions {
	maxRetries: number;
	baseDelay: number; // milliseconds
	maxDelay: number; // milliseconds
	exponentialFactor: number;
	jitter: boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
	maxRetries: 3,
	baseDelay: 1000, // 1 second
	maxDelay: 10000, // 10 seconds
	exponentialFactor: 2,
	jitter: true,
};

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
	const exponentialDelay = options.baseDelay * options.exponentialFactor ** attempt;
	const clampedDelay = Math.min(exponentialDelay, options.maxDelay);

	if (options.jitter) {
		// Add +/- 20% jitter to prevent thundering herd
		const jitterAmount = clampedDelay * 0.2;
		const jitter = (Math.random() - 0.5) * 2 * jitterAmount;
		return Math.max(0, clampedDelay + jitter);
	}

	return clampedDelay;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: any): boolean {
	// Retry on network errors, rate limiting, and temporary server errors
	if (error?.code) {
		const retryableCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
		if (retryableCodes.includes(error.code)) {
			return true;
		}
	}

	// HTTP status codes that are retryable
	if (error?.status || error?.response?.status) {
		const status = error.status || error.response?.status;
		const retryableStatuses = [
			429, // Rate Limited
			500, // Internal Server Error
			502, // Bad Gateway
			503, // Service Unavailable
			504, // Gateway Timeout
		];
		if (retryableStatuses.includes(status)) {
			return true;
		}
	}

	// AI SDK specific errors
	if (error?.message) {
		const message = error.message.toLowerCase();
		if (
			message.includes('rate limit') ||
			message.includes('timeout') ||
			message.includes('network') ||
			message.includes('connection') ||
			message.includes('temporarily unavailable')
		) {
			return true;
		}
	}

	return false;
}

/**
 * Retry an async function with exponential backoff
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: Partial<RetryOptions> = {}
): Promise<T> {
	const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
	let lastError: any;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry on the last attempt
			if (attempt === opts.maxRetries) {
				break;
			}

			// Check if the error is retryable
			if (!isRetryableError(error)) {
				console.debug(
					`[Retry] Non-retryable error on attempt ${attempt + 1}:`,
					(error as any)?.message || error
				);
				throw error;
			}

			const delay = calculateDelay(attempt, opts);
			console.debug(
				`[Retry] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms:`,
				(error as any)?.message || error
			);

			await sleep(delay);
		}
	}

	// If we get here, all retries failed
	console.warn(
		`[Retry] All ${opts.maxRetries + 1} attempts failed. Last error:`,
		(lastError as any)?.message || lastError
	);
	throw lastError;
}

/**
 * Async function with retry built-in for AI operations
 */
export async function retryAIOperation<T>(
	operation: () => Promise<T>,
	operationName: string,
	customOptions?: Partial<RetryOptions>
): Promise<T> {
	return withRetry(operation, {
		...DEFAULT_RETRY_OPTIONS,
		...customOptions,
		// AI operations might need longer delays due to rate limiting
		baseDelay: 2000, // 2 seconds
		maxDelay: 30000, // 30 seconds
	});
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
	failures: number;
	lastFailureTime: number;
	state: 'closed' | 'open' | 'half-open';
}

const circuitBreakerStates = new Map<string, CircuitBreakerState>();

/**
 * Simple circuit breaker for AI operations
 */
export async function withCircuitBreaker<T>(
	fn: () => Promise<T>,
	operationKey: string,
	options: {
		failureThreshold: number;
		timeout: number; // milliseconds
		resetTimeout: number; // milliseconds
	} = {
		failureThreshold: 5,
		timeout: 30000, // 30 seconds
		resetTimeout: 60000, // 1 minute
	}
): Promise<T> {
	const state = circuitBreakerStates.get(operationKey) || {
		failures: 0,
		lastFailureTime: 0,
		state: 'closed' as const,
	};

	const now = Date.now();

	// Check if circuit should be reset
	if (state.state === 'open' && now - state.lastFailureTime > options.resetTimeout) {
		state.state = 'half-open';
		state.failures = 0;
	}

	// Reject immediately if circuit is open
	if (state.state === 'open') {
		throw new Error(
			`Circuit breaker is open for operation: ${operationKey}. Too many recent failures.`
		);
	}

	try {
		const result = await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error(`Operation timeout after ${options.timeout}ms`)),
					options.timeout
				);
			}),
		]);

		// Success - reset failure count
		if (state.state === 'half-open') {
			state.state = 'closed';
		}
		state.failures = 0;
		circuitBreakerStates.set(operationKey, state);

		return result;
	} catch (error) {
		state.failures++;
		state.lastFailureTime = now;

		if (state.failures >= options.failureThreshold) {
			state.state = 'open';
			console.warn(
				`[CircuitBreaker] Circuit opened for ${operationKey} after ${state.failures} failures`
			);
		}

		circuitBreakerStates.set(operationKey, state);
		throw error;
	}
}
