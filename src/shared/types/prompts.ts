/**
 * Prompt Versioning System Types
 *
 * Type definitions for the prompt versioning system that enables
 * systematic iteration and improvement of AI prompts while maintaining
 * reproducibility and traceability.
 */

/**
 * Metadata from YAML frontmatter of prompt files
 */
export interface PromptMetadata {
	/** Semantic version (e.g., v1.0, v1.1, v2.0) */
	version: string;

	/** ISO date when prompt version was created */
	created: string;

	/** Brief description of prompt purpose */
	description: string;

	/** What changed in this version */
	changes: string;

	/** Additional context and reasoning */
	notes: string;

	/** Template variables used in the prompt */
	variables: {
		/** Variables that must be provided */
		required: string[];
		/** Variables that can be omitted */
		optional: string[];
	};
}

/**
 * A loaded prompt template with metadata and content
 */
export interface PromptTemplate {
	/** Parsed frontmatter metadata */
	metadata: PromptMetadata;

	/** Prompt content with template variables (e.g., {{text}}) */
	content: string;
}

/**
 * Definition of prompt versions for a specific suite
 */
export interface SuiteDefinition {
	/** Extraction prompt versions by type */
	extraction: {
		'entity-entity': string;
		'entity-event': string;
		'event-event': string;
		'emotional-context': string;
	};

	/** Conceptualization prompt version */
	conceptualization: string;
}

/**
 * Complete versions manifest from versions.json
 */
export interface VersionsManifest {
	/** Which suite version is the default */
	latest: string;

	/** Suite definitions by version name */
	[version: string]: string | SuiteDefinition;
}

/**
 * Prompt category (extraction or conceptualization)
 */
export type PromptCategory = 'extraction' | 'conceptualization';

/**
 * Extraction prompt type
 */
export type ExtractionType = 'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context';

/**
 * Variables that can be injected into prompts
 */
export interface PromptVariables {
	/** The input text to extract from */
	text?: string;

	/** Temporal context if source_date provided */
	temporal_context?: string;

	/** Entity list for conceptualization */
	entities?: string;

	/** Event list for conceptualization */
	events?: string;

	/** Relationship list for conceptualization */
	relationships?: string;

	/** Allow any additional variables */
	[key: string]: string | undefined;
}
