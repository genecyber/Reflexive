# Getting Started with Reflexive

This guide will help you install Reflexive and run your first AI-powered Node.js application monitoring session.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** >= 18.0.0
- **Claude API Access** via one of:
  - Claude Code CLI (recommended for development)
  - Anthropic API key (for production)

## Installation

### Option 1: Global Installation

Install Reflexive globally to use the CLI anywhere:

```bash
npm install -g reflexive
```

Verify installation:
```bash
reflexive --version
```

### Option 2: Project Installation

Install as a project dependency for library mode:

```bash
npm install reflexive
```

### Option 3: npx (No Installation)

Run directly without installing:

```bash
npx reflexive app.js
```

## Authentication

Reflexive requires Claude API access. Choose one method:

### Method 1: Claude Code CLI (Recommended for Development)

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Authenticate once
claude auth login
```

The CLI will open your browser for OAuth authentication. After login, Reflexive will automatically use your credentials.

### Method 2: API Key (Production Deployments)

Set your Anthropic API key as an environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

Or create a `.env` file:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

## Quick Start

### Local Mode: Monitor Any Node.js App

The simplest way to use Reflexive is monitoring mode. Create a simple app:

```bash
echo "console.log('Hello from Reflexive!');" > app.js
```

Run it with Reflexive:

```bash
reflexive app.js
```

Open your browser to `http://localhost:3099` to see the dashboard.

In the chat interface, try:
- "What is this app doing?"
- "Show me the recent logs"
- "What files are in this directory?"

### Enable File Editing

By default, Reflexive is read-only. To let the AI modify files, use the `--write` flag:

```bash
reflexive --write app.js
```

Now you can chat with the AI:

```
You: Turn this into an Express server with a /hello endpoint

Agent: I'll help you create an Express server...
[The agent reads app.js, writes new code, installs express]

You: Test the /hello endpoint

Agent: [starts server, tests endpoint]
The server is running on port 3000 and /hello returns "Hello World!"
```

### Sandbox Mode: Isolated Execution

Run your app in an isolated Vercel Sandbox:

```bash
reflexive --sandbox app.js
```

Sandbox mode provides:
- Complete filesystem isolation
- Network isolation
- Snapshot and restore capabilities
- Clean environment for testing

## Your First Session

Let's walk through a complete example:

### 1. Create a Simple App

```bash
mkdir my-reflexive-app
cd my-reflexive-app
echo "console.log('Starting app...');" > server.js
```

### 2. Run with Reflexive

```bash
npx reflexive --write server.js
```

### 3. Open the Dashboard

Navigate to `http://localhost:3099` in your browser.

### 4. Chat with the AI

Try these prompts:

**Basic Information:**
```
Show me the current logs
What files are in this directory?
What is the app doing right now?
```

**Code Modification (requires --write):**
```
Turn this into an Express web server
Add a /users endpoint that returns mock user data
Add error handling middleware
```

**Debugging:**
```
Why did the server crash?
Show me the last 10 error messages
What's using the most memory?
```

### 5. Stop the App

Click "Stop Process" in the dashboard or press `Ctrl+C` in the terminal.

## Understanding the Dashboard

The Reflexive dashboard has three main sections:

### 1. Chat Interface
- Type messages to the AI agent
- View AI responses with syntax highlighting
- See tool usage (file reads, log queries, etc.)

### 2. Log Viewer
- Real-time log streaming
- Filter by log level (info, warn, error)
- Search logs by keyword
- Create watch patterns

### 3. Controls
- **Start/Stop/Restart** - Process lifecycle control
- **Process Info** - PID, uptime, memory usage
- **Watch Patterns** - Trigger AI on log patterns

## Next Steps

### Learn the Capabilities

Reflexive has several capability flags:

```bash
# File operations
--write          # Allow file modifications
--shell          # Allow shell command execution

# Instrumentation
--inject         # Deep instrumentation (console, HTTP, GC)
--eval           # Runtime code evaluation (DANGEROUS)

# Debugging
--debug          # V8 Inspector debugging

# Development
--watch          # Auto-restart on file changes
--open           # Open dashboard in browser
```

### Try Library Mode

Embed Reflexive directly in your application:

```javascript
// app.js
import { makeReflexive } from 'reflexive';

const r = makeReflexive({
  port: 3099,
  title: 'My App'
});

// Your app code
console.log('App started');

// Expose custom state
r.setState('users.count', 42);
r.setState('cache.hitRate', 0.95);

// Programmatic chat
const answer = await r.chat("What's the current state?");
console.log(answer);
```

Run it:
```bash
node app.js
```

### Try Sandbox Mode

Run isolated apps in Vercel Sandbox:

```bash
reflexive --sandbox --write app.js
```

Sandbox mode enables:
- Snapshot and restore
- Complete isolation
- Safe experimentation

### Explore Examples

See [Examples](./examples.md) for more use cases:
- Express server development
- Debugging crashes
- Performance analysis
- Custom tool integration

## Configuration

For advanced configuration, create `reflexive.config.js`:

```javascript
export default {
  mode: 'local',
  port: 3099,
  capabilities: {
    readFiles: true,
    writeFiles: true,
    shellAccess: false,
    restart: true,
    inject: false,
    eval: false,
    debug: false
  }
};
```

Run with config:
```bash
reflexive --config reflexive.config.js app.js
```

See [User Guide](./user-guide.md) for complete configuration options.

## Troubleshooting

### "Command not found: reflexive"

If installed globally, ensure npm global bin is in your PATH:
```bash
npm config get prefix
export PATH="$(npm config get prefix)/bin:$PATH"
```

Or use npx:
```bash
npx reflexive app.js
```

### "ANTHROPIC_API_KEY not found"

Authenticate with Claude Code CLI:
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

Or set the API key:
```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### Dashboard Won't Load

Check if port 3099 is already in use:
```bash
lsof -i :3099
```

Use a different port:
```bash
reflexive --port 3100 app.js
```

### Process Won't Start

Ensure your entry file exists:
```bash
ls -la app.js
```

Check Node.js version:
```bash
node --version  # Should be >= 18.0.0
```

### More Help

See the [User Guide](./user-guide.md) for detailed troubleshooting or file an issue on GitHub.

## What's Next?

- **[User Guide](./user-guide.md)** - Complete feature documentation
- **[Examples](./examples.md)** - Real-world usage examples
- **[API Reference](./api-reference.md)** - Library API and REST endpoints
- **[Deployment Guide](./deployment.md)** - Production deployment

---

**Ready to dive deeper?** Continue to the [User Guide](./user-guide.md)
