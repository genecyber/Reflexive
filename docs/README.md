# Reflexive Documentation

Comprehensive documentation for Reflexive, an AI-powered introspection framework for Node.js applications.

## Documentation Index

### Getting Started
- [Getting Started Guide](./getting-started.md) - Installation, quick start, and first steps

### User Guides
- [User Guide](./user-guide.md) - Complete usage guide for all modes and features
- [Examples](./examples.md) - Code examples and common use cases

### API & Developer Resources
- [API Reference](./api-reference.md) - Complete API documentation for library and REST modes
- [Developer Guide](./developer-guide.md) - Architecture, contributing, and development setup

### Deployment
- [Deployment Guide](./deployment.md) - Railway, Docker, and production deployment

## Quick Links

### Installation
```bash
npm install -g reflexive
```

### Quick Start
```bash
# Local mode - monitor any Node.js app
npx reflexive app.js

# Sandbox mode - isolated execution
npx reflexive --sandbox app.js

# Library mode - embed in your app
import { makeReflexive } from 'reflexive';
```

## What is Reflexive?

Reflexive is an AI-powered introspection framework that lets you talk to your running Node.js applications. It embeds Claude AI inside your app, giving it the ability to:

- See logs in real-time
- Read and modify source files
- Set breakpoints and inspect variables
- Control process lifecycle
- Respond to runtime events

## Three Operating Modes

1. **Local Mode** - Run any Node.js app with AI monitoring
2. **Sandbox Mode** - Execute apps in isolated Vercel Sandbox environments
3. **Hosted Mode** - Multi-tenant production deployment with REST API

## Key Features

- **AI Agent Loop** - Claude works autonomously until tasks are complete
- **V8 Debugger** - Real breakpoints with Inspector protocol
- **Safety First** - All capabilities require explicit opt-in flags
- **TypeScript Native** - Full type safety and IntelliSense support
- **Zero Config** - Works out of the box, configurable when needed

## Version Information

- **Current Version**: 0.2.0
- **Node.js**: >= 18.0.0
- **TypeScript**: 5.7+

## Support & Community

- [GitHub Repository](https://github.com/your-org/reflexive)
- [Issue Tracker](https://github.com/your-org/reflexive/issues)
- [Claude Agent SDK Docs](https://docs.anthropic.com/en/docs/claude-code/agent-sdk)

## Documentation Versions

This documentation corresponds to Reflexive v0.2.0, which includes:
- Complete TypeScript migration
- Sandbox capabilities (Vercel Sandbox)
- Hosted mode with REST API
- V8 Inspector debugging
- Comprehensive test suite

---

**Next Steps**: Start with the [Getting Started Guide](./getting-started.md)
