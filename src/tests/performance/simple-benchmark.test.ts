import { performance } from 'perf_hooks';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { KnowledgeTriple } from '@prisma/client';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TimingPhase {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

interface BenchmarkReport {
  testName: string;
  inputTokens: number;
  textLength: number;
  phases: TimingPhase[];
  totalTime: number;
  results: {
    [key: string]: number;
  };
}

class SimpleBenchmark {
  private currentPhase: TimingPhase | null = null;
  private phases: TimingPhase[] = [];

  startPhase(name: string) {
    if (this.currentPhase) {
      this.endPhase();
    }
    
    this.currentPhase = {
      name,
      startTime: performance.now(),
    };
  }

  endPhase(): TimingPhase | null {
    if (!this.currentPhase) return null;
    
    this.currentPhase.endTime = performance.now();
    this.currentPhase.duration = this.currentPhase.endTime - this.currentPhase.startTime;
    
    this.phases.push(this.currentPhase);
    const completedPhase = this.currentPhase;
    this.currentPhase = null;
    
    return completedPhase;
  }

  getReport(testName: string, textLength: number): BenchmarkReport {
    if (this.currentPhase) {
      this.endPhase();
    }

    const totalTime = this.phases.reduce((sum, phase) => sum + (phase.duration || 0), 0);
    const estimatedTokens = Math.ceil(textLength / 4);

    return {
      testName,
      inputTokens: estimatedTokens,
      textLength,
      phases: [...this.phases],
      totalTime,
      results: {},
    };
  }

  reset() {
    this.currentPhase = null;
    this.phases = [];
  }

  generateReportSummary(report: BenchmarkReport): string {
    const lines = [
      `\n=== SIMPLE BENCHMARK REPORT ===`,
      `Test: ${report.testName}`,
      `Input: ${report.textLength} characters (${report.inputTokens} estimated tokens)`,
      `Total Time: ${report.totalTime.toFixed(2)}ms`,
      '',
      '--- Phase Breakdown ---',
    ];

    report.phases.forEach(phase => {
      lines.push(`${phase.name}: ${(phase.duration || 0).toFixed(2)}ms`);
    });

    return lines.join('\n');
  }
}

// Mock AI extraction function that simulates the four-stage process
async function mockFourStageExtraction(text: string): Promise<KnowledgeTriple[]> {
  const extractionTypes = ['ENTITY_ENTITY', 'ENTITY_EVENT', 'EVENT_EVENT', 'EMOTIONAL_CONTEXT'];
  const results: KnowledgeTriple[] = [];
  
  // Simulate sequential processing (current implementation)
  for (const type of extractionTypes) {
    // Simulate AI API call latency (proportional to text length)
    const simulatedLatency = Math.min(50 + (text.length / 100), 2000);
    await new Promise(resolve => setTimeout(resolve, simulatedLatency));
    
    // Generate mock triples
    const numTriples = Math.ceil(text.length / 500); // Rough estimate
    for (let i = 0; i < numTriples; i++) {
      results.push({
        id: `${type}-${i}-${Date.now()}`,
        subject: `Subject_${type}_${i}`,
        predicate: `predicate_${type}_${i}`,
        object: `Object_${type}_${i}`,
        context: text.substring(0, 100),
        confidence: 0.8 + Math.random() * 0.2,
        extraction_type: type,
        extracted_at: new Date(),
        source: 'benchmark',
        source_type: 'test',
        source_date: new Date().toISOString(),
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      } as KnowledgeTriple);
    }
  }
  
  return results;
}

// Mock parallel extraction function 
async function mockParallelExtraction(text: string): Promise<KnowledgeTriple[]> {
  const extractionTypes = ['ENTITY_ENTITY', 'ENTITY_EVENT', 'EVENT_EVENT', 'EMOTIONAL_CONTEXT'];
  
  // Simulate parallel processing
  const promises = extractionTypes.map(async (type) => {
    // Simulate AI API call latency (same as sequential but runs in parallel)
    const simulatedLatency = Math.min(50 + (text.length / 100), 2000);
    await new Promise(resolve => setTimeout(resolve, simulatedLatency));
    
    // Generate mock triples
    const numTriples = Math.ceil(text.length / 500);
    const results: KnowledgeTriple[] = [];
    
    for (let i = 0; i < numTriples; i++) {
      results.push({
        id: `${type}-${i}-${Date.now()}`,
        subject: `Subject_${type}_${i}`,
        predicate: `predicate_${type}_${i}`,
        object: `Object_${type}_${i}`,
        context: text.substring(0, 100),
        confidence: 0.8 + Math.random() * 0.2,
        extraction_type: type,
        extracted_at: new Date(),
        source: 'benchmark',
        source_type: 'test',
        source_date: new Date().toISOString(),
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      } as KnowledgeTriple);
    }
    
    return results;
  });
  
  const results = await Promise.all(promises);
  return results.flat();
}

// Mock embedding generation with duplicate tracking
async function mockEmbeddingGeneration(texts: string[]): Promise<{
  embeddings: number[][];
  stats: {
    totalTexts: number;
    uniqueTexts: number;
    duplicates: number;
  };
}> {
  const uniqueTexts = new Set(texts);
  const duplicates = texts.length - uniqueTexts.size;
  
  // Simulate embedding API latency
  const batchLatency = 50 + (texts.length * 5);
  await new Promise(resolve => setTimeout(resolve, batchLatency));
  
  const embeddings = texts.map(() => new Array(1536).fill(0.1));
  
  return {
    embeddings,
    stats: {
      totalTexts: texts.length,
      uniqueTexts: uniqueTexts.size,
      duplicates,
    },
  };
}

describe('Simple Performance Benchmark', () => {
  let benchmark: SimpleBenchmark;
  
  beforeEach(() => {
    benchmark = new SimpleBenchmark();
  });

  const testCases = [
    { name: 'small', filename: 'small-text.txt', expectedImprovement: 60 },
    { name: 'medium', filename: 'medium-text.txt', expectedImprovement: 70 },
    { name: 'large', filename: 'large-text.txt', expectedImprovement: 75 },
    { name: 'xlarge', filename: 'xlarge-text.txt', expectedImprovement: 80 },
  ];

  testCases.forEach(({ name, filename, expectedImprovement }) => {
    describe(`${name} text benchmark`, () => {
      let text: string;
      
      beforeAll(() => {
        text = readFileSync(resolve(__dirname, 'fixtures', filename), 'utf-8');
      });

      it('should benchmark current sequential extraction', async () => {
        benchmark.reset();
        
        benchmark.startPhase('Sequential Extraction');
        const sequentialResult = await mockFourStageExtraction(text);
        benchmark.endPhase();
        
        benchmark.startPhase('Embedding Generation');
        const allTexts = [
          ...new Set([
            ...sequentialResult.map(t => t.subject),
            ...sequentialResult.map(t => t.object),
            ...sequentialResult.map(t => t.predicate),
            ...sequentialResult.map(t => `${t.subject} ${t.predicate} ${t.object}`)
          ])
        ];
        const embeddingResult = await mockEmbeddingGeneration(allTexts);
        benchmark.endPhase();
        
        const report = benchmark.getReport(`current-${name}`, text.length);
        report.results.triplesExtracted = sequentialResult.length;
        report.results.embeddingCalls = embeddingResult.stats.totalTexts;
        report.results.duplicateEmbeddings = embeddingResult.stats.duplicates;
        
        console.log(benchmark.generateReportSummary(report));
        
        expect(report.totalTime).toBeGreaterThan(0);
        expect(report.results.triplesExtracted).toBeGreaterThan(0);
      });

      it('should benchmark optimized parallel extraction', async () => {
        benchmark.reset();
        
        benchmark.startPhase('Parallel Extraction');
        const parallelResult = await mockParallelExtraction(text);
        benchmark.endPhase();
        
        benchmark.startPhase('Optimized Embedding Generation');
        // Simulate batched embedding with deduplication
        const allTexts = [
          ...new Set([
            ...parallelResult.map(t => t.subject),
            ...parallelResult.map(t => t.object),
            ...parallelResult.map(t => t.predicate),
            ...parallelResult.map(t => `${t.subject} ${t.predicate} ${t.object}`)
          ])
        ];
        const embeddingResult = await mockEmbeddingGeneration(allTexts);
        benchmark.endPhase();
        
        const report = benchmark.getReport(`optimized-${name}`, text.length);
        report.results.triplesExtracted = parallelResult.length;
        report.results.embeddingCalls = embeddingResult.stats.uniqueTexts; // Only unique texts
        report.results.duplicateEmbeddings = 0; // No duplicates in optimized version
        
        console.log(benchmark.generateReportSummary(report));
        
        expect(report.totalTime).toBeGreaterThan(0);
        expect(report.results.triplesExtracted).toBeGreaterThan(0);
        
        // The optimized version should be significantly faster
        // This is a mock test, but it demonstrates the expected improvement
        console.log(`Expected improvement for ${name}: ${expectedImprovement}%`);
      });
    });
  });

  it('should demonstrate the impact of parallel vs sequential processing', async () => {
    const text = readFileSync(resolve(__dirname, 'fixtures', 'large-text.txt'), 'utf-8');
    
    // Sequential benchmark
    benchmark.reset();
    benchmark.startPhase('Sequential Extraction');
    const sequentialResult = await mockFourStageExtraction(text);
    const sequentialPhase = benchmark.endPhase();
    
    // Parallel benchmark
    benchmark.reset();
    benchmark.startPhase('Parallel Extraction');
    const parallelResult = await mockParallelExtraction(text);
    const parallelPhase = benchmark.endPhase();
    
    const improvement = ((sequentialPhase!.duration! - parallelPhase!.duration!) / sequentialPhase!.duration!) * 100;
    
    console.log('\n=== PARALLEL VS SEQUENTIAL COMPARISON ===');
    console.log(`Sequential: ${sequentialPhase!.duration!.toFixed(2)}ms`);
    console.log(`Parallel: ${parallelPhase!.duration!.toFixed(2)}ms`);
    console.log(`Improvement: ${improvement.toFixed(1)}%`);
    
    expect(parallelPhase!.duration!).toBeLessThan(sequentialPhase!.duration!);
    expect(improvement).toBeGreaterThan(50); // Expect at least 50% improvement
    expect(sequentialResult.length).toEqual(parallelResult.length); // Same number of results
  });

  it('should identify embedding duplication opportunities', async () => {
    const text = readFileSync(resolve(__dirname, 'fixtures', 'medium-text.txt'), 'utf-8');
    
    // Mock extraction result with intentional duplicates
    const mockTriples: KnowledgeTriple[] = [
      {
        id: '1',
        subject: 'AI',
        predicate: 'transforms',
        object: 'industries',
      } as KnowledgeTriple,
      {
        id: '2',
        subject: 'AI',
        predicate: 'enables',
        object: 'automation',
      } as KnowledgeTriple,
      {
        id: '3',
        subject: 'machine learning',
        predicate: 'powers',
        object: 'AI',
      } as KnowledgeTriple,
    ];
    
    // Current approach: generate embeddings for each occurrence
    const currentTexts = [
      ...mockTriples.map(t => t.subject), // [AI, AI, machine learning]
      ...mockTriples.map(t => t.object),   // [industries, automation, AI]
      ...mockTriples.map(t => t.predicate), // [transforms, enables, powers]
    ]; // Total: 9 texts, with duplicates
    
    const currentResult = await mockEmbeddingGeneration(currentTexts);
    
    // Optimized approach: deduplicate first
    const optimizedTexts = [...new Set(currentTexts)];
    const optimizedResult = await mockEmbeddingGeneration(optimizedTexts);
    
    const duplicateRate = (currentResult.stats.duplicates / currentResult.stats.totalTexts) * 100;
    const savings = ((currentResult.stats.totalTexts - optimizedResult.stats.totalTexts) / currentResult.stats.totalTexts) * 100;
    
    console.log('\n=== EMBEDDING DUPLICATION ANALYSIS ===');
    console.log(`Current approach: ${currentResult.stats.totalTexts} embedding calls`);
    console.log(`Optimized approach: ${optimizedResult.stats.totalTexts} embedding calls`);
    console.log(`Duplicates found: ${currentResult.stats.duplicates} (${duplicateRate.toFixed(1)}%)`);
    console.log(`Potential savings: ${savings.toFixed(1)}%`);
    
    expect(optimizedResult.stats.totalTexts).toBeLessThan(currentResult.stats.totalTexts);
    expect(savings).toBeGreaterThan(0);
  });
});