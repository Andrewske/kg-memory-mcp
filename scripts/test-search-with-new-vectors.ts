#!/usr/bin/env npx tsx

/**
 * Test script to verify search works with the vectors we just generated
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createEmbeddingService } from "../src/shared/services/embedding-service.js";
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
		minScore: parseFloat(process.env.KG_MIN_SCORE || "0.1"), // Lower threshold
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

async function testSearchWithNewVectors() {
	console.log("🔍 Testing Search with Newly Generated Vectors\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const embeddingService = createEmbeddingService(config.embeddings);

		console.log("✅ Services initialized");

		// Test searches for the content we just added
		const testQueries = [
			"TestUser VectorTesting project",
			"semantic vector generation",
			"works on project",
			"VectorTesting focuses semantic"
		];

		for (const query of testQueries) {
			console.log(`\n🔎 Testing query: "${query}"`);
			console.log("─".repeat(60));

			const searchResult = await searchByText(
				query,
				db,
				embeddingService,
				config,
				{
					limit: 5,
					threshold: 0.0, // Very low threshold to see any matches
				}
			);

			if (!searchResult.success) {
				console.log(`❌ Search failed: ${searchResult.error.message}`);
				continue;
			}

			const { triples, concepts } = searchResult.data;
			console.log(`📊 Results: ${triples.length} triples, ${concepts.length} concepts`);

			if (triples.length > 0) {
				console.log(`\n✅ SUCCESS: Found matching triples!`);
				triples.forEach((match, i) => {
					console.log(`   ${i + 1}. "${match.triple.subject}" → "${match.triple.predicate}" → "${match.triple.object}"`);
					console.log(`      Score: ${match.score.toFixed(4)}, Type: ${match.searchType}, Source: ${match.triple.source}`);
				});
			} else {
				console.log(`\n⚠️  No matching triples found`);
			}

			if (concepts.length > 0) {
				console.log(`\n📝 Found concepts:`);
				concepts.forEach((match, i) => {
					console.log(`   ${i + 1}. "${match.concept.concept}" (${match.concept.abstraction_level})`);
					console.log(`      Score: ${match.score.toFixed(4)}`);
				});
			}
		}

		console.log(`\n🎉 Search test complete!`);

		// Check total vector count
		console.log(`\n📊 Vector Statistics:`);
		console.log("─".repeat(60));
		
		// We should now have at least 8 more vectors than before
		// (The original 32 broken ones plus our new 8 working ones = at least 40)

	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testSearchWithNewVectors().catch(console.error);