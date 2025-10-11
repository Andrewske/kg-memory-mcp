# Benchmark Analysis: v1.1 vs v1.0 Prompts

**Comparison**: 2025-10-10 (v1.1) vs 2025-10-09 (v1.0)
**Source**: default-text.md (same fixture)
**Model**: gpt-4o-mini (same)

---

## Executive Summary

The v1.1 prompts show **significant improvements in coverage and detail extraction**, with triple count more than doubling (53 → 110). However, **critical entity normalization issues persist**, and the **deduplication bug remains unfixed**.

### Score Estimates

| Criterion | v1.0 Score | v1.1 Estimated | Change | Status |
|-----------|------------|----------------|--------|--------|
| **Coverage** | 5/10 | **7/10** | **+2.0** | ✅ **Fixed** |
| **Relevance** | 6/10 | **6.5/10** | **+0.5** | ⚠️ **Partial** |
| **Search Utility** | 4/10 | **4/10** | **0.0** | ❌ **No Change** |
| **Deduplication** | 2/10 | **2/10** | **0.0** | ❌ **No Change** |
| **Concepts** | 7/10 | **7/10** | **0.0** | ✅ **Maintained** |
| **Overall** | 4.9/10 | **5.8/10** | **+0.9** | ⚠️ **Progress** |

**Grade**: Still **D** (Below Expectations), but approaching **C** (Acceptable)

---

## What Improved ✅

### 1. Coverage: 5/10 → 7/10 (+2.0)

**Major Win**: Triple count doubled from 53 to 110, capturing much more detail.

#### Temporal Information Now Captured
```
v1.0: ❌ Missing dates
v1.1: ✅ Extracted
- "ceremony" --[scheduled_for]-> "June 8th in Portland"
- "presentation to the marketing team" --[scheduled for]-> "next Tuesday"
- "Dad's retirement" --[occurred]-> "last month"
- "Grandma Helen's inability to travel" --[resulted_from]-> "hip surgery in February"
- "lease signing for new apartment" --[scheduled for]-> "April 10th"
- "MBA application deadline" --[is in]-> "six months"
- "planned trip to Barcelona" --[is in]-> "September"
- "Spanish lessons" --[occur every]-> "Wednesday evening"
```

**Impact**: Temporal context is now preserved, enabling time-based queries.

#### Organizations and Institutions Captured
```
v1.0: ❌ Missing organizational context
v1.1: ✅ Extracted
- "AI integration project at TechFlow Solutions"
- "natural language processing module" --[requested_by]-> "GreenSpace Analytics"
- "Maria Chen" --[works_at]-> "Quantum Dynamics"
- "MBA part-time at UC Berkeley"
- "online course on blockchain technology" (MIT OpenCourseWare implied)
```

**Impact**: Professional context preserved, work relationships clearer.

#### Causal and Temporal Sequences
```
v1.0: ❌ Limited causal relationships
v1.1: ✅ Improved
- "Grandma Helen's inability to travel" --[resulted_from]-> "hip surgery in February"
- "breakthrough in AI project" --[followed]-> "successful implementation of NLP module"
- "conflict" --[came to a head during]-> "yesterday's standup meeting"
- "Claire's postpartum depression" --[started]-> "two months ago"
```

**Impact**: Event chains and causality now represented.

#### ENTITY_EVENT Stage Now Working
```
v1.0: 0 triples from ENTITY_EVENT stage
v1.1: 38 triples from ENTITY_EVENT stage

Examples:
- "I" --[felt]-> "anxious about the presentation"
- "Sarah" --[mentioned]-> "the budget committee will also be attending"
- "David" --[had a breakthrough]-> "in the AI integration project"
- "I" --[implemented]-> "the natural language processing module"
```

**Impact**: Entity-to-event relationships now captured, adding context.

### Assessment: Coverage Goal Achieved ✅

The v1.1 prompts successfully addressed the coverage issue. Information density increased from ~50-60% to ~70-75% of source content.

---

## What Partially Improved ⚠️

### 2. Relevance: 6/10 → 6.5/10 (+0.5)

**Mixed Results**: Some predicate improvements, but generic relationships persist.

#### Better Predicates (✅)
```
v1.1 Good Examples:
- "felt_anxious_about", "felt_nervous_about", "felt_uncomfortable_witnessing"
- "struggling_with", "dealing_with", "overwhelmed_by"
- "tutoring", "teaching", "training"
- "criticized", "argued", "pushing_for"
- "reached_out_about", "collaborated", "implemented"
```

#### Generic Predicates Still Present (❌)
```
Still Generic (~15-20% of relationships):
- "mentioned" (appears 3 times)
- "talked_about" (appears 2 times)
- "brought_up"
- "is" (Dr. Maria Santos --[is]-> oncologist)
- "and_I" (awkward compound predicate)
```

#### Comparison: v1.0 vs v1.1

| Predicate Type | v1.0 Rate | v1.1 Rate | Target | Status |
|----------------|-----------|-----------|--------|--------|
| Generic | ~25% | ~15-20% | <15% | ⚠️ Close |
| Specific | ~75% | ~80-85% | >85% | ⚠️ Close |

**Impact**: Moderate improvement, but still short of target.

### Assessment: Relevance Partially Fixed ⚠️

Generic predicates reduced from 25% to 15-20%, but target is <15%. Close, but needs final push.

---

## What Did NOT Improve ❌

### 3. Search Utility: 4/10 → 4/10 (0.0)

**Critical Issue**: First-person pronouns still pervasive, making ~30% of triples unsearchable.

#### First-Person Pronouns Still Used (❌)

Count of "I" as entity:
```bash
v1.0: ~15 instances
v1.1: 17 instances (MORE than before!)

Examples from v1.1:
1. "I" --[feels_anxious_about]-> "presentation to the marketing team"
3. "I" --[had_coffee_with]-> "Mom"
11. "I" --[discussed_arranging]-> "live stream of the ceremony"
12. "I" --[working_on]-> "AI integration project at TechFlow Solutions"
20. "I" --[planning]-> "video call next Friday"
23. "Marcus" --[training]-> "I"
28. "I" --[suggested]-> "Claire talk to her doctor"
32. "I" --[reading]-> "Mindset by Carol Dweck"
34. "I" --[started_taking]-> "online course on blockchain technology"
36. "Elena Gutierrez" --[tutoring]-> "I"
37. "I" --[hoping_to_reach]-> "conversational level in Spanish"
39. "I" --[attending]-> "AI Innovation Conference in San Francisco"
41. "I" --[considering_pursuing]-> "MBA part-time at UC Berkeley"
44. "I" --[feeling_grateful_for]-> "people in my life"
45. "I" --[need_to_have]-> "conversation with Mr. Johnson"

ENTITY_EVENT stage:
1. "I" --[felt]-> "anxious about the presentation"
8. "I" --[discussed]-> "arranging for a live stream of the ceremony"
10. "I" --[implemented]-> "the natural language processing module"
... (many more)
```

**This makes searching for "What is the author doing?" or "Show all author activities" fail completely.**

#### Compound Entities Still Present (❌)
```
v1.1 Examples:
38. "Emma" --[and_I]-> "planning trip to Barcelona"
34. "Emma" --[and I]-> "are planning to move in together"

Should be:
- "[AUTHOR]" --[is planning trip to]-> "Barcelona with Emma"
- "Emma" --[is planning trip to]-> "Barcelona with [AUTHOR]"
- "[AUTHOR]" --[is planning to move in with]-> "Emma"
- "Emma" --[is planning to move in with]-> "[AUTHOR]"
```

#### Entity Consistency Issues (❌)
```
Inconsistent References:
- "Dr. Rodriguez" (line 43) vs "Dr. Amanda Rodriguez" (line 19)
- "Robert" (line 29 in ENTITY_EVENT) vs "Uncle Robert" (line 29 in ENTITY_ENTITY)
- "Mom" consistently used ✅
- "Emma" consistently used ✅
```

#### Search Query Test Results

Testing natural questions:

| Query | v1.0 Result | v1.1 Result | Status |
|-------|-------------|-------------|--------|
| "Find all information about the author" | ❌ Fails (pronouns) | ❌ Fails (pronouns) | No change |
| "What is Emma doing?" | ⚠️ Partial | ✅ Works | Improved |
| "Show all work-related activities" | ❌ Missing context | ⚠️ Partial | Improved |
| "When is Jake's wedding?" | ❌ Missing date | ✅ Works | **Fixed** |
| "Who works at TechFlow Solutions?" | ❌ Missing | ⚠️ Partial | Improved |

**Query Success Rate**: ~30-40% (unchanged from v1.0)

### Assessment: Search Utility NOT Fixed ❌

Despite better coverage, first-person pronoun usage makes ~30% of triples unsearchable. This is the **highest priority issue remaining**.

---

### 4. Deduplication: 2/10 → 2/10 (0.0)

**Still Broken**: Cross-stage deduplication continues to fail.

#### Fewer Obvious Duplicates, But Bug Persists

```
v1.0: ~18-20 exact cross-stage duplicates
v1.1: 2 exact cross-stage duplicates detected

Example from v1.1:
- ENTITY_ENTITY #25: "Claire" --[dealing_with]-> "postpartum depression" ❌ EXACT DUPLICATE
- ENTITY_EVENT #22: "Claire" --[is dealing with]-> "postpartum depression" ✅ KEPT
- EMOTIONAL_CONTEXT #8: "Claire" --[dealing_with]-> "postpartum depression" ❌ EXACT DUPLICATE
```

**Why fewer duplicates?**
- v1.1 prompts produce more diverse extractions per stage
- But the **deduplication system still doesn't compare across stages**
- This masks the bug but doesn't fix it

#### Evidence of Unfixed Bug

```
Dedup Summary from Report:
- Total Extracted: 111
- Total Kept: 110
- Exact Duplicates: 2
- Semantic Duplicates: 0
- Cross-Stage Duplicates: 0 ← Should be 2, not 0

Status: "0.0% dedup rate"
```

The report claims "Cross-Stage Duplicates: 0" but then marks 2 triples as exact duplicates. This confirms the deduplication logic **still doesn't check across stages**.

### Assessment: Deduplication Still Broken ❌

This is a **code bug**, not a prompt issue. See `DEDUPLICATION_BUG_REPORT.md` for details.

---

## Remaining Issues from PROMPT_IMPROVEMENTS.md

Let me check which of my original suggestions still apply:

### Issue 1: Entity Normalization (STILL NEEDED) ❌

**Original Problem**: First-person pronouns, compound entities
**Status in v1.1**: **NOT FIXED**

All 7 rules from PROMPT_IMPROVEMENTS.md still apply:
1. ❌ Replace first-person pronouns with "[AUTHOR]" - NOT DONE
2. ❌ Decompose compound entities - NOT DONE
3. ⚠️ Use full names consistently - PARTIALLY DONE
4. ⚠️ Avoid possessive constructions - MOSTLY DONE
5. ⚠️ Use specific names over generic roles - PARTIALLY DONE
6. ⚠️ Disambiguate when necessary - PARTIALLY DONE
7. ✅ Preserve professional titles - DONE

**Priority**: **CRITICAL** - This is now the #1 issue blocking search utility.

---

### Issue 2: Detail Extraction (MOSTLY FIXED) ✅

**Original Problem**: Missing temporal, quantitative, location data
**Status in v1.1**: **LARGELY FIXED**

Checking against the requirements:

#### Temporal Information
- ✅ Specific dates extracted (June 8th, April 10th, etc.)
- ✅ Durations captured (two months ago, three weeks ago, six months)
- ✅ Temporal sequences (resulted_from, followed, started)

#### Quantitative Information
- ⚠️ Percentages: Missing "87% accuracy" (minor issue)
- ✅ Counts: "second round of chemotherapy" captured
- ✅ Ordinals: "second round" captured

#### Location Information
- ✅ Specific venues: "Café Luna" implied, "Fit Life Gym" missing but context captured
- ✅ Cities: Portland, San Francisco, Denver (in context), Barcelona
- ✅ Organizations: TechFlow Solutions, GreenSpace Analytics, UC Berkeley, Quantum Dynamics

#### Causal Relationships
- ✅ Causal keywords captured: "resulted_from", "due to"
- ✅ Temporal cause/effect: hip surgery → can't travel

#### Professional/Academic Attribution
- ✅ Professional relationships: David as colleague, Luis as senior developer
- ✅ Supervisors: Margaret Kim implied
- ⚠️ Academic details: Journal publications missing (minor)

**Priority**: **LOW** - Most requirements met. Minor gaps acceptable.

---

### Issue 3: Relationship Specificity (PARTIALLY FIXED) ⚠️

**Original Problem**: Too many generic predicates (25%)
**Status in v1.1**: **IMPROVED** (now ~15-20%)

Checking against requirements:

#### Forbidden Generic Predicates
```
Still appearing in v1.1:
- "mentioned" (3 instances) - Should be "reported", "stated", "informed"
- "talked_about" (2 instances) - Should be "discussed", "addressed"
- "brought_up" (1 instance) - Should be "raised", "introduced"
- "is" (1 instance) - Should be "works_as", "serves_as"
```

#### Domain-Specific Verbs
```
✅ Good usage:
- Medical: "tutoring", "counseling" (implied), "treating" (implied)
- Professional: "collaborating", "implementing", "criticized", "argues"
- Educational: "teaching", "tutoring", "explains"
- Emotional: "felt_anxious_about", "struggling_with", "dealing_with"

❌ Generic still present:
- "mentioned", "talked_about" (communication)
- "is" (identity/role)
```

#### "Related To" Test
```
Testing problematic predicates:

"Sarah" --[mentioned]-> "budget committee attending"
→ Test: "Sarah is related to budget committee" (loses communication act)
→ FAIL: Too generic
→ Better: "informed about", "announced", "warned about"

"Dr. Maria Santos" --[is]-> "oncologist"
→ Test: "Dr. Maria Santos is related to oncologist" (loses profession)
→ FAIL: Too generic
→ Better: "works_as", "practices_as", "specializes_as"
```

**Priority**: **MEDIUM** - Close to target (<15%), but not quite there.

---

## Updated Recommendations

Based on this analysis, here's what still needs work:

### Priority 1 (CRITICAL): Entity Normalization

**The v1.1 prompts did NOT address first-person pronouns at all.**

From PROMPT_IMPROVEMENTS.md, add this to ALL extraction prompts:

```markdown
## CRITICAL: ENTITY NAMING RULES

### Rule 1: NEVER Use First-Person Pronouns
Replace ALL first-person pronouns with "[AUTHOR]" when they appear as entities.

FORBIDDEN: "I", "me", "my", "mine", "myself"

Examples:
❌ WRONG: "I" --[feels_anxious_about]-> "presentation"
✅ RIGHT: "[AUTHOR]" --[feels_anxious_about]-> "presentation"

❌ WRONG: "Marcus" --[training]-> "I"
✅ RIGHT: "Marcus" --[training]-> "[AUTHOR]"

❌ WRONG: "I" --[working_on]-> "AI project"
✅ RIGHT: "[AUTHOR]" --[working_on]-> "AI integration project"

This applies to BOTH subject and object positions.

### Rule 2: Decompose Compound Entities
NEVER use "and I" or "and me" in entity names. Create separate triples.

❌ WRONG: "Emma" --[and_I]-> "planning trip to Barcelona"
✅ RIGHT:
  - "[AUTHOR]" --[is planning trip to]-> "Barcelona"
  - "Emma" --[is planning trip to]-> "Barcelona"
  - "[AUTHOR]" --[is traveling with]-> "Emma"

❌ WRONG: "Emma and I" --[are planning to move in together]-> "in May"
✅ RIGHT:
  - "[AUTHOR]" --[is planning to move in with]-> "Emma"
  - "Emma" --[is planning to move in with]-> "[AUTHOR]"
  - "move-in event" --[scheduled for]-> "May"
```

**Expected Impact**: Search Utility 4→7, Query Success Rate 40%→70%

---

### Priority 2 (MEDIUM): Final Predicate Specificity Push

Only 4-5% more improvement needed. Target the most common generic predicates:

```markdown
## PREDICATE SPECIFICITY RULES

### Replace These Common Generic Predicates:

1. "mentioned" → Use context to pick specific verb:
   - Information sharing: "informed", "announced", "revealed", "disclosed"
   - Casual reference: "noted", "observed", "commented_on"
   - Warning: "warned_about", "cautioned_about"

2. "talked_about" → Use conversation context:
   - Discussion: "discussed", "deliberated_on", "addressed"
   - Suggestion: "proposed", "suggested", "recommended"
   - Planning: "planned", "coordinated", "arranged"

3. "brought_up" → Use initiation context:
   - Topic introduction: "introduced_topic", "raised_issue", "presented"
   - Problem flagging: "identified_concern", "highlighted_problem"

4. "is" (for roles/professions) → Use role-specific verbs:
   - Professions: "works_as", "practices_as", "serves_as"
   - Identity: "identifies_as", "is_known_as"
   - Status: "holds_position_of", "has_role_of"
```

**Expected Impact**: Relevance 6.5→7.5-8.0, Generic Rate 15-20%→<15%

---

### Priority 3 (LOW): Minor Coverage Gaps

These are nice-to-haves, not critical:

1. **Quantitative details**: Extract specific percentages/metrics when mentioned
   - "87% accuracy" should be captured as attribute or separate triple

2. **Venue names**: When specific locations mentioned, extract them
   - "Café Luna" (was in source, not extracted)
   - "Fit Life Gym" (was in source, partially captured)

3. **Academic publications**: When journals/publications mentioned
   - "Journal of Applied Machine Learning" (was in source, not extracted)

**Expected Impact**: Coverage 7→7.5 (marginal)

---

## Summary: Which Improvements Still Apply?

From the original PROMPT_IMPROVEMENTS.md document:

| Improvement Section | Status in v1.1 | Still Needed? | Priority |
|-------------------|----------------|---------------|----------|
| **Entity Normalization** | ❌ Not applied | **YES** | **CRITICAL** |
| **Detail Extraction** | ✅ Mostly applied | Minor gaps | LOW |
| **Relationship Specificity** | ⚠️ Partially applied | Yes, final 5% | MEDIUM |

---

## Recommended Next Steps

### Step 1: Apply Priority 1 Fix (Entity Normalization)

1. Update all 4 extraction prompt files:
   - `prompts/extraction/entity-entity/v1.1.md` → v1.2
   - `prompts/extraction/entity-event/v1.1.md` → v1.2 (if exists)
   - `prompts/extraction/event-event/v1.0.md` → v1.1
   - `prompts/extraction/emotional-context/v1.0.md` → v1.1

2. Add the "CRITICAL: ENTITY NAMING RULES" section at the TOP of each prompt

3. Create prompt suite v1.2 in `prompts/versions.json`

4. Run benchmark with v1.2:
   ```bash
   # Update benchmark.config.ts: promptVersion: 'v1.2'
   pnpm run benchmark -- --input src/benchmarks/shared/fixtures/default-text.md --type pipeline
   ```

5. Verify: `grep -i '"I"' benchmarks/results/pipeline/latest.md` should return 0 results

**Expected Result**: Search Utility 4→7, Overall Score 5.8→6.8

---

### Step 2: Apply Priority 2 Fix (Final Predicate Push)

After v1.2 validates successfully:

1. Add "PREDICATE SPECIFICITY RULES" section to same prompts

2. Increment to v1.3 (or v2.0 if combined with entity normalization)

3. Run benchmark and compare

4. Verify: Generic predicate rate <15%

**Expected Result**: Relevance 6.5→8.0, Overall Score 6.8→7.2

---

### Step 3: Fix Deduplication Bug (Code Change)

This is independent of prompt work. See `DEDUPLICATION_BUG_REPORT.md`.

**Expected Result**: Deduplication 2→9, Storage efficiency 100%

---

## Final Expected Scores

After all improvements:

| Criterion | v1.0 | v1.1 | v1.2 | v1.3 + Code Fix | Target |
|-----------|------|------|------|-----------------|--------|
| Coverage | 5/10 | 7/10 | 7/10 | 7/10 | 7/10 ✅ |
| Relevance | 6/10 | 6.5/10 | 6.5/10 | 8/10 | 8/10 ✅ |
| Search Utility | 4/10 | 4/10 | **7/10** | 7/10 | 6-7/10 ✅ |
| Deduplication | 2/10 | 2/10 | 2/10 | **9/10** | 9/10 ✅ |
| Concepts | 7/10 | 7/10 | 7/10 | 7/10 | 7/10 ✅ |
| **Overall** | 4.9 | 5.8 | **6.8** | **7.5** | **7.0-7.5** ✅ |

**Final Grade**: B (Good) - Production Ready

---

## Conclusion

The v1.1 prompts made **excellent progress on coverage** (+2 points), but **missed entity normalization entirely**. This is the **single most important fix** remaining for prompt improvements.

The good news: We're close! One more prompt iteration (v1.2) focusing on entity normalization should push us to B grade territory.

**Actionable**: Apply the "CRITICAL: ENTITY NAMING RULES" section to all extraction prompts and re-run the benchmark.
