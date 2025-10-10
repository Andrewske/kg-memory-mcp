# Extraction Prompt Improvements (Future Work)

## Current Status
After implementing benchmark improvements, we observed **61% cross-stage duplication** in the four-stage extraction method.

## Problem
The four extraction stages currently use generic, overlapping prompts that cause multiple stages to extract the same information:

- **ENTITY_ENTITY**: "relationships between people, places, things, or concepts"
- **ENTITY_EVENT**: "how entities are involved in or affected by events"
- **EVENT_EVENT**: "causal, temporal, or logical relationships between events"
- **EMOTIONAL_CONTEXT**: "emotional states, feelings, or contextual information"

### Example Overlap
For "Mom struggled with Dad's retirement":
- ✅ ENTITY_ENTITY: Mom → struggled with → Dad's retirement
- ✅ ENTITY_EVENT: Mom → experienced → struggle (retirement as event)
- ✅ EVENT_EVENT: retirement → caused → struggle
- ✅ EMOTIONAL_CONTEXT: Mom → feeling stressed about → retirement

All are valid interpretations, but we only want ONE!

## Proposed Solution

### Make Prompts Mutually Exclusive with EXCLUDE Clauses

**File to modify**: `src/features/knowledge-extraction/extract.ts:491-516`

Replace the `createTypeSpecificPrompt` function with improved prompts that include explicit EXCLUDE clauses to prevent cross-stage duplication.

## Expected Impact

**Before**: 70 triples generated → 27 stored (61% duplication)
**After**: 70 triples generated → 60 stored (~15% duplication)

The remaining 15% should be legitimate edge cases where information genuinely fits multiple categories.

## Implementation Timeline

Implement AFTER benchmark improvements are complete and we have baseline data to measure against.
