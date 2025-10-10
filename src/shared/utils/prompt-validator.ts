/**
 * Prompt Validation Utility
 *
 * Validates extraction and conceptualization prompts to ensure they meet quality standards.
 * Prevents prompt regressions by checking for required elements before prompts are used.
 */

import type { Result } from '~/shared/types/services.js';

export interface PromptRequirements {
	/** Required keywords that must appear in the prompt */
	mustInclude: string[];
	/** Whether the prompt must provide examples */
	mustProvideExamples: boolean;
	/** Whether the prompt must specify JSON schema */
	mustSpecifySchema: boolean;
	/** Maximum allowed token count (approximate) */
	maxTokens?: number;
}

export interface PromptValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
	metadata: {
		hasExamples: boolean;
		hasSchema: boolean;
		estimatedTokens: number;
		missingKeywords: string[];
	};
}

/**
 * Default requirements for extraction prompts
 */
export const EXTRACTION_PROMPT_REQUIREMENTS: PromptRequirements = {
	mustInclude: ['triples', 'subject', 'predicate', 'object', 'confidence'],
	mustProvideExamples: true,
	mustSpecifySchema: true,
	maxTokens: 2000,
};

/**
 * Default requirements for conceptualization prompts
 */
export const CONCEPTUALIZATION_PROMPT_REQUIREMENTS: PromptRequirements = {
	mustInclude: ['concepts', 'name', 'abstraction_level'],
	mustProvideExamples: true,
	mustSpecifySchema: true,
	maxTokens: 2000,
};

/**
 * Validate a prompt against requirements
 *
 * @param promptContent - The prompt text to validate
 * @param requirements - Validation requirements
 * @returns Validation result with errors and warnings
 */
export function validatePrompt(
	promptContent: string,
	requirements: PromptRequirements
): PromptValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const missingKeywords: string[] = [];

	// Normalize content for case-insensitive checks
	const normalizedContent = promptContent.toLowerCase();

	// Check for required keywords
	for (const keyword of requirements.mustInclude) {
		if (!normalizedContent.includes(keyword.toLowerCase())) {
			missingKeywords.push(keyword);
			errors.push(`Prompt missing required keyword: "${keyword}"`);
		}
	}

	// Check for examples
	const hasExamples =
		normalizedContent.includes('example') ||
		normalizedContent.includes('input:') ||
		normalizedContent.includes('output:');

	if (requirements.mustProvideExamples && !hasExamples) {
		errors.push('Prompt must include examples to demonstrate expected output format');
	}

	// Check for JSON schema specification
	const hasSchema =
		normalizedContent.includes('json') &&
		(normalizedContent.includes('schema') ||
			normalizedContent.includes('structure') ||
			normalizedContent.includes('format'));

	if (requirements.mustSpecifySchema && !hasSchema) {
		errors.push('Prompt must specify JSON schema or output format');
	}

	// Estimate token count (rough approximation: 1 token ≈ 4 characters)
	const estimatedTokens = Math.ceil(promptContent.length / 4);

	if (requirements.maxTokens && estimatedTokens > requirements.maxTokens) {
		warnings.push(
			`Prompt may be too long: ~${estimatedTokens} tokens (max: ${requirements.maxTokens}). Consider shortening examples or instructions.`
		);
	}

	// Check for common anti-patterns
	if (normalizedContent.includes('respond with a json object') && !hasExamples) {
		warnings.push(
			'Prompt asks for JSON but provides no examples - AI may misinterpret the schema'
		);
	}

	if (normalizedContent.includes('{{') && !normalizedContent.includes('}}')) {
		errors.push('Prompt has unclosed template variable placeholder');
	}

	// Check for vague language
	const vaguePatterns = [
		{ pattern: /\bany\b/gi, suggestion: 'Be specific about what to extract' },
		{ pattern: /\bstuff\b/gi, suggestion: 'Use precise terminology' },
		{ pattern: /\betc\b/gi, suggestion: 'Enumerate all expected cases' },
	];

	for (const { pattern, suggestion } of vaguePatterns) {
		if (pattern.test(promptContent)) {
			warnings.push(`Vague language detected: "${pattern.source}". ${suggestion}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		metadata: {
			hasExamples,
			hasSchema,
			estimatedTokens,
			missingKeywords,
		},
	};
}

/**
 * Validate all extraction prompts in a suite
 *
 * @param prompts - Map of extraction type to prompt content
 * @returns Result with validation details for each prompt
 */
export function validateExtractionSuite(prompts: Map<string, string>): Result<{
	valid: boolean;
	results: Map<string, PromptValidationResult>;
}> {
	const results = new Map<string, PromptValidationResult>();
	let allValid = true;

	for (const [extractionType, content] of prompts.entries()) {
		const validationResult = validatePrompt(content, EXTRACTION_PROMPT_REQUIREMENTS);
		results.set(extractionType, validationResult);

		if (!validationResult.valid) {
			allValid = false;
		}
	}

	return {
		success: true,
		data: {
			valid: allValid,
			results,
		},
	};
}

/**
 * Format validation results as a human-readable report
 *
 * @param promptType - Type of prompt being validated
 * @param result - Validation result
 * @returns Formatted report string
 */
export function formatValidationReport(
	promptType: string,
	result: PromptValidationResult
): string {
	const lines: string[] = [];

	lines.push(`\n📋 Prompt Validation: ${promptType}`);
	lines.push(`   Status: ${result.valid ? '✅ PASSED' : '❌ FAILED'}`);
	lines.push(`   Examples: ${result.metadata.hasExamples ? '✅' : '❌'}`);
	lines.push(`   Schema: ${result.metadata.hasSchema ? '✅' : '❌'}`);
	lines.push(`   Estimated tokens: ${result.metadata.estimatedTokens}`);

	if (result.metadata.missingKeywords.length > 0) {
		lines.push(`   Missing keywords: ${result.metadata.missingKeywords.join(', ')}`);
	}

	if (result.errors.length > 0) {
		lines.push('\n   ❌ Errors:');
		for (const error of result.errors) {
			lines.push(`      • ${error}`);
		}
	}

	if (result.warnings.length > 0) {
		lines.push('\n   ⚠️  Warnings:');
		for (const warning of result.warnings) {
			lines.push(`      • ${warning}`);
		}
	}

	return lines.join('\n');
}
