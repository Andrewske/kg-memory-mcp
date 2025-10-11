# Extraction Prompt Improvement Guide

**Version**: 1.0
**Date**: 2025-10-09
**Based on Benchmark**: 2025-10-09T22-18-03-369-PST
**Current Prompt Version**: v1.0
**Target Prompt Version**: v2.0

---

## Executive Summary

Analysis of benchmark results reveals that **prompt improvements alone can boost extraction quality from 4.9/10 to ~6.5-7.0/10** by addressing three core issues:

1. **Entity Normalization** - First-person pronouns and compound entities make triples unsearchable
2. **Detail Extraction** - Missing temporal, quantitative, and location context
3. **Relationship Specificity** - Too many generic predicates that don't convey meaning

These improvements target the weakest areas (Coverage: 5/10, Search Utility: 4/10, Relevance: 6/10) while maintaining the strong concept generation (7/10).

---

## Current Performance Baseline

| Criterion | Current Score | Target Score | Improvement Path |
|-----------|---------------|--------------|------------------|
| Coverage | 5/10 | 7/10 | Detail extraction rules |
| Relevance | 6/10 | 8/10 | Predicate specificity |
| Search Utility | 4/10 | 6/10 | Entity normalization |
| Deduplication | 2/10 | 9/10 | Code fix (separate doc) |
| Concepts | 7/10 | 7/10 | Already good |
| **Overall** | **4.9/10** | **7.0/10** | **+2.1 points** |

---

## Issue 1: Entity Normalization

### Current Problems

**First-Person Pronouns** (makes ~20% of triples unsearchable):
```
❌ I --[am considering pursuing]-> an MBA part-time
❌ My therapist Dr. Kevin Matthews --[suggested]-> journaling
❌ My fitness journey --[is progressing well]-> with personal trainer Marcus
```

**Compound Entities** (creates malformed triples):
```
❌ Emma and I --[are planning to move in together in]-> May
❌ David and I --[had a breakthrough with]-> AI integration project
```

**Possessive Constructions** (unnecessarily complex):
```
❌ Max --[is my neighbor's dog]-> golden retriever
❌ Emma with her issues (as entity reference)
```

**Vague References** (not searchable):
```
❌ the office
❌ the meeting
❌ new promotion and night feedings (as single entity)
```

### Prompt Enhancement: Entity Normalization Rules

Add this section to extraction prompts:

```markdown
## ENTITY NORMALIZATION RULES

### Rule 1: First-Person Pronouns
Replace all first-person pronouns with "[AUTHOR]" or infer the author's name if known.

Examples:
❌ BAD: "I" --[am considering]-> "MBA program"
✅ GOOD: "[AUTHOR]" --[is considering]-> "MBA program"

❌ BAD: "My relationship with Emma" (as entity)
✅ GOOD: "[AUTHOR]'s relationship with Emma" OR decompose into separate triple

First-person indicators to replace:
- "I", "me", "my", "mine", "myself"
- "We", "us", "our", "ours" (when referring to author + someone)

### Rule 2: Decompose Compound Entities
When multiple people are referenced together, create separate triples for each person.

Examples:
❌ BAD: "Emma and I" --[are planning to move in together]-> "in May"
✅ GOOD:
  - "[AUTHOR]" --[is planning to move in with]-> "Emma"
  - "Emma" --[is planning to move in with]-> "[AUTHOR]"
  - "[AUTHOR]" --[plans to move]-> "May"
  - "Emma" --[plans to move]-> "May"

❌ BAD: "David and I" --[had a breakthrough with]-> "AI integration project"
✅ GOOD:
  - "[AUTHOR]" --[had breakthrough on]-> "AI integration project"
  - "David" --[had breakthrough on]-> "AI integration project"
  - "[AUTHOR]" --[collaborated with]-> "David"

### Rule 3: Use Full Names Consistently
Always use the most complete form of a person's name. Never use pronouns or abbreviations.

Examples:
❌ BAD: "Dr. V.", "the therapist", "she", "her"
✅ GOOD: "Dr. Patricia Vance"

❌ BAD: "Marcus", then later "my trainer"
✅ GOOD: "Marcus" (consistently)

When someone is first introduced with full name, use that form in ALL subsequent extractions:
- First mention: "My therapist Dr. Kevin Matthews"
- Extract as: "Dr. Kevin Matthews"
- All future references: "Dr. Kevin Matthews" (not "my therapist", "Dr. Matthews", "Kevin")

### Rule 4: Avoid Possessive Constructions in Entity Names
Extract possessive relationships as separate triples, not embedded in entity names.

Examples:
❌ BAD: "my neighbor's dog" (as entity name)
✅ GOOD:
  - Entity: "Max"
  - Triple: "Max" --[is dog belonging to]-> "[AUTHOR]'s neighbor"
  - OR: "Max" --[owned by]-> "Mr. Johnson"

❌ BAD: "Claire's mother-in-law"
✅ GOOD:
  - Entity: "Mrs. Peterson"
  - Triple: "Mrs. Peterson" --[is mother-in-law of]-> "Claire"

### Rule 5: Use Specific Names Over Generic Roles
When both name and role are provided, use the name. When only role is given, use specific role.

Examples:
❌ BAD: "the office", "the meeting", "the conference"
✅ GOOD: "TechFlow Solutions office", "marketing team presentation", "AI Innovation Conference"

❌ BAD: "the client"
✅ GOOD: "GreenSpace Analytics" (if name is mentioned in text)

❌ BAD: "new promotion and night feedings" (as single entity)
✅ GOOD: Extract as two separate entities or as attributes:
  - "Tom's new promotion" (entity or event)
  - "night feedings" (activity)

### Rule 6: Disambiguate When Necessary
If multiple people share the same name or role, add disambiguating context.

Examples:
- "Dr. Kevin Matthews (therapist)" vs "Dr. Maria Santos (oncologist)"
- "Tom (Claire's husband)" if there are multiple Toms in the text

### Rule 7: Preserve Professional Titles
Always include professional titles when provided (Dr., Professor, Mr., Mrs., etc.).

Examples:
✅ "Dr. Maria Santos" (not "Maria Santos")
✅ "Professor James Liu" (not "James Liu")
✅ "Mrs. Peterson" (not "Peterson")
```

### Expected Impact

- **Search Utility**: 4/10 → 6-7/10
- **Fixes**: ~20% of triples currently unsearchable due to first-person pronouns
- **Query Success Rate**: 30-40% → 60-70%
- **Entity Consistency**: 70% → 90%+

---

## Issue 2: Detail Extraction (Coverage)

### Current Problems

**Missing Temporal Information**:
```
Source: "Jake's wedding scheduled for June 8th in Portland"
Extracted: Mom --[worried about]-> logistics for Jake's wedding
Missing: June 8th date, Portland location
```

**Missing Quantitative Details**:
```
Source: "87% accuracy, which exceeds their initial expectations"
Extracted: (nothing about the metric)
Missing: Specific accuracy percentage, performance comparison
```

**Missing Location Context**:
```
Source: "Had coffee with Mom at Café Luna around 9 AM"
Extracted: Mom --[struggling with]-> Dad's retirement
Missing: Café Luna location, morning timeframe
```

**Missing Causal Relationships**:
```
Source: "can't travel easily anymore due to her hip surgery"
Extracted: Grandma Helen --[can't travel easily due to]-> hip surgery ✅ (actually captured!)
But many other causal links missed
```

**Missing Organizational Context**:
```
Source: "My colleague David and I at TechFlow Solutions"
Extracted: David --[had a breakthrough with]-> AI integration project
Missing: TechFlow Solutions as employer, David as colleague
```

### Prompt Enhancement: Detail Extraction Rules

Add this section to extraction prompts:

```markdown
## REQUIRED DETAIL EXTRACTION

### Temporal Information (Dates, Times, Durations)

ALWAYS extract temporal markers when present in the text.

#### Specific Dates
Extract dates as attributes or separate temporal triples.

Examples:
Source: "Jake's wedding scheduled for June 8th in Portland"
✅ Extract:
  - "Jake's wedding" --[scheduled for]-> "June 8th"
  - "Jake's wedding" --[will be held in]-> "Portland"
  - "Jake" --[getting married on]-> "June 8th"

Source: "The lease signing is scheduled for April 10th"
✅ Extract:
  - "lease signing" --[scheduled for]-> "April 10th"
  - "[AUTHOR]" --[signing lease on]-> "April 10th"

#### Durations
Extract time periods that provide context.

Examples:
Source: "working on this project for three months now"
✅ Extract:
  - "[AUTHOR]" --[has been working on for]-> "three months"
  - "project" --[duration so far]-> "three months"

Source: "dating for eight months now"
✅ Extract:
  - "[AUTHOR]" --[has been dating for]-> "eight months"
  - "[AUTHOR]'s relationship with Emma" --[duration]-> "eight months"

Source: "Started working out three weeks ago"
✅ Extract:
  - "[AUTHOR]" --[started working out]-> "three weeks ago"

#### Temporal Sequences
Capture sequence words that show order of events.

Keywords to watch for: "before", "after", "during", "while", "then", "next", "previously", "following"

Examples:
Source: "After having baby Oliver two months ago"
✅ Extract:
  - "baby Oliver" --[born]-> "two months ago"
  - "Claire" --[gave birth]-> "two months ago"
  - "postpartum depression" --[began after]-> "Oliver's birth"

### Quantitative Information (Numbers, Metrics, Measurements)

Extract all quantitative data that adds specificity.

#### Percentages and Metrics
Examples:
Source: "processing data with 87% accuracy, which exceeds expectations"
✅ Extract:
  - "machine learning algorithms" --[achieved accuracy of]-> "87%"
  - "accuracy" --[exceeds]-> "initial expectations"
  - "GreenSpace Analytics" --[received results with]-> "87% accuracy"

Source: "second round of chemotherapy"
✅ Extract:
  - "Aunt Susan" --[completed]-> "second round of chemotherapy"
  - "chemotherapy" --[round number]-> "2"

#### Counts and Quantities
Examples:
Source: "three weeks ago"
✅ Extract as temporal attribute (see above)

Source: "takes three years while working full-time"
✅ Extract:
  - "MBA program" --[duration]-> "three years"
  - "MBA program" --[attendance mode]-> "part-time"

### Location Information (Places, Venues, Cities)

ALWAYS extract location context when places are mentioned.

#### Specific Venues
Examples:
Source: "Had coffee with Mom at Café Luna around 9 AM"
✅ Extract:
  - "[AUTHOR]" --[met with]-> "Mom"
  - "meeting" --[occurred at]-> "Café Luna"
  - "meeting" --[occurred at time]-> "9 AM"

Source: "personal trainer Marcus at Fit Life Gym"
✅ Extract:
  - "Marcus" --[works at]-> "Fit Life Gym"
  - "[AUTHOR]" --[trains at]-> "Fit Life Gym"

#### Cities and Regions
Examples:
Source: "wedding in Portland"
✅ Extract:
  - "Jake's wedding" --[location]-> "Portland"

Source: "Grandma can participate virtually from her assisted living facility in Denver"
✅ Extract:
  - "Grandma Helen" --[resides in]-> "Denver"
  - "Grandma Helen" --[lives at]-> "assisted living facility in Denver"

#### Organizations and Institutions
Examples:
Source: "at TechFlow Solutions"
✅ Extract:
  - "[AUTHOR]" --[works at]-> "TechFlow Solutions"
  - "AI integration project" --[conducted by]-> "TechFlow Solutions"

Source: "our client, GreenSpace Analytics"
✅ Extract:
  - "GreenSpace Analytics" --[is client of]-> "TechFlow Solutions"
  - "customer feedback data" --[belongs to]-> "GreenSpace Analytics"

Source: "MBA part-time at UC Berkeley"
✅ Extract:
  - "MBA program" --[offered by]-> "UC Berkeley"
  - "[AUTHOR]" --[considering application to]-> "UC Berkeley"

### Causal Relationships (Cause and Effect)

Look for causal language and extract explicit causal relationships.

#### Causal Keywords
Watch for: "because", "due to", "caused by", "led to", "resulted in", "thanks to", "as a result of"

Examples:
Source: "can't travel easily anymore due to her hip surgery in February"
✅ Extract:
  - "Grandma Helen" --[cannot travel easily]-> "currently"
  - "travel difficulty" --[caused by]-> "hip surgery"
  - "hip surgery" --[occurred in]-> "February"

Source: "Her parents' messy divorce when she was sixteen affected her trust"
✅ Extract:
  - "Emma's parents" --[had]-> "messy divorce"
  - "divorce" --[occurred when Emma was]-> "sixteen years old"
  - "divorce" --[negatively affected]-> "Emma's trust in relationships"

Source: "driving her to every appointment while managing his own diabetes"
✅ Extract:
  - "Uncle Robert" --[drives to appointments]-> "Aunt Susan"
  - "Uncle Robert" --[managing]-> "diabetes"
  - "Uncle Robert" --[overwhelmed by]-> "caregiving and health management"

### Relationship and Attribution Details

Extract who is connected to whom and in what capacity.

#### Professional Relationships
Examples:
Source: "my colleague David"
✅ Extract:
  - "David" --[is colleague of]-> "[AUTHOR]"
  - "David" --[works at]-> "TechFlow Solutions"

Source: "My current supervisor Margaret Kim"
✅ Extract:
  - "Margaret Kim" --[supervises]-> "[AUTHOR]"
  - "Margaret Kim" --[works at]-> "TechFlow Solutions"

Source: "our senior developer Luis"
✅ Extract:
  - "Luis" --[role]-> "senior developer"
  - "Luis" --[works at]-> "TechFlow Solutions"

#### Family Relationships
Examples:
Source: "Claire's mother-in-law, Mrs. Peterson"
✅ Extract:
  - "Mrs. Peterson" --[is mother-in-law of]-> "Claire"
  - "Mrs. Peterson" --[is mother of]-> "Tom"

Source: "my brother Jake"
✅ Extract:
  - "Jake" --[is brother of]-> "[AUTHOR]"

### Academic and Professional Achievements

Extract publications, research, education details.

Examples:
Source: "published extensively in the Journal of Applied Machine Learning"
✅ Extract:
  - "Dr. Amanda Rodriguez" --[published in]-> "Journal of Applied Machine Learning"
  - "Dr. Amanda Rodriguez" --[has publication record]-> "extensive"

Source: "The instructor, Professor James Liu, explains complex cryptographic concepts"
✅ Extract:
  - "Professor James Liu" --[teaches]-> "blockchain technology course"
  - "Professor James Liu" --[affiliated with]-> "MIT OpenCourseWare"
  - "course" --[covers]-> "cryptographic concepts"
```

### Expected Impact

- **Coverage**: 5/10 → 7/10
- **Information Captured**: 50-60% → 70-75%
- **Fixes**: Missing dates, locations, metrics, causal chains, organizational context
- **Triple Count**: Should increase from ~35 unique to ~45-55 unique (more complete coverage)

---

## Issue 3: Relationship Specificity (Relevance)

### Current Problems

**Generic Predicates** (~25% of relationships):
```
❌ Dr. Patricia Vance --[is helping]-> Emma with her issues
❌ Uncle Robert --[updating about]-> Aunt Susan's cancer treatment
❌ Dr. Amanda Rodriguez --[reached out about]-> collaborating on a research paper
```

**Awkward Constructions**:
```
❌ Marcus --[is my personal trainer at]-> Fit Life Gym
   (mixing role with location in predicate)
❌ Max --[is my neighbor's dog]-> golden retriever
   (possessive in predicate, wrong object)
```

**Lost Semantic Meaning**:
```
❌ Generic: "is helping" → doesn't specify HOW (treating? counseling? supporting?)
❌ Generic: "updating about" → could be "reported progress on" or "shared concerns about"
❌ Generic: "reached out about" → could be "proposed collaboration on" or "invited to collaborate on"
```

### Prompt Enhancement: Relationship Specificity Rules

Add this section to extraction prompts:

```markdown
## RELATIONSHIP SPECIFICITY REQUIREMENTS

### Forbidden Generic Predicates

DO NOT use these generic predicates. Always find more specific alternatives.

#### Strictly Forbidden:
- "is" (except for identity: "is a", "is the")
- "has"
- "about"
- "concerning"
- "regarding"
- "related to"
- "involves"
- "connected to"

#### Use Sparingly (Only If No Better Alternative):
- "is helping" → specify: "is treating", "is counseling", "is training", "is teaching"
- "working on" → specify: "developing", "implementing", "researching", "debugging"
- "updating about" → specify: "reported progress on", "shared concerns about", "notified of"

### How to Choose Specific Predicates

#### Step 1: Identify the Relationship Type

Ask yourself:
1. What is the NATURE of the relationship?
   - Professional (colleague, supervisor, client)
   - Medical (treating, diagnosing, recovering from)
   - Educational (teaching, learning, studying)
   - Emotional (worried about, excited for, frustrated with)
   - Physical (located at, traveling to, living in)

2. What is the DIRECTION of the relationship?
   - Active: subject is doing something
   - Passive: subject is receiving/experiencing
   - Mutual: bidirectional interaction

3. What is the CONTEXT?
   - Professional setting
   - Personal relationship
   - Medical situation
   - Educational environment

#### Step 2: Select Domain-Specific Verbs

Use verbs that convey precise meaning within the context.

**Medical Context:**
❌ GENERIC: "Dr. Vance" --[is helping]-> "Emma"
✅ SPECIFIC: "Dr. Patricia Vance" --[is counseling]-> "Emma" (if therapy)
✅ SPECIFIC: "Dr. Patricia Vance" --[is treating]-> "Emma" (if medical treatment)

❌ GENERIC: "Aunt Susan" --[is doing]-> "cancer treatment"
✅ SPECIFIC: "Aunt Susan" --[is undergoing]-> "chemotherapy"
✅ SPECIFIC: "Aunt Susan" --[completed]-> "second round of chemotherapy"

**Professional Context:**
❌ GENERIC: "David" --[worked with]-> "me on AI project"
✅ SPECIFIC: "David" --[collaborated with]-> "[AUTHOR] on AI integration project"
✅ SPECIFIC: "David" --[co-developed]-> "AI integration project"

❌ GENERIC: "Dr. Rodriguez" --[reached out about]-> "research paper"
✅ SPECIFIC: "Dr. Amanda Rodriguez" --[proposed collaboration on]-> "research paper"
✅ SPECIFIC: "Dr. Amanda Rodriguez" --[invited to co-author]-> "research paper"

**Educational Context:**
❌ GENERIC: "Elena" --[is helping with]-> "Spanish"
✅ SPECIFIC: "Elena Gutierrez" --[tutors]-> "[AUTHOR] in Spanish"
✅ SPECIFIC: "Elena Gutierrez" --[teaches]-> "[AUTHOR]"

**Emotional Context:**
❌ GENERIC: "Tom" --[is having issues with]-> "work and parenting"
✅ SPECIFIC: "Tom" --[is overwhelmed by]-> "work and parenting demands"
✅ SPECIFIC: "Tom" --[is juggling]-> "new promotion and night feedings"

#### Step 3: Use Active Voice

Prefer active constructions over passive when possible.

Examples:
❌ PASSIVE: "Emma" --[is being treated by]-> "Dr. Vance"
✅ ACTIVE: "Dr. Patricia Vance" --[is treating]-> "Emma"

❌ PASSIVE: "Project" --[is being worked on by]-> "David and I"
✅ ACTIVE: "[AUTHOR]" --[is developing]-> "AI integration project"
✅ ACTIVE: "David" --[is developing]-> "AI integration project"

### Predicate Vocabulary by Domain

Use these domain-specific verbs as examples:

#### Medical/Health:
- treating, diagnosing, recovering from, suffering from, managing (condition)
- undergoing (treatment), completed (treatment), responding to (treatment)
- prescribed, monitored, hospitalized at, receiving care from
- experiencing (symptom), struggling with (condition)

#### Professional/Work:
- collaborating with, supervising, reporting to, managing
- developing, implementing, debugging, testing, deploying
- presenting to, consulting for, advising
- hired by, employed at, working for, contracted with

#### Educational:
- teaching, learning, studying, tutoring, mentoring
- enrolled in, attending, graduated from, applied to
- researching, writing about, published in
- earning (degree), pursuing (certification)

#### Emotional/Psychological:
- worried about, anxious about, excited for, dreading
- overwhelmed by, frustrated with, grateful for, proud of
- coping with, processing, reflecting on, struggling with

#### Relationships:
- dating, married to, divorced from, engaged to
- parent of, child of, sibling of, related to
- friend of, colleague of, neighbor of, acquainted with

#### Events:
- attending, hosting, organizing, participating in
- scheduled for, postponed to, cancelled
- occurred at, happened during, took place in

#### Location/Movement:
- located at, residing in, living in, working at
- traveling to, moving to, visiting
- commuting to, relocated from

### Validation Check: The "Related To" Test

Before finalizing a predicate, apply this test:

**Test**: Can you replace the predicate with "is related to" without losing significant meaning?

If YES → The predicate is TOO GENERIC. Find a better verb.
If NO → The predicate is specific enough.

Examples:
❌ "Emma" --[has connection with]-> "Dr. Vance"
   → Test: "Emma is related to Dr. Vance" (loses meaning of therapy relationship)
   → FAIL: Too generic
   → Fix: "Dr. Patricia Vance" --[is counseling]-> "Emma"

✅ "Tom" --[is overwhelmed by]-> "work demands"
   → Test: "Tom is related to work demands" (loses emotional state)
   → PASS: Specific enough

✅ "Aunt Susan" --[is undergoing]-> "chemotherapy"
   → Test: "Aunt Susan is related to chemotherapy" (loses active treatment)
   → PASS: Specific enough

### Common Mistakes and Fixes

| Mistake | Why It's Wrong | Better Alternative |
|---------|---------------|-------------------|
| "is" (linking) | Adds no semantic value | Use specific state/role verb |
| "has" | Too vague about relationship | Specify nature of possession/connection |
| "is helping" | Doesn't specify how | "is treating", "is counseling", "is training" |
| "working on" | Generic action | "developing", "implementing", "debugging" |
| "talking about" | Vague communication | "discussing", "presenting", "consulting on" |
| "is at" | Location only | "works at", "lives at", "located at" |
| "did" | Extremely vague | Use specific action verb |

### Examples: Before and After

#### Example 1: Medical Relationship
```
Source: "She mentioned that her therapy sessions with Dr. Patricia Vance have been helping"

❌ BEFORE:
  - Emma --[is seeing]-> Dr. Patricia Vance
  - Dr. Vance --[is helping]-> Emma

✅ AFTER:
  - Emma --[is receiving therapy from]-> Dr. Patricia Vance
  - Dr. Patricia Vance --[is counseling]-> Emma
  - Emma --[benefits from sessions with]-> Dr. Patricia Vance
```

#### Example 2: Professional Collaboration
```
Source: "Dr. Amanda Rodriguez reached out about potentially collaborating on a research paper"

❌ BEFORE:
  - Dr. Rodriguez --[contacted]-> me
  - Dr. Rodriguez --[is interested in]-> research paper

✅ AFTER:
  - Dr. Amanda Rodriguez --[proposed collaboration with]-> [AUTHOR]
  - Dr. Amanda Rodriguez --[invited to co-author]-> research paper
  - research paper --[topic]-> AI methodologies
```

#### Example 3: Family Stress
```
Source: "Uncle Robert sounds exhausted - he's been driving her to every appointment while managing his own diabetes"

❌ BEFORE:
  - Uncle Robert --[is helping]-> Aunt Susan
  - Uncle Robert --[has]-> diabetes

✅ AFTER:
  - Uncle Robert --[drives to appointments]-> Aunt Susan
  - Uncle Robert --[is caregiver for]-> Aunt Susan
  - Uncle Robert --[is managing]-> diabetes
  - Uncle Robert --[is exhausted by]-> caregiving responsibilities
```

#### Example 4: Work Conflict
```
Source: "Luis openly criticized Jennifer's timeline estimates in front of the whole team"

❌ BEFORE:
  - Luis --[disagreed with]-> Jennifer
  - Luis --[talked about]-> timeline issues

✅ AFTER:
  - Luis --[openly criticized]-> Jennifer's timeline estimates
  - Luis --[challenged]-> Jennifer's project estimates
  - conflict --[occurred during]-> standup meeting
  - conflict --[witnessed by]-> entire team
```
```

### Expected Impact

- **Relevance**: 6/10 → 8/10
- **Generic Predicate Rate**: 25% → <15%
- **Semantic Clarity**: More meaningful, searchable relationships
- **Domain Appropriateness**: Context-aware verb selection

---

## Implementation Guide

### Step 1: Locate Current Extraction Prompts

Extraction prompts are likely in:
```
src/features/knowledge-extraction/prompts/
src/features/knowledge-extraction/extraction-prompts.ts
src/features/knowledge-extraction/four-stage-prompts.ts
```

Or possibly in:
```
src/shared/prompts/
src/config/prompts/
```

Search for:
```bash
grep -r "ENTITY_ENTITY\|EVENT_EVENT\|EMOTIONAL_CONTEXT" src/ --include="*.ts"
grep -r "Extract.*triple\|Extract.*knowledge" src/ --include="*.ts"
```

### Step 2: Update Each Stage Prompt

The four-stage extraction likely has separate prompts for:
1. ENTITY_ENTITY stage
2. ENTITY_EVENT stage (may be unused based on 0 extracted)
3. EVENT_EVENT stage
4. EMOTIONAL_CONTEXT stage

**Apply all three improvement sections to each stage prompt:**
1. Add "Entity Normalization Rules" section
2. Add "Required Detail Extraction" section
3. Add "Relationship Specificity Requirements" section

### Step 3: Update System Prompt (If Separate)

If there's a shared system prompt that applies to all stages, add the improvements there instead of duplicating across stage prompts.

### Step 4: Test Incrementally

Don't change everything at once. Test improvements incrementally:

#### Phase 1: Entity Normalization Only
1. Add entity normalization rules
2. Run benchmark
3. Check if first-person pronouns eliminated
4. Expected: Search Utility 4→6

#### Phase 2: Add Detail Extraction
1. Add detail extraction rules
2. Run benchmark
3. Check if dates, locations, metrics captured
4. Expected: Coverage 5→6.5

#### Phase 3: Add Relationship Specificity
1. Add relationship specificity rules
2. Run benchmark
3. Check generic predicate rate
4. Expected: Relevance 6→7.5, Overall 6.5→7.0

### Step 5: Version Prompts

```typescript
// In prompt configuration:
export const PROMPT_VERSION = "v2.0";

export const EXTRACTION_PROMPT_CHANGELOG = {
  "v2.0": {
    date: "2025-10-10",
    changes: [
      "Added entity normalization rules (first-person pronouns)",
      "Added required detail extraction (temporal, quantitative, location)",
      "Added relationship specificity requirements (domain-specific verbs)"
    ],
    expectedImprovements: {
      coverage: "5→7",
      relevance: "6→8",
      searchUtility: "4→6",
      overall: "4.9→7.0"
    }
  },
  "v1.0": {
    date: "2025-10-09",
    changes: ["Initial four-stage extraction implementation"],
    baseline: true
  }
};
```

---

## Validation Tests

### Test 1: Entity Normalization

After implementing entity normalization rules:

```bash
# Run benchmark
pnpm run benchmark -- --input src/benchmarks/shared/fixtures/default-text.md --type pipeline

# Check for first-person pronouns in output
grep -i "\"subject\": \"I\|\"subject\": \"my\|\"subject\": \"me" benchmarks/results/pipeline/*.md

# Expected: 0 results
```

**Success Criteria:**
- Zero first-person pronouns as entity names
- All compound entities decomposed
- Entity references consistent throughout extraction

### Test 2: Detail Coverage

After implementing detail extraction rules:

```bash
# Run benchmark and check for specific details
grep -i "june 8\|april 10\|87%\|eight months\|three months\|café luna\|portland\|uc berkeley" \
  benchmarks/results/pipeline/*.md

# Expected: At least 50% of these details present
```

**Success Criteria:**
- Temporal markers extracted (dates, durations)
- Quantitative data captured (percentages, counts)
- Location context included (venues, cities)
- Organizational entities present (companies, institutions)

### Test 3: Relationship Specificity

After implementing relationship specificity rules:

```bash
# Run benchmark and count generic predicates
grep -oP '"\[.*?\]"' benchmarks/results/pipeline/latest.md | \
  grep -iE "\[is\]|\[has\]|\[about\]|\[concerning\]|\[related to\]" | \
  wc -l

# Compare to total relationships - generic should be <15%
```

**Success Criteria:**
- Generic predicates <15% of total relationships
- Domain-specific verbs used appropriately
- Active voice preferred over passive
- All predicates pass "related to" test

### Test 4: Comprehensive Benchmark Comparison

Create a comparison script:

```typescript
// scripts/compare-benchmarks.ts
import { analyzeBenchmark } from './benchmark-analyzer';

const v1Results = analyzeBenchmark('2025-10-09T22-18-03-369-PST.md');
const v2Results = analyzeBenchmark('latest.md');

console.table({
  'Coverage': {
    v1: v1Results.coverage,
    v2: v2Results.coverage,
    delta: v2Results.coverage - v1Results.coverage
  },
  'Relevance': {
    v1: v1Results.relevance,
    v2: v2Results.relevance,
    delta: v2Results.relevance - v1Results.relevance
  },
  'Search Utility': {
    v1: v1Results.searchUtility,
    v2: v2Results.searchUtility,
    delta: v2Results.searchUtility - v1Results.searchUtility
  }
});
```

**Success Criteria:**
- Coverage: +1.5 to +2.0 points
- Relevance: +1.5 to +2.0 points
- Search Utility: +2.0 to +3.0 points
- Overall: +2.0 to +2.5 points

---

## Monitoring and Iteration

### Track These Metrics

After implementing improvements, monitor:

1. **Entity Normalization Success Rate**
   - % of entities using canonical names
   - # of first-person pronoun entities (target: 0)
   - # of compound entities (target: 0)

2. **Detail Extraction Rate**
   - % of temporal markers captured
   - % of quantitative data extracted
   - % of locations included

3. **Predicate Specificity Score**
   - % generic predicates (target: <15%)
   - Average predicate specificity (domain verb usage)
   - % passing "related to" test

4. **Overall Quality Score**
   - Coverage score (target: 7/10)
   - Relevance score (target: 8/10)
   - Search utility score (target: 6-7/10)

### Iterate Based on Results

If scores don't improve as expected:

**Coverage still low?**
- Add more examples to detail extraction rules
- Check if certain types of information consistently missed
- Add specific patterns for that information type

**Relevance still low?**
- Expand forbidden predicates list
- Add more domain-specific verb examples
- Strengthen validation checks

**Search utility still low?**
- Review entity consistency in actual output
- May need post-processing step (see note below)
- Check if normalization rules being followed

---

## Post-Processing Enhancement (Optional)

If prompt improvements don't achieve target scores, consider adding a post-processing step:

```typescript
// After extraction, before storage:
async function postProcessTriples(triples: Triple[]): Promise<Triple[]> {
  // 1. Entity resolution
  const entityMap = buildCoReferenceMap(triples);

  // 2. Normalize all entities
  const normalized = triples.map(t => ({
    ...t,
    subject: entityMap.get(t.subject) || t.subject,
    object: entityMap.get(t.object) || t.object
  }));

  // 3. Validate predicates
  const validated = normalized.filter(t =>
    !isGenericPredicate(t.predicate)
  );

  return validated;
}
```

This adds complexity but can catch issues that prompts miss.

---

## Expected Final Results

### Benchmark Scores After All Improvements

| Criterion | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Coverage | 5/10 | 7/10 | +2.0 |
| Relevance | 6/10 | 8/10 | +2.0 |
| Search Utility | 4/10 | 6-7/10 | +2-3 |
| Deduplication | 2/10 | 9/10* | +7.0* |
| Concepts | 7/10 | 7/10 | 0.0 |
| **Overall** | **4.9/10** | **7.0-7.5/10** | **+2.1-2.6** |

*Deduplication requires code fix (see separate document)

### Grade Improvement

- **Before**: D (Below Expectations) - 4.9/10
- **After**: B (Good) - 7.0-7.5/10
- **Production Ready**: Yes, with monitoring

### Quality Metrics

- **Entity Consistency**: 70% → 90%+
- **Information Coverage**: 50-60% → 70-75%
- **Generic Predicates**: 25% → <15%
- **Search Query Success**: 30-40% → 65-75%
- **Triple Count**: ~35 unique → ~45-55 unique

---

## Troubleshooting

### Issue: Prompts Too Long (Token Limit)

If adding all improvements makes prompts too long:

**Solution 1**: Condense examples
- Keep rules, reduce example count
- Reference patterns instead of full examples

**Solution 2**: Separate system prompt
- Move rules to shared system prompt
- Keep stage-specific examples in stage prompts

**Solution 3**: Multi-pass approach
- First pass: Extract with basic rules
- Second pass: Enhance with normalization and specificity

### Issue: Extraction Quality Inconsistent

If quality varies significantly across runs:

**Solution 1**: Add more explicit examples
- Show both good and bad examples
- Make rules more prescriptive

**Solution 2**: Increase temperature parameter
- Lower temperature (0.2-0.3) for more consistent output
- May reduce creativity but improve consistency

**Solution 3**: Add validation step
- Check extraction against rules
- Re-extract if validation fails

### Issue: Model Not Following Rules

If GPT-4o-mini ignores some rules:

**Solution 1**: Make rules more prominent
- Use CAPS for critical rules
- Repeat important rules in multiple places
- Add "CRITICAL" or "REQUIRED" tags

**Solution 2**: Try different model
- Test with GPT-4 (more capable, more expensive)
- Compare results to identify model limitations

**Solution 3**: Add few-shot examples
- Provide 3-5 complete extraction examples
- Show exactly the desired output format

---

## Next Steps

1. ✅ Read this document thoroughly
2. ✅ Locate current extraction prompts in codebase
3. ✅ Implement Phase 1 (Entity Normalization)
4. ✅ Run Test 1 and validate results
5. ✅ Implement Phase 2 (Detail Extraction)
6. ✅ Run Test 2 and validate results
7. ✅ Implement Phase 3 (Relationship Specificity)
8. ✅ Run Test 3 and validate results
9. ✅ Run comprehensive benchmark comparison
10. ✅ Document results and any deviations
11. ✅ Iterate if needed to reach target scores

---

## Related Documents

- **DEDUPLICATION_BUG_REPORT.md** - Critical code fix required for cross-stage deduplication
- **rubric.md** - Evaluation criteria and scoring guidelines
- **CLAUDE.md** - Project architecture and development guide
- **benchmarks/results/pipeline/2025-10-09T22-18-03-369-PST.md** - Baseline benchmark report

---

## Document Changelog

### 2025-10-09: Initial Version
- Created based on benchmark analysis of report 2025-10-09T22-18-03-369-PST
- Identified 3 core improvement areas: entity normalization, detail extraction, relationship specificity
- Provided detailed prompt enhancements with examples
- Estimated +2.1 point improvement in overall quality score
- Documented implementation guide and validation tests

---

*Generated by AI Quality Analyst based on benchmark report analysis*
*For questions or clarifications, review the source benchmark report and rubric*
