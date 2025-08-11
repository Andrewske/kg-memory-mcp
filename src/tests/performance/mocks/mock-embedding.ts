export interface EmbeddingStats {
  totalCalls: number;
  totalTexts: number;
  uniqueTexts: number;
  duplicates: number;
  batchSizes: number[];
  totalTime: number;
}

export class MockEmbeddingService {
  private callCount = 0;
  private totalTexts = 0;
  private uniqueTexts = new Set<string>();
  private duplicates = 0;
  private batchSizes: number[] = [];
  private callTimings: number[] = [];
  private textToEmbedding = new Map<string, number[]>();

  async embedBatch(texts: string[]): Promise<number[][]> {
    const start = performance.now();
    
    this.callCount++;
    this.batchSizes.push(texts.length);
    this.totalTexts += texts.length;
    
    const embeddings: number[][] = [];
    
    for (const text of texts) {
      if (this.uniqueTexts.has(text)) {
        this.duplicates++;
        // Return the same embedding for duplicate text
        embeddings.push(this.textToEmbedding.get(text)!);
      } else {
        this.uniqueTexts.add(text);
        // Generate a deterministic mock embedding based on text
        const embedding = this.generateMockEmbedding(text);
        this.textToEmbedding.set(text, embedding);
        embeddings.push(embedding);
      }
    }
    
    const duration = performance.now() - start;
    this.callTimings.push(duration);
    
    // Simulate API latency (proportional to batch size)
    await this.simulateLatency(texts.length);
    
    return embeddings;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0];
  }

  private generateMockEmbedding(text: string): number[] {
    // Generate a deterministic 1536-dimensional embedding
    const embedding = new Array(1536);
    let hash = 0;
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    for (let i = 0; i < 1536; i++) {
      // Use hash to generate pseudo-random values
      hash = ((hash * 1103515245) + 12345) & 0x7fffffff;
      embedding[i] = (hash / 0x7fffffff) * 2 - 1; // Normalize to [-1, 1]
    }
    
    return embedding;
  }

  private async simulateLatency(batchSize: number): Promise<void> {
    // Simulate realistic API latency
    // Base latency + per-item latency
    const baseLatency = 50; // ms
    const perItemLatency = 5; // ms
    const totalLatency = baseLatency + (batchSize * perItemLatency);
    
    if (process.env.MOCK_REALISTIC_LATENCY === 'true') {
      await new Promise(resolve => setTimeout(resolve, totalLatency));
    }
  }

  getStatistics(): EmbeddingStats {
    const totalTime = this.callTimings.reduce((sum, t) => sum + t, 0);
    
    return {
      totalCalls: this.callCount,
      totalTexts: this.totalTexts,
      uniqueTexts: this.uniqueTexts.size,
      duplicates: this.duplicates,
      batchSizes: [...this.batchSizes],
      totalTime,
    };
  }

  getDuplicateDetails(): Map<string, number> {
    const duplicateCounts = new Map<string, number>();
    
    for (const text of this.textToEmbedding.keys()) {
      // Count how many times each text was requested
      // (This is simplified - in reality we'd track each request)
      duplicateCounts.set(text, 1);
    }
    
    return duplicateCounts;
  }

  reset() {
    this.callCount = 0;
    this.totalTexts = 0;
    this.uniqueTexts.clear();
    this.duplicates = 0;
    this.batchSizes = [];
    this.callTimings = [];
    this.textToEmbedding.clear();
  }
}