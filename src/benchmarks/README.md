# Benchmarks

**📚 Full documentation:** See [BENCHMARKS.md](../../BENCHMARKS.md) in the project root for complete benchmark documentation.

## What's in this directory

This directory contains the benchmark implementation code and AI-powered quality evaluation tools:

- **Benchmark scripts**: `pipeline.ts`, `extraction.ts`, `concepts.ts`, `deduplication.ts`
- **Comparison tools**: `compare.ts` for analyzing results across iterations
- **Cleanup utilities**: `clean.ts` for managing old results
- **Quality evaluation**: `CLAUDE.md` (AI grading instructions) and `rubric.md` (scoring criteria)
- **Shared utilities**: `shared/` directory with fixtures, metrics, storage, and helpers

## Quick Start

```bash
# Run full pipeline benchmark
pnpm benchmark:pipeline

# Compare last 5 runs
pnpm benchmark:compare --type pipeline --last 5

# Clean old results
pnpm benchmark:clean --all --keep 10
```

For detailed usage, options, and quality evaluation workflow, see [BENCHMARKS.md](../../BENCHMARKS.md).

## Quality Evaluation

Benchmark results can be evaluated using AI-powered analysis:

- **Rubric**: [rubric.md](rubric.md) - Quality scoring criteria across 5 dimensions
- **AI Grading**: [CLAUDE.md](CLAUDE.md) - Instructions for AI-powered quality analysis

## Development

The benchmark suite is built with:
- **TypeScript** for type safety
- **Shared fixtures** for consistent testing
- **Vocabulary tracking** for metrics normalization
- **PST timezone** for consistent timestamps
- **Baseline management** for regression detection
