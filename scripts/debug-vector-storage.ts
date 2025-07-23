#!/usr/bin/env npx tsx

/**
 * Debug script to test vector storage directly
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import type { KnowledgeGraphConfig } from "../src/shared/types/index.js";
import { v4 as uuidv4 } from "uuid";

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

async function debugVectorStorage() {
	console.log("🐛 Debug Vector Storage Directly\n");

	try {
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);

		console.log("✅ Database adapter created");

		// Create a test vector with correct 1536 dimensions
		const testVectorId = `test-vector-${Date.now()}`;
		const testTripleId = "test-triple-" + Date.now();
		const testEmbedding = Array(1536).fill(0).map((_, i) => i / 1536); // 1536 dimensions with test values
		
		console.log(`\n🧪 Test Vector Details:`);
		console.log(`   Vector ID: ${testVectorId}`);
		console.log(`   Triple ID: ${testTripleId}`);
		console.log(`   Embedding: [${testEmbedding.join(', ')}]`);
		console.log(`   Embedding length: ${testEmbedding.length}`);

		// Test just semantic vector storage
		const vectorsToStore = {
			semantic: [{
				vector_id: testVectorId,
				text: "test semantic text",
				embedding: testEmbedding,
				knowledge_triple_id: testTripleId,
			}]
		};

		console.log(`\n🔧 Calling db.storeVectors()...`);
		console.log(`   Input data:`, vectorsToStore);

		const storeResult = await db.storeVectors(vectorsToStore);

		console.log(`\n📊 Storage Result:`, {
			success: storeResult.success,
			error: storeResult.success ? null : storeResult.error
		});

		if (storeResult.success) {
			console.log(`\n✅ Storage claimed success - let's verify what was actually stored...`);

			// Check what was actually stored using direct Prisma query
			const prisma = (db as any).db;
			const storedVector = await prisma.semanticVector.findUnique({
				where: {
					vectorId: testVectorId
				}
			});

			if (storedVector) {
				console.log(`\n📝 Stored Vector Found:`);
				console.log(`   ID: ${storedVector.id}`);
				console.log(`   Vector ID: ${storedVector.vectorId}`);
				console.log(`   Text: "${storedVector.text}"`);
				console.log(`   Knowledge Triple ID: ${storedVector.knowledgeTripleId}`);
				console.log(`   Raw embedding: ${storedVector.embedding}`);
				
				if (storedVector.embedding) {
					try {
						const parsedEmbedding = JSON.parse(storedVector.embedding);
						console.log(`   Parsed embedding length: ${parsedEmbedding.length}`);
						console.log(`   Parsed values: [${parsedEmbedding.slice(0, 5).join(', ')}...]`);
					} catch (e) {
						console.error(`   ❌ Failed to parse embedding:`, e);
					}
				} else {
					console.log(`   ⚠️  Embedding is null/undefined`);
				}
			} else {
				console.log(`\n❌ Vector not found in database!`);
			}
		}

	} catch (error) {
		console.error("❌ Debug failed:", error);
		process.exit(1);
	}
}

// Run the debug
debugVectorStorage().catch(console.error);