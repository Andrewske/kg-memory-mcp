/**
 * Performance tests for resource limit enforcement and concurrency control
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

import { ResourceManager, Semaphore } from '~/features/knowledge-processing/resource-manager.js';
import { setupTestSuite, waitFor } from '../helpers/test-setup.js';
import { performanceData } from '../fixtures/test-data.js';

// Setup test environment
setupTestSuite();

describe('Resource Limits Performance', () => {
  describe('Semaphore Performance', () => {
    it('should handle high concurrency efficiently', async () => {
      const limit = 10;
      const operations = 100;
      const semaphore = new Semaphore(limit);

      const startTime = Date.now();
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const promises = Array.from({ length: operations }, (_, i) =>
        semaphore.acquire(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          
          await waitFor(10); // Short operation
          
          currentConcurrent--;
          return i;
        })
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(operations);
      expect(maxConcurrent).toBeLessThanOrEqual(limit);
      
      // Should complete in reasonable time with parallelization
      const totalTime = endTime - startTime;
      const sequentialTime = operations * 10; // If run sequentially
      const expectedTime = Math.ceil(operations / limit) * 10; // With parallelization
      
      expect(totalTime).toBeLessThan(sequentialTime * 0.5); // At least 50% faster than sequential
      expect(totalTime).toBeLessThan(expectedTime * 2); // Within reasonable bounds
    });

    it('should maintain performance under different batch sizes', async () => {
      const results = [];

      for (const batchSize of performanceData.batchSizes) {
        const semaphore = new Semaphore(batchSize);
        const operations = batchSize * 10; // 10x the semaphore limit

        const startTime = Date.now();
        
        const promises = Array.from({ length: operations }, (_, i) =>
          semaphore.acquire(async () => {
            await waitFor(5);
            return i;
          })
        );

        await Promise.all(promises);
        const endTime = Date.now();

        results.push({
          batchSize,
          operations,
          totalTime: endTime - startTime,
          averageTime: (endTime - startTime) / operations
        });
      }

      // Verify performance characteristics
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        
        // Larger batch sizes should generally be more efficient per operation
        if (curr.batchSize > prev.batchSize * 2) {
          expect(curr.averageTime).toBeLessThan(prev.averageTime * 1.5);
        }
      }
    });

    it('should handle bursty load patterns efficiently', async () => {
      const semaphore = new Semaphore(5);
      const burstSize = 50;
      const pauseBetweenBursts = 100;

      const startTime = Date.now();

      // Create multiple bursts of concurrent operations
      const bursts = Array.from({ length: 3 }, async (_, burstIndex) => {
        await waitFor(burstIndex * pauseBetweenBursts);
        
        const burstPromises = Array.from({ length: burstSize }, (_, i) =>
          semaphore.acquire(async () => {
            await waitFor(20);
            return `burst-${burstIndex}-op-${i}`;
          })
        );

        return Promise.all(burstPromises);
      });

      const results = await Promise.all(bursts);
      const endTime = Date.now();

      expect(results.flat()).toHaveLength(burstSize * 3);
      
      // Should handle bursts without significant performance degradation
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(1500); // Reasonable upper bound
    });
  });

  describe('ResourceManager Performance', () => {
    it('should scale efficiently with increased resource limits', async () => {
      const testCases = [
        { aiLimit: 2, dbLimit: 1 },
        { aiLimit: 4, dbLimit: 2 },
        { aiLimit: 8, dbLimit: 4 },
        { aiLimit: 16, dbLimit: 8 }
      ];

      const results = [];

      for (const { aiLimit, dbLimit } of testCases) {
        const manager = new ResourceManager({
          maxAICalls: aiLimit,
          maxConnections: dbLimit,
          maxMemoryMB: 2048
        });

        const operations = aiLimit * 10; // 10x the AI limit
        const startTime = Date.now();

        const promises = Array.from({ length: operations }, (_, i) =>
          manager.withAI(async () => {
            await waitFor(10);
            return i;
          })
        );

        await Promise.all(promises);
        const endTime = Date.now();

        results.push({
          aiLimit,
          dbLimit,
          operations,
          totalTime: endTime - startTime,
          throughput: operations / (endTime - startTime) * 1000 // ops/sec
        });
      }

      // Verify throughput scales with resource limits
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        
        // Higher limits should provide better throughput
        if (curr.aiLimit >= prev.aiLimit * 2) {
          expect(curr.throughput).toBeGreaterThan(prev.throughput * 1.2);
        }
      }
    });

    it('should maintain low overhead for resource tracking', async () => {
      const manager = new ResourceManager({
        maxAICalls: 10,
        maxConnections: 5,
        maxMemoryMB: 2048
      });

      const iterations = 1000;
      const startTime = Date.now();

      // Measure overhead of resource tracking
      for (let i = 0; i < iterations; i++) {
        const usage = manager.getCurrentUsage();
        expect(typeof usage.aiCalls).toBe('number');
        expect(typeof usage.connections).toBe('number');
        expect(typeof usage.memoryMB).toBe('number');
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / iterations;

      // Resource usage tracking should be very fast
      expect(averageTime).toBeLessThan(0.1); // Less than 0.1ms per call
    });

    it('should handle mixed workload patterns efficiently', async () => {
      const manager = new ResourceManager({
        maxAICalls: 4,
        maxConnections: 2,
        maxMemoryMB: 2048
      });

      const aiOperations = 20;
      const dbOperations = 10;
      
      const startTime = Date.now();

      // Mix AI and DB operations
      const aiPromises = Array.from({ length: aiOperations }, (_, i) =>
        manager.withAI(async () => {
          await waitFor(25);
          return `ai-${i}`;
        })
      );

      const dbPromises = Array.from({ length: dbOperations }, (_, i) =>
        manager.withDB(async () => {
          await waitFor(15);
          return `db-${i}`;
        })
      );

      const results = await Promise.all([...aiPromises, ...dbPromises]);
      const endTime = Date.now();

      expect(results).toHaveLength(aiOperations + dbOperations);
      
      // Mixed workload should be efficient due to separate resource pools
      const totalTime = endTime - startTime;
      const expectedSequentialTime = (aiOperations * 25) + (dbOperations * 15);
      
      expect(totalTime).toBeLessThan(expectedSequentialTime * 0.3); // Much faster than sequential
    });

    it('should handle resource contention gracefully', async () => {
      const manager = new ResourceManager({
        maxAICalls: 2, // Very limited resources
        maxConnections: 1,
        maxMemoryMB: 512
      });

      const highContentionOperations = 50;
      const startTime = Date.now();

      let maxQueuedOperations = 0;
      let currentlyQueued = 0;

      const promises = Array.from({ length: highContentionOperations }, (_, i) =>
        manager.withAI(async () => {
          currentlyQueued++;
          maxQueuedOperations = Math.max(maxQueuedOperations, currentlyQueued);
          
          await waitFor(30); // Longer operation to create contention
          
          currentlyQueued--;
          return i;
        })
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(highContentionOperations);
      
      // Should handle high contention without failures
      const totalTime = endTime - startTime;
      const expectedTime = Math.ceil(highContentionOperations / 2) * 30; // With maxAICalls: 2
      
      expect(totalTime).toBeLessThan(expectedTime * 1.5); // Within reasonable bounds
      expect(maxQueuedOperations).toBeGreaterThan(highContentionOperations / 2);
    });
  });

  describe('Memory and CPU Performance', () => {
    it('should maintain stable memory usage under load', async () => {
      const manager = new ResourceManager({
        maxAICalls: 8,
        maxConnections: 4,
        maxMemoryMB: 1024
      });

      const iterations = 100;
      const memoryReadings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        // Perform some operations
        await manager.withAI(async () => {
          await waitFor(5);
          const largeArray = new Array(1000).fill(i); // Create some memory pressure
          return largeArray.length;
        });

        // Record memory usage
        const usage = manager.getCurrentUsage();
        memoryReadings.push(usage.memoryMB);
      }

      // Memory usage should remain relatively stable
      const initialMemory = memoryReadings[0];
      const finalMemory = memoryReadings[memoryReadings.length - 1];
      const maxMemory = Math.max(...memoryReadings);

      // Memory should not continuously grow (no major leaks)
      expect(finalMemory).toBeLessThan(initialMemory * 2);
      expect(maxMemory).toBeLessThan(1024); // Should stay within limits
    });

    it('should handle CPU-intensive operations efficiently', async () => {
      const manager = new ResourceManager({
        maxAICalls: 4,
        maxConnections: 2,
        maxMemoryMB: 2048
      });

      const cpuIntensiveTask = async () => {
        // Simulate CPU-intensive work
        let result = 0;
        for (let i = 0; i < 100000; i++) {
          result += Math.random() * i;
        }
        return result;
      };

      const operations = 20;
      const startTime = Date.now();

      const promises = Array.from({ length: operations }, () =>
        manager.withAI(cpuIntensiveTask)
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(operations);
      
      // Should complete CPU-intensive work in reasonable time with parallelization
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(5000); // 5 second upper bound
    });
  });

  describe('Performance Regression Detection', () => {
    it('should maintain baseline performance characteristics', async () => {
      // This test establishes performance baselines for regression detection
      const baselineTests = [
        {
          name: 'semaphore_throughput',
          test: async () => {
            const semaphore = new Semaphore(10);
            const operations = 100;
            const startTime = Date.now();
            
            await Promise.all(Array.from({ length: operations }, () =>
              semaphore.acquire(async () => waitFor(1))
            ));
            
            return Date.now() - startTime;
          },
          expectedMaxTime: 200 // milliseconds
        },
        {
          name: 'resource_manager_ai_ops',
          test: async () => {
            const manager = new ResourceManager({ maxAICalls: 5, maxConnections: 2, maxMemoryMB: 1024 });
            const operations = 50;
            const startTime = Date.now();
            
            await Promise.all(Array.from({ length: operations }, () =>
              manager.withAI(async () => waitFor(5))
            ));
            
            return Date.now() - startTime;
          },
          expectedMaxTime: 300 // milliseconds
        },
        {
          name: 'mixed_workload_efficiency',
          test: async () => {
            const manager = new ResourceManager({ maxAICalls: 3, maxConnections: 2, maxMemoryMB: 1024 });
            const startTime = Date.now();
            
            await Promise.all([
              ...Array.from({ length: 15 }, () => manager.withAI(async () => waitFor(10))),
              ...Array.from({ length: 10 }, () => manager.withDB(async () => waitFor(8)))
            ]);
            
            return Date.now() - startTime;
          },
          expectedMaxTime: 400 // milliseconds
        }
      ];

      const results = [];

      for (const { name, test, expectedMaxTime } of baselineTests) {
        const actualTime = await test();
        results.push({ name, actualTime, expectedMaxTime });
        
        expect(actualTime).toBeLessThan(expectedMaxTime);
      }

      // Log results for performance monitoring
      console.log('Performance Baseline Results:', results);
    });
  });
});