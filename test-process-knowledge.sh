#!/bin/bash

# Initialize the MCP server
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' | pnpm tsx src/index.ts > /dev/null

# Call process_knowledge tool
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "process_knowledge", "arguments": {"text": "Kevin is a software engineer who loves TypeScript and works on knowledge graph systems.", "source": "test"}}}' | pnpm tsx src/index.ts