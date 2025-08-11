/**
 * Performance tests for embedding generation efficiency optimization
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Mock dependencies
jest.mock('~/shared/env.js');

import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { env } from '~/shared/env.js';
import {
  createMockEmbeddingService,
  createTestTriple,
  createTestConcept,
  createSuccessResult
} from '../helpers/mock-factories.js';
import { performanceData, sampleTriples } from '../fixtures/test-data.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Embedding Efficiency Performance', () => {
  let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbeddingService = createMockEmbeddingService();
    (env as any).BATCH_SIZE = 100;
  });

  describe('Deduplication Efficiency', () => {
    it('should achieve significant deduplication in realistic datasets', async () => {
      // Create dataset with realistic duplication patterns
      const baseEntities = ['John Smith', 'Tech Corp', 'Sarah Johnson', 'AI Project', 'San Francisco'];
      const basePredicates = ['works at', 'manages', 'located in', 'participated in'];

      const triples = [];
      // Generate many triples with overlapping entities
      for (let i = 0; i < 100; i++) {
        triples.push(createTestTriple({
          subject: baseEntities[i % baseEntities.length],
          predicate: basePredicates[i % basePredicates.length],
          object: baseEntities[(i + 2) % baseEntities.length]
        }));
      }

      // Add concepts with some duplicates
      const concepts = [];
      const baseConceptNames = ['Technology', 'Business', 'People', 'Location', 'Projects'];
      for (let i = 0; i < 50; i++) {
        concepts.push(createTestConcept({
          name: baseConceptNames[i % baseConceptNames.length]
        }));
      }

      const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

      expect(result.success).toBe(true);
      
      const stats = result.data?.stats;
      expect(stats?.totalTexts).toBeGreaterThan(stats?.uniqueTexts!);
      
      // Should achieve at least 50% deduplication efficiency
      const efficiency = stats?.duplicatesAverted! / stats?.totalTexts!;
      expect(efficiency).toBeGreaterThan(0.5);
      
      console.log(`Deduplication efficiency: ${(efficiency * 100).toFixed(1)}% (${stats?.duplicatesAverted}/${stats?.totalTexts} duplicates removed)`);
    });

    it('should scale efficiently with dataset size', async () => {
      const testSizes = [10, 50, 100, 500];
      const results = [];

      for (const size of testSizes) {
        // Generate dataset of specified size with 30% duplication rate
        const uniqueCount = Math.floor(size * 0.7);
        const duplicateCount = size - uniqueCount;

        const triples = [];
        const uniqueEntities = Array.from({ length: uniqueCount }, (_, i) => `Entity_${i}`);
        
        // Add unique triples
        for (let i = 0; i < uniqueCount; i++) {
          triples.push(createTestTriple({
            subject: uniqueEntities[i],
            object: `Object_${i}`
          }));
        }
        
        // Add duplicate triples (reuse entities)
        for (let i = 0; i < duplicateCount; i++) {
          triples.push(createTestTriple({
            subject: uniqueEntities[i % uniqueCount],
            object: `Object_${i % uniqueCount}`
          }));
        }

        const startTime = Date.now();
        const result = await generateEmbeddingMap(triples, [], mockEmbeddingService, false);
        const endTime = Date.now();

        expect(result.success).toBe(true);
        
        results.push({
          size,
          processingTime: endTime - startTime,
          totalTexts: result.data?.stats.totalTexts,
          uniqueTexts: result.data?.stats.uniqueTexts,
          efficiency: result.data?.stats.duplicatesAverted! / result.data?.stats.totalTexts!
        });
      }

      // Verify linear scaling characteristics
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        
        // Processing time should scale reasonably with dataset size
        const sizeRatio = curr.size / prev.size;
        const timeRatio = curr.processingTime / prev.processingTime;
        
        expect(timeRatio).toBeLessThan(sizeRatio * 2); // Should not be worse than O(n²)
      }

      console.log('Scaling results:', results);
    });

    it('should optimize batch processing for different batch sizes', async () => {
      const triples = Array.from({ length: 200 }, (_, i) => 
        createTestTriple({
          subject: `Entity_${Math.floor(i / 5)}`, // 5 triples per entity (80% duplication)
          object: `Object_${i}`
        })
      );

      const results = [];

      for (const batchSize of performanceData.batchSizes) {
        (env as any).BATCH_SIZE = batchSize;

        const startTime = Date.now();
        const result = await generateEmbeddingMap(triples, [], mockEmbeddingService, false);
        const endTime = Date.now();

        expect(result.success).toBe(true);

        results.push({
          batchSize,
          processingTime: endTime - startTime,
          batchCalls: result.data?.stats.batchCalls,
          apiEfficiency: result.data?.stats.duplicatesAverted! / result.data?.stats.totalTexts!
        });
      }

      // Verify batch size optimization
      const optimalBatch = results.reduce((best, current) => 
        current.processingTime < best.processingTime ? current : best
      );

      expect(optimalBatch.batchSize).toBeGreaterThan(1); // Should benefit from batching
      console.log('Batch size optimization results:', results);
    });
  });

  describe('API Call Optimization', () => {
    it('should demonstrate 70-80% API call reduction', async () => {
      // Create dataset with high duplication typical of real knowledge graphs
      const commonEntities = ['John Smith', 'Tech Corp', 'Sarah Johnson'];
      const commonPredicates = ['works at', 'manages', 'reports to'];
      
      const triples = [];
      // Generate 100 triples with heavy entity reuse
      for (let i = 0; i < 100; i++) {
        triples.push(createTestTriple({
          subject: commonEntities[i % commonEntities.length],
          predicate: commonPredicates[i % commonPredicates.length],
          object: commonEntities[(i + 1) % commonEntities.length]
        }));
      }

      // Track actual API calls made
      let apiCallCount = 0;
      mockEmbeddingService.generateEmbeddings.mockImplementation(async (texts: string[]) => {
        apiCallCount++;
        return createSuccessResult({
          embeddings: texts.map(() => Array(1536).fill(0).map(() => Math.random())),
          usage: { promptTokens: texts.length * 8, totalTokens: texts.length * 8 }
        });
      });

      const result = await generateEmbeddingMap(triples, [], mockEmbeddingService, false);

      expect(result.success).toBe(true);

      const stats = result.data?.stats;
      const theoreticalApiCalls = Math.ceil(stats?.totalTexts! / 100); // Without deduplication
      const actualApiCalls = stats?.batchCalls!;
      const reduction = 1 - (actualApiCalls / theoreticalApiCalls);

      expect(reduction).toBeGreaterThan(0.7); // At least 70% reduction
      expect(reduction).toBeLessThanOrEqual(0.9); // Realistic upper bound

      console.log(`API call reduction: ${(reduction * 100).toFixed(1)}% (${actualApiCalls} vs ${theoreticalApiCalls} calls)`);
    });

    it('should maintain efficiency across different content types', async () => {
      const testCases = [
        {
          name: 'entity-heavy',
          triples: sampleTriples.entityEntity,
          concepts: []
        },
        {
          name: 'event-heavy',
          triples: [...sampleTriples.entityEvent, ...sampleTriples.eventEvent],
          concepts: []
        },
        {
          name: 'mixed-with-concepts',
          triples: Object.values(sampleTriples).flat(),
          concepts: Array.from({ length: 10 }, (_, i) => 
            createTestConcept({ name: `Concept_${i}` })
          )
        }
      ];

      const results = [];

      for (const { name, triples, concepts } of testCases) {
        // Duplicate the dataset to create deduplication opportunities
        const duplicatedTriples = [...triples, ...triples, ...triples];
        const duplicatedConcepts = [...concepts, ...concepts];

        const result = await generateEmbeddingMap(
          duplicatedTriples, 
          duplicatedConcepts, 
          mockEmbeddingService, 
          false
        );

        expect(result.success).toBe(true);

        const stats = result.data?.stats;
        const efficiency = stats?.duplicatesAverted! / stats?.totalTexts!;

        results.push({
          name,
          totalTexts: stats?.totalTexts,
          uniqueTexts: stats?.uniqueTexts,
          efficiency: efficiency,
          batchCalls: stats?.batchCalls
        });

        // All content types should achieve reasonable efficiency
        expect(efficiency).toBeGreaterThan(0.6);
      }

      console.log('Content type efficiency results:', results);
    });
  });

  describe('Memory and Performance Optimization', () => {
    it('should handle large datasets without memory issues', async () => {
      const largeDatasetSize = 1000;
      
      // Generate large dataset
      const triples = Array.from({ length: largeDatasetSize }, (_, i) => 
        createTestTriple({
          subject: `Entity_${Math.floor(i / 10)}`, // 10 triples per entity
          predicate: `predicate_${i % 20}`, // 20 unique predicates
          object: `Object_${i}`,
          semantic_content: `This is a longer semantic content string for triple ${i} that includes more detailed information about the relationship.`
        })
      );

      const concepts = Array.from({ length: 100 }, (_, i) => 
        createTestConcept({
          name: `LongConceptName_${i}`,
          description: `This is a detailed description for concept ${i} that contains comprehensive information.`
        })
      );

      const startTime = Date.now();
      const initialMemory = process.memoryUsage().heapUsed;

      const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

      const endTime = Date.now();
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      expect(result.success).toBe(true);
      
      // Should complete in reasonable time
      expect(endTime - startTime).toBeLessThan(5000); // 5 seconds
      
      // Memory usage should be reasonable
      expect(memoryIncrease).toBeLessThan(100); // Less than 100MB increase
      
      console.log(`Large dataset processing: ${endTime - startTime}ms, ${memoryIncrease.toFixed(1)}MB memory increase`);
    });

    it('should optimize text collection and processing', async () => {
      // Test different text length patterns
      const testCases = [
        { name: 'short-texts', avgLength: 10 },
        { name: 'medium-texts', avgLength: 50 },
        { name: 'long-texts', avgLength: 200 }
      ];

      const results = [];

      for (const { name, avgLength } of testCases) {
        const triples = Array.from({ length: 100 }, (_, i) => 
          createTestTriple({
            subject: 'A'.repeat(avgLength),
            predicate: 'B'.repeat(avgLength),
            object: 'C'.repeat(avgLength),
            semantic_content: 'D'.repeat(avgLength * 3)
          })
        );

        const startTime = Date.now();
        const result = await generateEmbeddingMap(triples, [], mockEmbeddingService, false);
        const endTime = Date.now();

        expect(result.success).toBe(true);

        results.push({
          name,
          avgLength,
          processingTime: endTime - startTime,
          efficiency: result.data?.stats.duplicatesAverted! / result.data?.stats.totalTexts!
        });
      }

      // Processing time should scale reasonably with text length
      const shortCase = results.find(r => r.name === 'short-texts')!;
      const longCase = results.find(r => r.name === 'long-texts')!;
      
      expect(longCase.processingTime).toBeLessThan(shortCase.processingTime * 5);

      console.log('Text length optimization results:', results);
    });

    it('should validate claimed 70-80% efficiency gains', async () => {
      // Create a realistic knowledge graph scenario
      const entities = [
        'John Smith', 'Sarah Johnson', 'Mike Wilson', 'Tech Corp', 'AI Division', 
        'San Francisco', 'New York', 'Machine Learning', 'Software Engineering', 'Product Management'
      ];

      const predicates = [
        'works at', 'manages', 'located in', 'specializes in', 'collaborated with',
        'reports to', 'participated in', 'developed', 'led', 'implemented'
      ];

      // Generate realistic dataset with natural duplication patterns
      const triples = [];
      for (let i = 0; i < 500; i++) {
        // 60% chance of reusing existing entities (realistic duplication)
        const subject = Math.random() < 0.6 
          ? entities[Math.floor(Math.random() * entities.length)]
          : `UniqueEntity_${i}`;
        
        const predicate = predicates[Math.floor(Math.random() * predicates.length)];
        
        const object = Math.random() < 0.6
          ? entities[Math.floor(Math.random() * entities.length)]
          : `UniqueObject_${i}`;

        triples.push(createTestTriple({
          subject, predicate, object,
          semantic_content: `${subject} ${predicate} ${object} in a professional context.`
        }));
      }

      // Add concepts with realistic duplication
      const conceptNames = ['Technology', 'Business Process', 'Human Resources', 'Innovation', 'Strategy'];
      const concepts = [];
      for (let i = 0; i < 100; i++) {
        const name = Math.random() < 0.7 
          ? conceptNames[Math.floor(Math.random() * conceptNames.length)]
          : `UniqueConcept_${i}`;
        
        concepts.push(createTestConcept({ name }));
      }

      const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

      expect(result.success).toBe(true);

      const stats = result.data?.stats;
      const efficiency = stats?.duplicatesAverted! / stats?.totalTexts!;

      // Should achieve the claimed 70-80% efficiency
      expect(efficiency).toBeGreaterThanOrEqual(0.7);
      expect(efficiency).toBeLessThanOrEqual(0.85);

      console.log(`Realistic dataset efficiency: ${(efficiency * 100).toFixed(1)}% (Target: 70-80%)`);
      console.log(`API calls saved: ${stats?.duplicatesAverted} out of ${stats?.totalTexts} total texts`);
    });
  });
});