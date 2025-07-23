#!/usr/bin/env npx tsx

/**
 * Test script to verify token tracking functionality
 * This script will:
 * 1. Process some knowledge with the MCP server
 * 2. Query the token usage from the database
 * 3. Display comprehensive token tracking results
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { createDatabaseAdapter } from "../src/shared/database/database-adapter.js";
import { createAIProvider } from "../src/shared/services/ai-provider-service.js";
import { createTokenTrackingService } from "../src/shared/services/token-tracking-service.js";
import { createTrackedAIProvider } from "../src/shared/services/tracked-ai-provider.js";
import { extractKnowledgeTriples } from "../src/features/knowledge-extraction/extract.js";
import type { KnowledgeGraphConfig } from "../src/shared/types/index.js";

// Load environment variables
config();

const prisma = new PrismaClient();

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

async function testTokenTracking() {
	console.log("🧪 Testing Token Tracking Functionality...\n");

	try {
		// Initialize services
		const config = createConfig();
		const db = createDatabaseAdapter(config.database);
		const baseAIProvider = createAIProvider(config.ai);
		const tokenTracker = createTokenTrackingService(db);

		// Create tracked AI provider
		const trackedAIProvider = createTrackedAIProvider(
			baseAIProvider,
			tokenTracker,
			{
				provider: config.ai.provider,
				model: config.ai.model,
			},
		);

		// Test text for knowledge extraction
		const testText = `
			John Smith is the CEO of TechCorp, a leading technology company based in Silicon Valley. 
			He founded the company in 2015 after leaving his position at Google. Under his leadership, 
			TechCorp has grown to over 500 employees and achieved a valuation of $2 billion. 
			John is passionate about artificial intelligence and believes it will transform every industry.
			He recently announced a partnership with Stanford University to research autonomous systems.
		`;

		const testThreadId = `test_thread_${Date.now()}`;
		const testBatchId = `test_batch_${Date.now()}`;

		console.log("📝 Extracting knowledge from test text...");
		console.log(`   Thread ID: ${testThreadId}`);
		console.log(`   Batch ID: ${testBatchId}`);
		console.log(`   AI Provider: ${config.ai.provider}`);
		console.log(`   Model: ${config.ai.model}\n`);

		// Extract knowledge using tracked AI provider
		const startTime = Date.now();
		const extractionResult = await extractKnowledgeTriples(
			testText,
			{
				source: "test_script",
				thread_id: testThreadId,
				processing_batch_id: testBatchId,
			},
			trackedAIProvider,
			config,
			false,
		);
		const endTime = Date.now();

		if (!extractionResult.success) {
			console.error("❌ Extraction failed:", extractionResult.error);
			return;
		}

		console.log(`✅ Extraction completed in ${endTime - startTime}ms`);
		console.log(
			`   Extracted ${extractionResult.data.triples.length} triples\n`,
		);

		// Give some time for background token logging
		console.log("⏳ Waiting for token tracking to complete...");
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Query token usage from database
		console.log("📊 Querying token usage from database...\n");

		const tokenUsageResult = await db.getTokenUsage({
			thread_id: testThreadId,
		});

		if (!tokenUsageResult.success) {
			console.error("❌ Failed to query token usage:", tokenUsageResult.error);
			return;
		}

		const tokenUsages = tokenUsageResult.data;
		console.log(`Found ${tokenUsages.length} token usage record(s)\n`);

		// Display detailed token usage
		for (const usage of tokenUsages) {
			console.log("🎯 Token Usage Details:");
			console.log("─".repeat(50));
			console.log(`Thread ID:        ${usage.thread_id}`);
			console.log(`Operation:        ${usage.operation_type}`);
			console.log(`Provider:         ${usage.provider}`);
			console.log(`Model:            ${usage.model}`);
			console.log(`\nStandard Tokens:`);
			console.log(`  Input:          ${usage.input_tokens}`);
			console.log(`  Output:         ${usage.output_tokens}`);
			console.log(`  Total:          ${usage.total_tokens}`);

			// Display advanced tokens if present
			if (
				usage.thinking_tokens ||
				usage.cached_read_tokens ||
				usage.cached_write_tokens
			) {
				console.log(`\nAdvanced Tokens:`);
				if (usage.thinking_tokens)
					console.log(`  Thinking:       ${usage.thinking_tokens}`);
				if (usage.reasoning_tokens)
					console.log(`  Reasoning:      ${usage.reasoning_tokens}`);
				if (usage.cached_read_tokens)
					console.log(`  Cached Read:    ${usage.cached_read_tokens}`);
				if (usage.cached_write_tokens)
					console.log(`  Cached Write:   ${usage.cached_write_tokens}`);
			}

			console.log(`\nPerformance:`);
			console.log(`  Duration:       ${usage.duration_ms || 0}ms`);
			console.log(
				`  Estimated Cost: $${Number(usage.estimated_cost || 0).toFixed(6)}`,
			);
			console.log(`  Timestamp:      ${usage.timestamp}`);

			if (usage.reasoning_steps) {
				console.log(
					`\nReasoning Steps: ${Array.isArray(usage.reasoning_steps) ? usage.reasoning_steps.length : 0}`,
				);
			}

			console.log("─".repeat(50));
		}

		// Calculate totals
		if (tokenUsages.length > 0) {
			const totals = tokenUsages.reduce(
				(acc, usage) => ({
					input: acc.input + usage.input_tokens,
					output: acc.output + usage.output_tokens,
					total: acc.total + usage.total_tokens,
					cost: acc.cost + (Number(usage.estimated_cost) || 0),
					duration: acc.duration + usage.duration_ms,
				}),
				{ input: 0, output: 0, total: 0, cost: 0, duration: 0 },
			);

			console.log("\n📈 Session Totals:");
			console.log("─".repeat(50));
			console.log(`Total Input Tokens:  ${totals.input}`);
			console.log(`Total Output Tokens: ${totals.output}`);
			console.log(`Total Tokens:        ${totals.total}`);
			console.log(`Total Cost:          $${totals.cost.toFixed(6)}`);
			console.log(`Total Duration:      ${totals.duration}ms`);
			console.log("─".repeat(50));
		}

		// Test token tracking service directly
		console.log("\n🧪 Testing Token Tracking Service Methods...\n");

		// Calculate cost for a hypothetical usage
		const testUsage = {
			input_tokens: 1000,
			output_tokens: 500,
			thinking_tokens: 200,
			cached_read_tokens: 100,
		};

		const calculatedCost = tokenTracker.calculateCost(
			testUsage,
			config.ai.provider,
			config.ai.model,
		);

		console.log("💰 Cost Calculation Test:");
		console.log(`   Model: ${config.ai.provider}/${config.ai.model}`);
		console.log(`   Input: ${testUsage.input_tokens} tokens`);
		console.log(`   Output: ${testUsage.output_tokens} tokens`);
		if (testUsage.thinking_tokens)
			console.log(`   Thinking: ${testUsage.thinking_tokens} tokens`);
		if (testUsage.cached_read_tokens)
			console.log(`   Cached Read: ${testUsage.cached_read_tokens} tokens`);
		console.log(`   Calculated Cost: $${calculatedCost.toFixed(6)}`);

		console.log("\n✅ Token tracking test completed successfully!");
	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

// Run the test
testTokenTracking().catch(console.error);
