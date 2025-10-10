/**
 * Prompt Loader Service
 *
 * Loads versioned prompt templates from the prompts/ directory,
 * manages caching, validates integrity, and renders templates with variables.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type {
	ExtractionType,
	PromptCategory,
	PromptMetadata,
	PromptTemplate,
	PromptVariables,
	SuiteDefinition,
	VersionsManifest,
} from '~/shared/types/prompts.js';
import type { Result } from '~/shared/types/services.js';

// In-memory cache for loaded prompts and versions manifest
const promptCache = new Map<string, PromptTemplate>();
let versionsManifest: VersionsManifest | null = null;

// Path to prompts directory (relative to project root)
const PROMPTS_DIR = 'prompts';

/**
 * Load the versions manifest from versions.json
 */
function loadVersionsManifest(): Result<VersionsManifest> {
	try {
		// Return cached version if available
		if (versionsManifest) {
			return { success: true, data: versionsManifest };
		}

		const versionsPath = join(process.cwd(), PROMPTS_DIR, 'versions.json');
		const content = readFileSync(versionsPath, 'utf-8');
		const parsed = JSON.parse(content) as VersionsManifest;

		// Validate basic structure
		if (!parsed.latest || typeof parsed.latest !== 'string') {
			return {
				success: false,
				error: {
					type: 'VALIDATION_ERROR',
					message: 'versions.json must have a "latest" field',
				},
			};
		}

		// Cache the manifest
		versionsManifest = parsed;

		return { success: true, data: parsed };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'FILE_ERROR',
				message: `Failed to load versions.json: ${error}`,
				cause: error,
			},
		};
	}
}

/**
 * Get suite definition for a specific version
 * Resolves "latest" to actual version
 */
export function getSuiteDefinition(suiteVersion: string): Result<SuiteDefinition> {
	const manifestResult = loadVersionsManifest();
	if (!manifestResult.success) {
		return manifestResult as Result<SuiteDefinition>;
	}

	const manifest = manifestResult.data;

	// Resolve "latest" keyword
	const actualVersion = suiteVersion === 'latest' ? manifest.latest : suiteVersion;

	// Get suite definition
	const suite = manifest[actualVersion];
	if (!suite || typeof suite === 'string') {
		return {
			success: false,
			error: {
				type: 'SUITE_NOT_FOUND',
				message: `Suite version "${actualVersion}" not found in versions.json`,
			},
		};
	}

	return { success: true, data: suite as SuiteDefinition };
}

/**
 * Load a specific prompt by category, type, and version
 */
export function loadPrompt(
	category: PromptCategory,
	type: string,
	version: string
): Result<PromptTemplate> {
	try {
		// Check cache first
		const cacheKey = `${category}:${type}:${version}`;
		const cached = promptCache.get(cacheKey);
		if (cached) {
			return { success: true, data: cached };
		}

		// Construct file path
		let filePath: string;
		if (category === 'extraction') {
			filePath = join(process.cwd(), PROMPTS_DIR, 'extraction', type, `${version}.md`);
		} else if (category === 'conceptualization') {
			filePath = join(process.cwd(), PROMPTS_DIR, 'conceptualization', `${version}.md`);
		} else {
			return {
				success: false,
				error: {
					type: 'INVALID_CATEGORY',
					message: `Invalid prompt category: ${category}`,
				},
			};
		}

		// Read and parse file
		const fileContent = readFileSync(filePath, 'utf-8');
		const parsed = matter(fileContent);

		// Validate frontmatter
		const metadata = parsed.data as Partial<PromptMetadata>;
		if (!metadata.version || !metadata.created || !metadata.description) {
			return {
				success: false,
				error: {
					type: 'VALIDATION_ERROR',
					message: `Prompt file ${filePath} missing required frontmatter fields`,
				},
			};
		}

		// Construct template
		const template: PromptTemplate = {
			metadata: {
				version: metadata.version,
				created: metadata.created,
				description: metadata.description,
				changes: metadata.changes || '',
				notes: metadata.notes || '',
				variables: metadata.variables || { required: [], optional: [] },
			},
			content: parsed.content.trim(),
		};

		// Cache the template
		promptCache.set(cacheKey, template);

		return { success: true, data: template };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'FILE_ERROR',
				message: `Failed to load prompt (${category}/${type}/${version}): ${error}`,
				cause: error,
			},
		};
	}
}

/**
 * Render a prompt template with variables
 * Validates that required variables are provided
 */
export function renderPrompt(
	template: PromptTemplate,
	variables: PromptVariables
): Result<string> {
	try {
		// Validate required variables
		const missing = template.metadata.variables.required.filter(
			varName => variables[varName] === undefined || variables[varName] === null
		);

		if (missing.length > 0) {
			return {
				success: false,
				error: {
					type: 'MISSING_VARIABLE',
					message: `Required variables missing: ${missing.join(', ')}`,
				},
			};
		}

		// Replace template variables
		let rendered = template.content;

		for (const [key, value] of Object.entries(variables)) {
			if (value !== undefined && value !== null) {
				const placeholder = `{{${key}}}`;
				rendered = rendered.replaceAll(placeholder, value);
			}
		}

		// Remove any remaining optional variables that weren't provided
		rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');

		return { success: true, data: rendered };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'RENDER_ERROR',
				message: `Failed to render prompt: ${error}`,
				cause: error,
			},
		};
	}
}

/**
 * Validate the entire prompt system
 * Checks that all referenced files exist and are valid
 * Call this on startup to catch configuration errors early
 */
export function validatePromptSystem(): Result<void> {
	try {
		// Load versions manifest
		const manifestResult = loadVersionsManifest();
		if (!manifestResult.success) {
			return manifestResult as Result<void>;
		}

		const manifest = manifestResult.data;

		// Validate that "latest" points to a valid suite
		const latestSuite = manifest[manifest.latest];
		if (!latestSuite || typeof latestSuite === 'string') {
			return {
				success: false,
				error: {
					type: 'VALIDATION_ERROR',
					message: `"latest" points to invalid suite: ${manifest.latest}`,
				},
			};
		}

		// Validate all suite definitions
		const suiteVersions = Object.keys(manifest).filter(key => key !== 'latest');

		for (const suiteVersion of suiteVersions) {
			const suite = manifest[suiteVersion];
			if (typeof suite === 'string') continue; // Skip "latest"

			const suiteDef = suite as SuiteDefinition;

			// Validate extraction prompts
			for (const [type, version] of Object.entries(suiteDef.extraction)) {
				const result = loadPrompt('extraction', type, version);
				if (!result.success) {
					return {
						success: false,
						error: {
							type: 'VALIDATION_ERROR',
							message: `Suite ${suiteVersion}: Invalid extraction prompt ${type}/${version}`,
							cause: result.error,
						},
					};
				}
			}

			// Validate conceptualization prompt
			const conceptResult = loadPrompt(
				'conceptualization',
				'default',
				suiteDef.conceptualization
			);
			if (!conceptResult.success) {
				return {
					success: false,
					error: {
						type: 'VALIDATION_ERROR',
						message: `Suite ${suiteVersion}: Invalid conceptualization prompt ${suiteDef.conceptualization}`,
						cause: conceptResult.error,
					},
				};
			}
		}

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'VALIDATION_ERROR',
				message: `Prompt system validation failed: ${error}`,
				cause: error,
			},
		};
	}
}

/**
 * Clear the prompt cache
 * Useful for testing or forcing reload
 */
export function clearPromptCache(): void {
	promptCache.clear();
	versionsManifest = null;
}

/**
 * Helper function to get prompt version for a specific extraction type
 * from a suite definition
 */
export function getExtractionPromptVersion(
	suite: SuiteDefinition,
	type: ExtractionType
): string {
	return suite.extraction[type];
}

/**
 * Helper function to get conceptualization prompt version
 * from a suite definition
 */
export function getConceptualizationPromptVersion(suite: SuiteDefinition): string {
	return suite.conceptualization;
}
