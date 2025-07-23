# Deployment Guide

This guide covers deploying the Knowledge Graph MCP Server in production environments with HTTP transport enabled.

## Quick Start

### Production Checklist

- [ ] PostgreSQL database configured and accessible
- [ ] Environment variables configured
- [ ] Build artifacts created (`pnpm run build`)
- [ ] SSL/TLS certificates configured (recommended)
- [ ] Reverse proxy configured (recommended)
- [ ] Monitoring and logging enabled
- [ ] Backup and recovery procedures in place

### Minimal Production Setup

```bash
# 1. Clone and build
git clone <repository-url>
cd full-context-mcp
pnpm install
pnpm run build

# 2. Configure environment
cp .env.example .env
# Edit .env with your production settings

# 3. Set up database
pnpm run db:generate
pnpm run db:migrate

# 4. Start in HTTP mode
pnpm run start:http
```

## Environment Configuration

### Required Variables

```bash
# Database (Required)
DATABASE_URL="postgresql://username:password@localhost:5432/knowledge_graph"

# AI APIs (Required - at least one)
OPENAI_API_KEY="sk-your-openai-api-key"
ANTHROPIC_API_KEY="your-anthropic-api-key"

# HTTP Transport (Required for HTTP mode)
ENABLE_HTTP_TRANSPORT=true
```

### Production Environment Variables

```bash
# HTTP Server Configuration
HTTP_PORT=3000                          # Server port
HTTP_BASE_PATH=/api                     # API base path
HTTP_CORS_ORIGINS="https://yourdomain.com,https://app.yourdomain.com"  # Production origins
HTTP_ENABLE_SSE=true                    # Enable SSE/MCP endpoint

# Security
HTTP_RATE_LIMIT_WINDOW=15               # Rate limit window (minutes)
HTTP_RATE_LIMIT_MAX=100                 # Max requests per window per IP
HTTP_REQUEST_SIZE_LIMIT=10mb            # Max request body size

# Performance
HTTP_COMPRESSION=true                   # Enable gzip compression
HTTP_KEEP_ALIVE_TIMEOUT=65000          # Keep-alive timeout (ms)

# AI Configuration
KNOWLEDGE_GRAPH_AI_PROVIDER=openai     # openai | anthropic
KNOWLEDGE_GRAPH_AI_MODEL=gpt-4o-mini   # AI model for extraction
KNOWLEDGE_GRAPH_EMBEDDING_MODEL=text-embedding-3-small  # Embedding model
KNOWLEDGE_GRAPH_EMBEDDING_DIMENSIONS=1536  # Embedding dimensions

# Database Configuration
KG_DB_CONNECTION_TIMEOUT=10000          # Connection timeout (ms)
KG_DB_MAX_CONNECTIONS=20                # Max database connections
KG_DB_CONNECTION_RETRY_ATTEMPTS=3       # Connection retry attempts

# Processing Configuration
KNOWLEDGE_GRAPH_EXTRACTION_MAX_TOKENS=4000     # Max tokens per extraction
KNOWLEDGE_GRAPH_DEDUP_SIMILARITY_THRESHOLD=0.85  # Deduplication threshold
KNOWLEDGE_GRAPH_DEDUP_BATCH_SIZE=50            # Deduplication batch size

# Transport Configuration
ENABLE_STDIO_TRANSPORT=false           # Disable STDIO in HTTP-only mode
```

### Environment File Template

Create `.env.production`:

```bash
# Production Environment Configuration

# Database
DATABASE_URL=postgresql://kg_user:secure_password@db.example.com:5432/knowledge_graph_prod

# AI APIs
OPENAI_API_KEY=sk-prod-your-openai-api-key
ANTHROPIC_API_KEY=your-prod-anthropic-api-key

# HTTP Transport
ENABLE_HTTP_TRANSPORT=true
ENABLE_STDIO_TRANSPORT=false
HTTP_PORT=3000
HTTP_BASE_PATH=/api
HTTP_CORS_ORIGINS=https://your-production-domain.com
HTTP_ENABLE_SSE=true

# Security & Performance
HTTP_RATE_LIMIT_WINDOW=15
HTTP_RATE_LIMIT_MAX=200
HTTP_REQUEST_SIZE_LIMIT=10mb
HTTP_COMPRESSION=true

# AI Configuration
KNOWLEDGE_GRAPH_AI_PROVIDER=openai
KNOWLEDGE_GRAPH_AI_MODEL=gpt-4o-mini
KNOWLEDGE_GRAPH_EMBEDDING_MODEL=text-embedding-3-small

# Database Optimization
KG_DB_MAX_CONNECTIONS=20
KG_DB_CONNECTION_TIMEOUT=10000

# Node.js Environment
NODE_ENV=production
```

## Database Setup

### PostgreSQL Configuration

**Production PostgreSQL Settings:**

```sql
-- Create dedicated user
CREATE USER kg_user WITH PASSWORD 'secure_password';

-- Create database
CREATE DATABASE knowledge_graph_prod OWNER kg_user;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE knowledge_graph_prod TO kg_user;

-- Connect to the database
\c knowledge_graph_prod

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search optimization

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO kg_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO kg_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO kg_user;
```

**Connection String:**
```bash
DATABASE_URL="postgresql://kg_user:secure_password@your-db-host:5432/knowledge_graph_prod?sslmode=require"
```

### Database Migration

```bash
# Run migrations in production
NODE_ENV=production pnpm run db:migrate

# Verify migration status
NODE_ENV=production pnpm run db:status

# Generate Prisma client for production
NODE_ENV=production pnpm run db:generate
```

## Deployment Methods

### 1. Traditional Server Deployment

**Using PM2 (Process Manager):**

```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'knowledge-graph-mcp',
    script: './dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      HTTP_PORT: 3000
    },
    env_file: '.env.production',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 5000,
    max_restarts: 5,
    min_uptime: '10s'
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

**Using systemd (Linux):**

```bash
# Create systemd service file
sudo tee /etc/systemd/system/knowledge-graph-mcp.service << 'EOF'
[Unit]
Description=Knowledge Graph MCP Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/opt/knowledge-graph-mcp
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/opt/knowledge-graph-mcp/.env.production
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=knowledge-graph-mcp

# Security settings
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/knowledge-graph-mcp/logs

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl enable knowledge-graph-mcp
sudo systemctl start knowledge-graph-mcp

# Check status
sudo systemctl status knowledge-graph-mcp
```

### 2. Docker Deployment

**Dockerfile (Production):**

```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client and build
RUN pnpm run db:generate
RUN pnpm run build

# Production stage
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache dumb-init postgresql-client

# Create app user
RUN addgroup -g 1001 -S app && \
    adduser -S app -u 1001 -G app

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile --prod

# Copy built application and Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Create logs directory
RUN mkdir -p logs && chown app:app logs

# Switch to app user
USER app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "
    const http = require('http');
    const options = { host: 'localhost', port: process.env.HTTP_PORT || 3000, path: '/api/health', timeout: 5000 };
    const req = http.request(options, (res) => process.exit(res.statusCode === 200 ? 0 : 1));
    req.on('error', () => process.exit(1));
    req.end();
  "

# Expose port
EXPOSE 3000

# Start application with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

**docker-compose.yml (Production):**

```yaml
version: '3.8'

services:
  knowledge-graph-mcp:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://kg_user:${DB_PASSWORD}@postgres:5432/knowledge_graph_prod
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ENABLE_HTTP_TRANSPORT: true
      HTTP_PORT: 3000
      HTTP_CORS_ORIGINS: ${CORS_ORIGINS}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: knowledge_graph_prod
      POSTGRES_USER: kg_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kg_user -d knowledge_graph_prod"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - knowledge-graph-mcp
    restart: unless-stopped

volumes:
  postgres_data:
```

**Environment file for Docker:**

```bash
# .env.docker
DB_PASSWORD=secure_database_password
OPENAI_API_KEY=sk-your-production-openai-key
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

**Deploy with Docker:**

```bash
# Build and start
docker-compose --env-file .env.docker up -d

# View logs
docker-compose logs -f knowledge-graph-mcp

# Run database migrations
docker-compose exec knowledge-graph-mcp pnpm run db:migrate

# Scale the application
docker-compose up -d --scale knowledge-graph-mcp=3
```

## Reverse Proxy Configuration

### Nginx Configuration

**nginx.conf:**

```nginx
upstream knowledge_graph_backend {
    least_conn;
    server localhost:3000;
    # Add more servers for load balancing
    # server localhost:3001;
    # server localhost:3002;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=sse:10m rate=2r/s;

server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL Configuration
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';";

    # API routes
    location /api/ {
        # Rate limiting for regular API endpoints
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://knowledge_graph_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 60;
        proxy_send_timeout 300;
        
        # CORS headers (if needed)
        add_header Access-Control-Allow-Origin "https://your-frontend-domain.com";
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-MCP-Version";
    }

    # SSE/MCP endpoint with different rate limiting
    location /api/mcp {
        # More restrictive rate limiting for SSE connections
        limit_req zone=sse burst=5 nodelay;
        
        proxy_pass http://knowledge_graph_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE-specific settings
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
        
        # SSE headers
        add_header Cache-Control "no-cache";
        add_header Connection "keep-alive";
    }

    # Health check endpoint (no rate limiting)
    location /api/health {
        proxy_pass http://knowledge_graph_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 10;
        proxy_connect_timeout 5;
    }

    # Block access to sensitive files
    location ~ /\. {
        deny all;
    }
    
    location ~ \.(env|log)$ {
        deny all;
    }
}
```

### Apache Configuration

**apache-vhost.conf:**

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    Redirect permanent / https://your-domain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName your-domain.com
    
    # SSL Configuration
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/cert.pem
    SSLCertificateKeyFile /etc/ssl/private/key.pem
    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
    
    # Security headers
    Header always set X-Frame-Options DENY
    Header always set X-Content-Type-Options nosniff
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    
    # Enable modules
    LoadModule proxy_module modules/mod_proxy.so
    LoadModule proxy_http_module modules/mod_proxy_http.so
    LoadModule headers_module modules/mod_headers.so
    
    # Proxy configuration
    ProxyPreserveHost On
    ProxyRequests Off
    
    # API endpoints
    ProxyPass /api/ http://localhost:3000/api/
    ProxyPassReverse /api/ http://localhost:3000/api/
    
    # SSE endpoint
    ProxyPass /api/mcp http://localhost:3000/api/mcp
    ProxyPassReverse /api/mcp http://localhost:3000/api/mcp
    
    # Set proxy headers
    ProxyPassReverse / http://localhost:3000/
    ProxyPass / http://localhost:3000/
    ProxySet Host $host
    ProxySet X-Real-IP $remote_addr
    ProxySet X-Forwarded-For $proxy_add_x_forwarded_for
    ProxySet X-Forwarded-Proto $scheme
</VirtualHost>
```

## Security Configuration

### SSL/TLS Setup

**Using Let's Encrypt (Certbot):**

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### API Key Authentication (Optional)

Add API key authentication for additional security:

```bash
# Environment variable
HTTP_API_KEY=your-secure-api-key-here
HTTP_REQUIRE_API_KEY=true  # Make API key required
```

### Firewall Configuration

**UFW (Ubuntu):**

```bash
# Basic firewall rules
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow ssh

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow PostgreSQL (if external)
sudo ufw allow from your-app-server-ip to any port 5432

# Check status
sudo ufw status verbose
```

## Monitoring and Logging

### Application Logging

**Configure structured logging:**

```bash
# Environment variables for logging
LOG_LEVEL=info                    # debug, info, warn, error
LOG_FORMAT=json                   # json, text
LOG_FILE_PATH=/app/logs/app.log   # Log file location
LOG_MAX_FILES=7                   # Log rotation
LOG_MAX_SIZE=100m                 # Max log file size
```

### Health Monitoring

**Health check script:**

```bash
#!/bin/bash
# health-check.sh

API_URL="https://your-domain.com/api/health"
TIMEOUT=10

response=$(curl -s -w "%{http_code}" --max-time $TIMEOUT "$API_URL")
http_code=$(echo "$response" | tail -c 4)

if [ "$http_code" = "200" ]; then
    echo "✅ Health check passed"
    exit 0
else
    echo "❌ Health check failed: HTTP $http_code"
    exit 1
fi
```

### Monitoring with Prometheus

**metrics endpoint configuration:**

```bash
# Enable metrics endpoint
HTTP_ENABLE_METRICS=true
HTTP_METRICS_PATH=/api/metrics
```

**prometheus.yml:**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'knowledge-graph-mcp'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /api/metrics
    scrape_interval: 30s
```

## Performance Optimization

### Database Optimization

**PostgreSQL tuning:**

```sql
-- postgresql.conf optimizations
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
```

**Index optimization:**

```sql
-- Add database indexes for better performance
CREATE INDEX CONCURRENTLY idx_triples_embedding_gin ON triples USING gin(embedding);
CREATE INDEX CONCURRENTLY idx_triples_source ON triples(source);
CREATE INDEX CONCURRENTLY idx_triples_type ON triples(type);
CREATE INDEX CONCURRENTLY idx_triples_extracted_at ON triples(extracted_at);
CREATE INDEX CONCURRENTLY idx_concepts_embedding_gin ON concepts USING gin(embedding);
```

### Application Performance

**Node.js optimization:**

```bash
# Environment variables for performance
NODE_ENV=production
NODE_OPTIONS="--max-old-space-size=2048"  # Increase heap size
UV_THREADPOOL_SIZE=16                      # Increase thread pool
```

### Load Balancing

**Multiple instances with PM2:**

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'knowledge-graph-mcp',
    script: './dist/index.js',
    instances: 'max',  // Use all CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      HTTP_PORT: 3000
    }
  }]
};
```

## Backup and Recovery

### Database Backup

**Automated PostgreSQL backup:**

```bash
#!/bin/bash
# backup.sh

DB_NAME="knowledge_graph_prod"
DB_USER="kg_user"
BACKUP_DIR="/backups/postgresql"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup
pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --compress=9 \
  --file="$BACKUP_DIR/kg_backup_$DATE.dump"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "kg_backup_*.dump" -mtime +7 -delete

echo "Backup completed: kg_backup_$DATE.dump"
```

**Restore from backup:**

```bash
# Restore database from backup
pg_restore -h localhost -U kg_user -d knowledge_graph_prod \
  --clean --if-exists backup_file.dump
```

### Application Backup

```bash
#!/bin/bash
# app-backup.sh

APP_DIR="/opt/knowledge-graph-mcp"
BACKUP_DIR="/backups/application"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
tar -czf "$BACKUP_DIR/app_backup_$DATE.tar.gz" \
  -C "$APP_DIR" \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=logs \
  .

echo "Application backup completed: app_backup_$DATE.tar.gz"
```

## Troubleshooting

### Common Issues

**1. Port already in use:**
```bash
# Find process using port 3000
sudo lsof -i :3000
sudo kill -9 <PID>

# Or use different port
HTTP_PORT=3001 pnpm run start:http
```

**2. Database connection issues:**
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1;"

# Check database logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

**3. Memory issues:**
```bash
# Increase Node.js heap size
NODE_OPTIONS="--max-old-space-size=4096" pnpm run start:http

# Monitor memory usage
htop
```

**4. SSL certificate issues:**
```bash
# Test SSL certificate
openssl s_client -connect your-domain.com:443

# Renew Let's Encrypt certificate
sudo certbot renew --dry-run
```

### Log Analysis

**View application logs:**
```bash
# PM2 logs
pm2 logs knowledge-graph-mcp

# systemd logs
sudo journalctl -u knowledge-graph-mcp -f

# Docker logs
docker-compose logs -f knowledge-graph-mcp
```

**Debug performance:**
```bash
# Enable debug logging
LOG_LEVEL=debug pnpm run start:http

# Monitor API endpoints
curl -w "%{time_total}\n" -o /dev/null -s https://your-domain.com/api/health
```

## Maintenance

### Regular Maintenance Tasks

**Weekly tasks:**
- Check application logs for errors
- Verify backup integrity
- Monitor disk space and database size
- Review security logs

**Monthly tasks:**
- Update dependencies (`pnpm update`)
- Rotate API keys if using API key authentication
- Review and optimize database performance
- Update SSL certificates if needed

**Quarterly tasks:**
- Security audit and vulnerability assessment
- Performance testing and optimization
- Backup and recovery procedure testing
- Documentation updates

### Updates and Upgrades

**Application updates:**
```bash
# 1. Backup current version
cp -r /opt/knowledge-graph-mcp /opt/knowledge-graph-mcp.backup

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
pnpm install

# 4. Run database migrations
pnpm run db:migrate

# 5. Build application
pnpm run build

# 6. Restart service
pm2 restart knowledge-graph-mcp
# OR
sudo systemctl restart knowledge-graph-mcp
```

**Zero-downtime deployment:**
```bash
# Using PM2 with graceful reload
pm2 gracefulReload ecosystem.config.js
```

This deployment guide provides comprehensive instructions for running the Knowledge Graph MCP Server in production with HTTP transport. Follow the security, monitoring, and maintenance recommendations to ensure reliable operation.