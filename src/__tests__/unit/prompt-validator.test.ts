/**
 * Unit tests for prompt validation utility
 */

import { describe, expect, it } from '@jest/globals';
import {
	EXTRACTION_PROMPT_REQUIREMENTS,
	formatValidationReport,
	validateExtractionSuite,
	validatePrompt,
} from '~/shared/utils/prompt-validator.js';

describe('Prompt Validator', () => {
	describe('validatePrompt', () => {
		it('should pass validation for well-formed v1.1 extraction prompt', () => {
			const goodPrompt = `
Extract relationships from text.

**Output Format**: Return a JSON object with this exact structure:

\`\`\`json
{
  "triples": [
    {
      "subject": "entity name",
      "predicate": "relationship type",
      "object": "related entity",
      "confidence": 0.0-1.0
    }
  ]
}
\`\`\`

**Examples**:

Input: "Alice works at TechCorp."
Output:
\`\`\`json
{
  "triples": [
    {"subject": "Alice", "predicate": "works_at", "object": "TechCorp", "confidence": 0.95}
  ]
}
\`\`\`

Now extract from: {{text}}
      `;

			const result = validatePrompt(goodPrompt, EXTRACTION_PROMPT_REQUIREMENTS);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.metadata.hasExamples).toBe(true);
			expect(result.metadata.hasSchema).toBe(true);
			expect(result.metadata.missingKeywords).toHaveLength(0);
		});

		it('should fail validation for vague v1.0 prompt without schema', () => {
			const badPrompt = `
Extract relationships from the following text.

Text: {{text}}

Respond with a JSON containing an array of triples.
      `;

			const result = validatePrompt(badPrompt, EXTRACTION_PROMPT_REQUIREMENTS);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.metadata.hasExamples).toBe(false);

			// Should be missing schema keywords (object might appear in "JSON object" phrase)
			expect(result.metadata.missingKeywords).toContain('subject');
			expect(result.metadata.missingKeywords).toContain('predicate');
			// "object" might not be missing due to "JSON object" phrase
			expect(result.metadata.missingKeywords).toContain('confidence');
		});

		it('should detect missing examples', () => {
			const promptWithoutExamples = `
Extract relationships from text.

**Output Format**: JSON object with fields: subject, predicate, object, confidence.
Return as triples array.

Text: {{text}}
      `;

			const result = validatePrompt(promptWithoutExamples, EXTRACTION_PROMPT_REQUIREMENTS);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				'Prompt must include examples to demonstrate expected output format'
			);
			expect(result.metadata.hasExamples).toBe(false);
		});

		it('should detect missing schema specification', () => {
			const promptWithoutSchema = `
Extract relationships from text.

Example: Alice works at TechCorp.

Text: {{text}}
      `;

			const result = validatePrompt(promptWithoutSchema, {
				...EXTRACTION_PROMPT_REQUIREMENTS,
				mustProvideExamples: false, // Focus on schema check
			});

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Prompt must specify JSON schema or output format');
			expect(result.metadata.hasSchema).toBe(false);
		});

		it('should detect unclosed template variables', () => {
			const promptWithBadTemplate = `
Extract from: {{text
      `;

			const result = validatePrompt(promptWithBadTemplate, {
				mustInclude: [],
				mustProvideExamples: false,
				mustSpecifySchema: false,
			});

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Prompt has unclosed template variable placeholder');
		});

		it('should warn about vague language', () => {
			const vaguePrompt = `
Extract any relationships and stuff from text, etc.

Output: JSON with triples array containing subject, predicate, object, confidence.

Example: Input "Alice works" Output {"triples": [...]}

Text: {{text}}
      `;

			const result = validatePrompt(vaguePrompt, EXTRACTION_PROMPT_REQUIREMENTS);

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings.some(w => w.includes('Vague language'))).toBe(true);
		});

		it('should warn about excessively long prompts', () => {
			// Create a very long prompt (~2500 tokens)
			const longPrompt = `
Extract relationships from text.

Output: JSON with triples containing subject, predicate, object, confidence.

Example: ${'Lorem ipsum dolor sit amet. '.repeat(200)}

Text: {{text}}
      `;

			const result = validatePrompt(longPrompt, {
				...EXTRACTION_PROMPT_REQUIREMENTS,
				maxTokens: 1000,
			});

			expect(result.warnings.some(w => w.includes('too long'))).toBe(true);
		});

		it('should estimate token count approximately correctly', () => {
			const shortPrompt = 'Extract triples.'; // ~4 tokens
			const result = validatePrompt(shortPrompt, {
				mustInclude: [],
				mustProvideExamples: false,
				mustSpecifySchema: false,
			});

			// Rough approximation: 1 token ≈ 4 characters
			expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
			expect(result.metadata.estimatedTokens).toBeLessThan(10);
		});

		it('should be case-insensitive for keyword matching', () => {
			const mixedCasePrompt = `
Extract TRIPLES with SUBJECT, PREDICATE, OBJECT, and CONFIDENCE.

JSON output format with examples.

Example: Input "test" Output {"triples": [{"subject": "A", "predicate": "B", "object": "C", "confidence": 0.9}]}

Text: {{text}}
      `;

			const result = validatePrompt(mixedCasePrompt, EXTRACTION_PROMPT_REQUIREMENTS);

			expect(result.valid).toBe(true);
			expect(result.metadata.missingKeywords).toHaveLength(0);
		});
	});

	describe('validateExtractionSuite', () => {
		it('should validate all prompts in a suite', () => {
			const prompts = new Map<string, string>([
				[
					'entity-entity',
					`
Extract entity relationships.

**Output Format**: JSON structure with triples array containing subject, predicate, object, confidence fields.

**Example**:
Input: "Alice works at Corp"
Output: {"triples": [{"subject": "Alice", "predicate": "works_at", "object": "Corp", "confidence": 0.9}]}

Text: {{text}}
        `,
				],
				[
					'entity-event',
					`
Extract entity-event relationships.

**Output Format**: JSON structure with triples array containing subject, predicate, object, confidence fields.

**Example**:
Input: "Bob attended meeting"
Output: {"triples": [{"subject": "Bob", "predicate": "attended", "object": "meeting", "confidence": 0.95}]}

Text: {{text}}
        `,
				],
			]);

			const result = validateExtractionSuite(prompts);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.valid).toBe(true);
				expect(result.data.results.size).toBe(2);
			}
		});

		it('should detect failures in suite when any prompt is invalid', () => {
			const prompts = new Map<string, string>([
				[
					'good-prompt',
					`
Extract relationships.
JSON: triples with subject, predicate, object, confidence.
Example: Input "test" Output {"triples": [...]}
Text: {{text}}
        `,
				],
				[
					'bad-prompt',
					`
Extract stuff.
Text: {{text}}
        `,
				],
			]);

			const result = validateExtractionSuite(prompts);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.valid).toBe(false);

				const badPromptResult = result.data.results.get('bad-prompt');
				expect(badPromptResult?.valid).toBe(false);
			}
		});
	});

	describe('formatValidationReport', () => {
		it('should format validation results as readable report', () => {
			const validationResult = {
				valid: false,
				errors: ['Missing keyword: confidence', 'No examples provided'],
				warnings: ['Vague language detected'],
				metadata: {
					hasExamples: false,
					hasSchema: true,
					estimatedTokens: 150,
					missingKeywords: ['confidence'],
				},
			};

			const report = formatValidationReport('entity-entity', validationResult);

			expect(report).toContain('entity-entity');
			expect(report).toContain('❌ FAILED');
			expect(report).toContain('Missing keyword: confidence');
			expect(report).toContain('No examples provided');
			expect(report).toContain('Vague language detected');
			expect(report).toContain('150');
		});

		it('should format successful validation cleanly', () => {
			const validationResult = {
				valid: true,
				errors: [],
				warnings: [],
				metadata: {
					hasExamples: true,
					hasSchema: true,
					estimatedTokens: 200,
					missingKeywords: [],
				},
			};

			const report = formatValidationReport('entity-event', validationResult);

			expect(report).toContain('entity-event');
			expect(report).toContain('✅ PASSED');
			expect(report).not.toContain('Errors');
			expect(report).not.toContain('Warnings');
		});
	});
});
