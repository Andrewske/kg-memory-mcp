/**
 * Unit tests for resource management and concurrency control
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ResourceManager, Semaphore } from '~/features/knowledge-processing/resource-manager.js';
import { setupTestSuite, waitFor } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Resource Manager', () => {
	describe('Semaphore', () => {
		it('should allow operations up to the limit', async () => {
			const semaphore = new Semaphore(2);
			const operations: Promise<string>[] = [];

			// Start two operations that should run immediately
			operations.push(
				semaphore.acquire(async () => {
					await waitFor(50);
					return 'operation-1';
				})
			);

			operations.push(
				semaphore.acquire(async () => {
					await waitFor(50);
					return 'operation-2';
				})
			);

			const results = await Promise.all(operations);
			expect(results).toEqual(['operation-1', 'operation-2']);
		});

		it('should queue operations beyond the limit', async () => {
			const semaphore = new Semaphore(1);
			const executionOrder: number[] = [];

			// Start three operations - only one should run at a time
			const operations = [1, 2, 3].map(i =>
				semaphore.acquire(async () => {
					executionOrder.push(i);
					await waitFor(20);
					return i;
				})
			);

			await Promise.all(operations);
			expect(executionOrder).toEqual([1, 2, 3]);
		});

		it('should handle operation failures without blocking the queue', async () => {
			const semaphore = new Semaphore(1);
			const results: (number | Error)[] = [];

			const operations = [
				semaphore
					.acquire(async () => {
						await waitFor(10);
						throw new Error('First operation failed');
					})
					.catch(err => err),

				semaphore
					.acquire(async () => {
						await waitFor(10);
						return 2;
					})
					.catch(err => err),

				semaphore
					.acquire(async () => {
						await waitFor(10);
						return 3;
					})
					.catch(err => err),
			];

			const settled = await Promise.all(operations);

			expect(settled[0]).toBeInstanceOf(Error);
			expect(settled[1]).toBe(2);
			expect(settled[2]).toBe(3);
		});

		it('should maintain FIFO order for queued operations', async () => {
			const semaphore = new Semaphore(1);
			const executionOrder: string[] = [];

			// Queue multiple operations
			const operations = ['A', 'B', 'C', 'D'].map(id =>
				semaphore.acquire(async () => {
					executionOrder.push(id);
					await waitFor(5);
					return id;
				})
			);

			await Promise.all(operations);
			expect(executionOrder).toEqual(['A', 'B', 'C', 'D']);
		});

		it('should handle concurrent acquire calls correctly', async () => {
			const semaphore = new Semaphore(2);
			let concurrent = 0;
			let maxConcurrent = 0;

			const operations = Array.from({ length: 5 }, (_, i) =>
				semaphore.acquire(async () => {
					concurrent++;
					maxConcurrent = Math.max(maxConcurrent, concurrent);
					await waitFor(30);
					concurrent--;
					return i;
				})
			);

			await Promise.all(operations);
			expect(maxConcurrent).toBe(2);
		});
	});

	describe('ResourceManager', () => {
		it('should initialize with provided limits', () => {
			const limits = {
				maxConnections: 3,
				maxAICalls: 5,
				maxMemoryMB: 1024,
			};

			const manager = new ResourceManager(limits);
			const status = manager.getStatus();

			expect(status.database.available).toBe(3);
			expect(status.ai.available).toBe(5);
			expect(status.memory.maxMB).toBe(1024);
		});

		it('should enforce AI call limits', async () => {
			const manager = new ResourceManager({
				maxConnections: 10,
				maxAICalls: 2,
				maxMemoryMB: 2048,
			});

			let concurrentCalls = 0;
			let maxConcurrentCalls = 0;

			const operations = Array.from({ length: 4 }, (_, i) =>
				manager.withAI(async () => {
					concurrentCalls++;
					maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
					await waitFor(50);
					concurrentCalls--;
					return i;
				})
			);

			const results = await Promise.all(operations);
			expect(results).toEqual([0, 1, 2, 3]);
			expect(maxConcurrentCalls).toBe(2);
		});

		it('should enforce database connection limits', async () => {
			const manager = new ResourceManager({
				maxConnections: 1,
				maxAICalls: 10,
				maxMemoryMB: 2048,
			});

			let concurrentConnections = 0;
			let maxConcurrentConnections = 0;

			const operations = Array.from({ length: 3 }, (_, i) =>
				manager.withDatabase(async () => {
					concurrentConnections++;
					maxConcurrentConnections = Math.max(maxConcurrentConnections, concurrentConnections);
					await waitFor(30);
					concurrentConnections--;
					return `db-op-${i}`;
				})
			);

			const results = await Promise.all(operations);
			expect(results).toEqual(['db-op-0', 'db-op-1', 'db-op-2']);
			expect(maxConcurrentConnections).toBe(1);
		});

		it('should handle mixed AI and DB operations concurrently', async () => {
			const manager = new ResourceManager({
				maxConnections: 1,
				maxAICalls: 1,
				maxMemoryMB: 2048,
			});

			const startTime = Date.now();

			// These should run concurrently since they use different resource pools
			const operations = [
				manager.withAI(async () => {
					await waitFor(50);
					return 'ai-result';
				}),
				manager.withDatabase(async () => {
					await waitFor(50);
					return 'db-result';
				}),
			];

			const results = await Promise.all(operations);
			const endTime = Date.now();

			expect(results).toEqual(['ai-result', 'db-result']);
			// Should take roughly 50ms, not 100ms if they were sequential
			expect(endTime - startTime).toBeLessThan(80);
		});

		it('should provide accurate resource usage metrics', async () => {
			const manager = new ResourceManager({
				maxConnections: 2,
				maxAICalls: 2,
				maxMemoryMB: 2048,
			});

			// Start operations but don't wait for them
			const aiOp = manager.withAI(async () => {
				await waitFor(100);
				return 'ai';
			});

			const dbOp = manager.withDatabase(async () => {
				await waitFor(100);
				return 'db';
			});

			// Check usage while operations are running
			await waitFor(10); // Give operations time to start
			const status = manager.getStatus();

			expect(status.ai.available).toBe(1); // 2 - 1 in use
			expect(status.database.available).toBe(1); // 2 - 1 in use
			expect(typeof status.memory.usedMB).toBe('number');

			await Promise.all([aiOp, dbOp]);

			// Check usage after operations complete
			const finalStatus = manager.getStatus();
			expect(finalStatus.ai.available).toBe(2);
			expect(finalStatus.database.available).toBe(2);
		});

		it('should handle operation failures gracefully', async () => {
			const manager = new ResourceManager({
				maxConnections: 1,
				maxAICalls: 1,
				maxMemoryMB: 2048,
			});

			// First operation fails
			const failedOp = manager.withAI(async () => {
				await waitFor(20);
				throw new Error('AI operation failed');
			});

			// Second operation should still work
			const successOp = manager.withAI(async () => {
				await waitFor(20);
				return 'success';
			});

			await expect(failedOp).rejects.toThrow('AI operation failed');
			await expect(successOp).resolves.toBe('success');

			// Resources should be properly released
			const status = manager.getStatus();
			expect(status.ai.available).toBe(1);
		});

		it('should handle timeout scenarios', async () => {
			const manager = new ResourceManager({
				maxConnections: 1,
				maxAICalls: 1,
				maxMemoryMB: 2048,
			});

			// Long-running operation that blocks the semaphore
			const longOp = manager.withAI(async () => {
				await waitFor(1000); // Very long operation
				return 'long';
			});

			// Quick operation that gets queued
			const quickOp = manager.withAI(async () => {
				await waitFor(10);
				return 'quick';
			});

			// Don't wait for the long operation, just verify the quick one times out
			await expect(
				Promise.race([
					quickOp,
					new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 200)),
				])
			).rejects.toThrow('Timeout');

			// Clean up the long operation
			await longOp;
		}, 15000); // Increase timeout to handle cleanup

		it('should track memory usage correctly', () => {
			const manager = new ResourceManager({
				maxConnections: 5,
				maxAICalls: 5,
				maxMemoryMB: 512,
			});

			const status = manager.getStatus();

			// Memory usage should be a reasonable value
			expect(status.memory.usedMB).toBeGreaterThan(0);
			expect(status.memory.usedMB).toBeLessThanOrEqual(512);
			expect(typeof status.memory.usedMB).toBe('number');
		});

		it('should work with default resource limits', () => {
			const manager = new ResourceManager({
				maxConnections: 5,
				maxAICalls: 10,
				maxMemoryMB: 2048,
			});
			const status = manager.getStatus();

			expect(status.database.available).toBe(5);
			expect(status.ai.available).toBe(10);
			expect(typeof status.memory.usedMB).toBe('number');
		});

		it('should handle zero AI calls limit gracefully', async () => {
			const manager = new ResourceManager({
				maxConnections: 1,
				maxAICalls: 0, // Zero AI calls allowed
				maxMemoryMB: 512, // Enough memory to avoid memory monitor
			});

			// Operations should still be callable but will queue indefinitely
			const operation = manager.withAI(async () => 'result');

			// Since maxAICalls is 0, this should never resolve
			const raceResult = await Promise.race([
				operation,
				new Promise(resolve => setTimeout(() => resolve('timeout'), 100)),
			]);

			expect(raceResult).toBe('timeout');
			
			// The operation will remain pending, but that's expected behavior
		}, 5000);
	});
});
