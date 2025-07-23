import fs from "node:fs/promises";
import path from "node:path";
import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer";
import { encode, encodeChat } from "gpt-tokenizer";
import type { TokenUsage } from "~/shared/types/index.js";
import { createLoggerOperations } from "./logger.js";

// Create logger instance
const logger = createLoggerOperations();

// Result type for error handling
export type TokenManagerResult<T> =
	| { success: true; data: T }
	| { success: false; error: TokenManagerError };

export type TokenManagerError = {
	type: "FILE_ERROR" | "VALIDATION_ERROR" | "PROCESSING_ERROR" | "TOKEN_ERROR";
	message: string;
	cause?: unknown;
};

export type TokenManagerState = {
	readonly tokenUsageFile: string;
	readonly isInitialized: boolean;
	readonly storageDir: string;
};

export type TokenStatsFilter = {
	startDate?: string;
	endDate?: string;
	provider?: string;
	model?: string;
};

export type TokenStats = {
	totalTokens: number;
	totalCost: number;
	byProvider: Record<string, number>;
	byModel: Record<string, number>;
};

export type TokenCostRates = {
	[key: string]: number;
};

// Pure utility functions
export const createTokenManagerState = (
	storageDir: string = "./data",
): TokenManagerState => ({
	tokenUsageFile: path.join(storageDir, "token-usage.jsonl"),
	isInitialized: false,
	storageDir,
});

const getDefaultCostRates = (): TokenCostRates => ({
	"gpt-4": 0.00003,
	"gpt-3.5-turbo": 0.000001,
	"claude-3-opus": 0.00003,
	"claude-3-sonnet": 0.000003,
	"claude-3-haiku": 0.0000025,
	"text-embedding-3-small": 0.00000002,
	"text-embedding-3-large": 0.00000013,
});

const createTokenUsageEntry = (usage: TokenUsage): TokenUsage => ({
	...usage,
	timestamp: usage.timestamp || new Date().toISOString(),
});

const calculateTokenCost = (
	tokens: number,
	model: string,
	rates: TokenCostRates,
): number => {
	const rate =
		Object.entries(rates).find(([key]) =>
			model.toLowerCase().includes(key),
		)?.[1] || 0.00001; // Default rate
	return tokens * rate;
};

const applyStatsFilter = (
	usage: TokenUsage,
	filter?: TokenStatsFilter,
): boolean => {
	if (!filter) return true;

	if (filter.startDate && usage.timestamp < filter.startDate) return false;
	if (filter.endDate && usage.timestamp > filter.endDate) return false;
	if (filter.provider && usage.provider !== filter.provider) return false;
	if (filter.model && usage.model !== filter.model) return false;

	return true;
};

// Core token operations
export const initializeTokenManager = async (
	state: TokenManagerState,
	storageDir?: string,
): Promise<TokenManagerResult<TokenManagerState>> => {
	try {
		const actualStorageDir = storageDir || state.storageDir;
		const tokenUsageFile = path.join(actualStorageDir, "token-usage.jsonl");

		await fs.mkdir(actualStorageDir, { recursive: true });

		const newState: TokenManagerState = {
			tokenUsageFile,
			isInitialized: true,
			storageDir: actualStorageDir,
		};

		return { success: true, data: newState };
	} catch (error) {
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to initialize token manager storage",
				cause: error,
			},
		};
	}
};

export const countTokens = async (
	text: string,
	provider: "anthropic" | "openai" | string,
): Promise<TokenManagerResult<number>> => {
	try {
		let tokenCount: number;

		if (provider === "anthropic") {
			tokenCount = anthropicCountTokens(text);
		} else if (provider === "openai") {
			const encoded = encode(text);
			tokenCount = encoded.length;
		} else {
			// Default to OpenAI tokenizer for unknown providers
			const encoded = encode(text);
			tokenCount = encoded.length;
		}

		return { success: true, data: tokenCount };
	} catch (error) {
		await logger.logError(
			"TOKEN_MANAGER",
			`Failed to count tokens for provider ${provider}`,
			error,
		);

		// Fallback to rough estimation
		const fallbackCount = Math.ceil(text.length / 4);
		return { success: true, data: fallbackCount };
	}
};

export const logTokenUsage = async (
	state: TokenManagerState,
	usage: TokenUsage,
): Promise<TokenManagerResult<void>> => {
	if (!state.isInitialized) {
		console.warn("TokenManager not initialized, skipping token logging");
		return { success: true, data: undefined };
	}

	try {
		const entry = createTokenUsageEntry(usage);
		await fs.appendFile(state.tokenUsageFile, JSON.stringify(entry) + "\n");
		return { success: true, data: undefined };
	} catch (error) {
		await logger.logError("TOKEN_MANAGER", "Failed to log token usage", error);
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to log token usage",
				cause: error,
			},
		};
	}
};

export const getTokenStats = async (
	state: TokenManagerState,
	filter?: TokenStatsFilter,
): Promise<TokenManagerResult<TokenStats>> => {
	if (!state.isInitialized) {
		const emptyStats: TokenStats = {
			totalTokens: 0,
			totalCost: 0,
			byProvider: {},
			byModel: {},
		};
		return { success: true, data: emptyStats };
	}

	try {
		const data = await fs.readFile(state.tokenUsageFile, "utf-8");
		const lines = data
			.trim()
			.split("\n")
			.filter((line) => line);

		let totalTokens = 0;
		const byProvider: Record<string, number> = {};
		const byModel: Record<string, number> = {};

		for (const line of lines) {
			const usage: TokenUsage = JSON.parse(line);

			// Apply filters
			if (!applyStatsFilter(usage, filter)) continue;

			totalTokens += usage.total_tokens;
			byProvider[usage.provider] =
				(byProvider[usage.provider] || 0) + usage.total_tokens;
			byModel[usage.model] = (byModel[usage.model] || 0) + usage.total_tokens;
		}

		// Calculate approximate costs
		const costRates = getDefaultCostRates();
		let totalCost = 0;
		for (const [model, tokens] of Object.entries(byModel)) {
			totalCost += calculateTokenCost(tokens, model, costRates);
		}

		const stats: TokenStats = {
			totalTokens,
			totalCost,
			byProvider,
			byModel,
		};

		return { success: true, data: stats };
	} catch (error) {
		await logger.logError("TOKEN_MANAGER", "Failed to get token stats", error);
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to get token stats",
				cause: error,
			},
		};
	}
};

// Higher-order function for creating token manager operations
export const createTokenManagerOperations = (storageDir: string = "./data") => {
	let state = createTokenManagerState(storageDir);

	return {
		// Initialize
		initialize: async (
			customStorageDir?: string,
		): Promise<TokenManagerResult<void>> => {
			const result = await initializeTokenManager(state, customStorageDir);
			if (!result.success) {
				return { success: false, error: result.error };
			}
			state = result.data;
			return { success: true, data: undefined };
		},

		// Core operations
		countTokens: (text: string, provider: "anthropic" | "openai" | string) =>
			countTokens(text, provider),

		logTokenUsage: (usage: TokenUsage) => logTokenUsage(state, usage),

		getTokenStats: (filter?: TokenStatsFilter) => getTokenStats(state, filter),

		// Utilities
		getCostRates: () => getDefaultCostRates(),
		calculateCost: (tokens: number, model: string) =>
			calculateTokenCost(tokens, model, getDefaultCostRates()),

		// State inspection
		getState: () => state,
		isInitialized: () => state.isInitialized,
	};
};

// Default token manager instance for backward compatibility
const defaultTokenManager = createTokenManagerOperations();

// Export convenience functions that maintain backward compatibility
export const countTokensDefault = (
	text: string,
	provider: "anthropic" | "openai" | string,
) => defaultTokenManager.countTokens(text, provider);

export const logTokenUsageDefault = (usage: TokenUsage) =>
	defaultTokenManager.logTokenUsage(usage);

export const getTokenStatsDefault = (filter?: TokenStatsFilter) =>
	defaultTokenManager.getTokenStats(filter);

// Legacy class wrapper for compatibility
export class TokenManager {
	private operations: ReturnType<typeof createTokenManagerOperations>;

	constructor(storageDir: string = "./data") {
		this.operations = createTokenManagerOperations(storageDir);
	}

	async initialize(storageDir?: string): Promise<void> {
		const result = await this.operations.initialize(storageDir);
		if (!result.success) {
			throw new Error(result.error.message);
		}
	}

	async countTokens(
		text: string,
		provider: "anthropic" | "openai" | string,
	): Promise<number> {
		const result = await this.operations.countTokens(text, provider);
		if (!result.success) {
			throw new Error(result.error.message);
		}
		return result.data;
	}

	async logTokenUsage(usage: TokenUsage): Promise<void> {
		const result = await this.operations.logTokenUsage(usage);
		if (!result.success) {
			throw new Error(result.error.message);
		}
	}

	async getTokenStats(filter?: TokenStatsFilter): Promise<TokenStats> {
		const result = await this.operations.getTokenStats(filter);
		if (!result.success) {
			throw new Error(result.error.message);
		}
		return result.data;
	}
}

// Export singleton instance for backward compatibility
export const tokenManager = new TokenManager();
