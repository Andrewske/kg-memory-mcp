#!/bin/bash
# Profile test execution times

echo "Running tests with reporter to identify slow tests..."

bun test --reporter=verbose 2>&1 | \
  grep -E "✓|✗" | \
  grep -oP "\(\d+ms\)" | \
  sort -rn | \
  head -20

echo ""
echo "Top 20 slowest tests shown above"
