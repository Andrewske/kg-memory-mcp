# HTTP Client Examples

This directory contains example client implementations for the Knowledge Graph MCP Server HTTP transport in various programming languages.

## Available Examples

### JavaScript/Node.js
- `javascript/simple-client.js` - Basic HTTP client using fetch
- `javascript/advanced-client.js` - Full-featured client with error handling
- `javascript/sse-client.js` - Server-Sent Events MCP client

### Python
- `python/simple_client.py` - Basic HTTP client using requests
- `python/advanced_client.py` - Full-featured client with async support
- `python/sse_client.py` - SSE/MCP client implementation

### Browser/Web
- `web/index.html` - Browser-based client example
- `web/client.js` - Browser JavaScript client
- `web/sse-client.js` - Browser SSE/MCP client

### cURL
- `curl/examples.sh` - Complete cURL command examples

## Running the Examples

### Prerequisites

1. Start the Knowledge Graph MCP Server in HTTP mode:
   ```bash
   cd /path/to/full-context-mcp
   ENABLE_HTTP_TRANSPORT=true pnpm run dev:http
   ```

2. Ensure the server is running on `http://localhost:3000`

### JavaScript Examples

```bash
cd examples/javascript
node simple-client.js
node advanced-client.js
node sse-client.js
```

### Python Examples

```bash
cd examples/python
pip install requests aiohttp sseclient-py
python simple_client.py
python advanced_client.py
python sse_client.py
```

### Browser Examples

```bash
cd examples/web
# Serve the files with a local HTTP server
python -m http.server 8080
# Open http://localhost:8080 in your browser
```

### cURL Examples

```bash
cd examples/curl
bash examples.sh
```

## Configuration

All examples are configured to connect to `http://localhost:3000` by default. You can modify the base URL in each example to point to your production server.

For production usage, make sure to:
- Use HTTPS instead of HTTP
- Set proper CORS origins
- Configure authentication if enabled
- Handle rate limiting appropriately

## Error Handling

All examples demonstrate proper error handling patterns:
- HTTP status code checking
- Response validation
- Network error handling
- Retry logic (in advanced examples)

## Next Steps

1. Choose the example that best fits your technology stack
2. Copy and adapt the code to your application
3. Configure the base URL for your environment
4. Add authentication if required
5. Implement proper error handling and logging
6. Add monitoring and metrics collection