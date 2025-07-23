/**
 * Knowledge Graph MCP Server - Web Client
 *
 * This JavaScript file provides HTTP client functionality for the browser.
 * It demonstrates how to interact with the Knowledge Graph MCP Server
 * HTTP API from a web application.
 */

class KnowledgeGraphWebClient {
	constructor(baseUrl = "http://localhost:3000/api") {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.isConnected = false;
	}

	async makeRequest(endpoint, options = {}) {
		const url = `${this.baseUrl}${endpoint}`;
		const requestOptions = {
			headers: {
				"Content-Type": "application/json",
				"X-MCP-Version": "2024-11-05",
				"X-MCP-Client-Name": "web-client",
				"X-MCP-Client-Version": "1.0.0",
				...options.headers,
			},
			...options,
		};

		try {
			const response = await fetch(url, requestOptions);
			const data = await response.json();

			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status}: ${data.error?.message || "Request failed"}`,
				);
			}

			if (!data.success && data.success !== undefined) {
				throw new Error(`API Error: ${data.error?.message || "Unknown error"}`);
			}

			return data.data || data;
		} catch (error) {
			if (error.name === "TypeError" && error.message.includes("fetch")) {
				throw new Error(
					"Network error: Cannot connect to server. Please check if the server is running.",
				);
			}
			throw error;
		}
	}

	async healthCheck() {
		return this.makeRequest("/health");
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

		const query = params.toString();
		return this.makeRequest(`/entities${query ? "?" + query : ""}`);
	}
}

// Global client instance
let client = new KnowledgeGraphWebClient();

// UI Helper Functions
function showLoading() {
	document.getElementById("loading").classList.add("show");
}

function hideLoading() {
	document.getElementById("loading").classList.remove("show");
}

function showStatus(message, type = "info") {
	// Create or update status element
	let statusEl = document.querySelector(".status.current");
	if (!statusEl) {
		statusEl = document.createElement("div");
		statusEl.className = `status ${type} current`;
		document
			.querySelector(".main")
			.insertBefore(statusEl, document.querySelector(".main").firstChild);
	} else {
		statusEl.className = `status ${type} current`;
	}

	statusEl.textContent = message;

	// Auto-hide after 5 seconds
	setTimeout(() => {
		if (statusEl.parentNode) {
			statusEl.remove();
		}
	}, 5000);
}

function updateConnectionStatus(connected) {
	const statusEl = document.getElementById("connectionStatus");
	if (connected) {
		statusEl.textContent = "Connected";
		statusEl.className = "connection-status connected";
		client.isConnected = true;
	} else {
		statusEl.textContent = "Disconnected";
		statusEl.className = "connection-status disconnected";
		client.isConnected = false;
	}
}

function displayResponse(elementId, data, error = null) {
	const element = document.getElementById(elementId);
	element.style.display = "block";

	if (error) {
		element.style.color = "#721c24";
		element.style.backgroundColor = "#f8d7da";
		element.textContent = `Error: ${error.message}`;
	} else {
		element.style.color = "#333";
		element.style.backgroundColor = "#f8f9fa";
		element.textContent = JSON.stringify(data, null, 2);
	}
}

function formatNumber(num) {
	return new Intl.NumberFormat().format(num);
}

// API Functions
async function checkConnection() {
	showLoading();

	try {
		const serverUrl = document.getElementById("serverUrl").value;
		client = new KnowledgeGraphWebClient(serverUrl);

		const health = await client.healthCheck();

		updateConnectionStatus(true);
		showStatus("✅ Successfully connected to server", "success");
		displayResponse("connectionResponse", health);
	} catch (error) {
		updateConnectionStatus(false);
		showStatus(`❌ Connection failed: ${error.message}`, "error");
		displayResponse("connectionResponse", null, error);
	}

	hideLoading();
}

async function getServerInfo() {
	if (!client.isConnected) {
		showStatus("Please check connection first", "error");
		return;
	}

	showLoading();

	try {
		const [version, capabilities, metrics] = await Promise.all([
			client.getVersion(),
			client.getCapabilities(),
			client.getMetrics(),
		]);

		const serverInfo = {
			version: version,
			capabilities: capabilities,
			metrics: metrics,
		};

		showStatus("✅ Server information retrieved", "success");
		displayResponse("connectionResponse", serverInfo);
	} catch (error) {
		showStatus(`❌ Failed to get server info: ${error.message}`, "error");
		displayResponse("connectionResponse", null, error);
	}

	hideLoading();
}

async function processKnowledge() {
	if (!client.isConnected) {
		showStatus("Please check connection first", "error");
		return;
	}

	const text = document.getElementById("knowledgeText").value;
	const source = document.getElementById("knowledgeSource").value;
	const includeConcepts = document.getElementById("includeConcepts").checked;

	if (!text.trim() || !source.trim()) {
		showStatus("Please enter both text and source", "error");
		return;
	}

	showLoading();

	try {
		const result = await client.processKnowledge(text, source, {
			includeConcepts,
			threadId: "web_client_demo",
		});

		showStatus(
			`✅ Processed ${result.triplesStored} triples successfully`,
			"success",
		);
		displayResponse("processResponse", result);
	} catch (error) {
		showStatus(`❌ Processing failed: ${error.message}`, "error");
		displayResponse("processResponse", null, error);
	}

	hideLoading();
}

async function searchKnowledge() {
	if (!client.isConnected) {
		showStatus("Please check connection first", "error");
		return;
	}

	const query = document.getElementById("searchQuery").value;
	const limit = parseInt(document.getElementById("searchLimit").value);
	const threshold = parseFloat(
		document.getElementById("searchThreshold").value,
	);

	if (!query.trim()) {
		showStatus("Please enter a search query", "error");
		return;
	}

	showLoading();

	try {
		const result = await client.searchKnowledge(query, {
			limit,
			threshold,
		});

		showStatus(`✅ Found ${result.results.length} results`, "success");
		displayResponse("searchResponse", result);
	} catch (error) {
		showStatus(`❌ Search failed: ${error.message}`, "error");
		displayResponse("searchResponse", null, error);
	}

	hideLoading();
}

async function searchConcepts() {
	if (!client.isConnected) {
		showStatus("Please check connection first", "error");
		return;
	}

	const query = document.getElementById("conceptQuery").value;

	if (!query.trim()) {
		showStatus("Please enter a concept query", "error");
		return;
	}

	showLoading();

	try {
		const result = await client.searchConcepts(query, {
			limit: 5,
			threshold: 0.7,
		});

		showStatus(`✅ Found ${result.results.length} concepts`, "success");
		displayResponse("conceptResponse", result);
	} catch (error) {
		showStatus(`❌ Concept search failed: ${error.message}`, "error");
		displayResponse("conceptResponse", null, error);
	}

	hideLoading();
}

async function getStatistics() {
	if (!client.isConnected) {
		showStatus("Please check connection first", "error");
		return;
	}

	showLoading();

	try {
		const stats = await client.getStats();

		// Display detailed stats
		displayResponse("statsResponse", stats);

		// Create visual stat cards
		createStatsCards(stats);

		showStatus("✅ Statistics retrieved", "success");
	} catch (error) {
		showStatus(`❌ Failed to get statistics: ${error.message}`, "error");
		displayResponse("statsResponse", null, error);
	}

	hideLoading();
}

async function getEntities() {
	if (!client.isConnected) {
		showStatus("Please check connection first", "error");
		return;
	}

	showLoading();

	try {
		const entities = await client.getEntities({
			limit: 20,
			sortBy: "frequency",
		});

		showStatus(`✅ Retrieved ${entities.entities.length} entities`, "success");
		displayResponse("statsResponse", entities);
	} catch (error) {
		showStatus(`❌ Failed to get entities: ${error.message}`, "error");
		displayResponse("statsResponse", null, error);
	}

	hideLoading();
}

function createStatsCards(stats) {
	const container = document.getElementById("statsCards");

	const cards = [
		{ label: "Total Triples", value: stats.totalTriples },
		{ label: "Total Concepts", value: stats.totalConcepts },
		{ label: "Unique Sources", value: stats.uniqueSources },
		{ label: "Unique Entities", value: stats.uniqueEntities },
	];

	container.innerHTML = cards
		.map(
			(card) => `
        <div class="stat-card">
            <div class="stat-value">${formatNumber(card.value)}</div>
            <div class="stat-label">${card.label}</div>
        </div>
    `,
		)
		.join("");

	container.style.display = "grid";
}

// Keyboard shortcuts
document.addEventListener("keydown", function (e) {
	// Ctrl/Cmd + Enter to process knowledge
	if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
		const activeElement = document.activeElement;
		if (activeElement.id === "knowledgeText") {
			e.preventDefault();
			processKnowledge();
		} else if (activeElement.id === "searchQuery") {
			e.preventDefault();
			searchKnowledge();
		} else if (activeElement.id === "conceptQuery") {
			e.preventDefault();
			searchConcepts();
		}
	}
});

// Auto-resize textareas
document.addEventListener("input", function (e) {
	if (e.target.tagName === "TEXTAREA") {
		e.target.style.height = "auto";
		e.target.style.height = e.target.scrollHeight + "px";
	}
});
