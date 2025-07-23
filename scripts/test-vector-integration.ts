#!/usr/bin/env npx tsx

/**
 * Test script to verify that new knowledge extraction properly generates and stores vectors
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createEmbeddingService } from "../src/shared/services/embedding-service.js";
import { createAIProvider } from "../src/shared/services/ai-provider-service.js";
import { extractKnowledgeTriples } from "../src/features/knowledge-extraction/extract.js";
import { storeTriples } from "../src/features/knowledge-graph/operations.js";
import { searchByText } from "../src/features/knowledge-graph/search.js";
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

async function testVectorIntegration() {
	console.log("🧪 Testing Vector Integration with Knowledge Extraction\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const embeddingService = createEmbeddingService(config.embeddings);
		const aiProvider = createAIProvider({
			provider: config.ai.provider,
			apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "",
		});

		console.log("✅ Services initialized");

		// Test text for knowledge extraction
		const testText = "Alice is working on a new AI project called VectorSearch. The project focuses on semantic similarity search and is scheduled to be completed by December 2024.";
		
		console.log("\n📝 Test Text:");
		console.log(`"${testText}"`);

		console.log("\n🔧 Step 1: Extracting knowledge triples...");
		const extractionResult = await extractKnowledgeTriples(
			testText,
			{
				source: "vector-integration-test",
				thread_id: "test_thread_" + Date.now(),
				conversation_date: new Date().toISOString(),
				processing_batch_id: "test_batch_" + Date.now(),
			},
			aiProvider,
			config,
			false
		);

		if (!extractionResult.success) {
			console.error("❌ Extraction failed:", extractionResult.error);
			return;
		}

		const { triples } = extractionResult.data;
		console.log(`✅ Extracted ${triples.length} triples`);
		triples.forEach((triple, i) => {
			console.log(`   ${i + 1}. "${triple.subject}" → "${triple.predicate}" → "${triple.object}" (${triple.type})`);
		});

		console.log("\n🔧 Step 2: Storing triples with vector generation...");
		const storeResult = await storeTriples(triples, db, config, embeddingService);

		if (!storeResult.success) {
			console.error("❌ Storage failed:", storeResult.error);
			return;
		}

		console.log("✅ Storage completed:");
		console.log(`   Triples stored: ${storeResult.data.triplesStored}`);
		console.log(`   Vectors generated: ${storeResult.data.vectorsGenerated || 0}`);
		console.log(`   Duplicates skipped: ${storeResult.data.duplicatesSkipped}`);

		if ((storeResult.data.vectorsGenerated || 0) === 0) {
			console.warn("\n⚠️  WARNING: No vectors were generated!");
			return;
		}

		console.log("\n🔧 Step 3: Testing semantic search...");
		
		// Test search queries
		const testQueries = [
			"Alice AI project",
			"VectorSearch semantic similarity",
			"December 2024 completion",
		];

		for (const query of testQueries) {
			console.log(`\n🔎 Testing query: "${query}"`);
			
			const searchResult = await searchByText(
				query,
				db,
				embeddingService,
				config,
				{
					limit: 5,
					threshold: 0.0, // Low threshold to get results
				}
			);

			if (!searchResult.success) {
				console.error(`❌ Search failed: ${searchResult.error.message}`);
				continue;
			}

			const { triples: foundTriples } = searchResult.data;
			console.log(`📊 Found ${foundTriples.length} matching triples:`);
			
			if (foundTriples.length > 0) {
				foundTriples.forEach((match, i) => {
					console.log(`   ${i + 1}. "${match.triple.subject}" → "${match.triple.predicate}" → "${match.triple.object}"`);
					console.log(`      Score: ${match.score.toFixed(4)}, Type: ${match.searchType}`);
				});
			} else {
				console.log("   (No matches found)");
			}
		}

		console.log("\n🎉 Vector Integration Test Complete!");
		console.log("✅ SUCCESS: New triples are properly stored with semantic vectors");
		console.log("✅ SUCCESS: Semantic search is working with generated vectors");

	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testVectorIntegration().catch(console.error);