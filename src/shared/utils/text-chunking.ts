/**
 * Text chunking utilities for handling large text inputs
 */

export interface TextChunk {
	text: string;
	start: number;
	end: number;
	estimatedTokens: number;
}

export interface ChunkingOptions {
	maxTokens: number;
	overlapTokens?: number;
	preserveParagraphs?: boolean;
}

/**
 * Split text into chunks based on token count estimation
 * Preserves paragraph boundaries when possible
 */
export function chunkText(text: string, options: ChunkingOptions): TextChunk[] {
	const { maxTokens, overlapTokens = 100, preserveParagraphs = true } = options;

	if (!text || text.trim().length === 0) {
		return [];
	}

	const estimatedTokens = Math.ceil(text.length / 4); // Rough estimation: 4 chars per token

	// If text is already small enough, return as single chunk
	if (estimatedTokens <= maxTokens) {
		return [
			{
				text: text.trim(),
				start: 0,
				end: text.length,
				estimatedTokens,
			},
		];
	}

	const chunks: TextChunk[] = [];
	const maxChars = maxTokens * 4; // Rough conversion back to characters
	const overlapChars = overlapTokens * 4;

	// Split into paragraphs first if requested
	const paragraphs = preserveParagraphs
		? text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
		: [text];

	let currentChunk = '';
	let currentStart = 0;
	let totalProcessed = 0;

	for (let i = 0; i < paragraphs.length; i++) {
		const paragraph = paragraphs[i].trim();
		const paragraphWithSpacing = i > 0 ? `\n\n${paragraph}` : paragraph;

		// If this paragraph alone exceeds max size, split it by sentences
		if (paragraph.length > maxChars) {
			// Finish current chunk if not empty
			if (currentChunk.trim().length > 0) {
				const chunkText = currentChunk.trim();
				chunks.push({
					text: chunkText,
					start: currentStart,
					end: currentStart + chunkText.length,
					estimatedTokens: Math.ceil(chunkText.length / 4),
				});

				// Set up overlap for next chunk
				const overlapStart = Math.max(0, chunkText.length - overlapChars);
				currentChunk = chunkText.substring(overlapStart);
				currentStart = currentStart + overlapStart;
			}

			// Split large paragraph by sentences
			const sentences = paragraph.split(/\. (?=[A-Z])/);
			for (const sentence of sentences) {
				const sentenceWithPunct = sentence.endsWith('.') ? sentence : `${sentence}.`;

				if (currentChunk.length + sentenceWithPunct.length > maxChars) {
					// Finish current chunk
					if (currentChunk.trim().length > 0) {
						const chunkText = currentChunk.trim();
						chunks.push({
							text: chunkText,
							start: currentStart,
							end: currentStart + chunkText.length,
							estimatedTokens: Math.ceil(chunkText.length / 4),
						});

						// Set up overlap
						const overlapStart = Math.max(0, chunkText.length - overlapChars);
						currentChunk = chunkText.substring(overlapStart);
						currentStart = currentStart + overlapStart;
					}
				}

				currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentenceWithPunct;
			}
		} else {
			// Check if adding this paragraph would exceed the limit
			if (currentChunk.length + paragraphWithSpacing.length > maxChars) {
				// Finish current chunk
				if (currentChunk.trim().length > 0) {
					const chunkText = currentChunk.trim();
					chunks.push({
						text: chunkText,
						start: currentStart,
						end: currentStart + chunkText.length,
						estimatedTokens: Math.ceil(chunkText.length / 4),
					});

					// Set up overlap for next chunk
					const overlapStart = Math.max(0, chunkText.length - overlapChars);
					currentChunk = chunkText.substring(overlapStart);
					currentStart = currentStart + overlapStart;
				} else {
					currentChunk = '';
					currentStart = totalProcessed;
				}
			}

			// Add paragraph to current chunk
			currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + paragraph;
		}

		totalProcessed += paragraphWithSpacing.length;
	}

	// Add final chunk if not empty
	if (currentChunk.trim().length > 0) {
		const chunkText = currentChunk.trim();
		chunks.push({
			text: chunkText,
			start: currentStart,
			end: currentStart + chunkText.length,
			estimatedTokens: Math.ceil(chunkText.length / 4),
		});
	}

	return chunks;
}

/**
 * Merge results from multiple chunks back into a single result
 */
export interface ChunkedResults<T> {
	results: T[];
	totalChunks: number;
	successfulChunks: number;
	failedChunks: number;
}

export function mergeChunkResults<T>(chunkResults: T[]): ChunkedResults<T> {
	const successful = chunkResults.filter(result => result !== null && result !== undefined);

	return {
		results: chunkResults,
		totalChunks: chunkResults.length,
		successfulChunks: successful.length,
		failedChunks: chunkResults.length - successful.length,
	};
}
