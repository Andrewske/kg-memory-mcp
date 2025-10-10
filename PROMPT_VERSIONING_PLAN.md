# Prompt Versioning System - Implementation Plan

## Overview
Create a file-based prompt versioning system for extraction and conceptualization prompts with full benchmark integration, type safety, and robust error handling.

## File Structure
```
prompts/
  extraction/
    entity-entity/
      v1.0.md
    entity-event/
      v1.0.md
    event-event/
      v1.0.md
    emotional-context/
      v1.0.md
  conceptualization/
    v1.0.md
  versions.json
```

## Implementation Steps

### 1. Create Prompt Files (5 files)

Migrate hardcoded prompts from source code to markdown files with YAML frontmatter.

**Format:**
```markdown
---
version: v1.0
created: 2025-10-10
description: Extract entity-entity relationships
changes: Initial version migrated from hardcoded prompt
notes: Extracts relationships between people, places, things, concepts
variables:
  required: [text]
  optional: [temporal_context]
---

Extract relationships between people, places, things, or concepts...
Text: {{text}}
{{temporal_context}}
Respond with a JSON object containing an array of triples.
```

**Source Locations:**
- Extraction prompts: `src/features/knowledge-extraction/extract.ts` lines 478-528
- Conceptualization prompt: `src/features/conceptualization/conceptualize.ts` lines 182-199

**Files to Create:**
1. `prompts/extraction/entity-entity/v1.0.md`
2. `prompts/extraction/entity-event/v1.0.md`
3. `prompts/extraction/event-event/v1.0.md`
4. `prompts/extraction/emotional-context/v1.0.md`
5. `prompts/conceptualization/v1.0.md`

### 2. Create versions.json

Maps suite versions to individual prompt versions.

```json
{
  "latest": "v1.0",
  "v1.0": {
    "extraction": {
      "entity-entity": "v1.0",
      "entity-event": "v1.0",
      "event-event": "v1.0",
      "emotional-context": "v1.0"
    },
    "conceptualization": "v1.0"
  }
}
```

**Purpose:**
- Bundle prompt versions together for reproducibility
- Allow individual prompts to evolve independently
- Support "latest" keyword for default version
- Track which prompts are used together

### 3. Create TypeScript Types

**File:** `src/shared/types/prompts.ts`

```typescript
export interface PromptMetadata {
  version: string;
  created: string;
  description: string;
  changes: string;
  notes: string;
  variables: {
    required: string[];
    optional: string[];
  };
}

export interface PromptTemplate {
  metadata: PromptMetadata;
  content: string;
}

export interface SuiteDefinition {
  extraction: {
    'entity-entity': string;
    'entity-event': string;
    'event-event': string;
    'emotional-context': string;
  };
  conceptualization: string;
}

export interface VersionsManifest {
  latest: string;
  [version: string]: string | SuiteDefinition;
}
```

### 4. Create Prompt Loader Module

**File:** `src/shared/services/prompt-loader.ts`

**Key Capabilities:**
- Load and parse YAML frontmatter (using `gray-matter` package)
- In-memory caching (load once per process)
- Template variable replacement with validation
- Startup validation of versions.json integrity
- Clear error messages for missing versions/files

**Core Functions:**
```typescript
/**
 * Load a specific prompt by category, type, and version
 */
export function loadPrompt(
  category: 'extraction' | 'conceptualization',
  type: string,
  version: string
): Result<PromptTemplate>

/**
 * Get suite definition for a specific version
 */
export function getSuiteDefinition(
  suiteVersion: string
): Result<SuiteDefinition>

/**
 * Render prompt with template variables
 */
export function renderPrompt(
  template: PromptTemplate,
  variables: Record<string, string>
): Result<string>

/**
 * Validate entire prompt system (call on startup)
 */
export function validatePromptSystem(): Result<void>

/**
 * Clear cache (for testing)
 */
export function clearPromptCache(): void
```

**Implementation Details:**

1. **Caching Strategy:**
   - Use Map to cache loaded prompts by key: `${category}:${type}:${version}`
   - Cache versions.json on first load
   - Never expire cache in production (static files)
   - Provide `clearPromptCache()` for testing

2. **YAML Parsing:**
   - Use `gray-matter` package: `npm install gray-matter`
   - Parse frontmatter into metadata object
   - Extract content as string
   - Validate required frontmatter fields

3. **Template Variables:**
   - Simple replacement: `{{variable_name}}` → value
   - Validate required variables are provided
   - Optional variables can be empty
   - Escape any remaining `{{}}` patterns to prevent errors

4. **Error Handling:**
   - Missing version file → `{ success: false, error: { type: 'FILE_NOT_FOUND', message: '...' } }`
   - Invalid YAML → `{ success: false, error: { type: 'PARSE_ERROR', message: '...' } }`
   - Missing required variable → `{ success: false, error: { type: 'MISSING_VARIABLE', message: '...' } }`
   - Missing suite in versions.json → `{ success: false, error: { type: 'SUITE_NOT_FOUND', message: '...' } }`

5. **Validation on Startup:**
   - Check versions.json exists and is valid JSON
   - Check all referenced prompt files exist
   - Check "latest" points to valid suite
   - Log warnings for unused prompt files

### 5. Update extract.ts

**File:** `src/features/knowledge-extraction/extract.ts`

**Changes:**
1. Remove `createTypeSpecificPrompt()` function (lines 502-528)
2. Add prompt loading logic to `extractByType()`:

```typescript
import { loadPrompt, getSuiteDefinition, renderPrompt } from '~/shared/services/prompt-loader.js';
import { env } from '~/shared/env.js';

export async function extractByType(data: ProcessKnowledgeArgs, type: TripleType) {
  try {
    // Get suite version from config
    const suiteVersion = env.PROMPT_VERSION || 'latest';

    // Get suite definition
    const suiteResult = getSuiteDefinition(suiteVersion);
    if (!suiteResult.success) {
      throw new Error(`Failed to load prompt suite: ${suiteResult.error?.message}`);
    }

    // Load specific prompt for this type
    const typeKey = type.toLowerCase().replace('_', '-');
    const promptVersion = suiteResult.data.extraction[typeKey];
    const promptResult = loadPrompt('extraction', typeKey, promptVersion);

    if (!promptResult.success) {
      throw new Error(`Failed to load prompt: ${promptResult.error?.message}`);
    }

    // Render prompt with variables
    const temporalContext = data.source_date
      ? `\n\nTemporal Context: This text is from ${new Date(data.source_date).toLocaleDateString()}. Consider this temporal context when extracting relationships.`
      : '';

    const renderedPrompt = renderPrompt(promptResult.data, {
      text: data.text,
      temporal_context: temporalContext,
    });

    if (!renderedPrompt.success) {
      throw new Error(`Failed to render prompt: ${renderedPrompt.error?.message}`);
    }

    const prompt = renderedPrompt.data;

    // Rest of extraction logic...
  } catch (error) {
    // Error handling...
  }
}
```

3. Handle conditional logic (temporal guidance for event-event) in prompt rendering

### 6. Update conceptualize.ts

**File:** `src/features/conceptualization/conceptualize.ts`

**Changes:**
1. Remove `createConceptualizationPrompt()` function (lines 182-199)
2. Add prompt loading logic to `generateConcepts()`:

```typescript
import { loadPrompt, getSuiteDefinition, renderPrompt } from '~/shared/services/prompt-loader.js';
import { env } from '~/shared/env.js';

export async function generateConcepts(
  input: ConceptualizationInput,
  metadata: { source: string; source_type: string }
) {
  try {
    // Get suite version
    const suiteVersion = env.PROMPT_VERSION || 'latest';
    const suiteResult = getSuiteDefinition(suiteVersion);
    if (!suiteResult.success) {
      throw new Error(`Failed to load prompt suite: ${suiteResult.error?.message}`);
    }

    // Load conceptualization prompt
    const promptVersion = suiteResult.data.conceptualization;
    const promptResult = loadPrompt('conceptualization', 'default', promptVersion);

    if (!promptResult.success) {
      throw new Error(`Failed to load prompt: ${promptResult.error?.message}`);
    }

    // Render with variables
    const renderedPrompt = renderPrompt(promptResult.data, {
      entities: input.entities.join(', '),
      events: input.events.join(', '),
      relationships: input.relationships.join(', '),
    });

    if (!renderedPrompt.success) {
      throw new Error(`Failed to render prompt: ${renderedPrompt.error?.message}`);
    }

    const prompt = renderedPrompt.data;

    // Rest of conceptualization logic...
  } catch (error) {
    // Error handling...
  }
}
```

### 7. Add PROMPT_VERSION Environment Variable

**File:** `src/shared/env.ts`

Add:
```typescript
PROMPT_VERSION: z.string().optional().default('latest'),
```

**File:** `.env.example`

Add:
```bash
# Prompt version to use (default: latest)
PROMPT_VERSION=v1.0
```

### 8. Enhanced Benchmark Integration

Update benchmark result metadata to include detailed prompt version information.

**Files to Update:**
- `src/benchmarks/pipeline.ts`
- `src/benchmarks/extraction.ts`
- `src/benchmarks/concepts.ts`

**Metadata to Add:**
```typescript
interface BenchmarkMetadata {
  // ... existing fields ...
  prompt_suite: string;
  prompts_used: {
    extraction: {
      'entity-entity': string;
      'entity-event': string;
      'event-event': string;
      'emotional-context': string;
    };
    conceptualization: string;
  };
}
```

**Implementation:**
```typescript
// Get suite info for metadata
const suiteVersion = config.promptVersion || env.PROMPT_VERSION || 'latest';
const suite = getSuiteDefinition(suiteVersion);

const metadata = {
  ...existingMetadata,
  prompt_suite: suiteVersion,
  prompts_used: suite.success ? suite.data : null,
};
```

### 9. Testing Strategy

#### Unit Tests

**File:** `src/shared/services/__tests__/prompt-loader.test.ts`

Tests:
- Parse YAML frontmatter correctly
- Validate frontmatter schema (required fields)
- Load and cache prompts
- Clear cache and reload
- Replace template variables
- Validate required variables present
- Handle missing files gracefully
- Handle invalid YAML gracefully
- Load suite definitions from versions.json
- Validate versions.json schema
- Handle missing suite versions
- Resolve "latest" keyword

#### Integration Tests

**File:** `src/features/knowledge-extraction/__tests__/extract-versioned.test.ts`

Tests:
- Load v1.0 suite, run extraction, verify output matches current behavior
- Load different versions, verify prompts change
- Test CLI flag override (`--prompt-version`)
- Test environment variable override
- Test error handling for missing versions
- Verify conditional logic (temporal context) still works

#### Benchmark Tests

**File:** `src/benchmarks/__tests__/versioning.test.ts`

Tests:
- Run extraction benchmark with v1.0
- Verify prompt versions stored in report metadata
- Run again with same version, verify reproducibility
- Compare reports from different versions

### 10. Documentation Updates

#### BENCHMARKS.md

Add new section: **Prompt Versioning and Iteration**

```markdown
## Prompt Versioning and Iteration

The extraction and conceptualization prompts are versioned to enable systematic improvement and reproducibility.

### File Structure

Prompts are stored in `prompts/` directory:
- `extraction/entity-entity/` - Entity-entity relationship extraction
- `extraction/entity-event/` - Entity-event relationship extraction
- `extraction/event-event/` - Event-event relationship extraction
- `extraction/emotional-context/` - Emotional context extraction
- `conceptualization/` - Concept generation prompts
- `versions.json` - Maps suite versions to individual prompt versions

### Iterating on Prompts

1. **Create new prompt version:**
   ```bash
   cp prompts/extraction/entity-entity/v1.0.md prompts/extraction/entity-entity/v1.1.md
   ```

2. **Edit the prompt:**
   - Update frontmatter metadata (version, description, changes)
   - Modify prompt content
   - Document reasoning in notes field

3. **Create new suite version in `versions.json`:**
   ```json
   "v1.1": {
     "extraction": {
       "entity-entity": "v1.1",
       "entity-event": "v1.0",
       "event-event": "v1.0",
       "emotional-context": "v1.0"
     },
     "conceptualization": "v1.0"
   }
   ```

4. **Test the new version:**
   ```bash
   # Update config
   # In benchmark.config.ts: promptVersion: 'v1.1'

   # Run benchmark
   pnpm benchmark:extraction
   ```

5. **Compare results:**
   ```bash
   pnpm benchmark:compare --last 2
   ```

6. **Review quality:**
   - Use AI grading workflow (see CLAUDE.md in benchmarks)
   - Check metrics vs baseline
   - Verify improvements

### Template Variables

Prompts support template variables:
- `{{text}}` - The input text to extract from (required)
- `{{temporal_context}}` - Temporal context if source_date provided (optional)
- `{{entities}}` - Entity list for conceptualization (required)
- `{{events}}` - Event list for conceptualization (required)
- `{{relationships}}` - Relationship list for conceptualization (required)

Variables are defined in frontmatter and validated at load time.
```

#### CLAUDE.md

Update **AI Configuration** section:

```markdown
### AI Configuration
- `AI_PROVIDER` - openai | anthropic (default: openai)
- `AI_MODEL` - Model for extraction (default: gpt-4o-mini)
- `EMBEDDING_MODEL` - Embedding model (default: text-embedding-3-small)
- `PROMPT_VERSION` - Prompt suite version to use (default: latest)
```

Add reference to prompt system:
```markdown
## Prompt Versioning

Extraction and conceptualization prompts are versioned in the `prompts/` directory.
See [Prompt Versioning Guide](PROMPTS.md) for details on the system architecture.
```

#### New File: PROMPTS.md

Create comprehensive developer guide:

```markdown
# Prompt Versioning System

## Architecture

The prompt versioning system allows systematic iteration and improvement of AI prompts
while maintaining reproducibility and traceability.

### Core Concepts

1. **Prompt Files**: Markdown files with YAML frontmatter containing prompt content
2. **Suite Versions**: Bundles of prompt versions that work together
3. **Template Variables**: Dynamic content injected at runtime
4. **Version Manifest**: `versions.json` maps suite versions to individual prompts

### File Format

#### YAML Frontmatter

Required fields:
- `version` - Semantic version (e.g., v1.0, v1.1, v2.0)
- `created` - ISO date when created
- `description` - Brief description of prompt purpose
- `changes` - What changed in this version
- `notes` - Additional context and reasoning

Optional fields:
- `variables.required` - Array of required template variables
- `variables.optional` - Array of optional template variables

#### Prompt Content

Template variables use `{{variable_name}}` syntax.
Variables are replaced at runtime with actual values.

Example:
```markdown
---
version: v1.0
created: 2025-10-10
description: Extract entity-entity relationships
changes: Initial version
notes: Focus on concrete relationships between named entities
variables:
  required: [text]
  optional: [temporal_context]
---

Extract relationships between people, places, things, or concepts.

Text: {{text}}
{{temporal_context}}

Respond with a JSON object containing an array of triples.
```

### Suite Versioning

`versions.json` structure:
```json
{
  "latest": "v1.0",
  "v1.0": {
    "extraction": {
      "entity-entity": "v1.0",
      "entity-event": "v1.0",
      "event-event": "v1.0",
      "emotional-context": "v1.0"
    },
    "conceptualization": "v1.0"
  }
}
```

**Guidelines:**
- Use semantic versioning (v1.0, v1.1, v2.0)
- Increment minor version for tweaks (v1.0 → v1.1)
- Increment major version for significant changes (v1.x → v2.0)
- Update "latest" to point to recommended version
- Keep old versions for reproducibility

### Best Practices

#### When to Create New Version

Create a new prompt version when:
- Improving clarity or specificity
- Adding/removing instructions
- Changing output format expectations
- Addressing quality issues found in benchmarks

#### Version Numbering

- **Patch** (v1.0.1): Typo fixes, clarification (rarely needed)
- **Minor** (v1.1): Instruction tweaks, small improvements
- **Major** (v2.0): Fundamental approach changes

#### Documentation

Always document in frontmatter:
- Why the change was made
- What problem it solves
- Expected impact on quality/performance
- Link to benchmark results if available

#### Testing

Before committing new version:
1. Run benchmarks with new version
2. Compare to baseline
3. Verify improvements in target metrics
4. Check for regressions in other metrics
5. Document results in benchmark report

### Template Variables

#### Variable Replacement

Simple string replacement:
```typescript
const rendered = prompt.replace('{{text}}', actualText);
```

#### Required vs Optional

- **Required**: Must be provided, error if missing
- **Optional**: Can be empty string, removed if not provided

#### Adding New Variables

1. Add to frontmatter variables list
2. Update prompt-loader.ts types if needed
3. Pass value when rendering prompt
4. Document in this guide

### Error Handling

The system provides clear errors:

- **Missing File**: "Prompt file not found: prompts/extraction/entity-entity/v1.0.md"
- **Invalid YAML**: "Failed to parse frontmatter in prompts/extraction/entity-entity/v1.0.md"
- **Missing Suite**: "Suite version 'v1.5' not found in versions.json"
- **Missing Variable**: "Required variable 'text' not provided for prompt entity-entity v1.0"

### API Reference

See `src/shared/services/prompt-loader.ts` for full API documentation.

Key functions:
- `loadPrompt(category, type, version)` - Load specific prompt
- `getSuiteDefinition(suiteVersion)` - Get suite definition
- `renderPrompt(template, variables)` - Render with variables
- `validatePromptSystem()` - Validate system integrity
```

### 11. Migration Strategy

Implement in three phases to minimize risk:

#### Phase 1: Setup (No Breaking Changes)

**Goal:** Create infrastructure without changing behavior

Tasks:
1. Create `prompts/` directory structure
2. Create all 5 prompt files from source code
3. Create `versions.json` with v1.0 suite
4. Create `src/shared/types/prompts.ts`
5. Create `src/shared/services/prompt-loader.ts`
6. Write unit tests for prompt loader
7. Add `PROMPT_VERSION` to env.ts
8. Keep existing code functioning

**Validation:**
- Tests pass
- Existing extraction/conceptualization work unchanged
- No runtime errors

#### Phase 2: Integration

**Goal:** Switch to using prompt loader

Tasks:
1. Update `extract.ts` to use prompt loader
2. Remove `createTypeSpecificPrompt()` function
3. Update `conceptualize.ts` to use prompt loader
4. Remove `createConceptualizationPrompt()` function
5. Add startup validation call
6. Update benchmark metadata storage
7. Run full test suite

**Validation:**
- All tests pass
- Benchmarks with v1.0 produce identical results to before
- Prompt versions appear in benchmark reports
- Error handling works correctly

#### Phase 3: Documentation

**Goal:** Complete documentation

Tasks:
1. Update BENCHMARKS.md with prompt iteration guide
2. Update CLAUDE.md with prompt version config
3. Create PROMPTS.md developer guide
4. Add inline comments to prompt files
5. Update README if needed

**Validation:**
- All documentation accurate
- Examples work as described
- System ready for prompt iteration

### 12. Success Criteria

The implementation is successful when:

- ✅ All existing benchmarks produce identical results with v1.0
- ✅ Can create v1.1, run benchmark, results differ appropriately
- ✅ Benchmark reports show exact prompt versions used
- ✅ Clear errors for missing/invalid versions
- ✅ System validates on startup
- ✅ Type-safe throughout (no `any` types)
- ✅ Comprehensive test coverage (>80%)
- ✅ Documentation complete and accurate
- ✅ Can iterate on prompts without touching code
- ✅ Easy rollback to previous versions

## Usage Workflow

### Daily Iteration Workflow

1. **Analyze current quality:**
   ```bash
   pnpm benchmark:pipeline
   # Review report, identify issues
   ```

2. **Create new prompt version:**
   ```bash
   cp prompts/extraction/entity-entity/v1.0.md prompts/extraction/entity-entity/v1.1.md
   # Edit v1.1.md, update metadata and content
   ```

3. **Create suite version:**
   ```json
   // In versions.json
   "v1.1": {
     "extraction": {
       "entity-entity": "v1.1",  // New version
       "entity-event": "v1.0",
       "event-event": "v1.0",
       "emotional-context": "v1.0"
     },
     "conceptualization": "v1.0"
   }
   ```

4. **Test new version:**
   ```typescript
   // In benchmark.config.ts
   promptVersion: 'v1.1',
   ```
   ```bash
   pnpm benchmark:extraction
   ```

5. **Compare results:**
   ```bash
   pnpm benchmark:compare --last 2
   # Review improvements/regressions
   ```

6. **Iterate or commit:**
   - If improvements: commit changes, update notes
   - If regressions: analyze, adjust, repeat
   - If no change: try different approach

### Review Workflow

For AI-powered quality review:

1. Run benchmark with new version
2. Load benchmark report
3. Use AI grading workflow (see benchmarks/CLAUDE.md)
4. Get qualitative feedback
5. Adjust prompts based on feedback
6. Repeat until quality targets met

## Dependencies

New packages needed:
- `gray-matter` - YAML frontmatter parsing
- `@types/gray-matter` - TypeScript types

```bash
pnpm add gray-matter
pnpm add -D @types/gray-matter
```

## Timeline Estimate

- **Phase 1**: 4-6 hours (setup, no breaking changes)
- **Phase 2**: 3-4 hours (integration, testing)
- **Phase 3**: 2-3 hours (documentation)
- **Total**: ~10-13 hours

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Prompt loading performance | Medium | In-memory caching, load once |
| Breaking existing behavior | High | Phase 1 keeps old code, extensive testing |
| Complex error cases | Medium | Comprehensive error handling, clear messages |
| Template variable injection | Low | Simple string replacement, validation |
| Version management complexity | Medium | Clear documentation, validation tools |

## Open Questions

1. Should we support multi-line template variables?
2. Should we add prompt diff visualization in reports?
3. Should conceptualization have multiple prompt types like extraction?
4. Should we version the deduplication process (currently no prompts)?
