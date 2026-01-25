# Reflexive Hosted Mode Dockerfile
# Optimized for Railway, Render, and other container platforms

FROM node:22-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy static assets
COPY logo-carbon.png ./

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash reflexive && \
    chown -R reflexive:reflexive /app

USER reflexive

# Expose default port (Railway will override with $PORT)
EXPOSE 3099

# Environment variables
ENV NODE_ENV=production
ENV PORT=3099

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3099) + '/api/health', res => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start hosted mode server
CMD ["node", "dist/cli.js", "--sandbox"]
