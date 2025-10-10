# Knowledge Graph Extraction Quality Rubric

**Version**: 1.0
**Last Updated**: 2025-10-09
**Purpose**: Evaluate and grade knowledge extraction quality across multiple dimensions

## Scoring Scale

- **10/10**: Exceptional - Exceeds all expectations
- **8-9/10**: Excellent - Meets all expectations with minor room for improvement
- **6-7/10**: Good - Solid performance with notable improvement areas
- **4-5/10**: Fair - Basic functionality but significant gaps
- **2-3/10**: Poor - Major issues that limit usability
- **0-1/10**: Critical - Fundamentally broken or unusable

---

## Criterion 1: Coverage (Weight: 30%)

**Definition**: How completely does the extracted knowledge graph represent the information in the source text?

### Scoring Guidelines

#### 10/10 - Exceptional Coverage
- ALL key entities mentioned in text are extracted
- ALL significant relationships are captured
- Temporal and causal relationships preserved
- Context and nuance maintained
- No important information lost

**Example**: For a 500-word article, extracts 40-50 meaningful triples covering all major points, entities, and relationships.

#### 6-7/10 - Good Coverage
- Most key entities extracted (80%+)
- Major relationships captured
- Some temporal/causal relationships present
- Minor details may be missing
- Core narrative preserved

**Example**: For a 500-word article, extracts 25-35 triples covering main points but missing some detail.

#### 2-3/10 - Poor Coverage
- Only 30-50% of key entities extracted
- Many important relationships missing
- Little to no temporal/causal preservation
- Significant information gaps
- Narrative incomplete

**Example**: For a 500-word article, extracts only 5-10 triples, missing most context.

### Evaluation Checklist

- [ ] All named entities extracted?
- [ ] All action verbs captured as relationships?
- [ ] Temporal markers preserved (before/after/during)?
- [ ] Causal links maintained (because/led to/resulted in)?
- [ ] Contextual details included (location, manner, reason)?
- [ ] Implicit relationships made explicit?

### Current Baseline Expectations

Based on current extraction performance:
- **Personal narratives** (journal entries, emails): Expect 60-70% coverage (score: 6-7)
- **News articles**: Expect 70-80% coverage (score: 7-8)
- **Technical documents**: Expect 50-60% coverage (score: 5-6)

---

## Criterion 2: Relevance (Weight: 25%)

**Definition**: How meaningful and useful are the extracted triples for understanding the content?

### Scoring Guidelines

#### 10/10 - Exceptional Relevance
- Every triple adds meaningful semantic value
- Relationships are specific and informative
- No trivial or redundant extractions
- Appropriate level of detail for context
- Clear, unambiguous connections

**Example**: "Dr. Sarah Chen" --[pioneered research on]-> "neural network optimization" vs. "Dr. Sarah Chen" --[is]-> "researcher"

#### 6-7/10 - Good Relevance
- Most triples are meaningful (75%+)
- Mix of specific and generic relationships
- Some redundancy present
- Generally appropriate detail level
- Mostly clear connections

**Example**: Mix of good ("struggling with", "concerned about") and generic ("is", "has") relationships.

#### 2-3/10 - Poor Relevance
- Many trivial or meaningless triples
- Predominantly generic relationships
- High redundancy
- Inappropriate detail level (too vague or too granular)
- Ambiguous connections

**Example**: Mostly noise like "thing" --[about]-> "stuff" or "person" --[is]-> "being"

### Evaluation Checklist

- [ ] Are predicates specific rather than generic?
- [ ] Do relationships convey meaningful information?
- [ ] Is detail level appropriate for content type?
- [ ] Are there obvious redundancies?
- [ ] Would a human find these triples useful?
- [ ] Do triples stand alone without source text?

### Red Flags (Reduce Score)

- Generic predicates: "is", "has", "related to", "about", "concerning"
- Trivial details: "dog barking", "weather is nice"
- Obvious duplicates: Same meaning, different wording
- Missing context: Pronouns without antecedents ("he", "it", "that")
- Vague entities: "thing", "stuff", "place"

### Current Baseline Expectations

- **Acceptable generic predicate rate**: <20% of total relationships
- **Expected redundancy rate**: <10% semantic overlap
- **Minimum specificity**: 70% of predicates should be domain-specific verbs

---

## Criterion 3: Search Utility (Weight: 25%)

**Definition**: How effectively does the extracted graph support knowledge retrieval and search?

### Scoring Guidelines

#### 10/10 - Exceptional Search Utility
- Entities normalized consistently
- Relationships expressed in searchable forms
- Rich cross-referencing between related facts
- Supports complex queries naturally
- Enables effective semantic search

**Query Performance**: Can answer 90%+ of natural questions about the text.

#### 6-7/10 - Good Search Utility
- Most entities normalized (80%+)
- Relationships mostly searchable
- Some cross-referencing present
- Supports basic queries
- Semantic search works reasonably

**Query Performance**: Can answer 60-70% of natural questions about the text.

#### 2-3/10 - Poor Search Utility
- Inconsistent entity naming
- Relationships not in searchable forms
- Little cross-referencing
- Only trivial queries work
- Semantic search unreliable

**Query Performance**: Can answer <40% of natural questions about the text.

### Evaluation Checklist

#### Entity Normalization
- [ ] Same entity always has same name?
- [ ] Full names used over pronouns?
- [ ] Abbreviated forms expanded?
- [ ] Entities disambiguated when needed?

#### Relationship Quality
- [ ] Predicates use consistent vocabulary?
- [ ] Active voice preferred?
- [ ] Verb forms standardized?
- [ ] Relationships bidirectional where appropriate?

#### Connectivity
- [ ] Related facts linked through shared entities?
- [ ] Transitive relationships captured?
- [ ] Context chains maintained?

### Test Queries (Score based on success rate)

For personal narrative:
1. "Find all information about [person X]"
2. "What is [person X]'s relationship to [person Y]?"
3. "What events involve [location]?"
4. "Who is experiencing [emotional state]?"
5. "Show all health-related concerns"

For technical content:
1. "Find all research by [author]"
2. "What methods relate to [topic]?"
3. "Show causal relationships for [concept]"
4. "List all entities affiliated with [organization]"
5. "Find temporal sequence of [events]"

### Current Baseline Expectations

- **Entity consistency**: >85% of entity references use canonical form
- **Cross-referencing density**: Each entity appears in 2+ triples on average
- **Query success rate**: 60-70% for well-formed natural language questions

---

## Criterion 4: Deduplication Quality (Weight: 10%)

**Definition**: How appropriately are duplicates identified and removed?

### Scoring Guidelines

#### 10/10 - Exceptional Deduplication
- ALL exact duplicates correctly identified
- Semantic duplicates appropriately detected
- NO false positives (different facts marked as duplicates)
- Preserves all distinct information
- Optimal balance of precision and recall

#### 6-7/10 - Good Deduplication
- Most exact duplicates removed (>95%)
- Reasonable semantic deduplication
- Few false positives (<5%)
- Most distinct information preserved

#### 2-3/10 - Poor Deduplication
- Many exact duplicates remain
- Semantic deduplication unreliable
- Significant false positives (>15%)
- Distinct information lost

### Evaluation Checklist

#### Exact Duplicates
- [ ] Identical triples removed?
- [ ] Difference in stage doesn't prevent dedup?
- [ ] Confidence scores merged appropriately?

#### Semantic Duplicates
- [ ] Near-synonyms detected?
- [ ] Paraphrases identified?
- [ ] Different perspectives differentiated?

#### False Positives
- [ ] Similar but distinct facts kept separate?
- [ ] Different semantic nuances preserved?
- [ ] Temporal variations maintained?

### Common Issues

**False Negatives** (should be duplicates but aren't):
- "is worried about" vs "concerned about" (same meaning)
- "Dr. Smith" vs "Doctor Smith" (same entity)
- "experiencing depression" vs "has depression" (same state)

**False Positives** (marked as duplicates but different):
- "cleaning garage" vs "organizing garage" (different activities)
- "thinking about MBA" vs "enrolled in MBA" (different stages)
- "before the meeting" vs "after the meeting" (opposite temporal)

### Current Baseline Expectations

- **Exact duplicate detection**: >98% precision and recall
- **Semantic duplicate threshold**: 0.85+ similarity for removal
- **False positive rate**: <5% of removed triples
- **Information preservation**: >95% of distinct facts retained

---

## Criterion 5: Concept Quality (Weight: 10%)

**Definition**: How well do generated concepts categorize and abstract the knowledge?

### Scoring Guidelines

#### 10/10 - Exceptional Concepts
- All major themes captured
- Appropriate abstraction levels (general + specific)
- Clear hierarchy of concepts
- Concepts enable effective filtering
- No trivial or redundant concepts

#### 6-7/10 - Good Concepts
- Most major themes present (75%+)
- Reasonable abstraction levels
- Some hierarchy present
- Concepts somewhat useful for filtering
- Minor redundancy (<10%)

#### 2-3/10 - Poor Concepts
- Many themes missing (>40%)
- Inappropriate abstraction levels
- No clear hierarchy
- Concepts not useful for filtering
- High redundancy (>25%)

### Evaluation Checklist

- [ ] All major content themes represented?
- [ ] Abstraction levels appropriate (not too general/specific)?
- [ ] Concepts form useful categories?
- [ ] No obviously redundant concepts?
- [ ] Concepts align with domain knowledge?

### Abstraction Level Guidelines

**General**: Broad categories applicable across domains
- Examples: "health", "relationships", "career", "education"
- Should cover 20-30% of concepts

**Specific**: Domain-specific categories
- Examples: "postpartum_health", "graduate_education", "mental_health_services"
- Should cover 70-80% of concepts

**Too General** (reduce score):
- "things", "events", "information", "topics"

**Too Specific** (reduce score):
- "garage_reorganization_project", "tuesday_morning_meeting"
- One-off events that don't generalize

### Current Baseline Expectations

- **Theme coverage**: >75% of major topics conceptualized
- **Abstraction mix**: 25% general, 75% specific
- **Duplicate concept rate**: <10%
- **Trivial concept rate**: <5%

---

## Overall Score Calculation

```
Overall Score = (Coverage × 0.30) + (Relevance × 0.25) + (Search Utility × 0.25) + (Deduplication × 0.10) + (Concepts × 0.10)
```

### Grade Thresholds

- **A (9.0-10.0)**: Exceptional - Ready for production
- **B (7.0-8.9)**: Good - Minor improvements needed
- **C (5.0-6.9)**: Acceptable - Notable improvements needed
- **D (3.0-4.9)**: Below expectations - Major improvements required
- **F (0.0-2.9)**: Failing - Fundamental issues to address

---

## Contextual Adjustments

Adjust expectations based on content type:

### Personal Narratives (journals, emails, messages)
- **Coverage**: Expect 60-70% baseline (casual writing harder to extract)
- **Relevance**: Tolerate 25% generic relationships (conversational nature)
- **Search Utility**: Prioritize entity normalization (many pronouns)

### News Articles
- **Coverage**: Expect 70-80% baseline (structured writing)
- **Relevance**: Expect 80%+ meaningful relationships
- **Search Utility**: High entity consistency expected

### Technical Documents
- **Coverage**: Expect 50-65% baseline (complex concepts)
- **Relevance**: Expect domain-specific relationships
- **Search Utility**: Technical terminology must be preserved

### Academic Papers
- **Coverage**: Expect 55-70% baseline (dense information)
- **Relevance**: Expect methodological relationships captured
- **Search Utility**: Citations and attributions critical

---

## Improvement Tracking

### Prompt Version History

#### v1.0 (Current Baseline)
- Four-stage extraction
- Basic entity and relationship extraction
- Generic concept generation
- 0.85 semantic similarity threshold
- **Average Score**: 6.5/10

#### Target v2.0 Goals
- Coverage: 7.5/10 (+1.0)
- Relevance: 7.5/10 (+1.5)
- Search Utility: 7.0/10 (+2.0)
- Overall: 7.5/10 (+1.0)

### Next Milestone

**Target**: Achieve consistent 7.5/10 overall score on diverse fixtures

**Focus Areas**:
1. Reduce generic relationships from 35% to <20%
2. Improve entity normalization from 70% to >85%
3. Enhance temporal/causal relationship extraction
4. Refine concept abstraction levels

---

## Usage Notes

- **Be Consistent**: Apply same standards across all evaluations
- **Document Examples**: Save good/bad examples for future reference
- **Update Regularly**: Adjust baselines as extraction improves
- **Context Matters**: Consider content type when scoring
- **Focus on Trends**: Track improvements over time, not just absolute scores

---

## Rubric Changelog

### 2025-10-09: Initial Version
- Created baseline rubric based on current extraction performance
- Established 5 evaluation criteria with weights
- Set initial expectations for personal narratives
- Defined 10-point scoring scale

**Expected Evolution**: As extraction improves, baseline expectations will increase.
