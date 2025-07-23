#!/bin/bash

# Knowledge Graph MCP Server - cURL Examples
# Complete set of cURL commands for testing HTTP endpoints
#
# Prerequisites:
# 1. Start the Knowledge Graph MCP Server in HTTP mode:
#    ENABLE_HTTP_TRANSPORT=true pnpm run dev:http
# 2. Ensure jq is installed for pretty JSON output (optional)
#
# Usage: bash examples.sh

set -e  # Exit on any error

# Configuration
API_BASE_URL="http://localhost:3000/api"
HEADERS=(-H "Content-Type: application/json" -H "X-MCP-Version: 2024-11-05")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to print colored output
print_step() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Helper function to make pretty JSON output
pretty_json() {
    if command -v jq &> /dev/null; then
        jq '.'
    else
        cat
    fi
}

# Helper function to check if server is running
check_server() {
    print_step "Checking server availability"
    
    if curl -s -f "${API_BASE_URL}/health" > /dev/null; then
        print_success "Server is running and accessible"
    else
        print_error "Server is not accessible at ${API_BASE_URL}"
        print_info "Make sure to start the server with: ENABLE_HTTP_TRANSPORT=true pnpm run dev:http"
        exit 1
    fi
}

# Main execution
main() {
    echo -e "${BLUE}🚀 Knowledge Graph MCP Server - cURL Examples${NC}\n"
    
    # Check server availability
    check_server
    
    # 1. Health Check
    print_step "1. Health Check"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/health" | pretty_json
    print_success "Health check completed"
    
    # 2. Server Version
    print_step "2. Server Version"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/version" | pretty_json
    print_success "Version information retrieved"
    
    # 3. Server Capabilities
    print_step "3. Server Capabilities"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/capabilities" | pretty_json
    print_success "Capabilities listed"
    
    # 4. Server Metrics
    print_step "4. Server Metrics"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/metrics" | pretty_json
    print_success "Metrics retrieved"
    
    # 5. Process Knowledge (Simple)
    print_step "5. Process Knowledge - Simple Example"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/process-knowledge" \
        -d '{
            "text": "Alice is a software engineer at OpenAI. She specializes in natural language processing and has been working on large language models for 3 years.",
            "source": "curl_example_simple",
            "include_concepts": false,
            "deduplicate": true
        }' | pretty_json
    print_success "Simple knowledge processing completed"
    
    # 6. Process Knowledge (With Concepts)
    print_step "6. Process Knowledge - With Concepts"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/process-knowledge" \
        -d '{
            "text": "Bob is a data scientist at Google. He works on recommendation systems and loves Python programming. He recently published a paper on deep learning architectures for recommendation engines.",
            "source": "curl_example_concepts",
            "thread_id": "curl_demo_thread",
            "conversation_date": "2024-01-15T10:30:00Z",
            "include_concepts": true,
            "deduplicate": true
        }' | pretty_json
    print_success "Knowledge processing with concepts completed"
    
    # 7. Search Knowledge Graph
    print_step "7. Search Knowledge Graph"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/search-knowledge" \
        -d '{
            "query": "software engineer natural language processing Python",
            "limit": 5,
            "threshold": 0.7,
            "types": ["entity-entity", "entity-event"]
        }' | pretty_json
    print_success "Knowledge graph search completed"
    
    # 8. Search with Source Filter
    print_step "8. Search with Source Filter"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/search-knowledge" \
        -d '{
            "query": "data scientist machine learning",
            "limit": 10,
            "threshold": 0.6,
            "sources": ["curl_example_simple", "curl_example_concepts"]
        }' | pretty_json
    print_success "Filtered search completed"
    
    # 9. Search Concepts
    print_step "9. Search Concepts"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/search-concepts" \
        -d '{
            "query": "artificial intelligence machine learning programming",
            "limit": 5,
            "threshold": 0.75
        }' | pretty_json
    print_success "Concept search completed"
    
    # 10. Store Pre-structured Triples
    print_step "10. Store Pre-structured Triples"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/store-triples" \
        -d '{
            "triples": [
                {
                    "subject": "Charlie",
                    "predicate": "works_at",
                    "object": "Microsoft",
                    "type": "entity-entity",
                    "source": "curl_manual_entry",
                    "confidence": 0.95,
                    "extracted_at": "2024-01-15T10:30:00Z"
                },
                {
                    "subject": "Charlie",
                    "predicate": "specializes_in",
                    "object": "cloud architecture",
                    "type": "entity-entity",
                    "source": "curl_manual_entry",
                    "confidence": 0.90,
                    "extracted_at": "2024-01-15T10:30:00Z"
                }
            ]
        }' | pretty_json
    print_success "Pre-structured triples stored"
    
    # 11. Deduplicate Triples
    print_step "11. Deduplicate Triples"
    curl -s "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/deduplicate" \
        -d '{
            "triples": [
                {
                    "subject": "John",
                    "predicate": "works_at",
                    "object": "Google",
                    "type": "entity-entity",
                    "source": "conversation_1"
                },
                {
                    "subject": "John Smith",
                    "predicate": "employed_by",
                    "object": "Google Inc",
                    "type": "entity-entity",
                    "source": "conversation_2"
                }
            ]
        }' | pretty_json
    print_success "Triple deduplication completed"
    
    # 12. Get Knowledge Graph Statistics
    print_step "12. Get Knowledge Graph Statistics"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/stats" | pretty_json
    print_success "Statistics retrieved"
    
    # 13. Enumerate Entities (Basic)
    print_step "13. Enumerate Entities - Basic"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/entities?limit=10&sort_by=frequency" | pretty_json
    print_success "Basic entity enumeration completed"
    
    # 14. Enumerate Entities (Advanced)
    print_step "14. Enumerate Entities - Advanced Filtering"
    curl -s "${HEADERS[@]}" \
        "${API_BASE_URL}/entities?role=both&min_occurrence=2&limit=20&sort_by=frequency" | pretty_json
    print_success "Advanced entity enumeration completed"
    
    # 15. Error Handling Example
    print_step "15. Error Handling Example"
    print_info "Demonstrating error handling with invalid request..."
    
    response=$(curl -s -w "%{http_code}" "${HEADERS[@]}" \
        -X POST "${API_BASE_URL}/process-knowledge" \
        -d '{
            "text": "",
            "source": ""
        }')
    
    # Extract HTTP status code (last 3 characters)
    http_code="${response: -3}"
    response_body="${response%???}"
    
    if [ "$http_code" = "400" ]; then
        print_success "Error handling working correctly (HTTP 400)"
        echo "$response_body" | pretty_json
    else
        print_error "Unexpected response code: $http_code"
    fi
    
    # 16. Rate Limiting Test (Optional)
    print_step "16. Rate Limiting Test (Optional)"
    print_info "Sending multiple rapid requests to test rate limiting..."
    
    for i in {1..5}; do
        response=$(curl -s -w "%{http_code}" "${HEADERS[@]}" "${API_BASE_URL}/health")
        http_code="${response: -3}"
        
        if [ "$http_code" = "429" ]; then
            print_success "Rate limiting is working (HTTP 429)"
            break
        elif [ "$i" = "5" ]; then
            print_info "Rate limiting not triggered (normal for development)"
        fi
        
        sleep 0.1
    done
    
    # 17. OpenAPI Documentation
    print_step "17. OpenAPI Documentation"
    curl -s "${HEADERS[@]}" "${API_BASE_URL}/openapi.json" | head -c 500
    echo "..."
    print_success "OpenAPI specification retrieved (truncated)"
    
    # Summary
    print_step "Summary"
    print_success "All cURL examples completed successfully!"
    print_info "You can now use these commands as templates for your own integrations"
    print_info "For more advanced usage, see the JavaScript and Python client examples"
    
    echo -e "\n${GREEN}🎉 cURL examples demonstration completed!${NC}"
}

# Trap errors and provide helpful message
trap 'print_error "Script failed. Make sure the server is running and accessible."' ERR

# Run main function
main "$@"