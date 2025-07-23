#!/usr/bin/env node

/**
 * Simple HTTP Client Example for Knowledge Graph MCP Server
 *
 * This example demonstrates basic usage of the HTTP API endpoints.
 * Run with: node simple-client.js
 */

const API_BASE_URL = "http://localhost:3000/api";

async function makeRequest(endpoint, options = {}) {
	const url = `${API_BASE_URL}${endpoint}`;
	const response = await fetch(url, {
		headers: {
			"Content-Type": "application/json",
			"X-MCP-Version": "2024-11-05",
			...options.headers,
		},
		...options,
	});

	const data = await response.json();

	if (!response.ok) {
		throw new Error(
			`HTTP ${response.status}: ${data.error?.message || "Request failed"}`,
		);
	}

	if (!data.success) {
		throw new Error(`API Error: ${data.error?.message || "Unknown error"}`);
	}

	return data.data;
}

async function main() {
	try {
		console.log("🚀 Knowledge Graph MCP Server - Simple Client Example\n");

		// 1. Check server health
		console.log("1. Checking server health...");
		const health = await makeRequest("/health");
		console.log("✅ Server is healthy:", health.status);
		console.log("   Database:", health.database.status);
		console.log("   AI Provider:", health.aiProvider.status);
		console.log();

		// 2. Process some knowledge
		console.log("2. Processing knowledge...");
		const processResult = await makeRequest("/process-knowledge", {
			method: "POST",
			body: JSON.stringify({
				text: "Alice is a software engineer at OpenAI. She specializes in machine learning and has been working on language models for 3 years. She loves Python programming and recently published a paper on transformer architectures.",
				source: "simple_client_example",
				thread_id: "demo_conversation",
				include_concepts: true,
				deduplicate: true,
			}),
		});
		console.log("✅ Knowledge processed successfully:");
		console.log(`   Triples stored: ${processResult.triplesStored}`);
		console.log(`   Concepts: ${processResult.conceptsStored}`);
		console.log();

		// 3. Search the knowledge graph
		console.log("3. Searching knowledge graph...");
		const searchResult = await makeRequest("/search-knowledge", {
			method: "POST",
			body: JSON.stringify({
				query: "software engineer machine learning Python",
				limit: 5,
				threshold: 0.7,
			}),
		});
		console.log("✅ Search completed:");
		console.log(`   Found ${searchResult.results.length} relevant triples:`);
		searchResult.results.forEach((result, index) => {
			console.log(
				`   ${index + 1}. ${result.triple.subject} → ${result.triple.predicate} → ${result.triple.object}`,
			);
			console.log(
				`      Similarity: ${result.similarity.toFixed(3)} | Source: ${result.triple.source}`,
			);
		});
		console.log();

		// 4. Search concepts
		console.log("4. Searching concepts...");
		const conceptResult = await makeRequest("/search-concepts", {
			method: "POST",
			body: JSON.stringify({
				query: "artificial intelligence programming",
				limit: 3,
				threshold: 0.75,
			}),
		});
		console.log("✅ Concept search completed:");
		console.log(`   Found ${conceptResult.results.length} relevant concepts:`);
		conceptResult.results.forEach((result, index) => {
			console.log(
				`   ${index + 1}. ${result.concept.concept} (${result.concept.abstraction_level})`,
			);
			console.log(`      Similarity: ${result.similarity.toFixed(3)}`);
		});
		console.log();

		// 5. Get statistics
		console.log("5. Getting knowledge graph statistics...");
		const stats = await makeRequest("/stats");
		console.log("✅ Statistics retrieved:");
		console.log(`   Total triples: ${stats.totalTriples}`);
		console.log(`   Total concepts: ${stats.totalConcepts}`);
		console.log(`   Unique sources: ${stats.uniqueSources}`);
		console.log(`   Unique entities: ${stats.uniqueEntities}`);
		console.log();

		// 6. Enumerate entities
		console.log("6. Enumerating entities...");
		const entities = await makeRequest("/entities?limit=10&sort_by=frequency");
		console.log("✅ Top entities by frequency:");
		entities.entities.slice(0, 5).forEach((entity, index) => {
			console.log(
				`   ${index + 1}. ${entity.entity} (appears ${entity.frequency} times)`,
			);
		});
		console.log();

		console.log("🎉 All operations completed successfully!");
	} catch (error) {
		console.error("❌ Error:", error.message);
		process.exit(1);
	}
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});

// Run the example
main();
