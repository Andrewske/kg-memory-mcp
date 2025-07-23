#!/usr/bin/env npx tsx

/**
 * Test script to debug new knowledge processing with vector generation
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createEmbeddingService } from "../src/shared/services/embedding-service.js";
import { storeTriples } from "../src/features/knowledge-graph/operations.js";
import type { KnowledgeGraphConfig, KnowledgeTriple } from "../src/shared/types/index.js";

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

async function testNewKnowledgeDebug() {
	console.log("🐛 Testing New Knowledge Processing with Debug Logging\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const embeddingService = createEmbeddingService(config.embeddings);

		console.log("✅ Services initialized");
		console.log(`📊 Embedding service type: ${typeof embeddingService}`);
		console.log(`📊 Database adapter type: ${typeof db}`);

		// Create test triples manually (avoiding AI extraction issues)
		const testTriples: KnowledgeTriple[] = [
			{
				subject: "TestUser",
				predicate: "works on",
				object: "VectorTesting project",
				type: "entity-entity",
				source: "debug-test",
				thread_id: "debug_" + Date.now(),
				conversation_date: new Date().toISOString(),
				extracted_at: new Date().toISOString(),
				processing_batch_id: "debug_batch_" + Date.now(),
				confidence: 0.95,
			},
			{
				subject: "VectorTesting project",
				predicate: "focuses on", 
				object: "semantic vector generation",
				type: "entity-entity",
				source: "debug-test",
				thread_id: "debug_" + Date.now(),
				conversation_date: new Date().toISOString(),
				extracted_at: new Date().toISOString(),
				processing_batch_id: "debug_batch_" + Date.now(),
				confidence: 0.90,
			}
		];

		console.log(`\n📝 Test Triples Created (${testTriples.length}):`);
		testTriples.forEach((triple, i) => {
			console.log(`   ${i + 1}. "${triple.subject}" → "${triple.predicate}" → "${triple.object}" (${triple.type})`);
		});

		console.log(`\n🔧 Calling storeTriples with embedding service...`);
		console.log(`   - Config provided: ${!!config}`);
		console.log(`   - Database provided: ${!!db}`);
		console.log(`   - Embedding service provided: ${!!embeddingService}`);
		console.log(`   - Triples count: ${testTriples.length}`);

		// This should trigger all the debug logging we added
		const storeResult = await storeTriples(testTriples, db, config, embeddingService);

		console.log(`\n📊 Store Result:`, {
			success: storeResult.success,
			triplesStored: storeResult.success ? storeResult.data.triplesStored : 0,
			vectorsGenerated: storeResult.success ? storeResult.data.vectorsGenerated : 0,
			duplicatesSkipped: storeResult.success ? storeResult.data.duplicatesSkipped : 0,
			error: storeResult.success ? null : storeResult.error,
		});

		if (storeResult.success) {
			const { triplesStored, vectorsGenerated, duplicatesSkipped } = storeResult.data;
			console.log(`\n🎉 Storage Complete!`);
			console.log(`   ✅ Triples stored: ${triplesStored}`);
			console.log(`   ✅ Vectors generated: ${vectorsGenerated || 0}`);
			console.log(`   ⏭️  Duplicates skipped: ${duplicatesSkipped}`);

			if ((vectorsGenerated || 0) > 0) {
				console.log(`\n🎉 SUCCESS: Vector integration is working!`);
			} else {
				console.log(`\n⚠️  WARNING: No vectors were generated despite successful storage`);
			}
		} else {
			console.error(`\n❌ Storage failed:`, storeResult.error);
		}

	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testNewKnowledgeDebug().catch(console.error);