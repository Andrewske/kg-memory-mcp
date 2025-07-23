#!/usr/bin/env node

/**
 * Advanced HTTP Client Example for Knowledge Graph MCP Server
 *
 * This example demonstrates advanced features including:
 * - Comprehensive error handling
 * - Retry logic with exponential backoff
 * - Rate limiting handling
 * - Connection pooling
 * - Batch processing
 * - Performance monitoring
 *
 * Run with: node advanced-client.js
 */

class KnowledgeGraphClient {
	constructor(options = {}) {
		this.baseUrl = options.baseUrl || "http://localhost:3000/api";
		this.timeout = options.timeout || 30000;
		this.maxRetries = options.maxRetries || 3;
		this.retryDelay = options.retryDelay || 1000;
		this.apiKey = options.apiKey;

		// Performance tracking
		this.stats = {
			requests: 0,
			errors: 0,
			totalTime: 0,
			retries: 0,
		};
	}

	async makeRequest(endpoint, options = {}, retryCount = 0) {
		const startTime = Date.now();
		this.stats.requests++;

		const url = `${this.baseUrl}${endpoint}`;
		const requestOptions = {
			timeout: this.timeout,
			headers: {
				"Content-Type": "application/json",
				"X-MCP-Version": "2024-11-05",
				"User-Agent": "KnowledgeGraph-Advanced-Client/1.0.0",
				...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
				...options.headers,
			},
			...options,
		};

		try {
			console.log(`📡 ${options.method || "GET"} ${endpoint}`);

			const response = await fetch(url, requestOptions);
			const data = await response.json();

			// Track timing
			const duration = Date.now() - startTime;
			this.stats.totalTime += duration;

			// Handle rate limiting
			if (response.status === 429) {
				const retryAfter = parseInt(
					response.headers.get("Retry-After") || "60",
				);
				console.log(`⏳ Rate limited. Waiting ${retryAfter} seconds...`);
				await this.sleep(retryAfter * 1000);
				return this.makeRequest(endpoint, options, retryCount);
			}

			// Handle other HTTP errors
			if (!response.ok) {
				const error = new Error(
					`HTTP ${response.status}: ${data.error?.message || "Request failed"}`,
				);
				error.status = response.status;
				error.code = data.error?.code;
				error.details = data.error?.details;
				throw error;
			}

			// Handle API errors
			if (!data.success) {
				const error = new Error(
					`API Error: ${data.error?.message || "Unknown error"}`,
				);
				error.code = data.error?.code;
				error.details = data.error?.details;
				throw error;
			}

			console.log(`✅ Request completed in ${duration}ms`);
			return data.data;
		} catch (error) {
			this.stats.errors++;
			const duration = Date.now() - startTime;
			this.stats.totalTime += duration;

			// Retry logic for certain errors
			if (retryCount < this.maxRetries && this.shouldRetry(error)) {
				this.stats.retries++;
				const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
				console.log(
					`🔄 Retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms: ${error.message}`,
				);
				await this.sleep(delay);
				return this.makeRequest(endpoint, options, retryCount + 1);
			}

			console.log(`❌ Request failed after ${duration}ms: ${error.message}`);
			throw error;
		}
	}

	shouldRetry(error) {
		// Retry on network errors, timeouts, and 5xx errors (but not 4xx)
		return (
			error.code === "ENOTFOUND" ||
			error.code === "ECONNRESET" ||
			error.code === "ETIMEDOUT" ||
			(error.status >= 500 && error.status < 600)
		);
	}

	async sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async healthCheck() {
		return this.makeRequest("/health");
	}

	async processKnowledge(text, source, options = {}) {
		return this.makeRequest("/process-knowledge", {
			method: "POST",
			body: JSON.stringify({
				text,
				source,
				thread_id: options.threadId,
				conversation_date: options.conversationDate || new Date().toISOString(),
				include_concepts: options.includeConcepts !== false,
				deduplicate: options.deduplicate !== false,
				processing_batch_id: options.batchId,
			}),
		});
	}

	async searchKnowledge(query, options = {}) {
		return this.makeRequest("/search-knowledge", {
			method: "POST",
			body: JSON.stringify({
				query,
				limit: options.limit || 10,
				threshold: options.threshold || 0.7,
				types: options.types,
				sources: options.sources,
			}),
		});
	}

	async searchConcepts(query, options = {}) {
		return this.makeRequest("/search-concepts", {
			method: "POST",
			body: JSON.stringify({
				query,
				limit: options.limit || 10,
				threshold: options.threshold || 0.7,
			}),
		});
	}

	async storeTriples(triples) {
		return this.makeRequest("/store-triples", {
			method: "POST",
			body: JSON.stringify({ triples }),
		});
	}

	async deduplicateTriples(triples) {
		return this.makeRequest("/deduplicate", {
			method: "POST",
			body: JSON.stringify({ triples }),
		});
	}

	async getStats() {
		return this.makeRequest("/stats");
	}

	async getEntities(options = {}) {
		const params = new URLSearchParams();
		if (options.role) params.set("role", options.role);
		if (options.minOccurrence)
			params.set("min_occurrence", options.minOccurrence);
		if (options.limit) params.set("limit", options.limit);
		if (options.sortBy) params.set("sort_by", options.sortBy);
		if (options.sources) params.set("sources", options.sources.join(","));
		if (options.types) params.set("types", options.types.join(","));

		const query = params.toString();
		return this.makeRequest(`/entities${query ? "?" + query : ""}`);
	}

	async getVersion() {
		return this.makeRequest("/version");
	}

	async getMetrics() {
		return this.makeRequest("/metrics");
	}

	async getCapabilities() {
		return this.makeRequest("/capabilities");
	}

	// Batch processing with concurrency control
	async processBatch(items, processor, options = {}) {
		const concurrency = options.concurrency || 3;
		const results = [];
		const errors = [];

		console.log(
			`📦 Processing batch of ${items.length} items with concurrency ${concurrency}`,
		);

		for (let i = 0; i < items.length; i += concurrency) {
			const chunk = items.slice(i, i + concurrency);
			const promises = chunk.map(async (item, index) => {
				try {
					const result = await processor(item, i + index);
					return { success: true, index: i + index, result };
				} catch (error) {
					return { success: false, index: i + index, error: error.message };
				}
			});

			const chunkResults = await Promise.all(promises);

			for (const result of chunkResults) {
				if (result.success) {
					results.push(result);
				} else {
					errors.push(result);
					console.log(`❌ Batch item ${result.index} failed: ${result.error}`);
				}
			}

			// Progress update
			console.log(
				`📊 Progress: ${Math.min(i + concurrency, items.length)}/${items.length} items processed`,
			);

			// Rate limiting pause between chunks
			if (i + concurrency < items.length) {
				await this.sleep(100);
			}
		}

		console.log(
			`✅ Batch completed: ${results.length} succeeded, ${errors.length} failed`,
		);
		return { results, errors };
	}

	getPerformanceStats() {
		const avgResponseTime =
			this.stats.requests > 0 ? this.stats.totalTime / this.stats.requests : 0;
		const errorRate =
			this.stats.requests > 0
				? (this.stats.errors / this.stats.requests) * 100
				: 0;

		return {
			totalRequests: this.stats.requests,
			totalErrors: this.stats.errors,
			totalRetries: this.stats.retries,
			averageResponseTime: Math.round(avgResponseTime),
			errorRate: Math.round(errorRate * 100) / 100,
			totalTime: this.stats.totalTime,
		};
	}

	resetStats() {
		this.stats = {
			requests: 0,
			errors: 0,
			totalTime: 0,
			retries: 0,
		};
	}
}

async function main() {
	const client = new KnowledgeGraphClient({
		baseUrl: "http://localhost:3000/api",
		timeout: 30000,
		maxRetries: 3,
		retryDelay: 1000,
	});

	try {
		console.log("🚀 Knowledge Graph MCP Server - Advanced Client Example\n");

		// 1. Health check
		console.log("1. Performing health check...");
		const health = await client.healthCheck();
		console.log("✅ Server health:", health.status);
		console.log();

		// 2. Get server information
		console.log("2. Getting server information...");
		const [version, capabilities, metrics] = await Promise.all([
			client.getVersion(),
			client.getCapabilities(),
			client.getMetrics(),
		]);
		console.log("✅ Server version:", version.version);
		console.log(
			"✅ Available tools:",
			capabilities.tools.map((t) => t.name).join(", "),
		);
		console.log("✅ Server metrics:", {
			uptime: metrics.uptime,
			memoryUsage: `${Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024)}MB`,
		});
		console.log();

		// 3. Batch processing example
		console.log("3. Demonstrating batch processing...");
		const texts = [
			"John is a data scientist at Google. He loves Python and machine learning.",
			"Sarah works at Microsoft as a software engineer. She specializes in cloud computing.",
			"Alex is a product manager at Apple. He focuses on user experience design.",
			"Maria is a researcher at Stanford University. She studies artificial intelligence.",
			"David is a DevOps engineer at Amazon. He works with containerization and Kubernetes.",
		];

		const batchResult = await client.processBatch(
			texts,
			async (text, index) => {
				return await client.processKnowledge(text, `batch_example_${index}`, {
					threadId: "advanced_demo",
					includeConcepts: true,
				});
			},
			{ concurrency: 2 },
		);

		console.log(
			`✅ Batch processing completed: ${batchResult.results.length} items processed`,
		);
		console.log();

		// 4. Advanced search with multiple criteria
		console.log("4. Performing advanced search...");
		const searchResults = await client.searchKnowledge(
			"software engineer data scientist machine learning",
			{
				limit: 10,
				threshold: 0.6,
				types: ["entity-entity", "entity-event"],
				sources: ["batch_example_0", "batch_example_1", "batch_example_3"],
			},
		);

		console.log(
			`✅ Advanced search found ${searchResults.results.length} results`,
		);
		searchResults.results.slice(0, 3).forEach((result, index) => {
			console.log(
				`   ${index + 1}. ${result.triple.subject} → ${result.triple.predicate} → ${result.triple.object}`,
			);
			console.log(
				`      Score: ${result.similarity.toFixed(3)} | Type: ${result.triple.type}`,
			);
		});
		console.log();

		// 5. Entity analysis
		console.log("5. Analyzing entities...");
		const entities = await client.getEntities({
			role: "both",
			minOccurrence: 1,
			limit: 20,
			sortBy: "frequency",
		});

		console.log("✅ Top entities by frequency:");
		entities.entities.slice(0, 5).forEach((entity, index) => {
			console.log(
				`   ${index + 1}. "${entity.entity}" (${entity.frequency} occurrences)`,
			);
		});
		console.log();

		// 6. Concept exploration
		console.log("6. Exploring concepts...");
		const concepts = await client.searchConcepts(
			"technology software programming",
			{
				limit: 5,
				threshold: 0.7,
			},
		);

		console.log("✅ Related concepts:");
		concepts.results.forEach((result, index) => {
			console.log(
				`   ${index + 1}. ${result.concept.concept} (${result.concept.abstraction_level})`,
			);
			console.log(`      Similarity: ${result.similarity.toFixed(3)}`);
		});
		console.log();

		// 7. Performance statistics
		console.log("7. Performance statistics:");
		const stats = client.getPerformanceStats();
		console.log("✅ Client performance:");
		console.log(`   Total requests: ${stats.totalRequests}`);
		console.log(`   Average response time: ${stats.averageResponseTime}ms`);
		console.log(`   Error rate: ${stats.errorRate}%`);
		console.log(`   Total retries: ${stats.totalRetries}`);
		console.log();

		console.log("🎉 Advanced client example completed successfully!");
	} catch (error) {
		console.error("❌ Critical error:", error.message);
		if (error.details) {
			console.error("📝 Error details:", error.details);
		}
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Received SIGINT, shutting down gracefully...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
	process.exit(0);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});

// Run the example
main();
