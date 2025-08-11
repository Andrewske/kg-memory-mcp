import type { 
  KnowledgeTriple, 
  ConceptNode, 
  Conceptualization,
  EntityVector,
  RelationshipVector,
  SemanticVector
} from '@prisma/client';

export interface MockDatabaseStats {
  triplesChecked: number;
  triplesStored: number;
  vectorsStored: number;
  conceptsStored: number;
  conceptualizationsStored: number;
  queriesExecuted: number;
  transactionCount: number;
}

export class MockDatabase {
  public triples: Map<string, KnowledgeTriple> = new Map();
  public concepts: Map<string, ConceptNode> = new Map();
  public conceptualizations: Map<string, Conceptualization> = new Map();
  public entityVectors: EntityVector[] = [];
  public relationshipVectors: RelationshipVector[] = [];
  public semanticVectors: SemanticVector[] = [];
  
  private stats: MockDatabaseStats = {
    triplesChecked: 0,
    triplesStored: 0,
    vectorsStored: 0,
    conceptsStored: 0,
    conceptualizationsStored: 0,
    queriesExecuted: 0,
    transactionCount: 0,
  };

  // Track timing for different operations
  private operationTimings: Map<string, number[]> = new Map();

  private trackTiming(operation: string, duration: number) {
    if (!this.operationTimings.has(operation)) {
      this.operationTimings.set(operation, []);
    }
    this.operationTimings.get(operation)!.push(duration);
  }

  async checkExistingTriples(tripleIds: string[]): Promise<string[]> {
    const start = performance.now();
    this.stats.triplesChecked += tripleIds.length;
    this.stats.queriesExecuted++;
    
    const existing = tripleIds.filter(id => this.triples.has(id));
    
    this.trackTiming('checkExistingTriples', performance.now() - start);
    return existing;
  }

  async storeTriples(triples: KnowledgeTriple[]): Promise<{ success: boolean; count: number }> {
    const start = performance.now();
    this.stats.transactionCount++;
    
    for (const triple of triples) {
      this.triples.set(triple.id, triple);
      this.stats.triplesStored++;
    }
    
    this.trackTiming('storeTriples', performance.now() - start);
    return { success: true, count: triples.length };
  }

  async storeEntityVectors(vectors: Omit<EntityVector, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    const start = performance.now();
    
    for (const vector of vectors) {
      this.entityVectors.push({
        ...vector,
        id: `entity-vector-${this.entityVectors.length}`,
        created_at: new Date(),
        updated_at: new Date(),
      } as EntityVector);
      this.stats.vectorsStored++;
    }
    
    this.trackTiming('storeEntityVectors', performance.now() - start);
  }

  async storeRelationshipVectors(vectors: Omit<RelationshipVector, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    const start = performance.now();
    
    for (const vector of vectors) {
      this.relationshipVectors.push({
        ...vector,
        id: `rel-vector-${this.relationshipVectors.length}`,
        created_at: new Date(),
        updated_at: new Date(),
      } as RelationshipVector);
      this.stats.vectorsStored++;
    }
    
    this.trackTiming('storeRelationshipVectors', performance.now() - start);
  }

  async storeSemanticVectors(vectors: Omit<SemanticVector, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    const start = performance.now();
    
    for (const vector of vectors) {
      this.semanticVectors.push({
        ...vector,
        id: `sem-vector-${this.semanticVectors.length}`,
        created_at: new Date(),
        updated_at: new Date(),
      } as SemanticVector);
      this.stats.vectorsStored++;
    }
    
    this.trackTiming('storeSemanticVectors', performance.now() - start);
  }

  async storeConcepts(concepts: ConceptNode[]): Promise<void> {
    const start = performance.now();
    
    for (const concept of concepts) {
      this.concepts.set(concept.id, concept);
      this.stats.conceptsStored++;
    }
    
    this.trackTiming('storeConcepts', performance.now() - start);
  }

  async storeConceptualizations(conceptualizations: Conceptualization[]): Promise<void> {
    const start = performance.now();
    
    for (const conceptualization of conceptualizations) {
      this.conceptualizations.set(conceptualization.id, conceptualization);
      this.stats.conceptualizationsStored++;
    }
    
    this.trackTiming('storeConceptualizations', performance.now() - start);
  }

  getStatistics(): MockDatabaseStats & { timings: Record<string, { count: number; avg: number; total: number }> } {
    const timings: Record<string, { count: number; avg: number; total: number }> = {};
    
    for (const [operation, times] of this.operationTimings.entries()) {
      const total = times.reduce((sum, t) => sum + t, 0);
      timings[operation] = {
        count: times.length,
        avg: total / times.length,
        total,
      };
    }
    
    return {
      ...this.stats,
      timings,
    };
  }

  reset() {
    this.triples.clear();
    this.concepts.clear();
    this.conceptualizations.clear();
    this.entityVectors = [];
    this.relationshipVectors = [];
    this.semanticVectors = [];
    this.stats = {
      triplesChecked: 0,
      triplesStored: 0,
      vectorsStored: 0,
      conceptsStored: 0,
      conceptualizationsStored: 0,
      queriesExecuted: 0,
      transactionCount: 0,
    };
    this.operationTimings.clear();
  }
}