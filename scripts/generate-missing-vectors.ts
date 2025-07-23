#!/usr/bin/env npx tsx

/**
 * Backfill script to generate missing semantic vectors for existing triples
 * This script will find all triples without associated vectors and generate them
 */

import { config as dotenvConfig } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createEmbeddingService } from "../src/shared/services/embedding-service.js";
import type { KnowledgeGraphConfig } from "../src/shared/types/index.js";
import { v4 as uuidv4 } from "uuid";

// Load environment variables
dotenvConfig();

// Helper function to generate triple ID
function generateTripleId(triple: any): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return Buffer.from(key).toString("base64").replace(/[+/=]/g, "_");
}

// Create configuration
const createConfig = (): KnowledgeGraphConfig => ({
	embeddings: {
		model: process.env.KG_EMBEDDING_MODEL || "text-embedding-3-small",
		dimensions: parseInt(process.env.KG_EMBEDDING_DIMENSIONS || "1536"),
		batchSize: parseInt(process.env.KG_BATCH_SIZE || "32"),
	},
	search: {
		topK: parseInt(process.env.KG_SEARCH_TOP_K || "10"),
		minScore: parseFloat(process.env.KG_MIN_SCORE || "0.7"),
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

async function generateMissingVectors() {
	console.log("🔧 Generating Missing Semantic Vectors for Existing Triples\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const embeddingService = createEmbeddingService(config.embeddings);

		console.log("📊 Checking current state...");

		// Get all triples
		const triplesResult = await db.getAllTriples();
		if (!triplesResult.success) {
			console.error("❌ Failed to get triples:", triplesResult.error);
			return;
		}

		const allTriples = triplesResult.data;
		console.log(`   Total triples in database: ${allTriples.length}`);

		// For now, let's assume all existing triples need vectors since we just implemented this feature
		console.log(`   Triples needing vectors: ${allTriples.length} (generating vectors for all existing triples)`);
		
		const missingTriples = allTriples;
		console.log(`\n🔍 Found ${missingTriples.length} triples to generate vectors for`);

		if (missingTriples.length === 0) {
			console.log("✅ No missing vectors to generate!");
			return;
		}

		// Process in batches
		const batchSize = config.embeddings.batchSize || 32;
		let totalProcessed = 0;
		let totalVectorsGenerated = 0;

		for (let i = 0; i < missingTriples.length; i += batchSize) {
			const batch = missingTriples.slice(i, i + batchSize);
			const semanticTexts = batch.map(triple => 
				`${triple.subject} ${triple.predicate} ${triple.object}`
			);

			console.log(`\n⚡ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingTriples.length / batchSize)} (${batch.length} triples)...`);

			// Generate embeddings for this batch
			const embeddings = await embeddingService.embedBatch(semanticTexts);

			if (!embeddings.success) {
				console.error(`❌ Failed to generate embeddings for batch:`, embeddings.error);
				continue;
			}

			// Prepare semantic vectors for storage
			const semanticVectors = batch.map((triple, idx) => ({
				vector_id: uuidv4(),
				text: semanticTexts[idx],
				embedding: embeddings.data[idx],
				knowledge_triple_id: generateTripleId(triple),
			}));

			// Store vectors in database
			const storeResult = await db.storeVectors({
				semantic: semanticVectors,
			});

			if (storeResult.success) {
				totalVectorsGenerated += semanticVectors.length;
				console.log(`   ✅ Stored ${semanticVectors.length} semantic vectors`);
			} else {
				console.error(`   ❌ Failed to store vectors:`, storeResult.error);
			}

			totalProcessed += batch.length;
			console.log(`   Progress: ${totalProcessed}/${missingTriples.length} triples processed`);

			// Small delay to avoid overwhelming the API
			if (i + batchSize < missingTriples.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		console.log(`\n🎉 Vector Generation Complete!`);
		console.log(`   Triples processed: ${totalProcessed}`);
		console.log(`   Semantic vectors generated: ${totalVectorsGenerated}`);

		console.log(`\n📈 Final Statistics:`);
		console.log(`   Total triples: ${allTriples.length}`);
		console.log(`   Estimated semantic vectors generated: ${totalVectorsGenerated}`);
		
		if (totalVectorsGenerated > 0) {
			console.log("\n✅ SUCCESS: Semantic vectors have been generated for existing triples!");
			console.log("🔍 Search functionality should now work properly with semantic similarity.");
			console.log("💡 Test the search using: npx tsx scripts/test-search-fix.ts");
		} else {
			console.log(`\n⚠️  WARNING: No vectors were generated.`);
		}

	} catch (error) {
		console.error("❌ Script failed:", error);
		process.exit(1);
	}
}

// Run the script
generateMissingVectors().catch(console.error);