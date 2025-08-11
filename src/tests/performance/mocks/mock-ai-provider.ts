import type { KnowledgeTriple, ConceptNode } from '@prisma/client';

export interface AIProviderStats {
  totalCalls: number;
  callsByType: Record<string, number>;
  totalTokensUsed: number;
  totalTime: number;
  averageLatency: number;
}

export class MockAIProvider {
  private callCount = 0;
  private callsByType: Record<string, number> = {};
  private totalTokensUsed = 0;
  private callTimings: number[] = [];

  async extractTriples(
    text: string,
    extractionType: 'ENTITY_ENTITY' | 'ENTITY_EVENT' | 'EVENT_EVENT' | 'EMOTIONAL_CONTEXT',
    options?: any
  ): Promise<KnowledgeTriple[]> {
    const start = performance.now();
    
    this.callCount++;
    this.callsByType[extractionType] = (this.callsByType[extractionType] || 0) + 1;
    
    // Estimate tokens (rough approximation)
    const estimatedTokens = Math.ceil(text.length / 4);
    this.totalTokensUsed += estimatedTokens;
    
    // Generate mock triples based on extraction type
    const triples = this.generateMockTriples(text, extractionType);
    
    // Simulate API latency
    await this.simulateLatency(estimatedTokens);
    
    const duration = performance.now() - start;
    this.callTimings.push(duration);
    
    return triples;
  }

  async generateConcepts(
    text: string,
    metadata?: any
  ): Promise<ConceptNode[]> {
    const start = performance.now();
    
    this.callCount++;
    this.callsByType['conceptualization'] = (this.callsByType['conceptualization'] || 0) + 1;
    
    // Estimate tokens
    const estimatedTokens = Math.ceil(text.length / 4);
    this.totalTokensUsed += estimatedTokens;
    
    // Generate mock concepts
    const concepts = this.generateMockConcepts(text);
    
    // Simulate API latency
    await this.simulateLatency(estimatedTokens);
    
    const duration = performance.now() - start;
    this.callTimings.push(duration);
    
    return concepts;
  }

  private generateMockTriples(
    text: string,
    extractionType: string
  ): KnowledgeTriple[] {
    const triples: KnowledgeTriple[] = [];
    
    // Generate a reasonable number of triples based on text length
    const numTriples = Math.min(Math.ceil(text.length / 200), 10);
    
    for (let i = 0; i < numTriples; i++) {
      const triple: KnowledgeTriple = {
        id: `${extractionType}-${i}-${Date.now()}`,
        subject: `Subject_${extractionType}_${i}`,
        predicate: `predicate_${extractionType}_${i}`,
        object: `Object_${extractionType}_${i}`,
        context: text.substring(0, 100),
        confidence: 0.8 + Math.random() * 0.2,
        extraction_type: extractionType,
        extracted_at: new Date(),
        source: 'test',
        source_type: 'benchmark',
        source_date: new Date().toISOString(),
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      };
      
      triples.push(triple);
    }
    
    return triples;
  }

  private generateMockConcepts(text: string): ConceptNode[] {
    const concepts: ConceptNode[] = [];
    
    // Generate concepts at different abstraction levels
    const levels = ['high', 'medium', 'low'];
    
    for (const level of levels) {
      for (let i = 0; i < 2; i++) {
        const concept: ConceptNode = {
          id: `concept-${level}-${i}-${Date.now()}`,
          name: `Concept_${level}_${i}`,
          description: `A ${level}-level concept extracted from the text`,
          abstraction_level: level as 'high' | 'medium' | 'low',
          category: 'general',
          confidence: 0.7 + Math.random() * 0.3,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        
        concepts.push(concept);
      }
    }
    
    return concepts;
  }

  private async simulateLatency(tokens: number): Promise<void> {
    // Simulate realistic API latency based on token count
    // Roughly 50ms base + 0.5ms per token
    const latency = 50 + (tokens * 0.5);
    
    if (process.env.MOCK_REALISTIC_LATENCY === 'true') {
      await new Promise(resolve => setTimeout(resolve, latency));
    }
  }

  getStatistics(): AIProviderStats {
    const totalTime = this.callTimings.reduce((sum, t) => sum + t, 0);
    const averageLatency = this.callTimings.length > 0 
      ? totalTime / this.callTimings.length 
      : 0;
    
    return {
      totalCalls: this.callCount,
      callsByType: { ...this.callsByType },
      totalTokensUsed: this.totalTokensUsed,
      totalTime,
      averageLatency,
    };
  }

  reset() {
    this.callCount = 0;
    this.callsByType = {};
    this.totalTokensUsed = 0;
    this.callTimings = [];
  }
}