#!/usr/bin/env npx tsx

/**
 * Test script to verify embedding service works in isolation
 */

import { config as dotenvConfig } from "dotenv";
import { createEmbeddingService } from "../src/shared/services/embedding-service.js";
import type { KnowledgeGraphConfig } from "../src/shared/types/index.js";

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

async function testEmbeddingService() {
	console.log("🧪 Testing Embedding Service in Isolation\n");

	try {
		// Initialize services
		const config = createConfig();
		const embeddingService = createEmbeddingService(config.embeddings);

		console.log("✅ Embedding service created");
		console.log(`📊 Configuration:`, {
			model: config.embeddings.model,
			dimensions: config.embeddings.dimensions,
			batchSize: config.embeddings.batchSize,
		});

		// Check environment variables
		console.log(`\n🔑 Environment Check:`);
		console.log(`   OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Missing"}`);
		console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "✅ Set" : "❌ Missing"}`);

		// Test single embedding
		console.log(`\n🔧 Test 1: Single embedding`);
		const testText = "Alice works on AI projects";
		console.log(`   Input: "${testText}"`);

		try {
			const singleResult = await embeddingService.embed(testText);
			console.log(`   Result:`, {
				success: singleResult.success,
				embeddingLength: singleResult.success ? singleResult.data.length : 0,
				error: singleResult.success ? null : singleResult.error,
			});

			if (singleResult.success) {
				console.log(`   Sample values: [${singleResult.data.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
			}
		} catch (error) {
			console.error(`   ❌ Single embedding error:`, error);
		}

		// Test batch embedding
		console.log(`\n🔧 Test 2: Batch embedding`);
		const testTexts = [
			"Alice works on AI projects",
			"Bob develops software applications", 
			"Charlie manages data science teams"
		];
		console.log(`   Input: ${testTexts.length} texts`);
		testTexts.forEach((text, i) => console.log(`      ${i + 1}. "${text}"`));

		try {
			const batchResult = await embeddingService.embedBatch(testTexts);
			console.log(`   Result:`, {
				success: batchResult.success,
				embeddingsCount: batchResult.success ? batchResult.data.length : 0,
				firstEmbeddingLength: batchResult.success && batchResult.data[0] ? batchResult.data[0].length : 0,
				error: batchResult.success ? null : batchResult.error,
			});

			if (batchResult.success && batchResult.data.length > 0) {
				console.log(`   Sample from first embedding: [${batchResult.data[0].slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`);
			}
		} catch (error) {
			console.error(`   ❌ Batch embedding error:`, error);
		}

		console.log(`\n🎉 Embedding service test complete!`);

	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testEmbeddingService().catch(console.error);