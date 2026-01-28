# Reflexive Documentation

Welcome to the Reflexive documentation. This is the comprehensive documentation for Reflexive, an AI-powered introspection framework for applications in multiple languages.

## Table of Contents

- [Overview](#overview)
- [What is Reflexive?](#what-is-reflexive)
- [Key Features](#key-features)
- [Operating Modes](#operating-modes)
- [Quick Links](#quick-links)
- [Documentation Structure](#documentation-structure)
- [Version Information](#version-information)
- [Getting Help](#getting-help)

## Overview

Reflexive enables building applications by talking to them. It embeds a Claude AI agent that lives inside your running application, capable of seeing logs, reading source files, setting breakpoints, and modifying code through chat conversation.

## What is Reflexive?

Reflexive combines the Claude Agent SDK with your application process to create an intelligent development assistant that can:

- Monitor and analyze application behavior in real-time
- Debug issues using V8 Inspector (Node.js) or Debug Adapter Protocol (Python, Go, .NET, Rust)
- Read and modify source code with explicit permissions
- Execute shell commands when authorized
- Watch for specific log patterns and respond automatically
- Set and manage breakpoints programmatically

Think of it as Claude Code embedded directly in your application, with full access to runtime state and the ability to take action.

## Key Features

### AI-Powered Development
- **Agent Loop**: Autonomous reasoning and tool execution until task completion
- **Multi-Turn Conversations**: Context-aware chat interface with memory
- **MCP Tool Integration**: Extensible tool system for custom capabilities

### Process Management
- **Lifecycle Control**: Start, stop, restart monitored processes
- **Hot Reload**: Automatic restart on file changes with `--watch`
- **Interactive Mode**: Proxy stdin/stdout for CLI applications

### Multi-Language Debugging
- **V8 Inspector**: Node.js/TypeScript debugging with breakpoints, stepping, scope inspection
- **Debug Adapter Protocol**: Python (debugpy), Go (Delve), .NET (netcoredbg), Rust (CodeLLDB)
- **Breakpoint Prompts**: Attach AI prompts to breakpoints that trigger automatically when hit
- **Watch Triggers**: Pattern-match logs and auto-prompt the agent
- **Deep Instrumentation**: Optional injection for diagnostics, GC stats, HTTP tracking (Node.js)

### Safety & Permissions
- **Read-Only by Default**: No file modifications without explicit flags
- **Capability Flags**: Granular control over agent permissions
- **Development-Focused**: Clear safety model for local development

## Operating Modes

Reflexive supports three distinct operating modes:

### 1. Local Mode (Default)
```bash
# Node.js
reflexive app.js

# Python (requires debugpy for --debug)
reflexive app.py

# Go (requires Delve for --debug)
reflexive main.go
```
Spawns and monitors your application as a child process. Full feature support including file watching and multi-language debugging. Injection mode available for Node.js.

### 2. Sandbox Mode
```bash
reflexive --sandbox app.js
```
Runs your application in an isolated Vercel Sandbox. Reflexive runs locally, controlling the remote sandbox environment.

### 3. Hosted Mode
```
https://your-reflexive.railway.app
```
Multi-tenant deployment with REST API for programmatic sandbox management. Supports full lifecycle control, snapshots, and snapshot restoration.

## Quick Links

### For New Users
- [Getting Started](./getting-started.md) - Installation and first steps
- [User Guide](./user-guide.md) - Complete feature documentation
- [Examples](./examples.md) - Real-world usage examples

### For Developers
- [API Reference](./api-reference.md) - Library API and REST endpoints
- [Developer Guide](./developer-guide.md) - Architecture and contributing
- [Deployment Guide](./deployment.md) - Production deployment options

### Reference Materials
- [CLI Reference](./user-guide.md#cli-reference) - Command-line options
- [Configuration File](./user-guide.md#configuration-file) - Config file format
- [MCP Tools](./api-reference.md#mcp-tools) - Available agent tools

## Documentation Structure

This documentation is organized into the following sections:

### [Getting Started](./getting-started.md)
Prerequisites, installation, authentication, and your first session with Reflexive.

### [User Guide](./user-guide.md)
Comprehensive guide to all features including operating modes, CLI usage, dashboard interface, and configuration.

### [API Reference](./api-reference.md)
Complete API documentation for library mode (`makeReflexive`), REST API endpoints for hosted mode, and TypeScript types.

### [Developer Guide](./developer-guide.md)
Architecture overview, development setup, code organization, and contribution guidelines.

### [Deployment Guide](./deployment.md)
Instructions for deploying Reflexive in various environments including Railway, Docker, and manual deployment.

### [Examples](./examples.md)
Practical examples for all operating modes, including library mode integration, CLI usage, and hosted mode API clients.

## Version Information

**Current Version**: 0.2.0

**Requirements**:
- Node.js >= 18.0.0
- Claude API access (via Claude Code CLI or API key)

**Runtime Dependencies**:
- `@anthropic-ai/claude-agent-sdk` - Claude AI integration
- `zod` - Parameter validation for MCP tools
- `ws` - WebSocket for V8 Inspector protocol
- `ms` - Time string parsing

**Optional Dependencies**:
- `@vercel/sandbox` - Sandbox mode isolation
- `@aws-sdk/client-s3` - S3 snapshot storage

## Getting Help

### Common Issues
- **Authentication Errors**: See [Authentication](./getting-started.md#authentication)
- **Process Not Starting**: Check [Troubleshooting](./user-guide.md#troubleshooting)
- **Permission Denied**: Review [Capability Flags](./user-guide.md#capability-flags)

### Resources
- GitHub: [https://github.com/yourusername/reflexive](https://github.com/yourusername/reflexive)
- Issues: Report bugs and request features on GitHub
- Discussions: Ask questions in GitHub Discussions

### Development Philosophy

Reflexive is designed with these principles:

1. **Safety First**: Read-only by default, explicit opt-in for dangerous operations
2. **Local Development**: Optimized for development workflows, not production monitoring
3. **Transparency**: Clear about what the agent can see and do
4. **Extensibility**: Easy to add custom tools and capabilities
5. **Simplicity**: Minimal dependencies, straightforward architecture

---

**Next Steps**: Start with the [Getting Started Guide](./getting-started.md) to install and configure Reflexive.
