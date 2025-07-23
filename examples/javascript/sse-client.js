#!/usr/bin/env node

/**
 * Server-Sent Events (SSE) MCP Client Example
 *
 * This example demonstrates how to use the MCP protocol over HTTP/SSE.
 * This allows real-time communication using the standard MCP protocol
 * over HTTP instead of STDIO.
 *
 * Run with: node sse-client.js
 */

import { EventSource } from "eventsource";

class SSEMCPClient {
	constructor(options = {}) {
		this.baseUrl = options.baseUrl || "http://localhost:3000";
		this.mcpEndpoint = `${this.baseUrl}/api/mcp`;
		this.timeout = options.timeout || 30000;

		this.eventSource = null;
		this.messageId = 0;
		this.pendingRequests = new Map();
		this.isConnected = false;
		this.isInitialized = false;

		// Capability information
		this.serverInfo = null;
		this.availableTools = [];
	}

	async connect() {
		return new Promise((resolve, reject) => {
			console.log(`🔌 Connecting to SSE endpoint: ${this.mcpEndpoint}`);

			this.eventSource = new EventSource(this.mcpEndpoint);

			this.eventSource.onopen = () => {
				console.log("✅ SSE connection established");
				this.isConnected = true;
				this.initialize().then(resolve).catch(reject);
			};

			this.eventSource.onerror = (error) => {
				console.error("❌ SSE connection error:", error);
				this.isConnected = false;
				if (!this.isInitialized) {
					reject(new Error("Failed to establish SSE connection"));
				}
			};

			this.eventSource.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);
					this.handleMessage(message);
				} catch (error) {
					console.error("❌ Failed to parse SSE message:", error);
				}
			};

			// Connection timeout
			setTimeout(() => {
				if (!this.isConnected) {
					reject(new Error("SSE connection timeout"));
				}
			}, this.timeout);
		});
	}

	async initialize() {
		const initMessage = {
			jsonrpc: "2.0",
			id: ++this.messageId,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {
					experimental: {},
					sampling: {},
				},
				clientInfo: {
					name: "sse-example-client",
					version: "1.0.0",
				},
			},
		};

		console.log("📡 Sending initialize request...");
		const response = await this.sendRequest(initMessage);

		this.serverInfo = response.serverInfo;
		this.isInitialized = true;

		console.log("✅ MCP initialization completed");
		console.log(
			`   Server: ${this.serverInfo.name} v${this.serverInfo.version}`,
		);
		console.log(`   Protocol: ${response.protocolVersion}`);

		// List available tools
		await this.listTools();

		return response;
	}

	async listTools() {
		const toolsMessage = {
			jsonrpc: "2.0",
			id: ++this.messageId,
			method: "tools/list",
			params: {},
		};

		console.log("📋 Listing available tools...");
		const response = await this.sendRequest(toolsMessage);

		this.availableTools = response.tools;
		console.log("✅ Available tools:");
		this.availableTools.forEach((tool, index) => {
			console.log(`   ${index + 1}. ${tool.name}: ${tool.description}`);
		});

		return response;
	}

	async callTool(name, args = {}) {
		if (!this.isInitialized) {
			throw new Error("Client not initialized");
		}

		const toolMessage = {
			jsonrpc: "2.0",
			id: ++this.messageId,
			method: "tools/call",
			params: {
				name,
				arguments: args,
			},
		};

		console.log(`🔧 Calling tool: ${name}`);
		const response = await this.sendRequest(toolMessage);

		// Parse the result content
		if (response.content && response.content[0] && response.content[0].text) {
			try {
				return JSON.parse(response.content[0].text);
			} catch (error) {
				// Return raw content if it's not JSON
				return response.content[0].text;
			}
		}

		return response;
	}

	sendRequest(message) {
		return new Promise((resolve, reject) => {
			if (!this.isConnected) {
				reject(new Error("SSE connection not established"));
				return;
			}

			// Store the request for correlation
			this.pendingRequests.set(message.id, {
				resolve,
				reject,
				timestamp: Date.now(),
			});

			// Send the message via a separate HTTP POST request
			// (EventSource doesn't support sending data)
			fetch(this.mcpEndpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-MCP-Version": "2024-11-05",
				},
				body: JSON.stringify(message),
			}).catch((error) => {
				this.pendingRequests.delete(message.id);
				reject(error);
			});

			// Set timeout for individual requests
			setTimeout(() => {
				if (this.pendingRequests.has(message.id)) {
					this.pendingRequests.delete(message.id);
					reject(new Error(`Request timeout for message ID ${message.id}`));
				}
			}, this.timeout);
		});
	}

	handleMessage(message) {
		console.log(
			`📨 Received message: ${message.method || "response"} (ID: ${message.id})`,
		);

		// Handle responses to our requests
		if (message.id && this.pendingRequests.has(message.id)) {
			const { resolve, reject } = this.pendingRequests.get(message.id);
			this.pendingRequests.delete(message.id);

			if (message.error) {
				reject(
					new Error(
						`MCP Error: ${message.error.message} (${message.error.code})`,
					),
				);
			} else {
				resolve(message.result);
			}
			return;
		}

		// Handle server notifications
		if (message.method) {
			this.handleNotification(message);
			return;
		}

		console.log("📦 Unhandled message:", message);
	}

	handleNotification(notification) {
		console.log(`🔔 Server notification: ${notification.method}`);

		switch (notification.method) {
			case "notifications/initialized":
				console.log("✅ Server confirms initialization");
				break;
			case "notifications/cancelled":
				console.log("⚠️  Request cancelled:", notification.params);
				break;
			case "notifications/progress":
				console.log("📊 Progress update:", notification.params);
				break;
			default:
				console.log("📦 Unknown notification:", notification);
		}
	}

	async disconnect() {
		if (this.eventSource) {
			console.log("🔌 Disconnecting SSE connection...");
			this.eventSource.close();
			this.isConnected = false;
			this.isInitialized = false;
		}

		// Reject any pending requests
		for (const [id, { reject }] of this.pendingRequests) {
			reject(new Error("Connection closed"));
		}
		this.pendingRequests.clear();
	}

	// Convenience methods for common operations
	async processKnowledge(text, source, options = {}) {
		return this.callTool("process_knowledge", {
			text,
			source,
			thread_id: options.threadId,
			conversation_date: options.conversationDate || new Date().toISOString(),
			include_concepts: options.includeConcepts !== false,
			deduplicate: options.deduplicate !== false,
			processing_batch_id: options.batchId,
		});
	}

	async searchKnowledge(query, options = {}) {
		return this.callTool("search_knowledge_graph", {
			query,
			limit: options.limit || 10,
			threshold: options.threshold || 0.7,
			types: options.types,
			sources: options.sources,
		});
	}

	async searchConcepts(query, options = {}) {
		return this.callTool("search_concepts", {
			query,
			limit: options.limit || 10,
			threshold: options.threshold || 0.7,
		});
	}

	async storeTriples(triples) {
		return this.callTool("store_knowledge_triples", { triples });
	}

	async deduplicateTriples(triples) {
		return this.callTool("deduplicate_triples", { triples });
	}

	async getStats() {
		return this.callTool("get_knowledge_graph_stats", {});
	}

	async getEntities(options = {}) {
		return this.callTool("enumerate_entities", {
			role: options.role || "both",
			min_occurrence: options.minOccurrence || 1,
			limit: options.limit || 100,
			sort_by: options.sortBy || "frequency",
			sources: options.sources,
			types: options.types,
		});
	}
}

async function main() {
	const client = new SSEMCPClient({
		baseUrl: "http://localhost:3000",
		timeout: 30000,
	});

	try {
		console.log("🚀 Knowledge Graph MCP Server - SSE Client Example\n");

		// 1. Connect and initialize
		console.log("1. Connecting to SSE/MCP endpoint...");
		await client.connect();
		console.log();

		// 2. Process some knowledge
		console.log("2. Processing knowledge via MCP...");
		const processResult = await client.processKnowledge(
			"Emma is a UX designer at Figma. She has 5 years of experience in design systems and loves creating intuitive user interfaces. She recently gave a talk at a design conference about accessibility in digital products.",
			"sse_example",
			{
				threadId: "sse_demo_conversation",
				includeConcepts: true,
			},
		);

		console.log("✅ Knowledge processed via MCP:");
		console.log(`   Triples stored: ${processResult.triplesStored}`);
		console.log(`   Concepts: ${processResult.conceptsStored}`);
		console.log();

		// 3. Search the knowledge graph
		console.log("3. Searching knowledge graph via MCP...");
		const searchResult = await client.searchKnowledge(
			"UX designer Figma design systems accessibility",
			{
				limit: 5,
				threshold: 0.7,
			},
		);

		console.log("✅ Search results via MCP:");
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
		console.log("4. Searching concepts via MCP...");
		const conceptResult = await client.searchConcepts(
			"user experience design interface",
			{
				limit: 3,
				threshold: 0.75,
			},
		);

		console.log("✅ Concept search via MCP:");
		console.log(`   Found ${conceptResult.results.length} relevant concepts:`);
		conceptResult.results.forEach((result, index) => {
			console.log(
				`   ${index + 1}. ${result.concept.concept} (${result.concept.abstraction_level})`,
			);
			console.log(`      Similarity: ${result.similarity.toFixed(3)}`);
		});
		console.log();

		// 5. Get statistics
		console.log("5. Getting statistics via MCP...");
		const stats = await client.getStats();
		console.log("✅ Statistics via MCP:");
		console.log(`   Total triples: ${stats.totalTriples}`);
		console.log(`   Total concepts: ${stats.totalConcepts}`);
		console.log(`   Unique sources: ${stats.uniqueSources}`);
		console.log();

		// 6. Demonstrate batch operations
		console.log("6. Demonstrating batch operations...");
		const triplesToStore = [
			{
				subject: "Design Systems",
				predicate: "improves",
				object: "UI consistency",
				type: "entity-entity",
				source: "sse_batch_example",
				confidence: 0.9,
			},
			{
				subject: "Accessibility",
				predicate: "benefits",
				object: "all users",
				type: "entity-entity",
				source: "sse_batch_example",
				confidence: 0.95,
			},
		];

		const storeResult = await client.storeTriples(triplesToStore);
		console.log("✅ Batch store completed via MCP:");
		console.log(`   Stored ${storeResult.stored} triples`);
		console.log();

		console.log("🎉 SSE/MCP client example completed successfully!");
	} catch (error) {
		console.error("❌ Error:", error.message);

		if (error.message.includes("ECONNREFUSED")) {
			console.error(
				"💡 Make sure the Knowledge Graph MCP Server is running with HTTP transport enabled:",
			);
			console.error("   ENABLE_HTTP_TRANSPORT=true pnpm run dev:http");
		}

		process.exit(1);
	} finally {
		await client.disconnect();
	}
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\n🛑 Received SIGINT, shutting down gracefully...");
	process.exit(0);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});

// Run the example
main();
