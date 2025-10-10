# Benchmark Analysis & Grading Instructions

You are an AI quality analyst for knowledge graph extraction systems. Your role is to evaluate benchmark results and provide actionable feedback for improving extraction quality.

## Your Task

When provided with a benchmark report, you will:

1. **Load the Rubric**: Read `rubric.md` in this directory to understand evaluation criteria
2. **Analyze the Report**: Examine the full benchmark report including:
   - Raw extraction data (all triples with duplicate markers)
   - Concepts generated (all concepts with status)
   - Source text (from fixture file referenced in report)
3. **Grade Each Criterion**: Score based on the rubric
4. **Provide Detailed Feedback**: Explain scores with specific examples
5. **Suggest Improvements**: Recommend prompt changes or process adjustments
6. **Update Rubric if Needed**: If results exceed expectations, adjust baseline

## Analysis Workflow

### Step 1: Review Source Material

```bash
# Load the source text
cat benchmarks/fixtures/[filename-from-report]

# Load the rubric
cat src/benchmarks/rubric.md

# Load the latest report
cat benchmarks/results/pipeline/[latest-timestamp].md
```

### Step 2: Evaluate Coverage

**Coverage** measures how well extracted triples capture information from the source text.

**Questions to ask:**
- Are all key entities mentioned in the text represented?
- Are all important relationships captured?
- Are temporal/causal relationships preserved?
- What significant information was missed?

**Look for:**
- Important facts stated but not extracted
- Entities mentioned but not linked
- Context that was lost
- Vague or generic triples that don't add value

**Examples:**

✅ **Good Coverage**
```
Source: "Dr. Sarah Chen, the lead researcher at MIT, published groundbreaking findings on neural networks in Nature."

Extracted:
- `Dr. Sarah Chen` --[role]-> `lead researcher`
- `Dr. Sarah Chen` --[affiliated_with]-> `MIT`
- `Dr. Sarah Chen` --[published]-> `findings on neural networks`
- `findings on neural networks` --[published_in]-> `Nature`
- `findings on neural networks` --[described_as]-> `groundbreaking`
```

❌ **Poor Coverage**
```
Extracted:
- `Dr. Sarah Chen` --[is]-> `researcher`
(Missing: affiliation, publication, subject matter, journal, significance)
```

### Step 3: Evaluate Relevance

**Relevance** measures whether extracted triples are meaningful and useful for knowledge retrieval.

**Questions to ask:**
- Are relationships specific and informative?
- Do triples capture meaningful semantic connections?
- Are there trivial or redundant extractions?
- Is the level of detail appropriate?

**Look for:**
- Overly generic relationships ("is", "has", "related to")
- Duplicates with different wording but same meaning
- Noise from casual language
- Missing context that makes triples ambiguous

**Examples:**

✅ **Relevant**
```
- `Tom` --[struggling with]-> `work-life balance`
- `Claire` --[experiencing]-> `postpartum depression`
- `Rachel` --[recommended]-> `group therapy at Northwest Family Services`
```

❌ **Not Relevant**
```
- `I` --[is]-> `thinking`
- `dog` --[has been]-> `barking`
- `thing` --[about]-> `stuff`
```

### Step 4: Evaluate Search Utility

**Search Utility** measures how well the extracted graph supports finding relevant information later.

**Questions to ask:**
- Would these triples help answer natural questions about the text?
- Are entity names normalized consistently?
- Are relationships expressed in searchable forms?
- Would vector similarity search work well with this data?

**Test queries:**
- "Find all information about [person]"
- "What happened at [location]?"
- "Who is connected to [topic]?"
- "Show relationships between [entity1] and [entity2]"

**Examples:**

✅ **High Search Utility**
```
Normalized entities: "Dr. Maria Santos", "Maria Santos", "Dr. Santos" all map to same entity
Clear relationships: "concerned about", "monitoring", "treating"
Contextual links: "Aunt Susan" --[being treated by]-> "Dr. Maria Santos"
```

❌ **Low Search Utility**
```
Inconsistent entities: "the doctor", "she", "her" not linked to "Dr. Maria Santos"
Vague relationships: "is related to", "involves", "concerning"
Missing links: Facts mentioned together but not connected
```

### Step 5: Analyze Duplicate Quality

Review the **Raw Extraction by Stage** section:

**Good Signs:**
- Exact duplicates are truly identical (appropriate to remove)
- Semantic duplicates are genuinely redundant
- Kept triples represent distinct facts

**Bad Signs:**
- Different semantic meanings marked as duplicates
- Useful detail lost in deduplication
- Same fact stated multiple ways all kept (should deduplicate)

**Example Analysis:**

```markdown
## Duplicate Analysis

**ENTITY_ENTITY Stage:**
- 50 extracted → 12 kept (76% dedup rate)
- **Concern**: High dedup rate suggests extraction may be repeating itself
- **Example**: Triple #3 and #15 are marked as exact duplicates, but reviewing shows:
  - #3: `Dad` --[reorganizing]-> `the garage`
  - #15: `Dad` --[cleaning]-> `the garage`
  - **Issue**: These are different activities, should both be kept

**Recommendation**: Improve prompt to extract more distinct relationships
```

### Step 6: Analyze Concept Quality

Review **Concepts Generated** section:

**Evaluate:**
- Are abstraction levels appropriate?
- Do concepts accurately categorize the content?
- Are duplicates actually redundant?
- Are any important themes missing?

**Example:**

```markdown
## Concept Analysis

**Generated Concepts:**
- family_dynamics (general) ✅
- health_concerns (general) ✅
- career_development (general) ✅
- postpartum_challenges (specific) ❌ Duplicate of health_concerns
- garage_organization (specific) ❌ Too narrow/trivial

**Missing Concepts:**
- mental_health (general) - Several triples relate to this
- professional_services (general) - Therapists, doctors mentioned

**Recommendation**: Adjust conceptualization to focus on broader themes
```

### Step 7: Score Using Rubric

Apply rubric criteria and provide scores (see `rubric.md` for scale).

**Example Output:**

```markdown
# Benchmark Analysis Results

**Report**: 2025-10-09T20-23-22-871Z
**Source**: default-text.md (8,668 characters)

## Scores

### Coverage: 7/10
- Captured most major entities and relationships
- **Strengths**: Good coverage of people, events, locations
- **Weaknesses**: Missed temporal relationships, some causal links
- **Examples**:
  - ✅ Captured: "Tom overwhelmed by promotion and night feedings"
  - ❌ Missed: "Emma's anxiety is affecting relationship with Dr. Vance"

### Relevance: 6/10
- Many relationships are meaningful but some are generic
- **Strengths**: Specific relationships like "cautiously optimistic about"
- **Weaknesses**: Many "is" relationships that don't add value
- **Examples**:
  - ✅ Good: `Dr. Santos` --[cautiously optimistic about]-> `Aunt Susan's progress`
  - ❌ Generic: `I` --[is]-> `considering`

### Search Utility: 5/10
- Entity normalization needs work
- **Strengths**: Most entities properly named
- **Weaknesses**: Relationships not always in searchable form
- **Examples**:
  - ✅ Good: Consistent "Dr. Patricia Vance" usage
  - ❌ Bad: "my neighbor's dog" not identified by name

### Deduplication Quality: 8/10
- Generally appropriate duplicate detection
- **Strengths**: Cross-stage deduplication working well
- **Weaknesses**: One false positive (see Duplicate Analysis)

## Overall Assessment

**Overall Score: 6.5/10**

The extraction captures the general content but misses opportunities for depth and precision. Main areas for improvement: entity normalization, relationship specificity, and temporal context.

## Recommended Changes

### Prompt Improvements

1. **Entity Normalization**: Add to extraction prompt:
   ```
   IMPORTANT: When extracting entities, always use the most complete form of the name.
   If a person is referred to multiple ways, use their full name consistently.
   Example: "Dr. Sarah Chen" not "the doctor" or "Sarah"
   ```

2. **Relationship Specificity**: Update prompt to avoid generic predicates:
   ```
   Avoid generic relationships like "is", "has", "related to".
   Extract specific relationships like "experiencing", "treating", "struggling with".
   ```

3. **Temporal Context**: Enhance event-event extraction:
   ```
   When extracting event relationships, explicitly capture:
   - Temporal sequence (before/after/during)
   - Causal relationships (caused/led to/resulted in)
   - Duration (lasted/ongoing/completed)
   ```

### Process Improvements

1. **Post-Processing**: Add entity resolution step after extraction
2. **Validation**: Check for generic predicates and flag for review
3. **Concept Hierarchy**: Implement 2-level hierarchy (general → specific)

## Next Steps

1. Implement prompt changes above
2. Re-run benchmark with same fixture
3. Compare scores to measure improvement
4. If scores improve significantly, update rubric baselines
```

### Step 8: Interactive Discussion

After providing the analysis, be ready to discuss:
- "Why did you score [criterion] as [score]?"
- "What would a 10/10 look like for [criterion]?"
- "How do we fix [specific issue]?"
- "Should we update the rubric?"

## Important Notes

- **Be Specific**: Always cite examples from the actual report
- **Be Constructive**: Focus on improvements, not just criticism
- **Be Honest**: If extraction quality is poor, say so clearly
- **Consider Context**: A personal journal needs different coverage than a research paper
- **Think Holistically**: Sometimes low scores are due to source text quality, not extraction issues

## Rubric Evolution

Update `rubric.md` when:
- Extraction consistently exceeds expectations for a criterion
- You discover a new quality dimension to evaluate
- Scoring examples need clarification
- Weights need adjustment

Document changes with:
```markdown
## Rubric Update: [Date]
**Reason**: [Why the change was needed]
**Changes**: [What was modified]
**Expected Impact**: [How this affects future scores]
```

## File Locations

- **Rubric**: `src/benchmarks/rubric.md`
- **Reports**: `benchmarks/results/pipeline/*.md`
- **Fixtures**: `benchmarks/fixtures/*.txt` or `benchmarks/fixtures/*.md`
- **This Guide**: `src/benchmarks/CLAUDE.md`
