# Changelog

All notable changes to the Knowledge Graph MCP Server project will be documented in this file.

## [Unreleased] - 2025-08-12

### Changes
- ADDED: Enhanced debug logging system with structured JSON output
- ADDED: Granular debug environment configuration variables (DEBUG_EXTRACTION, DEBUG_DATABASE, etc.)
- CHANGED: Pipeline report script with comprehensive context tracking
- CHANGED: Batch storage operations to use structured logging
- FIXED: Source field mismatch debugging in data flow tracking

### LEARNINGS
- Debug context must track source transformations (source → source_chunk_0)
- Post-transaction vector operations require explicit timing boundaries
- Query parameter logging essential for database operation debugging