#!/usr/bin/env npx tsx

/**
 * Test script with completely new triples to verify vector generation
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createEmbeddingService } from "../src/shared/services/embedding-service.js";
import { storeTriples } from "../src/features/knowledge-graph/operations.js";
import type { KnowledgeTriple, KnowledgeGraphConfig } from "../src/shared/types/index.js";

// Load environment variables
dotenvConfig();

// Create configuration
const createConfig = (): KnowledgeGraphConfig => ({
	embeddings: {
		model: process.env.KG_EMBEDDING_MODEL || "text-embedding-3-small",
		dimensions: parseInt(process.env.KG_EMBEDDING_DIMENSIONS || "1536"),
		batchSize: parseInt(process.env.KG_BATCH_SIZE || "32"),
	},
	search: {
		topK: parseInt(process.env.KG_SEARCH_TOP_K || "10"),
		minScore: parseFloat(process.env.KG_MIN_SCORE || "0.3"),
	},
	database: {
		url: process.env.DATABASE_URL || "",
		maxConnections: parseInt(process.env.KG_DB_MAX_CONNECTIONS || "10"),
		timeout: parseInt(process.env.KG_DB_CONNECTION_TIMEOUT || "5000"),
	},
	extraction: {
		extractionMethod: "single-pass",
		delayBetweenTypes: parseInt(process.env.KG_DELAY_BETWEEN_TYPES || "2000"),
		maxChunkTokens: parseInt(process.env.KG_MAX_CHUNK_TOKENS || "1500"),
		model: process.env.KG_EXTRACTION_MODEL || "gpt-4o-mini",
		temperature: parseFloat(process.env.KG_EXTRACTION_TEMPERATURE || "0.1"),
	},
	deduplication: {
		enableSemanticDeduplication:
			process.env.KG_ENABLE_SEMANTIC_DEDUP === "true",
		semanticSimilarityThreshold: parseFloat(
			process.env.KG_SEMANTIC_SIMILARITY_THRESHOLD || "0.85",
		),
		exactMatchFields: ["subject", "predicate", "object", "type"],
	},
	ai: {
		provider:
			(process.env.KNOWLEDGE_GRAPH_AI_PROVIDER as "openai" | "anthropic") ||
			"openai",
		model: process.env.KNOWLEDGE_GRAPH_AI_MODEL || "gpt-4o-mini",
		temperature: parseFloat(process.env.KG_AI_TEMPERATURE || "0.1"),
		maxTokens: parseInt(process.env.KG_AI_MAX_TOKENS || "4096"),
	},
});

async function testCompletelyNewTriples() {
	console.log("🧪 Testing Completely New Triples for Vector Generation\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const embeddingService = createEmbeddingService(config.embeddings);

		console.log("✅ Services initialized");

		// Create completely unique triples with timestamp to avoid duplicates
		const timestamp = Date.now();
		const testTriples: KnowledgeTriple[] = [
			{
				subject: `NewTestUser_${timestamp}`,
				predicate: "discovers",
				object: `VectorFix_${timestamp}`,
				type: "entity-entity",
				source: `vector-fix-test-${timestamp}`,
				thread_id: `test-thread-${timestamp}`,
				extracted_at: new Date().toISOString(),
				processing_batch_id: `batch-${timestamp}`,
				confidence: 0.95,
			},
			{
				subject: `VectorFix_${timestamp}`,
				predicate: "enables",
				object: `ProperEmbeddings_${timestamp}`,
				type: "entity-entity",
				source: `vector-fix-test-${timestamp}`,
				thread_id: `test-thread-${timestamp}`,
				extracted_at: new Date().toISOString(),
				processing_batch_id: `batch-${timestamp}`,
				confidence: 0.92,
			},
			{
				subject: `ProperEmbeddings_${timestamp}`,
				predicate: "improves",
				object: `SearchQuality_${timestamp}`,
				type: "entity-entity",
				source: `vector-fix-test-${timestamp}`,
				thread_id: `test-thread-${timestamp}`,
				extracted_at: new Date().toISOString(),
				processing_batch_id: `batch-${timestamp}`,
				confidence: 0.88,
			},
		];

		console.log(`📝 Created ${testTriples.length} completely unique test triples:`);
		testTriples.forEach((triple, i) => {
			console.log(`   ${i + 1}. "${triple.subject}" → "${triple.predicate}" → "${triple.object}"`);
		});

		// Store triples with vector generation
		console.log(`\n🔧 Storing triples with vector generation...`);
		const storeResult = await storeTriples(testTriples, db, config, embeddingService);

		console.log(`\n📊 Storage Result:`, {
			success: storeResult.success,
			data: storeResult.success ? storeResult.data : null,
			error: storeResult.success ? null : storeResult.error,
		});

		if (!storeResult.success) {
			console.log(`❌ Storage failed:`, storeResult.error);
			return;
		}

		const { triplesStored, vectorsGenerated } = storeResult.data;
		console.log(`\n🎉 Processing Complete!`);
		console.log(`   ✅ New triples stored: ${triplesStored}`);
		console.log(`   ✅ Vectors generated: ${vectorsGenerated || 0}`);

		if (vectorsGenerated && vectorsGenerated > 0) {
			console.log(`\n🔥 SUCCESS: Vector generation is working!`);
			console.log(`   - Expected ~${testTriples.length * 4} vectors (entity + relationship + semantic for each triple)`);
			console.log(`   - Got: ${vectorsGenerated} vectors`);
			
			// Expected breakdown for 3 triples:
			// - 6 unique entities (NewTestUser, VectorFix, ProperEmbeddings, SearchQuality) = ~6 entity vectors
			// - 3 unique relationships (discovers, enables, improves) = ~3 relationship vectors  
			// - 3 semantic vectors (one per triple) = 3 semantic vectors
			// Total expected: ~12 vectors
			
			if (vectorsGenerated >= 9) {  // Allow some flexibility
				console.log(`   ✅ Vector count looks correct for all vector types!`);
			} else {
				console.log(`   ⚠️  Vector count seems low - may be missing some vector types`);
			}
		} else {
			console.log(`\n❌ PROBLEM: No vectors were generated despite successful triple storage`);
		}

	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testCompletelyNewTriples().catch(console.error);