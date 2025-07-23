/**
 * Token counting utility - simplified version without external dependencies
 * Provides estimated token counts for different AI models
 */

/**
 * Count tokens in a text string for a specific model (using estimation)
 * @param text The text to count tokens for
 * @param model The model name (e.g., "gpt-4", "text-embedding-3-small")
 * @returns The estimated number of tokens
 */
export function countTokens(text: string, model: string): number {
	// Simple estimation: 1 token ≈ 4 characters in English
	// This is a rough approximation used when tiktoken is not available
	return Math.ceil(text.length / 4);
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
 * No-op function for compatibility - not needed for estimation
 */
export function freeEncoders(): void {
	// No-op since we're not using actual encoders
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
