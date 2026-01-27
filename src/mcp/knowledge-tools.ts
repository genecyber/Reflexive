/**
 * Self-Knowledge Tools
 *
 * Provides the agent with access to Reflexive's own documentation,
 * enabling it to help users write hybrid AI-native applications.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { createTool, textResult } from './tools.js';
import type { McpTool } from '../types/mcp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve docs directory - works from both source and installed package
function getDocsDir(): string {
  // When running from dist/, docs is at ../docs
  // When running from src/, docs is at ../../docs
  const possiblePaths = [
    join(__dirname, '..', '..', 'docs'),      // From dist/mcp/
    join(__dirname, '..', 'docs'),            // Alternative
    join(process.cwd(), 'docs'),              // From current working directory
    join(process.cwd(), 'node_modules', 'reflexive', 'docs'), // Installed as dependency
  ];

  for (const p of possiblePaths) {
    if (existsSync(p) && existsSync(join(p, 'index.md'))) {
      return p;
    }
  }

  return possiblePaths[0]; // Default, may not exist
}

const DOCS_DIR = getDocsDir();

// Map topic names to files
const TOPIC_FILES: Record<string, string> = {
  'overview': 'index.md',
  'index': 'index.md',
  'getting-started': 'getting-started.md',
  'start': 'getting-started.md',
  'user-guide': 'user-guide.md',
  'guide': 'user-guide.md',
  'api': 'api-reference.md',
  'api-reference': 'api-reference.md',
  'library': 'api-reference.md',
  'mcp': 'api-reference.md',
  'mcp-server': 'api-reference.md',
  'developer': 'developer-guide.md',
  'developer-guide': 'developer-guide.md',
  'architecture': 'developer-guide.md',
  'deployment': 'deployment.md',
  'deploy': 'deployment.md',
};

// Get list of available topics
function getAvailableTopics(): string[] {
  const uniqueFiles = new Set(Object.values(TOPIC_FILES));
  const topics: string[] = [];

  for (const [topic, file] of Object.entries(TOPIC_FILES)) {
    if (uniqueFiles.has(file)) {
      topics.push(topic);
      uniqueFiles.delete(file); // Only show first alias for each file
    }
  }

  return ['overview', 'getting-started', 'user-guide', 'api-reference', 'developer-guide', 'deployment'];
}

// Read documentation file
function readDocFile(topic: string): string {
  const filename = TOPIC_FILES[topic.toLowerCase()];

  if (!filename) {
    const available = getAvailableTopics().join(', ');
    return `Unknown topic: "${topic}". Available topics: ${available}`;
  }

  const filepath = join(DOCS_DIR, filename);

  if (!existsSync(filepath)) {
    return `Documentation file not found: ${filename}. The docs directory may not be installed correctly.`;
  }

  try {
    return readFileSync(filepath, 'utf-8');
  } catch (error) {
    return `Error reading documentation: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// List all available documentation
function listDocs(): string {
  const sections = [
    '# Reflexive Documentation\n',
    'Use `reflexive_self_knowledge` with a topic to get detailed documentation.\n',
    '## Available Topics\n',
    '| Topic | Description |',
    '|-------|-------------|',
    '| `overview` | Introduction, key features, operating modes |',
    '| `getting-started` | Installation, authentication, first steps |',
    '| `user-guide` | CLI usage, dashboard, configuration, watch triggers |',
    '| `api-reference` | Library API, MCP Server Mode, REST API, MCP tools |',
    '| `mcp` or `mcp-server` | MCP Server Mode for Claude Code, Claude Desktop, ChatGPT |',
    '| `developer-guide` | Architecture, code structure, contributing |',
    '| `deployment` | Railway, Docker, production deployment |',
    '',
    '## Quick Reference\n',
    '### Library Mode (Embed in Your App)',
    '',
    '**First, install the package:**',
    '```bash',
    'npm install reflexive',
    '```',
    '',
    '**Then use in your code:**',
    '```javascript',
    'import { makeReflexive } from \'reflexive\';',
    '',
    'const r = makeReflexive({ port: 3099, title: \'My App\' });',
    '',
    '// Expose state the AI can query',
    'r.setState(\'users.count\', 42);',
    '',
    '// Programmatic AI prompts (powerful!)',
    'const answer = await r.chat(\'What is the memory usage?\');',
    '',
    '// Use in endpoints for hybrid AI-native features',
    'app.get(\'/story/:topic\', async (req, res) => {',
    '  const story = await r.chat(`Write a story about ${req.params.topic}`);',
    '  res.json({ story });',
    '});',
    '```',
    '',
    '### CLI Mode (Monitor External Process)',
    '```bash',
    'reflexive [options] app.js',
    '',
    '# Common flags:',
    '--write          # Allow file modifications',
    '--shell          # Allow shell commands',
    '--debug          # Enable V8 debugger',
    '--watch          # Restart on file changes',
    '--inject         # Deep instrumentation',
    '```',
    '',
    '### MCP Server Mode (For External AI Agents)',
    '',
    'Run reflexive as an MCP server that Claude Code, Claude Desktop, or ChatGPT can connect to:',
    '',
    '```bash',
    '# Start without an app (use run_app tool to start apps dynamically)',
    'npx reflexive --mcp --write --debug',
    '',
    '# Start with a specific app',
    'npx reflexive --mcp --write --debug ./app.js',
    '',
    '# Add to Claude Code (full capabilities)',
    'claude mcp add --transport stdio reflexive -- npx reflexive --mcp --write --shell --debug',
    '```',
    '',
    'Tools available to connected agents:',
    '- `run_app` - start or switch to a different Node.js app',
    '- `get_process_state`, `get_output_logs`, `restart_process`, `stop_process`',
    '- `read_file`, `write_file`, `edit_file`, `list_directory` (with --write)',
    '- `exec_shell` (with --shell)',
    '- `chat` - talk to embedded Reflexive agent',
    '- Debug tools (with --debug): breakpoints, stepping, scope inspection',
    '',
    '### CLI + Library Mode (Automatic Integration)',
    '',
    'When your app uses `makeReflexive()` AND you run it with `reflexive app.js`:',
    '- makeReflexive() detects CLI mode and becomes a client',
    '- `.chat()` calls proxy to CLI\'s server (no port conflicts)',
    '- `.setState()` syncs to CLI dashboard',
    '- Your app works identically in both modes',
    '',
    '```bash',
    '# Standalone (app starts its own server)',
    'node app.js',
    '',
    '# With CLI (app connects to CLI\'s server)',
    'reflexive app.js',
    '',
    '# With CLI + eval capabilities (both systems work together)',
    'reflexive --eval --write app.js',
    '```',
    '',
    '### CLI Flags + Library Mode (Orthogonal Systems)',
    '',
    'Important: `--eval`/`--inject` work EVEN when app uses `makeReflexive()`:',
    '',
    '1. **Injection system** (--inject/--eval):',
    '   - Loads via Node\'s --require flag at startup',
    '   - Instruments console, HTTP, GC, event loop',
    '   - Enables evaluate_in_app tool (with --eval)',
    '   - Communicates via IPC with CLI',
    '',
    '2. **Library system** (makeReflexive()):',
    '   - Detects CLI via REFLEXIVE_CLI_MODE env var',
    '   - Connects as HTTP client to CLI server',
    '   - Enables .chat() and .setState() in app code',
    '   - Agent can use get_custom_state tool',
    '',
    'These work TOGETHER - agent gets:',
    '- evaluate_in_app (from --eval injection)',
    '- get_custom_state (from makeReflexive)',
    '- Programmatic .chat() in user code (from makeReflexive)',
    '- No conflicts (IPC vs HTTP channels)',
  ];

  return sections.join('\n');
}

/**
 * Create the self-knowledge tool
 */
export function createKnowledgeTool(): McpTool {
  return createTool(
    'reflexive_self_knowledge',
    `Get detailed documentation about Reflexive's capabilities.

Use this tool when you need to:
- Help users write code that uses Reflexive features
- Understand the API for makeReflexive, chat(), setState(), etc.
- Explain how to create hybrid AI-native applications
- Look up CLI options, configuration, or deployment options

Topics: overview, getting-started, user-guide, api-reference, developer-guide, deployment

Call with no topic to see a quick reference and list of available topics.`,
    {
      topic: z.string().optional().describe(
        'Documentation topic to retrieve. Options: overview, getting-started, user-guide, api-reference, developer-guide, deployment. Omit for quick reference.'
      ),
    },
    async ({ topic }) => {
      if (!topic) {
        return textResult(listDocs());
      }

      const content = readDocFile(topic);
      return textResult(content);
    }
  );
}

/**
 * Create all knowledge tools (currently just one, but extensible)
 */
export function createKnowledgeTools(): McpTool[] {
  return [createKnowledgeTool()];
}
