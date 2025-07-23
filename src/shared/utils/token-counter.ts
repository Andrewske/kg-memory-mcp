import { get_encoding, type Tiktoken, type TiktokenEncoding } from "tiktoken";

/**
 * Token counting utility using tiktoken
 * Provides accurate token counts for different OpenAI and embedding models
 */

// Cache encoders to avoid recreating them
const encoderCache = new Map<TiktokenEncoding, Tiktoken>();

/**
 * Get the appropriate encoder name for a given model
 */
function getEncoderForModel(model: string): TiktokenEncoding {
	// Embedding models use cl100k_base
	if (model.includes("embedding")) {
		return "cl100k_base";
	}

	// GPT-4 and GPT-3.5 turbo models use cl100k_base
	if (
		model.includes("gpt-4") ||
		model.includes("gpt-3.5") ||
		model.includes("gpt-4o")
	) {
		return "cl100k_base";
	}

	// GPT-3 models (legacy) use p50k_base
	if (model.includes("text-davinci") || model.includes("code-davinci")) {
		return "p50k_base";
	}

	// Default to cl100k_base for newer models
	return "cl100k_base";
}

/**
 * Count tokens in a text string for a specific model
 * @param text The text to count tokens for
 * @param model The model name (e.g., "gpt-4", "text-embedding-3-small")
 * @returns The number of tokens
 */
export function countTokens(text: string, model: string): number {
	const encoderName = getEncoderForModel(model);

	// Get or create encoder
	let encoder = encoderCache.get(encoderName);
	if (!encoder) {
		encoder = get_encoding(encoderName);
		encoderCache.set(encoderName, encoder);
	}

	// Count tokens
	const tokens = encoder.encode(text);
	return tokens.length;
}

/**
 * Count tokens for multiple texts (batch)
 * @param texts Array of texts to count tokens for
 * @param model The model name
 * @returns Total token count for all texts
 */
export function countTokensBatch(texts: string[], model: string): number {
	return texts.reduce((total, text) => total + countTokens(text, model), 0);
}

/**
 * Free all cached encoders to release memory
 * Call this during shutdown or when encoders are no longer needed
 */
export function freeEncoders(): void {
	for (const encoder of encoderCache.values()) {
		encoder.free();
	}
	encoderCache.clear();
}

/**
 * Estimate tokens for a given text length (rough approximation)
 * Useful for quick estimates without loading tiktoken
 * @param textLength The length of the text in characters
 * @returns Estimated token count (approximately 1 token per 4 characters)
 */
export function estimateTokens(textLength: number): number {
	// OpenAI's rough estimate: 1 token ≈ 4 characters in English
	return Math.ceil(textLength / 4);
}