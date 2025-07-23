/**
 * Server-Sent Events (SSE) MCP Client for Browser
 *
 * This module provides SSE/MCP functionality for real-time communication
 * with the Knowledge Graph MCP Server over HTTP.
 */

class BrowserSSEMCPClient {
	constructor(baseUrl = "http://localhost:3000") {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.mcpEndpoint = `${this.baseUrl}/api/mcp`;
		this.eventSource = null;
		this.messageId = 0;
		this.pendingRequests = new Map();
		this.isConnected = false;
		this.isInitialized = false;
		this.serverInfo = null;
		this.availableTools = [];

		// Event handlers
		this.onConnectionChange = null;
		this.onMessage = null;
		this.onError = null;
	}

	async connect() {
		return new Promise((resolve, reject) => {
			console.log("🔌 Connecting to SSE endpoint:", this.mcpEndpoint);

			try {
				this.eventSource = new EventSource(this.mcpEndpoint);

				this.eventSource.onopen = () => {
					console.log("✅ SSE connection established");
					this.isConnected = true;
					if (this.onConnectionChange) {
						this.onConnectionChange(true);
					}
					this.initialize().then(resolve).catch(reject);
				};

				this.eventSource.onerror = (error) => {
					console.error("❌ SSE connection error:", error);
					this.isConnected = false;
					if (this.onConnectionChange) {
						this.onConnectionChange(false);
					}
					if (this.onError) {
						this.onError(error);
					}
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
				}, 10000);
			} catch (error) {
				reject(error);
			}
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
					name: "browser-sse-client",
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
		console.log(
			"✅ Available tools:",
			this.availableTools.map((t) => t.name),
		);

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
				method: message.method,
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
			}, 30000);
		});
	}

	handleMessage(message) {
		console.log(
			`📨 Received message: ${message.method || "response"} (ID: ${message.id})`,
		);

		if (this.onMessage) {
			this.onMessage(message);
		}

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

	disconnect() {
		if (this.eventSource) {
			console.log("🔌 Disconnecting SSE connection...");
			this.eventSource.close();
			this.isConnected = false;
			this.isInitialized = false;

			if (this.onConnectionChange) {
				this.onConnectionChange(false);
			}
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

	async getStats() {
		return this.callTool("get_knowledge_graph_stats", {});
	}
}

// Global SSE client instance
let sseClient = null;

// SSE UI Functions
function updateSSEStatus(message, type = "info") {
	const statusEl = document.getElementById("sseStatus");
	statusEl.style.display = "block";
	statusEl.className = `status ${type}`;
	statusEl.textContent = message;
}

function displaySSEResponse(data, error = null) {
	const element = document.getElementById("sseResponse");
	element.style.display = "block";

	if (error) {
		element.style.color = "#721c24";
		element.style.backgroundColor = "#f8d7da";
		element.textContent = `SSE Error: ${error.message}`;
	} else {
		element.style.color = "#333";
		element.style.backgroundColor = "#f8f9fa";
		element.textContent = JSON.stringify(data, null, 2);
	}
}

async function connectSSE() {
	try {
		const serverUrl = document
			.getElementById("serverUrl")
			.value.replace("/api", "");
		sseClient = new BrowserSSEMCPClient(serverUrl);

		// Set up event handlers
		sseClient.onConnectionChange = (connected) => {
			if (connected) {
				updateSSEStatus("✅ SSE connection established", "success");
				document.getElementById("sseTestBtn").disabled = false;
			} else {
				updateSSEStatus("❌ SSE connection lost", "error");
				document.getElementById("sseTestBtn").disabled = true;
			}
		};

		sseClient.onMessage = (message) => {
			console.log("SSE Message received:", message);
		};

		sseClient.onError = (error) => {
			updateSSEStatus(`❌ SSE error: ${error.message}`, "error");
		};

		updateSSEStatus("🔌 Connecting to SSE endpoint...", "info");

		await sseClient.connect();

		updateSSEStatus(
			"✅ SSE/MCP connection established and initialized",
			"success",
		);
		displaySSEResponse({
			connected: true,
			serverInfo: sseClient.serverInfo,
			availableTools: sseClient.availableTools.map((t) => t.name),
		});
	} catch (error) {
		updateSSEStatus(`❌ SSE connection failed: ${error.message}`, "error");
		displaySSEResponse(null, error);
		document.getElementById("sseTestBtn").disabled = true;
	}
}

function disconnectSSE() {
	if (sseClient) {
		sseClient.disconnect();
		sseClient = null;
		updateSSEStatus("🔌 SSE connection closed", "info");
		document.getElementById("sseTestBtn").disabled = true;
	}
}

async function testSSEKnowledge() {
	if (!sseClient || !sseClient.isInitialized) {
		updateSSEStatus("❌ SSE client not connected", "error");
		return;
	}

	try {
		updateSSEStatus("🔧 Processing knowledge via SSE/MCP...", "info");

		const result = await sseClient.processKnowledge(
			"Emma is a UX designer at Figma. She specializes in design systems and has 5 years of experience creating user interfaces. She recently spoke at a design conference about accessibility.",
			"sse_web_example",
			{
				threadId: "sse_web_demo",
				includeConcepts: true,
			},
		);

		updateSSEStatus("✅ Knowledge processed via SSE/MCP", "success");
		displaySSEResponse(result);

		// Also search for the processed knowledge
		setTimeout(async () => {
			try {
				const searchResult = await sseClient.searchKnowledge(
					"UX designer Figma design systems",
					{ limit: 3, threshold: 0.7 },
				);

				displaySSEResponse({
					processResult: result,
					searchResult: searchResult,
				});
			} catch (searchError) {
				console.error("SSE search error:", searchError);
			}
		}, 1000);
	} catch (error) {
		updateSSEStatus(
			`❌ SSE knowledge processing failed: ${error.message}`,
			"error",
		);
		displaySSEResponse(null, error);
	}
}

// Clean up SSE connection when page unloads
window.addEventListener("beforeunload", () => {
	if (sseClient) {
		sseClient.disconnect();
	}
});
