# Benchmark Suite

Performance and quality benchmarks for the Knowledge Graph MCP Server pipeline.

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
--extraction-method <method> # single-pass or four-stage
--enable-dedup              # Enable deduplication
--prompt-version <version>  # Track prompt iterations
--notes <text>              # Add notes to benchmark
```

### Extraction Benchmark (`benchmark:extraction`)
Tests only knowledge extraction stage.

**Use when:**
- Iterating on extraction prompts
- Testing extraction methods (single-pass vs four-stage)
- Optimizing extraction quality

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

## Comparison Tool

Compare benchmark results across iterations:

```bash
# Compare last 5 runs
pnpm benchmark:compare --type pipeline --last 5

# Compare specific runs by ID
pnpm benchmark:compare --ids run-001,run-002,run-003

# Compare by prompt version
pnpm benchmark:compare --prompt-version v1.0,v1.1,v2.0

# Compare date range
pnpm benchmark:compare --from 2025-01-01 --to 2025-01-31

# Show statistics
pnpm benchmark:compare --stats
```

## Iteration Workflow

1. **Baseline** - Run full pipeline to establish baseline
```bash
pnpm benchmark:pipeline --prompt-version v1.0
```

2. **Iterate** - Make prompt/model changes

3. **Test** - Run stage-specific benchmark
```bash
pnpm benchmark:extraction --prompt-version v1.1
```

4. **Compare** - See improvements
```bash
pnpm benchmark:compare --type extraction --last 2
```

5. **Document** - Update prompt version and notes

6. **Repeat** - Continue iterating

## Output

Results are saved to `benchmarks/results/`:

```
benchmarks/results/
├── metrics.csv                     # Historical tracking
├── pipeline/
│   ├── 2025-01-15T10-30-00.json  # Raw metrics
│   └── 2025-01-15T10-30-00.md    # Detailed report
├── extraction/
├── concepts/
└── deduplication/
```

## Metrics Tracked

### Performance
- Total duration (ms)
- Stage durations
- Tokens per second
- MS per token
- Memory usage

### Quality
- Triples extracted
- Concepts generated
- Duplicates removed
- Average confidence
- Search recall/precision (future)

### Cost
- Input tokens
- Output tokens
- Total tokens
- Estimated cost (USD)
- API calls

## Test Fixtures

Available test fixtures in `src/benchmarks/shared/fixtures/`:

- **micro** - Tiny test (<100 chars)
- **tiny** - Very small test (~500 chars)
- **small** - Small test (~1K chars)
- **medium** - Medium test (~5K chars)
- **large** - Large test (~20K chars)
- **xlarge** - Extra large test (~50K chars)
- **default** - Standard journal entry (~5K chars, substantial content)

## Tips

- Use `--prompt-version` to track iterations
- Add `--notes` for context about changes
- Run benchmarks before/after changes to measure impact
- Use comparison tool to identify regressions
- Clean old results periodically to save space

## Advanced Usage

### Custom Input
```bash
pnpm benchmark:pipeline --input ./my-test-data.txt
```

### Model Testing
```bash
pnpm benchmark:extraction --model gpt-4o --prompt-version v2.0
```

### Batch Comparison
```bash
pnpm benchmark:compare --from 2025-01-01 --to 2025-01-31 --stats
```

For more details, see `BENCHMARKS.md` in the project root.
