# Deployment Guide

Guide for deploying Reflexive in production environments, particularly hosted mode.

## Table of Contents

- [Deployment Options](#deployment-options)
- [Railway Deployment](#railway-deployment)
  - [One-Click Deploy](#one-click-deploy)
  - [Manual Setup](#manual-setup)
  - [Environment Variables](#environment-variables)
  - [Monitoring](#monitoring)
- [Docker Deployment](#docker-deployment)
  - [Using Pre-built Image](#using-pre-built-image)
  - [Building Custom Image](#building-custom-image)
  - [Docker Compose](#docker-compose)
  - [Kubernetes](#kubernetes)
- [Manual Deployment](#manual-deployment)
  - [Build and Deploy](#build-and-deploy)
  - [Process Management](#process-management)
  - [Reverse Proxy](#reverse-proxy)
- [Security Considerations](#security-considerations)
  - [API Authentication](#api-authentication)
  - [Rate Limiting](#rate-limiting)
  - [Sandbox Isolation](#sandbox-isolation)
  - [Secrets Management](#secrets-management)
- [Storage Configuration](#storage-configuration)
  - [S3 Storage](#s3-storage)
  - [Cloudflare R2](#cloudflare-r2)
  - [Memory Storage](#memory-storage)
- [Monitoring and Logging](#monitoring-and-logging)
  - [Health Checks](#health-checks)
  - [Metrics](#metrics)
  - [Log Aggregation](#log-aggregation)
- [Scaling](#scaling)
  - [Horizontal Scaling](#horizontal-scaling)
  - [Resource Limits](#resource-limits)
- [Troubleshooting](#troubleshooting)

## Deployment Options

Reflexive can be deployed in several ways depending on your needs:

| Option | Best For | Complexity | Cost |
|--------|----------|------------|------|
| Railway | Quick deployment, managed infrastructure | Low | $ |
| Docker | Containerized deployment, cloud-agnostic | Medium | $$ |
| Manual | Full control, custom infrastructure | High | $$$ |

## Railway Deployment

Railway provides the easiest way to deploy Reflexive with minimal configuration.

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=reflexive)

Click the button above or use the CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy from directory
cd reflexive
railway up
```

### Manual Setup

**Step 1: Create Project**

```bash
railway login
railway init
railway link
```

**Step 2: Set Environment Variables**

```bash
railway variables set ANTHROPIC_API_KEY=sk-ant-xxxxx
railway variables set REFLEXIVE_API_KEY=your-secure-key
railway variables set NODE_ENV=production
railway variables set PORT=3099
```

**Step 3: Configure Snapshot Storage**

For S3:
```bash
railway variables set AWS_ACCESS_KEY_ID=your-access-key
railway variables set AWS_SECRET_ACCESS_KEY=your-secret-key
railway variables set REFLEXIVE_SNAPSHOT_BUCKET=reflexive-snapshots
railway variables set AWS_REGION=us-east-1
```

For Cloudflare R2:
```bash
railway variables set AWS_ACCESS_KEY_ID=your-r2-access-key
railway variables set AWS_SECRET_ACCESS_KEY=your-r2-secret-key
railway variables set REFLEXIVE_S3_ENDPOINT=https://account.r2.cloudflarestorage.com
railway variables set REFLEXIVE_SNAPSHOT_BUCKET=reflexive-snapshots
```

**Step 4: Deploy**

```bash
railway up
```

**Step 5: Get URL**

```bash
railway domain
# Returns: https://reflexive-production.up.railway.app
```

### Environment Variables

Required variables for Railway deployment:

```bash
# Authentication
ANTHROPIC_API_KEY=sk-ant-xxxxx          # Claude API key
REFLEXIVE_API_KEY=your-secure-key       # API key for REST endpoints

# Server
NODE_ENV=production
PORT=3099                                # Railway auto-sets PORT

# Snapshot Storage (choose one)
# Option 1: AWS S3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
REFLEXIVE_SNAPSHOT_BUCKET=bucket-name
AWS_REGION=us-east-1

# Option 2: Cloudflare R2
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
REFLEXIVE_S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com
REFLEXIVE_SNAPSHOT_BUCKET=bucket-name

# Optional: Vercel Sandbox
VERCEL_TOKEN=xxx                        # For sandbox mode
```

### Monitoring

Railway provides built-in monitoring:

```bash
# View logs
railway logs

# View metrics
railway status

# Open dashboard
railway open
```

## Docker Deployment

### Using Pre-built Image

Pull and run the official image:

```bash
docker pull reflexive/reflexive:latest

docker run -d \
  --name reflexive \
  -p 3099:3099 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e REFLEXIVE_API_KEY=your-key \
  -e AWS_ACCESS_KEY_ID=xxx \
  -e AWS_SECRET_ACCESS_KEY=xxx \
  -e REFLEXIVE_SNAPSHOT_BUCKET=snapshots \
  reflexive/reflexive:latest
```

### Building Custom Image

**Create Dockerfile**:

```dockerfile
# Dockerfile
FROM node:18-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Expose port
EXPOSE 3099

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3099/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Run
CMD ["node", "dist/cli.js", "--mode", "hosted"]
```

**Build and Run**:

```bash
# Build
docker build -t reflexive:latest .

# Run
docker run -d \
  --name reflexive \
  -p 3099:3099 \
  --env-file .env \
  reflexive:latest
```

### Docker Compose

**docker-compose.yml**:

```yaml
version: '3.8'

services:
  reflexive:
    build: .
    ports:
      - "3099:3099"
    environment:
      - NODE_ENV=production
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - REFLEXIVE_API_KEY=${REFLEXIVE_API_KEY}
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - REFLEXIVE_SNAPSHOT_BUCKET=${REFLEXIVE_SNAPSHOT_BUCKET}
      - REFLEXIVE_S3_ENDPOINT=${REFLEXIVE_S3_ENDPOINT}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3099/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    volumes:
      - ./config:/app/config:ro
    networks:
      - reflexive-net

  # Optional: Redis for rate limiting
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    networks:
      - reflexive-net

networks:
  reflexive-net:
    driver: bridge
```

**Start services**:

```bash
docker-compose up -d

# View logs
docker-compose logs -f reflexive

# Stop
docker-compose down
```

### Kubernetes

**deployment.yaml**:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reflexive
spec:
  replicas: 3
  selector:
    matchLabels:
      app: reflexive
  template:
    metadata:
      labels:
        app: reflexive
    spec:
      containers:
      - name: reflexive
        image: reflexive/reflexive:latest
        ports:
        - containerPort: 3099
        env:
        - name: NODE_ENV
          value: "production"
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: reflexive-secrets
              key: anthropic-api-key
        - name: REFLEXIVE_API_KEY
          valueFrom:
            secretKeyRef:
              name: reflexive-secrets
              key: reflexive-api-key
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: aws-secrets
              key: access-key-id
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: aws-secrets
              key: secret-access-key
        - name: REFLEXIVE_SNAPSHOT_BUCKET
          value: "reflexive-snapshots"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3099
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3099
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: reflexive
spec:
  selector:
    app: reflexive
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3099
  type: LoadBalancer
```

**Deploy**:

```bash
# Create secrets
kubectl create secret generic reflexive-secrets \
  --from-literal=anthropic-api-key=sk-ant-xxx \
  --from-literal=reflexive-api-key=your-key

kubectl create secret generic aws-secrets \
  --from-literal=access-key-id=xxx \
  --from-literal=secret-access-key=xxx

# Apply deployment
kubectl apply -f deployment.yaml

# Check status
kubectl get pods
kubectl get services
```

## Manual Deployment

### Build and Deploy

**On your server**:

```bash
# Clone repository
git clone https://github.com/yourusername/reflexive.git
cd reflexive

# Install dependencies
npm ci

# Build
npm run build

# Test
npm test

# Start
NODE_ENV=production node dist/cli.js --mode hosted
```

### Process Management

Use PM2 for process management:

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'reflexive',
    script: './dist/cli.js',
    args: '--mode hosted',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 3099
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Setup startup script
pm2 startup
pm2 save

# Monitor
pm2 monit
pm2 logs reflexive
```

### Reverse Proxy

**Nginx configuration**:

```nginx
# /etc/nginx/sites-available/reflexive
upstream reflexive {
    server localhost:3099;
}

server {
    listen 80;
    server_name reflexive.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name reflexive.yourdomain.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/reflexive.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reflexive.yourdomain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy settings
    location / {
        proxy_pass http://reflexive;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

Enable and reload:
```bash
ln -s /etc/nginx/sites-available/reflexive /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## Security Considerations

### API Authentication

**Generate strong API key**:

```bash
# Generate random key
openssl rand -base64 32

# Set as environment variable
export REFLEXIVE_API_KEY="generated-key-here"
```

**Use in requests**:

```bash
curl -H "Authorization: Bearer generated-key-here" \
  https://your-reflexive.app/api/sandboxes
```

### Rate Limiting

Rate limiting is built-in. Configure in `reflexive.config.js`:

```javascript
export default {
  mode: 'hosted',
  rateLimit: {
    maxRequests: 100,      // Max requests
    windowMs: 60000,       // Per minute
    skipPublicPaths: true  // Skip /api/health
  }
};
```

### Sandbox Isolation

Sandboxes are isolated by Vercel's infrastructure:
- Separate filesystems
- Network isolation
- Resource limits (CPU, memory)
- Automatic cleanup

### Secrets Management

**Never commit secrets**. Use environment variables or secret managers.

**AWS Secrets Manager**:

```bash
# Store secret
aws secretsmanager create-secret \
  --name reflexive/anthropic-key \
  --secret-string "sk-ant-xxx"

# Retrieve in app
const secret = await secretsManager.getSecretValue({
  SecretId: 'reflexive/anthropic-key'
}).promise();
```

**Kubernetes Secrets**:

```bash
kubectl create secret generic reflexive-secrets \
  --from-literal=anthropic-api-key=sk-ant-xxx
```

## Storage Configuration

### S3 Storage

**Create S3 bucket**:

```bash
aws s3 mb s3://reflexive-snapshots --region us-east-1
```

**Set bucket policy** (private):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::reflexive-snapshots/*",
    "Condition": {
      "StringNotEquals": {
        "aws:PrincipalArn": "arn:aws:iam::ACCOUNT:user/reflexive"
      }
    }
  }]
}
```

**Configure**:

```bash
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
export REFLEXIVE_SNAPSHOT_BUCKET=reflexive-snapshots
export AWS_REGION=us-east-1
```

### Cloudflare R2

**Create R2 bucket**:
1. Go to Cloudflare dashboard
2. Navigate to R2
3. Create bucket: `reflexive-snapshots`

**Create API token**:
1. R2 > Manage R2 API Tokens
2. Create token with read/write permissions

**Configure**:

```bash
export AWS_ACCESS_KEY_ID=r2-access-key-id
export AWS_SECRET_ACCESS_KEY=r2-secret-key
export REFLEXIVE_S3_ENDPOINT=https://account.r2.cloudflarestorage.com
export REFLEXIVE_SNAPSHOT_BUCKET=reflexive-snapshots
```

### Memory Storage

For development or testing (not persistent):

```javascript
// reflexive.config.js
export default {
  mode: 'hosted',
  hosted: {
    snapshotStorage: {
      provider: 'memory'
    }
  }
};
```

**Warning**: Snapshots are lost on restart.

## Monitoring and Logging

### Health Checks

**HTTP health endpoint**:

```bash
curl https://your-reflexive.app/api/health
```

Response:
```json
{
  "status": "ok",
  "sandboxes": 5,
  "running": 3
}
```

**Use in monitoring**:

```yaml
# Kubernetes liveness probe
livenessProbe:
  httpGet:
    path: /api/health
    port: 3099
  initialDelaySeconds: 5
  periodSeconds: 10
```

### Metrics

Export metrics for monitoring:

```javascript
// In your app
import { makeReflexive } from 'reflexive';

const r = makeReflexive({
  tools: [
    {
      name: 'get_metrics',
      description: 'Get application metrics',
      schema: { type: 'object', properties: {} },
      handler: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            sandboxes: manager.count()
          })
        }]
      })
    }
  ]
});
```

### Log Aggregation

**Send logs to external service**:

```javascript
// Using Winston
import winston from 'winston';

const logger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: 'app.log' }),
    new winston.transports.Http({
      host: 'logs.example.com',
      port: 8080,
      path: '/logs'
    })
  ]
});

appState.on('log', (entry) => {
  logger.log({
    level: entry.type,
    message: entry.message,
    timestamp: entry.timestamp
  });
});
```

## Scaling

### Horizontal Scaling

Reflexive can be scaled horizontally with some considerations:

**Stateless design**: Each instance manages its own sandboxes
**Shared storage**: Use S3/R2 for snapshot persistence
**Load balancing**: Round-robin or least-connections

**Example with multiple instances**:

```yaml
# docker-compose.yml
services:
  reflexive-1:
    build: .
    ports:
      - "3099:3099"
    environment:
      - INSTANCE_ID=1

  reflexive-2:
    build: .
    ports:
      - "3100:3099"
    environment:
      - INSTANCE_ID=2

  nginx:
    image: nginx
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - reflexive-1
      - reflexive-2
```

### Resource Limits

Configure per deployment:

**Docker**:
```bash
docker run \
  --memory="2g" \
  --cpus="2" \
  reflexive:latest
```

**Kubernetes**:
```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "2000m"
```

**Per-sandbox limits** (in config):
```javascript
export default {
  sandbox: {
    vcpus: 2,
    memory: 2048,  // MB
    timeout: '30m'
  }
};
```

## Troubleshooting

### Common Issues

**Port already in use**:
```bash
# Find process
lsof -i :3099

# Kill process
kill -9 PID

# Or use different port
PORT=3100 node dist/cli.js
```

**Sandbox creation fails**:
```bash
# Check Vercel token
echo $VERCEL_TOKEN

# Test sandbox creation
curl -H "Authorization: Bearer $VERCEL_TOKEN" \
  https://api.vercel.com/v1/sandbox
```

**Storage errors**:
```bash
# Test S3 access
aws s3 ls s3://reflexive-snapshots

# Check credentials
aws sts get-caller-identity
```

**Memory issues**:
```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" node dist/cli.js

# Or in PM2
pm2 start dist/cli.js --node-args="--max-old-space-size=4096"
```

### Debug Mode

Enable verbose logging:

```bash
DEBUG=reflexive:* node dist/cli.js --mode hosted
```

Or set in environment:
```bash
export DEBUG=reflexive:*
```

---

**Next**: Check [Examples](./examples.md) for usage patterns and integrations.
