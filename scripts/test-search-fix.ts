#!/usr/bin/env npx tsx

/**
 * Test script to verify the search_knowledge_graph fix
 * This script will test the search functionality to ensure it returns triples instead of just concepts
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createAIProvider } from "../src/shared/services/ai-provider-service.js";
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
		minScore: parseFloat(process.env.KG_MIN_SCORE || "0.3"), // Lower threshold for testing
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

async function testSearchFix() {
	console.log("🔍 Testing Search Knowledge Graph Fix...\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const embeddingService = createEmbeddingService(config.embeddings);

		console.log("🔧 Configuration:");
		console.log(`   Search topK: ${config.search.topK}`);
		console.log(`   Search minScore: ${config.search.minScore}`);
		console.log(`   AI Provider: ${config.ai.provider}`);
		console.log(`   Embedding Model: ${config.embeddings.model}`);
		console.log(`   Using AutoSchemaKG Multi-Index Fusion Search\n`);

		// Test search queries that should find knowledge triples
		const testQueries = [
			"projects work priorities deadlines",
			"current tasks user should be working on",
			"Kevin Bonanza work focus",
			"artificial intelligence technology",
		];

		for (const query of testQueries) {
			console.log(`🔎 Testing query: "${query}"`);
			console.log("─".repeat(60));

			const searchResult = await searchByText(
				query,
				db,
				embeddingService,
				config,
				{
					limit: 10,
					threshold: 0.3, // Lower threshold to get more results
				},
			);

			if (!searchResult.success) {
				console.log(`❌ Search failed: ${searchResult.error.message}\n`);
				continue;
			}

			const { triples, concepts, temporal } = searchResult.data;

			console.log(`📊 Results:`);
			console.log(`   Triples found: ${triples.length}`);
			console.log(`   Concepts found: ${concepts.length}`);

			if (triples.length > 0) {
				console.log(
					`\n✅ SUCCESS: Found triples via ${triples[0].searchType} search!`,
				);
				console.log(
					`   Top triple: "${triples[0].triple.subject}" → "${triples[0].triple.predicate}" → "${triples[0].triple.object}"`,
				);
				console.log(`   Score: ${triples[0].score.toFixed(4)}`);
				console.log(`   Search type: ${triples[0].searchType}`);
				console.log(`   Triple type: ${triples[0].triple.type}`);
				console.log(`   Source: ${triples[0].triple.source}`);
			} else {
				console.log(`\n❌ No relevant knowledge triples found`);
				console.log(
					`   Note: Concepts were used within fusion search to discover triples`,
				);
			}

			if (concepts.length > 0) {
				console.log(
					`\n⚠️  UNEXPECTED: Concepts returned separately (should be empty in new implementation)`,
				);
			}

			if (temporal) {
				console.log(
					`   Temporal data: ${temporal.dateRange?.earliest} to ${temporal.dateRange?.latest}`,
				);
			}

			console.log("");
		}

		// Test database statistics
		console.log("📈 Database Statistics:");
		console.log("─".repeat(60));

		const tripleCount = await db.getTripleCount();
		const conceptCount = await db.getConceptCount();

		console.log(`   Total triples: ${tripleCount}`);
		console.log(`   Total concepts: ${conceptCount}`);

		if (tripleCount === 0) {
			console.log(
				`\n⚠️  WARNING: No triples in database. Search will only return concepts.`,
			);
			console.log(
				`   Recommendation: Add some knowledge triples first using process_knowledge tool.`,
			);
		}

		console.log("\n✅ Search fix test completed!");
	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testSearchFix().catch(console.error);
