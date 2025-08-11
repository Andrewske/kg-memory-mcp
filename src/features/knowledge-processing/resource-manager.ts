/**
 * Resource management utilities for controlling concurrency and resource usage
 */

/**
 * Semaphore for controlling concurrent operations
 */
export class Semaphore {
	private permits: number;
	private waiting: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	/**
	 * Acquire a permit and execute a task
	 */
	async acquire<T>(task: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			if (this.permits > 0) {
				this.permits--;
				this.executeTask(task, resolve, reject);
			} else {
				// Queue the task if no permits available
				this.waiting.push(() => {
					this.permits--;
					this.executeTask(task, resolve, reject);
				});
			}
		});
	}

	private async executeTask<T>(
		task: () => Promise<T>,
		resolve: (value: T) => void,
		reject: (reason: any) => void
	) {
		try {
			const result = await task();
			resolve(result);
		} catch (error) {
			reject(error);
		} finally {
			// Release permit and process waiting queue
			this.permits++;
			if (this.waiting.length > 0) {
				const next = this.waiting.shift();
				next?.();
			}
		}
	}

	/**
	 * Get current number of available permits
	 */
	getAvailablePermits(): number {
		return this.permits;
	}

	/**
	 * Get number of waiting tasks
	 */
	getWaitingCount(): number {
		return this.waiting.length;
	}
}

/**
 * Resource limits configuration
 */
export interface ResourceLimits {
	maxConnections: number;
	maxAICalls: number;
	maxMemoryMB: number;
}

/**
 * Monitor memory usage
 */
export class MemoryMonitor {
	private maxMemoryMB: number;

	constructor(maxMemoryMB: number) {
		this.maxMemoryMB = maxMemoryMB;
	}

	/**
	 * Check if memory is available
	 */
	checkAvailable(): boolean {
		const usage = process.memoryUsage();
		const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
		return usedMB < this.maxMemoryMB;
	}

	/**
	 * Get current memory usage
	 */
	getCurrentUsage(): { usedMB: number; maxMB: number; percentage: number } {
		const usage = process.memoryUsage();
		const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
		const percentage = Math.round((usedMB / this.maxMemoryMB) * 100);

		return {
			usedMB,
			maxMB: this.maxMemoryMB,
			percentage,
		};
	}

	/**
	 * Wait until memory is available
	 */
	async waitForMemory(checkInterval = 1000): Promise<void> {
		while (!this.checkAvailable()) {
			console.warn('[MemoryMonitor] Memory limit reached, waiting...');
			await new Promise(resolve => setTimeout(resolve, checkInterval));
		}
	}
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
	private tokens: number;
	private maxTokens: number;
	private refillRate: number; // tokens per second
	private lastRefill: number;

	constructor(maxTokens: number, refillRate: number) {
		this.maxTokens = maxTokens;
		this.tokens = maxTokens;
		this.refillRate = refillRate;
		this.lastRefill = Date.now();
	}

	/**
	 * Acquire tokens for an operation
	 */
	async acquire(tokensNeeded = 1): Promise<void> {
		// Refill tokens based on time elapsed
		this.refill();

		// Wait if not enough tokens
		while (this.tokens < tokensNeeded) {
			const waitTime = Math.ceil(((tokensNeeded - this.tokens) / this.refillRate) * 1000);
			await new Promise(resolve => setTimeout(resolve, waitTime));
			this.refill();
		}

		this.tokens -= tokensNeeded;
	}

	private refill() {
		const now = Date.now();
		const elapsed = (now - this.lastRefill) / 1000; // seconds
		const tokensToAdd = Math.floor(elapsed * this.refillRate);

		if (tokensToAdd > 0) {
			this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
			this.lastRefill = now;
		}
	}

	/**
	 * Get current token count
	 */
	getAvailableTokens(): number {
		this.refill();
		return this.tokens;
	}
}

/**
 * Resource manager for coordinating all resource limits
 */
export class ResourceManager {
	private dbSemaphore: Semaphore;
	private aiSemaphore: Semaphore;
	private memoryMonitor: MemoryMonitor;
	private rateLimiter: RateLimiter;

	constructor(limits: ResourceLimits) {
		this.dbSemaphore = new Semaphore(limits.maxConnections);
		this.aiSemaphore = new Semaphore(limits.maxAICalls);
		this.memoryMonitor = new MemoryMonitor(limits.maxMemoryMB);
		this.rateLimiter = new RateLimiter(10, 1); // 10 calls, refill 1 per second
	}

	/**
	 * Acquire resources for a database operation
	 */
	async withDatabase<T>(operation: () => Promise<T>): Promise<T> {
		return this.dbSemaphore.acquire(operation);
	}

	/**
	 * Acquire resources for an AI operation
	 */
	async withAI<T>(operation: () => Promise<T>): Promise<T> {
		await this.memoryMonitor.waitForMemory();
		await this.rateLimiter.acquire();
		return this.aiSemaphore.acquire(operation);
	}

	/**
	 * Get current resource status
	 */
	getStatus() {
		return {
			database: {
				available: this.dbSemaphore.getAvailablePermits(),
				waiting: this.dbSemaphore.getWaitingCount(),
			},
			ai: {
				available: this.aiSemaphore.getAvailablePermits(),
				waiting: this.aiSemaphore.getWaitingCount(),
			},
			memory: this.memoryMonitor.getCurrentUsage(),
			rateLimit: {
				available: this.rateLimiter.getAvailableTokens(),
			},
		};
	}
}
