# Benchmark Suite

Performance and quality benchmarks for the Knowledge Graph MCP Server pipeline.

## Table of Contents

- [Quick Start](#quick-start)
- [Available Benchmarks](#available-benchmarks)
- [Comparison Tools](#comparison-tools)
- [Quality Evaluation](#quality-evaluation)
- [Iteration Workflow](#iteration-workflow)
- [Output Structure](#output-structure)
- [Metrics Reference](#metrics-reference)
- [Test Fixtures](#test-fixtures)
- [Advanced Usage](#advanced-usage)
- [Tips & Best Practices](#tips--best-practices)

## Quick Start

```bash
# Run full pipeline benchmark
pnpm benchmark:pipeline

# Run extraction only
pnpm benchmark:extraction

# Run concepts only
pnpm benchmark:concepts

# Run deduplication only
pnpm benchmark:dedup

# Compare last 5 pipeline runs
pnpm benchmark:compare --type pipeline --last 5

# Clean old results (keep last 10)
pnpm benchmark:clean --all --keep 10
```

## Available Benchmarks

### Pipeline Benchmark (`benchmark:pipeline`)

Tests complete extraction → concepts → (optional) deduplication pipeline.

**Use when:**
- Testing complete workflow changes
- Model/configuration updates
- End-to-end performance validation

**Options:**
```bash
--input <file>              # Custom input file
--fixture <size>            # Use fixture (micro, tiny, small, medium, large, xlarge, default)
--model <model>             # AI model to use
--provider <provider>       # openai or anthropic
--enable-dedup              # Enable deduplication
--prompt-version <version>  # Track prompt iterations
--notes <text>              # Add notes to benchmark
```

**Example:**
```bash
pnpm benchmark:pipeline --fixture default --prompt-version v1.0 --notes "Baseline extraction quality"
```

### Extraction Benchmark (`benchmark:extraction`)

Tests only knowledge extraction stage.

**Use when:**
- Iterating on extraction prompts
- Optimizing extraction quality
- Testing different AI models

**Example:**
```bash
pnpm benchmark:extraction --model gpt-4o --prompt-version v2.1
```

### Concepts Benchmark (`benchmark:concepts`)

Tests only concept generation stage.

**Use when:**
- Iterating on conceptualization prompts
- Testing abstraction level distribution
- Optimizing concept quality

### Deduplication Benchmark (`benchmark:dedup`)

Tests semantic deduplication effectiveness.

**Use when:**
- Testing deduplication thresholds
- Measuring duplicate detection accuracy
- Optimizing dedup performance

## Comparison Tools

Compare benchmark results across iterations to track improvements and detect regressions.

### Basic Comparison

```bash
# Compare last 5 runs
pnpm benchmark:compare --type pipeline --last 5

# Compare specific runs by ID
pnpm benchmark:compare --ids run-001,run-002,run-003

# Compare by prompt version
pnpm benchmark:compare --prompt-version v1.0,v1.1,v2.0
```

### Date Range Comparison

```bash
# Compare runs in date range
pnpm benchmark:compare --from 2025-01-01 --to 2025-01-31

# Show statistics
pnpm benchmark:compare --stats
```

### Interpreting Results

The comparison tool shows:
- **Performance metrics**: Duration, tokens/sec, memory usage
- **Quality metrics**: Triples extracted, concepts generated, duplicates removed
- **Cost metrics**: Token usage and estimated costs
- **Trends**: Improvements or regressions across iterations

## Quality Evaluation

Beyond automated metrics, benchmark results can be evaluated for extraction quality using AI-powered analysis.

### Quality Rubric

The benchmark suite includes a comprehensive quality rubric that evaluates five dimensions:

1. **Coverage (30%)** - How completely extracted knowledge represents source text
2. **Relevance (25%)** - How meaningful and useful extracted triples are
3. **Search Utility (25%)** - How well the graph supports knowledge retrieval
4. **Deduplication Quality (10%)** - How appropriately duplicates are detected
5. **Concept Quality (10%)** - How well concepts categorize and abstract knowledge

**See:** [`src/benchmarks/rubric.md`](src/benchmarks/rubric.md) for detailed scoring criteria.

### AI-Powered Grading

Results can be graded by AI (Claude) using specialized analysis instructions:

1. **Load the rubric**: Read quality evaluation criteria
2. **Analyze the report**: Examine extraction data, concepts, and source text
3. **Grade each criterion**: Score based on rubric guidelines
4. **Provide feedback**: Explain scores with specific examples
5. **Suggest improvements**: Recommend prompt changes or process adjustments

**See:** [`src/benchmarks/CLAUDE.md`](src/benchmarks/CLAUDE.md) for AI grading instructions.

### Quality Workflow

1. Run benchmark to generate results
2. Review automated metrics in the report
3. Use AI grading to evaluate extraction quality
4. Identify improvement areas from feedback
5. Iterate on prompts or configuration
6. Re-run benchmark to measure improvement

## Iteration Workflow

Systematic approach to improving extraction quality:

### 1. Establish Baseline

Run full pipeline to establish baseline metrics:

```bash
pnpm benchmark:pipeline --prompt-version v1.0 --notes "Initial baseline"
```

### 2. Make Changes

Modify prompts, models, or configuration based on analysis.

### 3. Test Changes

Run stage-specific benchmark for faster iteration:

```bash
pnpm benchmark:extraction --prompt-version v1.1 --notes "Improved entity normalization"
```

### 4. Compare Results

See improvements or regressions:

```bash
pnpm benchmark:compare --type extraction --last 2
```

### 5. Document

Update prompt version and add notes explaining changes.

### 6. Repeat

Continue iterating until quality targets are met.

### 7. Validate

Run full pipeline benchmark to ensure changes work end-to-end:

```bash
pnpm benchmark:pipeline --prompt-version v1.1
```

## Output Structure

Results are saved to `benchmarks/results/` directory:

```
benchmarks/results/
├── metrics.csv                     # Historical tracking (all benchmarks)
├── pipeline/
│   ├── 2025-01-15T10-30-00.json  # Raw metrics (JSON)
│   └── 2025-01-15T10-30-00.md    # Detailed report (Markdown)
├── extraction/
│   ├── 2025-01-15T11-00-00.json
│   └── 2025-01-15T11-00-00.md
├── concepts/
│   ├── 2025-01-15T11-15-00.json
│   └── 2025-01-15T11-15-00.md
└── deduplication/
    ├── 2025-01-15T11-30-00.json
    └── 2025-01-15T11-30-00.md
```

### Report Format

Each markdown report includes:

- **Summary**: Key metrics and configuration
- **Performance**: Duration, tokens/sec, memory usage
- **Quality**: Triples, concepts, deduplication stats
- **Cost**: Token usage and estimated cost
- **Raw Data**: Detailed extraction results by stage
- **Concepts**: Generated concepts with abstraction levels
- **Source Text**: Reference to fixture used

## Metrics Reference

### Performance Metrics

- **Total Duration** - End-to-end processing time (ms)
- **Stage Durations** - Time per pipeline stage (ms)
- **Tokens/Second** - Throughput rate
- **MS/Token** - Latency per token
- **Memory Usage** - Peak memory consumption

### Quality Metrics

- **Triples Extracted** - Total knowledge triples extracted
- **Triples by Stage** - Entity-Entity, Entity-Event, Event-Event, Emotional
- **Duplicates Removed** - Exact and semantic duplicates detected
- **Concepts Generated** - Hierarchical concepts created
- **Average Confidence** - Mean confidence scores
- **Deduplication Rate** - Percentage of triples removed as duplicates

### Cost Metrics

- **Input Tokens** - Tokens sent to AI models
- **Output Tokens** - Tokens generated by AI models
- **Total Tokens** - Combined token usage
- **Estimated Cost** - Approximate USD cost based on model pricing
- **API Calls** - Number of API requests made

### Search Metrics (Future)

- **Recall** - How many relevant results are retrieved
- **Precision** - How many retrieved results are relevant
- **F1 Score** - Harmonic mean of precision and recall

## Test Fixtures

Available test fixtures in `src/benchmarks/shared/fixtures/`:

| Fixture | Size | Characters | Use Case |
|---------|------|------------|----------|
| **micro** | Tiny | <100 | Quick smoke tests |
| **tiny** | Very Small | ~500 | Fast iteration testing |
| **small** | Small | ~1K | Unit testing |
| **medium** | Medium | ~5K | Standard testing |
| **large** | Large | ~20K | Performance testing |
| **xlarge** | Extra Large | ~50K | Stress testing |
| **default** | Standard | ~5K | Personal journal entry with rich content |

### Choosing Fixtures

- **Quick tests**: Use `micro` or `tiny` for rapid iteration
- **Quality evaluation**: Use `default` for comprehensive analysis
- **Performance testing**: Use `large` or `xlarge` for load testing
- **Custom content**: Use `--input` flag with your own text file

## Advanced Usage

### Custom Input Files

Test with your own content:

```bash
pnpm benchmark:pipeline --input ./my-test-data.txt --notes "Custom content test"
```

### Model Comparison

Compare different AI models:

```bash
# Test with GPT-4
pnpm benchmark:extraction --model gpt-4o --prompt-version v2.0 --notes "GPT-4 test"

# Test with GPT-3.5
pnpm benchmark:extraction --model gpt-3.5-turbo --prompt-version v2.0 --notes "GPT-3.5 test"

# Compare results
pnpm benchmark:compare --last 2
```

### Batch Comparison

Analyze multiple runs with statistics:

```bash
# Get statistics for all runs in January
pnpm benchmark:compare --from 2025-01-01 --to 2025-01-31 --stats
```

### Result Cleanup

Manage disk space by cleaning old results:

```bash
# Keep last 10 results for all benchmark types
pnpm benchmark:clean --all --keep 10

# Keep last 20 pipeline results only
pnpm benchmark:clean --type pipeline --keep 20

# Remove results older than 30 days
pnpm benchmark:clean --older-than 30
```

## Tips & Best Practices

### Version Control

- Always use `--prompt-version` to track iterations
- Use semantic versioning (v1.0, v1.1, v2.0)
- Increment minor version for prompt tweaks
- Increment major version for significant changes

### Documentation

- Add `--notes` explaining what changed
- Document rationale for prompt modifications
- Keep a changelog of major improvements
- Link benchmark runs to code commits

### Iteration Strategy

- Start with stage-specific benchmarks for faster iteration
- Use smaller fixtures (tiny, small) during development
- Run full pipeline with default fixture before committing
- Compare results before/after changes to measure impact

### Quality Focus

- Don't optimize for metrics alone - review actual extractions
- Use AI grading to catch quality issues metrics miss
- Test with diverse content types (personal, technical, news)
- Validate edge cases and error handling

### Performance Optimization

- Profile with `large` or `xlarge` fixtures for performance work
- Monitor token usage to control costs
- Compare extraction methods for speed/quality tradeoffs
- Batch similar changes to reduce test runs

### Cost Management

- Use smaller models (gpt-4o-mini) for development
- Use larger models (gpt-4o) for quality validation
- Monitor `metrics.csv` for cost trends
- Set budgets for benchmark runs

### Regression Detection

- Run benchmarks on main branch before merging PRs
- Compare feature branch results to main
- Use comparison tool to detect performance regressions
- Maintain baseline runs for major versions

### Collaboration

- Share benchmark results in PR descriptions
- Link to specific result files for reproducibility
- Use consistent fixtures for team comparisons
- Document expected scores for different content types

## Related Documentation

- [Main README](README.md) - Project overview and setup
- [CLAUDE.md](CLAUDE.md) - Development guide for AI assistants
- [Quality Rubric](src/benchmarks/rubric.md) - Detailed scoring criteria
- [AI Grading Instructions](src/benchmarks/CLAUDE.md) - AI analysis workflow

---

For questions or issues with benchmarks, see the [main documentation](README.md) or check the benchmark source code in `src/benchmarks/`.
