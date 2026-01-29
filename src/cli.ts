#!/usr/bin/env node

/**
 * Reflexive CLI
 *
 * Run any Node.js application with an AI agent that can see and control it.
 *
 * Usage:
 *   reflexive [options] [entry-file] [-- app-args...]
 */

import { spawn } from 'child_process';
import { resolve, dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, realpathSync, statSync, readdirSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { createServer, ServerResponse } from 'http';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { ProcessManager } from './managers/process-manager.js';
import { SandboxManager } from './managers/sandbox-manager.js';
import { getDashboardHTML } from './core/dashboard.js';
import { createChatStream } from './core/chat-stream.js';
import { createCliTools } from './mcp/cli-tools.js';
import { createSandboxTools, getSandboxAllowedTools } from './mcp/sandbox-tools.js';
import { createKnowledgeTools } from './mcp/knowledge-tools.js';
import { parseJsonBody } from './core/http-server.js';
import { getRuntimeForFile } from './runtimes/index.js';
import { z } from 'zod';
import type { Capabilities } from './types/index.js';
import type { AnyToolDefinition } from './mcp/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Helper: Convert Zod schema to JSON Schema for SDK MCP server
// ============================================================================

/**
 * Convert a Zod schema to JSON Schema format for the Claude Agent SDK
 * The SDK needs JSON Schema, not Zod objects
 */
function convertZodToJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  // Handle ZodObject specifically
  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = value as z.ZodTypeAny;
      properties[key] = convertZodFieldToJsonSchema(fieldSchema);

      // Check if field is required (not optional)
      if (!(fieldSchema instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  // Fallback for non-object schemas
  return { type: 'object', properties: {} };
}

/**
 * Convert a single Zod field to JSON Schema
 */
function convertZodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Handle optional wrapper
  let innerField = field;
  if (field instanceof z.ZodOptional) {
    innerField = field._def.innerType;
  }

  // Determine type
  if (innerField instanceof z.ZodString) {
    result.type = 'string';
  } else if (innerField instanceof z.ZodNumber) {
    result.type = 'number';
  } else if (innerField instanceof z.ZodBoolean) {
    result.type = 'boolean';
  } else if (innerField instanceof z.ZodArray) {
    result.type = 'array';
    result.items = convertZodFieldToJsonSchema(innerField._def.type);
  } else if (innerField instanceof z.ZodEnum) {
    result.type = 'string';
    result.enum = innerField._def.values;
  } else {
    result.type = 'string'; // fallback
  }

  // Add description if available
  if (field.description) {
    result.description = field.description;
  }

  return result;
}

// ============================================================================
// Static file serving for Next.js dashboard
// ============================================================================

const DASHBOARD_DIR = join(__dirname, '..', 'dashboard', 'out');
const DASHBOARD_AVAILABLE = existsSync(DASHBOARD_DIR);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

function serveStaticFile(res: ServerResponse, filePath: string): boolean {
  try {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const data = readFileSync(filePath);

    const cacheControl = ext === '.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function tryServeDashboard(res: ServerResponse, pathname: string): boolean {
  if (!DASHBOARD_AVAILABLE) return false;

  // Remove /reflexive prefix to get the file path in the out directory
  let relativePath = pathname.replace(/^\/reflexive/, '') || '/';

  // Try exact file match first
  let filePath = join(DASHBOARD_DIR, relativePath);
  if (existsSync(filePath) && !filePath.endsWith('/')) {
    const stat = statSync(filePath);
    if (stat.isFile()) {
      return serveStaticFile(res, filePath);
    }
  }

  // Try with index.html for directories
  if (relativePath === '/' || relativePath.endsWith('/')) {
    filePath = join(DASHBOARD_DIR, relativePath, 'index.html');
    if (existsSync(filePath)) {
      return serveStaticFile(res, filePath);
    }
  }

  // Try adding .html extension
  filePath = join(DASHBOARD_DIR, relativePath + '.html');
  if (existsSync(filePath)) {
    return serveStaticFile(res, filePath);
  }

  return false;
}

interface CliOptions {
  entry: string | null;
  port: number;
  host: string;
  open: boolean;
  interactive: boolean;
  inject: boolean;  // Internal flag: true when eval is enabled
  eval: boolean;
  debug: boolean;
  sandbox: boolean;
  mcp: boolean;      // Run as stdio MCP server for external agents
  mcpWebUI: boolean; // Enable webUI when in MCP mode (default: true)
  demo: string | null; // Demo name to run (basic, queue, inject)
  capabilities: Capabilities;
  nodeArgs: string[];
  appArgs: string[];
}

// Demo name mapping
const DEMOS: Record<string, { file: string; flags?: string[] }> = {
  'basic': { file: 'basic-server.js' },
  'server': { file: 'basic-server.js' },
  'queue': { file: 'task-queue.js' },
  'task': { file: 'task-queue.js' },
  'inject': { file: 'injection-test.js', flags: ['--inject'] },
  'eval': { file: 'injection-test.js', flags: ['--eval'] },
};

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    entry: null,
    port: 3099,
    host: 'localhost',
    open: false,
    interactive: false,
    inject: false,
    eval: false,
    debug: false,
    sandbox: false,
    mcp: false,
    mcpWebUI: true,  // webUI on by default even in MCP mode
    demo: null,
    capabilities: {
      readFiles: true,
      writeFiles: false,
      shellAccess: false,
      restart: true,
      inject: false,
      eval: false,
      debug: false
    },
    nodeArgs: [],
    appArgs: []
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      options.port = parseInt(args[++i], 10);
    } else if (arg === '--host' || arg === '-h') {
      options.host = args[++i];
    } else if (arg === '--open' || arg === '-o') {
      options.open = true;
    } else if (arg === '--interactive' || arg === '-i') {
      options.interactive = true;
    } else if (arg === '--eval') {
      // --eval now includes deep instrumentation (what --inject did)
      options.inject = true;
      options.eval = true;
      options.capabilities.eval = true;
    } else if (arg === '--debug' || arg === '-d') {
      options.debug = true;
      options.capabilities.debug = true;
    } else if (arg === '--inspect') {
      // --inspect = eval + debug (the \"poke around\" mode)
      options.inject = true;
      options.eval = true;
      options.debug = true;
      options.capabilities.eval = true;
      options.capabilities.debug = true;
    } else if (arg === '--sandbox' || arg === '-s') {
      options.sandbox = true;
    } else if (arg === '--mcp') {
      options.mcp = true;
    } else if (arg === '--no-webui') {
      options.mcpWebUI = false;
    } else if (arg === '--capabilities' || arg === '-c') {
      const caps = args[++i].split(',');
      for (const cap of caps) {
        const trimmed = cap.trim() as keyof Capabilities;
        if (trimmed in options.capabilities) {
          options.capabilities[trimmed] = true;
        }
      }
    } else if (arg === '--write') {
      options.capabilities.writeFiles = true;
    } else if (arg === '--shell') {
      options.capabilities.shellAccess = true;
    } else if (arg === '--dev') {
      // --dev = write + shell + eval
      options.capabilities.writeFiles = true;
      options.capabilities.shellAccess = true;
      options.capabilities.eval = true;
      options.inject = true;
      options.eval = true;
    } else if (arg === '--full') {
      // --full = write + shell + eval + debug (everything useful)
      options.capabilities.writeFiles = true;
      options.capabilities.shellAccess = true;
      options.capabilities.eval = true;
      options.capabilities.debug = true;
      options.inject = true;
      options.eval = true;
      options.debug = true;
    } else if (arg === '--dangerously-skip-permissions') {
      options.capabilities.readFiles = true;
      options.capabilities.writeFiles = true;
      options.capabilities.shellAccess = true;
      options.capabilities.restart = true;
      options.capabilities.eval = true;
      options.capabilities.debug = true;
      options.inject = true;
      options.eval = true;
      options.debug = true;
    } else if (arg === '--node-args') {
      options.nodeArgs = args[++i].split(' ');
    } else if (arg === '--demo') {
      options.demo = args[++i] || 'basic';
      options.open = true;  // Auto-open browser for demos
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      const pkgPath = join(__dirname, '..', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      console.log(`reflexive v${pkg.version}`);
      process.exit(0);
    } else if (arg === '--') {
      options.appArgs = args.slice(i + 1);
      break;
    } else if (!arg.startsWith('-')) {
      if (!options.entry) {
        options.entry = arg;
      } else {
        options.appArgs.push(arg);
      }
    }
    i++;
  }

  return options;
}

function printHelp(): void {
  console.log(`
Reflexive CLI

Run any Node.js application with an AI agent that can see and control it.

USAGE:
  reflexive [options] [entry-file] [-- app-args...]

  If no entry file is specified, reflexive will look for package.json and
  let you select from available scripts (or auto-run "start" if it's the only one).

OPTIONS:
  -p, --port <port>       Dashboard port (default: 3099)
  -h, --host <host>       Dashboard host (default: localhost)
  -o, --open              Open dashboard in browser
  -i, --interactive       Interactive mode: proxy stdin/stdout through agent
  -s, --sandbox           Run in Vercel Sandbox (isolated environment)
      --mcp               Run as stdio MCP server (for external AI agents like Claude Code)
      --no-webui          Disable web dashboard (only applies to --mcp mode)
      --demo <name>       Run a built-in demo (basic, queue, inject, eval)
      --eval              Enable runtime code evaluation (includes deep instrumentation)
  -d, --debug             Enable debugging (V8 Inspector for Node.js, DAP for Python/Go/.NET/Rust)
      --inspect           Enable eval + debug (the "poke around" mode)
  -c, --capabilities      Enable capabilities (comma-separated)
      --write             Enable file writing
      --shell             Enable shell access
      --node-args <args>  Arguments to pass to Node.js
      --help              Show this help
  -v, --version           Show version number

PRESETS:
      --dev               Preset: write + shell + eval (common development combo)
      --full              Preset: write + shell + eval + debug (everything useful)
      --dangerously-skip-permissions  Enable ALL capabilities (same as --full)

CAPABILITIES:
  readFiles      Read project files (default: on)
  writeFiles     Write/edit files
  shellAccess    Run shell commands
  restart        Restart the process (default: on)
  eval           Runtime code evaluation with deep instrumentation
  debug          Multi-language debugging (Node.js, Python, Go, .NET, Rust)

MCP SERVER MODE:
  Run reflexive as an MCP server that external AI agents can connect to:

    reflexive --mcp --write ./app.js              # Start with a specific app
    reflexive --mcp --write                       # Start without an app (use run_app tool)
    reflexive --mcp --write --shell --debug       # Full capabilities with debugging

  Configure in Claude Code's MCP settings:
    {
      "mcpServers": {
        "reflexive": {
          "command": "npx",
          "args": ["reflexive", "--mcp", "--write", "--shell", "--debug"]
        }
      }
    }

  The MCP server exposes all reflexive tools (logs, restart, files, debug, etc.)
  Use --debug to enable breakpoint tools (set_breakpoint, resume, step_*, etc.)
  Use the run_app tool to dynamically start or switch between different apps.
  WebUI is still available at http://localhost:3099 unless --no-webui is specified.

DEMOS:
  Run built-in demos to explore Reflexive features:

    reflexive --demo basic     # HTTP server with watch trigger demos
    reflexive --demo queue     # Task queue with background worker
    reflexive --demo inject    # Injection mode demo (console, HTTP, GC tracking)
    reflexive --demo eval      # Eval mode demo (runtime code evaluation)

EXAMPLES:
  reflexive                                    # Auto-detect from package.json
  reflexive ./index.js                         # Run specific file
  reflexive --demo basic                       # Run the basic demo
  reflexive --sandbox ./app.js                 # Run in isolated Vercel Sandbox
  reflexive --mcp --write ./app.js             # Run as MCP server for external agents
  reflexive --dev ./app.js                     # Development mode (write + shell + eval)
  reflexive --inspect ./server.js              # Full introspection (eval + debug)
  reflexive --full ./server.js                 # All capabilities enabled
  reflexive ./app.js -- --port 8080            # Pass args to your app
`);
}

async function resolveEntryFromPackageJson(options: CliOptions): Promise<string | null> {
  const pkgPath = resolve(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    const scriptNames = Object.keys(scripts);

    if (scriptNames.length === 0) {
      // Try main field
      if (pkg.main) {
        return resolve(process.cwd(), pkg.main);
      }
      return null;
    }

    // If there's a "start" script, extract the entry file
    if (scripts.start) {
      const match = scripts.start.match(/node\s+([^\s]+)/);
      if (match) {
        return resolve(process.cwd(), match[1]);
      }
    }

    // If there's only one script, use it
    if (scriptNames.length === 1) {
      const match = scripts[scriptNames[0]].match(/node\s+([^\s]+)/);
      if (match) {
        return resolve(process.cwd(), match[1]);
      }
    }

    // Try main field
    if (pkg.main) {
      return resolve(process.cwd(), pkg.main);
    }

    return null;
  } catch {
    return null;
  }
}

function buildSystemPrompt(processManager: ProcessManager, options: CliOptions): string {
  const state = processManager.getState();
  const parts: string[] = [
    'You are an AI assistant powered by Reflexive, controlling a Node.js process.',
    state.entry ? `Entry file: ${state.entry}` : 'Entry file: (none configured - use run_app to start an app)',
    `Working directory: ${state.cwd}`,
    '',
    'SELF-KNOWLEDGE: Use `reflexive_self_knowledge` to get detailed documentation about Reflexive.',
    'This includes: CLI options, library API (makeReflexive, chat, setState), patterns for AI-native apps.',
    '',
    'CLARIFY APPROACH: When a user request could be done multiple ways, ASK which approach they prefer:',
    '1. RUNTIME (temporary): Use --eval to do it now, works only while CLI is running',
    '2. CODE CHANGE (permanent): Modify the source code, works when app runs standalone',
    '3. LIBRARY MODE (permanent + AI): Install reflexive (`npm install reflexive`), use makeReflexive() and .chat() for AI-native features',
    '',
    'Example: "make it log a joke" could mean:',
    '- Runtime: evaluate_in_app to log a joke now (temporary)',
    '- Code change: edit the file to add console.log (permanent but static)',
    '- Library mode: use reflexive.chat() to generate jokes dynamically (requires npm install)',
  ];

  if (options.interactive) {
    parts.push('');
    parts.push('INTERACTIVE MODE: This is a CLI application that expects user input.');
    parts.push('When the process shows a prompt or is waiting for input, use send_input to respond.');
    parts.push('Read the recent output carefully to understand what the app is asking for.');
  }



  if (options.eval) {
    parts.push('');
    parts.push('EVAL MODE: Runtime code evaluation is enabled.');
    parts.push('EVAL MODE includes deep instrumentation: console, diagnostics, and state tracking.');
    parts.push('EVAL MODE includes deep instrumentation: console, diagnostics, and state tracking.');
    parts.push('You can execute arbitrary JavaScript in the app context with evaluate_in_app.');
    parts.push('Use this power responsibly - you can inspect and modify the running application.');
  }

  if (options.debug) {
    parts.push('');
    parts.push('DEBUG MODE: Multi-language debugging is enabled.');
    parts.push('Supported: Node.js (V8 Inspector), Python (debugpy), Go (Delve), .NET (netcoredbg), Rust (CodeLLDB).');
    parts.push('You can set real breakpoints, step through code, and inspect variables.');
    parts.push('Use debug_set_breakpoint to add breakpoints at specific lines.');
    parts.push('When paused, use debug_get_call_stack and debug_get_scope_variables to inspect state.');
    parts.push('You can also add a "prompt" to breakpoints that auto-triggers when hit.');
  }

  parts.push('');
  parts.push('Capabilities:');
  parts.push(`  - Read files: ${options.capabilities.readFiles ? 'yes' : 'no'}`);
  parts.push(`  - Write files: ${options.capabilities.writeFiles ? 'yes' : 'no'}`);
  parts.push(`  - Shell access: ${options.capabilities.shellAccess ? 'yes' : 'no'}`);
  parts.push(`  - Restart process: ${options.capabilities.restart ? 'yes' : 'no'}`);

  return parts.join('\n');
}

function buildSandboxSystemPrompt(sandboxManager: SandboxManager, options: CliOptions): string {
  const state = sandboxManager.getState();
  const parts: string[] = [
    'You are an AI assistant powered by Reflexive, controlling a Node.js application in an isolated Vercel Sandbox.',
    `Entry file: ${state.entry}`,
    'The app runs in a secure, isolated environment.',
    '',
    'SELF-KNOWLEDGE: Use `reflexive_self_knowledge` to get detailed documentation about Reflexive.',
    '',
    'CLARIFY APPROACH: When a user request could be done multiple ways, ASK which approach they prefer:',
    '1. CODE CHANGE (permanent): Modify the source code',
    '2. LIBRARY MODE (permanent + AI): Use makeReflexive() and .chat() for AI-native features (requires `npm install reflexive`)',
  ];

  parts.push('');
  parts.push('SANDBOX MODE: The application runs in an isolated Vercel Sandbox.');
  parts.push('You can access custom state via process.reflexive.setState() and get_custom_state.');
  parts.push('Console logs, errors, and state changes are captured.');

  parts.push('');
  parts.push('Capabilities:');
  parts.push(`  - Read files: ${options.capabilities.readFiles ? 'yes' : 'no'}`);
  parts.push(`  - Write files: ${options.capabilities.writeFiles ? 'yes' : 'no'}`);
  parts.push(`  - Shell access: ${options.capabilities.shellAccess ? 'yes' : 'no'}`);
  parts.push(`  - Restart sandbox: ${options.capabilities.restart ? 'yes' : 'no'}`);

  return parts.join('\n');
}

function getAllowedTools(capabilities: Capabilities): string[] {
  const tools: string[] = [
    'get_process_state',
    'get_output_logs',
    'search_logs',
    'send_input'
  ];

  if (capabilities.restart) {
    tools.push('restart_process', 'stop_process', 'start_process');
  }

  if (capabilities.eval) {
    // eval includes injection, so add both eval and injection tools
    tools.push('get_injected_state', 'get_injection_logs');
    tools.push('evaluate_in_app', 'list_app_globals');
  }

  if (capabilities.debug) {
    tools.push(
      'debug_set_breakpoint',
      'debug_remove_breakpoint',
      'debug_list_breakpoints',
      'debug_resume',
      'debug_pause',
      'debug_step_over',
      'debug_step_into',
      'debug_step_out',
      'debug_get_call_stack',
      'debug_evaluate',
      'debug_get_scope_variables',
      'debug_get_state'
    );
  }

  return tools;
}

async function startCliDashboard(processManager: ProcessManager, options: CliOptions): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  // Create MCP server with CLI tools + knowledge tools
  const cliTools = createCliTools({
    processManager,
    capabilities: options.capabilities,
    inject: options.inject,
    eval: options.eval,
    debug: options.debug
  });
  const knowledgeTools = createKnowledgeTools();
  const allTools = [...cliTools, ...knowledgeTools];

  // Extract raw Zod shapes for the SDK (it expects raw shapes, not ZodObject wrappers)
  const sdkTools = allTools.map(tool => ({
    ...tool,
    inputSchema: tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {}
  }));

  const mcpServer = createSdkMcpServer({
    name: 'reflexive-cli',
    tools: sdkTools
  });

  // Store conversation session ID for continuity
  let conversationSessionId: string | null = null;

  // Store chat messages server-side for persistence across UI refreshes
  interface StoredMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    isCliOutput?: boolean;
    isCliInput?: boolean;
    isWatchTrigger?: boolean;
    watchPattern?: string;
    isBreakpointPrompt?: boolean;
    breakpointFile?: string;
    breakpointLine?: number;
    isAutoTrigger?: boolean;
  }
  const chatHistory: StoredMessage[] = [];
  const MAX_CHAT_HISTORY = 100;

  function addChatMessage(msg: Omit<StoredMessage, 'id' | 'timestamp'>): StoredMessage {
    const message: StoredMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString()
    };
    chatHistory.push(message);
    // Trim old messages
    while (chatHistory.length > MAX_CHAT_HISTORY) {
      chatHistory.shift();
    }
    return message;
  }

  // In interactive mode, stream CLI output to chat for persistence
  // Buffer output and flush after a short delay (debounce rapid output)
  if (options.interactive) {
    let outputBuffer = '';
    let outputTimeout: ReturnType<typeof setTimeout> | null = null;

    processManager.setOutputCallback((text, _source) => {
      outputBuffer += text;
      if (outputTimeout) clearTimeout(outputTimeout);
      outputTimeout = setTimeout(() => {
        if (outputBuffer.trim()) {
          addChatMessage({
            role: 'assistant',
            content: outputBuffer,
            isCliOutput: true
          });
        }
        outputBuffer = '';
      }, 100);
    });
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      // Serve logo
      if (pathname === '/logo-carbon.png') {
        const logoPath = join(__dirname, '..', 'logo-carbon.png');
        try {
          const logoData = readFileSync(logoPath);
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
          res.end(logoData);
        } catch {
          res.writeHead(404);
          res.end('Logo not found');
        }
        return;
      }

      // Redirect root to /reflexive if Next.js dashboard is available
      if (pathname === '/' || pathname === '/dashboard') {
        if (DASHBOARD_AVAILABLE) {
          res.writeHead(302, { 'Location': '/reflexive/' });
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML({
          title: 'Reflexive CLI',
          status: processManager.getState(),
          showControls: true,
          interactive: options.interactive,
          inject: options.inject,
          debug: options.debug,
          capabilities: options.capabilities,
          logsEndpoint: '/logs',
          statusEndpoint: '/state',
          chatEndpoint: '/chat',
          cliInputEndpoint: '/cli-input'
        }));
        return;
      }

      // Serve Next.js dashboard at /reflexive
      if (pathname.startsWith('/reflexive')) {
        if (tryServeDashboard(res, pathname)) {
          return;
        }
        // Fall back to embedded HTML if dashboard not available
        if (pathname === '/reflexive' || pathname === '/reflexive/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getDashboardHTML({
            title: 'Reflexive CLI',
            status: processManager.getState(),
            showControls: true,
            interactive: options.interactive,
            inject: options.inject,
            debug: options.debug,
            capabilities: options.capabilities,
            logsEndpoint: '/logs',
            statusEndpoint: '/state',
            chatEndpoint: '/chat',
            cliInputEndpoint: '/cli-input'
          }));
          return;
        }
      }

      // Interactive mode: direct CLI input
      if (pathname === '/cli-input' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { input } = JSON.parse(body);

        if (input && options.interactive) {
          processManager.sendInput(input);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, sent: input }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Interactive mode not enabled or no input' }));
        }
        return;
      }

      if (pathname === '/chat' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const {
          message,
          isCliInput,
          skipUserStorage,
          // Metadata for auto-triggered messages (persists on refresh)
          isWatchTrigger,
          watchPattern,
          isBreakpointPrompt,
          breakpointFile,
          breakpointLine,
          isAutoTrigger,
        } = JSON.parse(body);

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message required' }));
          return;
        }

        // Store user message in chat history (skip for auto-triggers)
        if (!skipUserStorage) {
          addChatMessage({ role: 'user', content: message, isCliInput });
        }

        const state = processManager.getState();
        const recentLogs = processManager.getLogs(options.interactive ? 30 : 10);
        const recentOutput = options.interactive
          ? `\n\nRecent CLI output (read carefully):\n---\n${recentLogs.filter(l => l.type === 'stdout' || l.type === 'stderr').slice(-15).map(l => l.message).join('\n')}\n---`
          : `\nRecent output: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;
        const contextSummary = `Process: ${state.isRunning ? 'running' : 'stopped'}, PID: ${state.pid}, uptime: ${state.uptime}s${state.waitingForInput ? ', WAITING FOR INPUT' : ''}${recentOutput}`;

        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: buildSystemPrompt(processManager, options),
          mcpServer,
          mcpServerName: 'reflexive-cli',
          sessionId: conversationSessionId || undefined,
          queryOptions: {
            cwd: state.cwd,
            allowedTools: getAllowedTools(options.capabilities)
          }
        });

        // SSE handler that also captures session ID
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // Accumulate assistant response
        let assistantContent = '';

        try {
          for await (const chunk of chatStream) {
            // Capture session ID for conversation continuity
            if (chunk.type === 'session' && chunk.sessionId) {
              conversationSessionId = chunk.sessionId;
            }
            // Accumulate text content
            if (chunk.type === 'text') {
              assistantContent += (chunk as { type: 'text'; content: string }).content || '';
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          // Store complete assistant response with metadata
          if (assistantContent) {
            addChatMessage({
              role: 'assistant',
              content: assistantContent,
              isWatchTrigger,
              watchPattern,
              isBreakpointPrompt,
              breakpointFile,
              breakpointLine,
              isAutoTrigger,
            });
          }
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: (e as Error).message })}\n\n`);
          // Store error as assistant message
          addChatMessage({ role: 'assistant', content: `Error: ${(e as Error).message}` });
        }
        res.end();
        return;
      }

      // Reset conversation (clear session history and chat messages)
      if (pathname === '/reset-conversation' && req.method === 'POST') {
        conversationSessionId = null;
        chatHistory.length = 0; // Clear chat history
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Conversation reset' }));
        return;
      }

      // Get chat history
      if (pathname === '/chat-history' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chatHistory));
        return;
      }

      // Add CLI output to chat (for interactive mode)
      if (pathname === '/chat-cli-output' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { content, isStderr } = JSON.parse(body);
        if (content) {
          addChatMessage({ role: 'assistant', content, isCliOutput: true });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Toggle permissions
      if (pathname === '/permissions' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const { permission, toggle } = JSON.parse(body);
          if (toggle && permission && permission in options.capabilities) {
            const capKey = permission as keyof Capabilities;
            options.capabilities[capKey] = !options.capabilities[capKey];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, enabled: options.capabilities[capKey] }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid permission or toggle not specified' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      // Reload reflexive with new settings (capabilities and modes)
      if (pathname === '/reload' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const settings = JSON.parse(body);

          // Update capabilities
          if (settings.capabilities) {
            for (const [key, value] of Object.entries(settings.capabilities)) {
              if (key in options.capabilities) {
                options.capabilities[key as keyof Capabilities] = value as boolean;
              }
            }
          }

          // Update mode flags
          if (settings.interactive !== undefined) {
            options.interactive = settings.interactive;
          }
          if (settings.debug !== undefined) {
            options.debug = settings.debug;
            options.capabilities.debug = settings.debug;
          }
          if (settings.inject !== undefined) {
            options.inject = settings.inject;
          }
          if (settings.eval !== undefined) {
            options.eval = settings.eval;
            options.capabilities.eval = settings.eval;
            // --eval implies --inject
            if (settings.eval) {
              options.inject = true;
            }
          }

          // Update ProcessManager options and restart the process
          processManager.updateOptions({
            interactive: options.interactive,
            inject: options.inject,
            eval: options.eval,
            debug: options.debug,
          });
          await processManager.restart();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            settings: {
              capabilities: options.capabilities,
              interactive: options.interactive,
              debug: options.debug,
              inject: options.inject,
              eval: options.eval,
            }
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      if (pathname === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...processManager.getState(),
          capabilities: options.capabilities,
          showControls: true,
          // Mode flags for dashboard toggles
          interactive: options.interactive,
          inject: options.inject,
          eval: options.eval,
          debug: options.debug
        }));
        return;
      }

      // Receive state updates from child makeReflexive() instances
      if (pathname === '/client-state' && req.method === 'POST') {
        try {
          const { key, value } = await parseJsonBody<{ key: string; value: unknown }>(req);
          if (key) {
            processManager.setClientState(key, value);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'key required' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      if (pathname === '/logs') {
        const count = parseInt(url.searchParams.get('count') || '50', 10);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(processManager.getLogs(count)));
        return;
      }

      // Allow dashboard to log messages
      if (pathname === '/log' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          // Log is handled internally by ProcessManager
          const { type, message: logMessage } = JSON.parse(body);
          processManager.emit('log', { type: type || 'dashboard', message: logMessage, timestamp: new Date().toISOString() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      if (pathname === '/restart' && req.method === 'POST') {
        await processManager.restart();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/stop' && req.method === 'POST') {
        await processManager.stop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/start' && req.method === 'POST') {
        processManager.start();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Run a different app (for dynamic app switching from dashboard)
      if (pathname === '/run-app' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const { path: appPath, args } = JSON.parse(body);
          if (!appPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'path required' }));
            return;
          }
          const absPath = resolve(process.cwd(), appPath);
          if (!existsSync(absPath)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `File not found: ${absPath}` }));
            return;
          }
          await processManager.runApp(absPath, args);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, entry: absPath }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      if (pathname === '/shutdown' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        await processManager.stop();
        process.exit(0);
      }

      // File browser endpoint - list files in a directory
      // File browser endpoint - gated by readFiles capability
      if (pathname === '/files') {
        if (!options.capabilities.readFiles) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File reading not enabled' }));
          return;
        }
        const dir = url.searchParams.get('dir') || process.cwd();
        try {
          const absDir = resolve(dir);
          if (!existsSync(absDir)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Directory not found' }));
            return;
          }
          const stat = statSync(absDir);
          if (!stat.isDirectory()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not a directory' }));
            return;
          }
          const entries = readdirSync(absDir, { withFileTypes: true });
          const files = entries
            .filter(e => !e.name.startsWith('.')) // Hide dotfiles
            .map(e => ({
              name: e.name,
              path: join(absDir, e.name),
              isDirectory: e.isDirectory(),
              isFile: e.isFile(),
            }))
            .sort((a, b) => {
              // Directories first, then files
              if (a.isDirectory && !b.isDirectory) return -1;
              if (!a.isDirectory && b.isDirectory) return 1;
              return a.name.localeCompare(b.name);
            });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            dir: absDir,
            parent: dirname(absDir),
            files,
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }

      // V8 Inspector debugging endpoints (only when --debug is enabled)
      if (pathname === '/debugger-status') {
        if (!options.debug) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ enabled: false }));
          return;
        }
        const debugState = processManager.getDebuggerState();
        const triggeredPrompts = processManager.getTriggeredBreakpointPrompts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: true, ...debugState, triggeredPrompts }));
        return;
      }

      // Clear triggered breakpoint prompts after frontend processes them
      if (pathname === '/debugger-clear-prompts' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const { timestamps } = JSON.parse(body);
          if (timestamps && Array.isArray(timestamps)) {
            processManager.clearTriggeredBreakpointPrompts(timestamps);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/debugger-resume' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        try {
          await processManager.debugResume();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/debugger-pause' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        try {
          await processManager.debugPause();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/debugger-step-over' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        try {
          await processManager.debugStepOver();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/debugger-step-into' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        try {
          await processManager.debugStepInto();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/debugger-step-out' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        try {
          await processManager.debugStepOut();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      // Breakpoint management endpoints
      if (pathname === '/debugger-breakpoints' && req.method === 'GET') {
        if (!options.debug) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ enabled: false, breakpoints: [] }));
          return;
        }
        const breakpoints = processManager.getPersistedBreakpoints();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: true, breakpoints }));
        return;
      }

      // Create a new breakpoint
      if (pathname === '/debugger-breakpoints' && req.method === 'POST') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const { file, line, condition, prompt, promptEnabled } = JSON.parse(body);
          if (!file || !line) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'file and line required' }));
            return;
          }
          const bp = await processManager.debugSetBreakpoint(file, line, condition);
          // Apply prompt settings if provided
          if (bp && (prompt || promptEnabled !== undefined)) {
            processManager.updateBreakpoint(bp.breakpointId, { prompt, promptEnabled });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, breakpoint: bp }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      // Delete a breakpoint
      if (pathname.startsWith('/debugger-breakpoint/') && req.method === 'DELETE') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        const breakpointId = decodeURIComponent(pathname.slice('/debugger-breakpoint/'.length));
        try {
          await processManager.debugRemoveBreakpoint(breakpointId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      // Update breakpoint properties
      if (pathname.startsWith('/debugger-breakpoint/') && req.method === 'PATCH') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        const breakpointId = decodeURIComponent(pathname.slice('/debugger-breakpoint/'.length));
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const updates = JSON.parse(body);
          const bp = processManager.updateBreakpoint(breakpointId, updates);
          if (bp) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, breakpoint: bp }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Breakpoint not found' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        options.port++;
        server.listen(options.port, options.host);
      } else {
        reject(err);
      }
    });

    server.on('listening', () => {
      resolve({ server, port: options.port });
    });

    server.listen(options.port, options.host);
  });
}

async function startSandboxDashboard(sandboxManager: SandboxManager, options: CliOptions): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  // Create MCP server with sandbox tools + knowledge tools
  const sandboxTools = createSandboxTools({
    sandboxManager,
    capabilities: options.capabilities
  });
  const knowledgeTools = createKnowledgeTools();
  const allTools = [...sandboxTools, ...knowledgeTools];

  // Extract raw Zod shapes for the SDK (it expects raw shapes, not ZodObject wrappers)
  const sdkTools = allTools.map(tool => ({
    ...tool,
    inputSchema: tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {}
  }));

  const mcpServer = createSdkMcpServer({
    name: 'reflexive-sandbox',
    tools: sdkTools
  });

  // Store conversation session ID for continuity
  let conversationSessionId: string | null = null;

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      // Serve logo
      if (pathname === '/logo-carbon.png') {
        const logoPath = join(__dirname, '..', 'logo-carbon.png');
        try {
          const logoData = readFileSync(logoPath);
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
          res.end(logoData);
        } catch {
          res.writeHead(404);
          res.end('Logo not found');
        }
        return;
      }

      // Redirect root to /reflexive if Next.js dashboard is available
      if (pathname === '/' || pathname === '/dashboard') {
        if (DASHBOARD_AVAILABLE) {
          res.writeHead(302, { 'Location': '/reflexive/' });
          res.end();
          return;
        }
        const state = sandboxManager.getState();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML({
          title: 'Reflexive Sandbox',
          status: {
            isRunning: state.isRunning,
            pid: null,
            uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
            restartCount: 0,
            exitCode: null,
            entry: state.entry || '',
            cwd: process.cwd(),
            interactive: false,
            waitingForInput: false,
            injectionReady: state.isRunning,
            debug: false,
            debuggerConnected: false,
            debuggerPaused: false,
            inspectorUrl: null
          },
          showControls: true,
          interactive: false,
          debug: false,
          capabilities: options.capabilities,
          logsEndpoint: '/logs',
          statusEndpoint: '/state',
          chatEndpoint: '/chat',
          cliInputEndpoint: '/cli-input'
        }));
        return;
      }

      // Serve Next.js dashboard at /reflexive
      if (pathname.startsWith('/reflexive')) {
        if (tryServeDashboard(res, pathname)) {
          return;
        }
        // Fall back to embedded HTML if dashboard not available
        if (pathname === '/reflexive' || pathname === '/reflexive/') {
          const state = sandboxManager.getState();
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getDashboardHTML({
            title: 'Reflexive Sandbox',
            status: {
              isRunning: state.isRunning,
              pid: null,
              uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
              restartCount: 0,
              exitCode: null,
              entry: state.entry || '',
              cwd: process.cwd(),
              interactive: false,
              waitingForInput: false,
              injectionReady: state.isRunning,
              debug: false,
              debuggerConnected: false,
              debuggerPaused: false,
              inspectorUrl: null
            },
            showControls: true,
            interactive: false,
            debug: false,
            capabilities: options.capabilities,
            logsEndpoint: '/logs',
            statusEndpoint: '/state',
            chatEndpoint: '/chat',
            cliInputEndpoint: '/cli-input'
          }));
          return;
        }
      }

      if (pathname === '/chat' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { message } = JSON.parse(body);

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message required' }));
          return;
        }

        const state = sandboxManager.getState();
        const recentLogs = sandboxManager.getLogs(10);
        const recentOutput = `\nRecent output: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;
        const uptime = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
        const contextSummary = `Sandbox: ${state.isRunning ? 'running' : 'stopped'}, uptime: ${uptime}s${recentOutput}`;

        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: buildSandboxSystemPrompt(sandboxManager, options),
          mcpServer,
          mcpServerName: 'reflexive-sandbox',
          sessionId: conversationSessionId || undefined,
          queryOptions: {
            cwd: process.cwd(),
            allowedTools: getSandboxAllowedTools(options.capabilities)
          }
        });

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        try {
          for await (const chunk of chatStream) {
            if (chunk.type === 'session' && chunk.sessionId) {
              conversationSessionId = chunk.sessionId;
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: (e as Error).message })}\n\n`);
        }
        res.end();
        return;
      }

      if (pathname === '/reset-conversation' && req.method === 'POST') {
        conversationSessionId = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Conversation reset' }));
        return;
      }

      if (pathname === '/state') {
        const state = sandboxManager.getState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          isRunning: state.isRunning,
          isCreated: state.isCreated,
          entry: state.entry,
          uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
          customState: state.customState,
          capabilities: options.capabilities,
          showControls: true,
          debug: false
        }));
        return;
      }

      if (pathname === '/logs') {
        const count = parseInt(url.searchParams.get('count') || '50', 10);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sandboxManager.getLogs(count)));
        return;
      }

      if (pathname === '/restart' && req.method === 'POST') {
        try {
          await sandboxManager.restart();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/stop' && req.method === 'POST') {
        try {
          await sandboxManager.stop();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
        return;
      }

      if (pathname === '/shutdown' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        await sandboxManager.destroy();
        process.exit(0);
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        options.port++;
        server.listen(options.port, options.host);
      } else {
        reject(err);
      }
    });

    server.on('listening', () => {
      resolve({ server, port: options.port });
    });

    server.listen(options.port, options.host);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle --demo flag
  if (options.demo) {
    const demoName = options.demo.toLowerCase();
    const demo = DEMOS[demoName];

    if (!demo) {
      console.error(`Unknown demo: ${options.demo}`);
      console.log('\nAvailable demos:');
      console.log('  basic, server  - Basic HTTP server with watch trigger demos');
      console.log('  queue, task    - Task queue with background worker');
      console.log('  inject         - Injection mode demo (runs with --inject)');
      console.log('  eval           - Eval mode demo (runs with --eval)');
      process.exit(1);
    }

    // Resolve the demo file path from the package installation
    const demosDir = join(__dirname, '..', 'demos');
    const demoPath = join(demosDir, demo.file);

    if (!existsSync(demoPath)) {
      console.error(`Demo file not found: ${demoPath}`);
      console.log('Demos may not be installed. Try reinstalling reflexive.');
      process.exit(1);
    }

    options.entry = demoPath;

    // Apply demo-specific flags
    if (demo.flags) {
      for (const flag of demo.flags) {
        if (flag === '--inject') {
          options.inject = true;
        } else if (flag === '--eval') {
          options.inject = true;
          options.eval = true;
          options.capabilities.eval = true;
        }
      }
    }

    console.log(`Running demo: ${demoName} (${demo.file})\n`);
  }

  // MCP mode - can run without entry file (use run_app tool to start apps)
  if (options.mcp) {
    // In MCP mode, if entry is specified, verify it exists
    if (options.entry && !existsSync(options.entry)) {
      console.log(`Creating new file: ${options.entry}\n`);
      writeFileSync(options.entry, '// Created by Reflexive\n\nconsole.log("Hello from Reflexive!");\n');
    }
    await runMcpMode(options);
    return;
  }

  if (!options.entry) {
    // Try to resolve from package.json
    const resolved = await resolveEntryFromPackageJson(options);
    if (resolved) {
      options.entry = resolved;
      options.open = true; // Auto-open dashboard when no explicit entry
    } else {
      // No package.json or scripts found - prompt for filename
      console.log('No entry file specified and no package.json scripts found.\n');
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });
      const filename = await new Promise<string>(resolve => {
        rl.question('Enter filename to run: ', resolve);
      });
      rl.close();
      if (filename.trim()) {
        options.entry = filename.trim();
        options.open = true;
      } else {
        console.error('No filename entered.\n');
        printHelp();
        process.exit(1);
      }
    }
  }

  if (!existsSync(options.entry)) {
    // Create the file if it doesn't exist
    console.log(`Creating new file: ${options.entry}\n`);
    writeFileSync(options.entry, '// Created by Reflexive\n\nconsole.log("Hello from Reflexive!");\n');
  }

  // Sandbox mode - run in Vercel Sandbox
  if (options.sandbox) {
    await runSandboxMode(options);
    return;
  }

  // Local mode - spawn child process
  const processManager = new ProcessManager({
    entry: options.entry,
    nodeArgs: options.nodeArgs,
    appArgs: options.appArgs,
    interactive: options.interactive,
    inject: options.inject,
    eval: options.eval,
    debug: options.debug,
    capabilities: {
      restart: options.capabilities.restart
    }
  });

  const { port } = await startCliDashboard(processManager, options);
  const url = `http://${options.host}:${port}`;

  // Detect runtime for debug info
  const runtime = getRuntimeForFile(options.entry);
  const debuggerName = runtime?.displayName
    ? `${runtime.displayName} (${runtime.protocol === 'dap' ? 'DAP' : 'V8 Inspector'})`
    : 'V8 Inspector';

  console.log(`
Reflexive CLI

  Dashboard: ${url}
  Entry:     ${resolve(options.entry)}
  Interactive: ${options.interactive ? 'enabled (stdin proxied)' : 'disabled'}
  Debug:     ${options.debug ? `enabled (${debuggerName})` : 'disabled'}

  Capabilities:
    Read files:    yes
    Write files:   ${options.capabilities.writeFiles ? 'yes' : 'no'}
    Shell access:  ${options.capabilities.shellAccess ? 'yes' : 'no'}
    Restart:       ${options.capabilities.restart ? 'yes' : 'no'}
`);

  if (options.open) {
    const { platform } = process;
    const cmd = platform === 'darwin' ? 'open' :
                platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' });
  }

  // Pass CLI port for parent-child coordination
  processManager.start(port);

  // Ignore SIGHUP so process survives terminal closing
  process.on('SIGHUP', () => {});

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await processManager.stop();
    processManager.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await processManager.stop();
    processManager.destroy();
    process.exit(0);
  });
}

/**
 * Create file operation tools for MCP server mode
 */
function createFileTools(capabilities: Capabilities): AnyToolDefinition[] {
  const tools: AnyToolDefinition[] = [];

  // Read file tool (always available)
  if (capabilities.readFiles) {
    tools.push({
      name: 'read_file',
      description: 'Read the contents of a file',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to read (relative to cwd or absolute)')
      }),
      handler: async ({ path: filePath }: { path: string }) => {
        try {
          const absPath = resolve(process.cwd(), filePath);
          const content = readFileSync(absPath, 'utf-8');
          return { content: [{ type: 'text', text: content }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error reading file: ${(err as Error).message}` }], isError: true };
        }
      }
    });

    tools.push({
      name: 'list_directory',
      description: 'List contents of a directory',
      inputSchema: z.object({
        path: z.string().optional().describe('Path to directory (default: current working directory)')
      }),
      handler: async ({ path: dirPath }: { path?: string }) => {
        try {
          const absPath = resolve(process.cwd(), dirPath || '.');
          const entries = readdirSync(absPath);
          const result = entries.map(name => {
            const entryPath = join(absPath, name);
            try {
              const stat = statSync(entryPath);
              return { name, type: stat.isDirectory() ? 'directory' : 'file', size: stat.size };
            } catch {
              return { name, type: 'unknown', size: 0 };
            }
          });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error listing directory: ${(err as Error).message}` }], isError: true };
        }
      }
    });
  }

  // Write file tool (only if writeFiles capability)
  if (capabilities.writeFiles) {
    tools.push({
      name: 'write_file',
      description: 'Write content to a file (creates or overwrites)',
      inputSchema: z.object({
        path: z.string().describe('Path to the file'),
        content: z.string().describe('Content to write')
      }),
      handler: async ({ path: filePath, content }: { path: string; content: string }) => {
        try {
          const absPath = resolve(process.cwd(), filePath);
          writeFileSync(absPath, content, 'utf-8');
          return { content: [{ type: 'text', text: `File written: ${absPath}` }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error writing file: ${(err as Error).message}` }], isError: true };
        }
      }
    });

    tools.push({
      name: 'edit_file',
      description: 'Edit a file by replacing a specific string',
      inputSchema: z.object({
        path: z.string().describe('Path to the file'),
        old_string: z.string().describe('The exact string to replace'),
        new_string: z.string().describe('The replacement string')
      }),
      handler: async ({ path: filePath, old_string, new_string }: { path: string; old_string: string; new_string: string }) => {
        try {
          const absPath = resolve(process.cwd(), filePath);
          const content = readFileSync(absPath, 'utf-8');
          if (!content.includes(old_string)) {
            return { content: [{ type: 'text', text: `Error: old_string not found in file` }], isError: true };
          }
          const newContent = content.replace(old_string, new_string);
          writeFileSync(absPath, newContent, 'utf-8');
          return { content: [{ type: 'text', text: `File edited: ${absPath}` }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `Error editing file: ${(err as Error).message}` }], isError: true };
        }
      }
    });
  }

  return tools;
}

/**
 * Create shell tool for MCP server mode
 * Note: Uses execSync intentionally - this is a shell execution tool gated behind --shell flag
 */
function createShellTool(capabilities: Capabilities): AnyToolDefinition[] {
  if (!capabilities.shellAccess) return [];

  return [{
    name: 'exec_shell',
    description: 'Execute a shell command and return the output. Only available when --shell flag is enabled.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      cwd: z.string().optional().describe('Working directory for the command'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)')
    }),
    handler: async ({ command, cwd, timeout }: { command: string; cwd?: string; timeout?: number }) => {
      // Using execSync intentionally - this is a shell tool that needs full shell features
      const { execSync } = await import('child_process');
      try {
        const output = execSync(command, {
          cwd: cwd || process.cwd(),
          timeout: timeout || 30000,
          encoding: 'utf-8' as BufferEncoding,
          maxBuffer: 10 * 1024 * 1024
        });
        return { content: [{ type: 'text', text: String(output) }] };
      } catch (err) {
        const error = err as { stdout?: string; stderr?: string; message: string };
        const output = error.stdout || error.stderr || error.message;
        return { content: [{ type: 'text', text: `Command failed: ${output}` }], isError: true };
      }
    }
  }];
}

/**
 * Create chat tool for MCP server mode - allows external agents to chat with the embedded Claude agent
 */
function createChatTool(
  processManager: ProcessManager,
  options: CliOptions,
  mcpServer: unknown
): AnyToolDefinition {
  return {
    name: 'chat',
    description: 'Chat with the embedded Reflexive AI agent. The agent has full context of the running application, logs, and can use all enabled tools (file read/write, shell, debug, eval). The agent also has reflexive_self_knowledge for documentation.',
    inputSchema: z.object({
      message: z.string().describe('Message to send to the Reflexive agent')
    }),
    handler: async ({ message }: { message: string }) => {
      try {
        const state = processManager.getState();
        const recentLogs = processManager.getLogs(10);
        const recentOutput = `\nRecent output: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;
        const contextSummary = `Process: ${state.isRunning ? 'running' : 'stopped'}, PID: ${state.pid}, uptime: ${state.uptime}s${recentOutput}`;

        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: buildSystemPrompt(processManager, options),
          mcpServer,
          mcpServerName: 'reflexive-cli',
          queryOptions: {
            cwd: state.cwd,
            allowedTools: getAllowedTools(options.capabilities)
          }
        });

        let fullResponse = '';
        for await (const chunk of chatStream) {
          if (chunk.type === 'text') {
            fullResponse += chunk.content;
          }
        }

        return { content: [{ type: 'text', text: fullResponse }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Chat error: ${(err as Error).message}` }], isError: true };
      }
    }
  };
}

/**
 * Create run_app tool for MCP server mode - allows dynamically switching apps
 */
function createRunAppTool(processManager: ProcessManager): AnyToolDefinition {
  return {
    name: 'run_app',
    description: 'Start or switch to a different Node.js application. Stops any currently running app and starts the new one. The app path can be relative to the current working directory or absolute.',
    inputSchema: z.object({
      path: z.string().describe('Path to the Node.js file to run'),
      args: z.array(z.string()).optional().describe('Optional arguments to pass to the app')
    }),
    handler: async ({ path: appPath, args }: { path: string; args?: string[] }) => {
      try {
        const absPath = resolve(process.cwd(), appPath);
        if (!existsSync(absPath)) {
          return { content: [{ type: 'text', text: `Error: File not found: ${absPath}` }], isError: true };
        }
        await processManager.runApp(absPath, args);
        return { content: [{ type: 'text', text: `Started: ${absPath}${args?.length ? ` with args: ${args.join(' ')}` : ''}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error starting app: ${(err as Error).message}` }], isError: true };
      }
    }
  };
}

/**
 * Run as stdio MCP server for external AI agents
 */
async function runMcpMode(options: CliOptions): Promise<void> {
  // Entry file is now optional in MCP mode - can be started dynamically with run_app tool

  // Create process manager (same as CLI mode, but entry may be null)
  const processManager = new ProcessManager({
    entry: options.entry || undefined,
    nodeArgs: options.nodeArgs,
    appArgs: options.appArgs,
    interactive: options.interactive,
    inject: options.inject,
    eval: options.eval,
    debug: options.debug,
    capabilities: {
      restart: options.capabilities.restart
    }
  });

  // Create MCP tools (CLI tools + file tools + shell tools + knowledge tools)
  const cliTools = createCliTools({
    processManager,
    capabilities: options.capabilities,
    inject: options.inject,
    eval: options.eval,
    debug: options.debug
  });
  const knowledgeTools = createKnowledgeTools();
  const fileTools = createFileTools(options.capabilities);
  const shellTools = createShellTool(options.capabilities);

  // Create SDK MCP server for the embedded agent (used by chat tool)
  // Extract raw Zod shapes for the SDK (it expects raw shapes, not ZodObject wrappers)
  const embeddedTools = [...cliTools, ...knowledgeTools].map(tool => ({
    ...tool,
    inputSchema: tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {}
  }));
  const embeddedMcpServer = createSdkMcpServer({
    name: 'reflexive-embedded',
    tools: embeddedTools
  });

  // Chat tool allows external agents to talk to the embedded Reflexive agent
  const chatTool = createChatTool(processManager, options, embeddedMcpServer);

  // Run app tool allows dynamically switching apps
  const runAppTool = createRunAppTool(processManager);

  // All tools exposed to external MCP clients
  const allTools = [...cliTools, ...knowledgeTools, ...fileTools, ...shellTools, chatTool, runAppTool];

  // Optionally start webUI
  let dashboardPort: number | null = null;
  if (options.mcpWebUI) {
    const { port } = await startCliDashboard(processManager, options);
    dashboardPort = port;
    process.stderr.write(`Reflexive MCP Server\n`);
    process.stderr.write(`  Dashboard: http://${options.host}:${port}\n`);
    if (options.entry) {
      process.stderr.write(`  Entry: ${resolve(options.entry)}\n`);
    } else {
      process.stderr.write(`  Entry: (none - use run_app tool to start an app)\n`);
    }
    process.stderr.write(`  Tools: ${allTools.map(t => t.name).join(', ')}\n\n`);
  } else {
    process.stderr.write(`Reflexive MCP Server (no webUI)\n`);
    if (options.entry) {
      process.stderr.write(`  Entry: ${resolve(options.entry)}\n`);
    } else {
      process.stderr.write(`  Entry: (none - use run_app tool to start an app)\n`);
    }
    process.stderr.write(`  Tools: ${allTools.map(t => t.name).join(', ')}\n\n`);
  }

  // Start the process (only if entry is specified)
  if (options.entry) {
    processManager.start(dashboardPort || 0);
  }

  // MCP Protocol handler over stdio
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  // Handle JSON-RPC messages
  readline.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      let response: unknown;

      switch (request.method) {
        case 'initialize':
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: 'reflexive',
                version: '1.0.0'
              }
            }
          };
          break;

        case 'notifications/initialized':
          // No response needed for notifications
          return;

        case 'tools/list':
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              tools: allTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema._def ? {
                  type: 'object',
                  properties: Object.fromEntries(
                    Object.entries((tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape || {}).map(([key, schema]) => [
                      key,
                      {
                        type: 'string', // simplified - could be more accurate
                        description: (schema as z.ZodTypeAny).description || ''
                      }
                    ])
                  )
                } : { type: 'object', properties: {} }
              }))
            }
          };
          break;

        case 'tools/call': {
          const toolName = request.params?.name;
          const toolArgs = request.params?.arguments || {};
          const tool = allTools.find(t => t.name === toolName);

          // Debug logging for MCP tool calls
          console.error(`[MCP] Tool call: ${toolName}`);
          console.error(`[MCP] Raw args: ${JSON.stringify(toolArgs)}`);

          if (!tool) {
            response = {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: `Unknown tool: ${toolName}` }
            };
          } else {
            try {
              // Parse and validate input using the tool's Zod schema
              const parsedArgs = tool.inputSchema.parse(toolArgs);
              const result = await tool.handler(parsedArgs);
              response = {
                jsonrpc: '2.0',
                id: request.id,
                result
              };
            } catch (err) {
              response = {
                jsonrpc: '2.0',
                id: request.id,
                result: {
                  content: [{ type: 'text', text: `Tool error: ${(err as Error).message}` }],
                  isError: true
                }
              };
            }
          }
          break;
        }

        default:
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` }
          };
      }

      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${(err as Error).message}` }
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    await processManager.stop();
    processManager.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await processManager.stop();
    processManager.destroy();
    process.exit(0);
  });

  readline.on('close', async () => {
    await processManager.stop();
    processManager.destroy();
    process.exit(0);
  });
}

async function runSandboxMode(options: CliOptions): Promise<void> {
  if (!options.entry) {
    console.error('Entry file required for sandbox mode');
    process.exit(1);
  }

  console.log('Starting Vercel Sandbox...\n');

  const sandboxManager = new SandboxManager({
    vcpus: 2,
    memory: 2048,
    timeout: '30m'
  });

  try {
    // Create sandbox
    await sandboxManager.create();

    // Read and upload the entry file
    const entryContent = readFileSync(options.entry, 'utf-8');
    await sandboxManager.uploadFiles([
      { path: '/app/app.js', content: entryContent }
    ]);

    // Start the app in the sandbox
    await sandboxManager.start('/app/app.js', options.appArgs);

    // Start dashboard
    const { port } = await startSandboxDashboard(sandboxManager, options);
    const url = `http://${options.host}:${port}`;

    console.log(`
Reflexive Sandbox

  Dashboard: ${url}
  Entry:     ${resolve(options.entry)}
  Mode:      Vercel Sandbox (isolated)

  Capabilities:
    Read files:    ${options.capabilities.readFiles ? 'yes' : 'no'}
    Write files:   ${options.capabilities.writeFiles ? 'yes' : 'no'}
    Shell access:  ${options.capabilities.shellAccess ? 'yes' : 'no'}
    Restart:       ${options.capabilities.restart ? 'yes' : 'no'}
`);

    if (options.open) {
      const { platform } = process;
      const cmd = platform === 'darwin' ? 'open' :
                  platform === 'win32' ? 'start' : 'xdg-open';
      spawn(cmd, [url], { shell: true, detached: true, stdio: 'ignore' });
    }

    // Ignore SIGHUP so process survives terminal closing
    process.on('SIGHUP', () => {});

    process.on('SIGINT', async () => {
      console.log('\nShutting down sandbox...');
      await sandboxManager.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await sandboxManager.destroy();
      process.exit(0);
    });

  } catch (err) {
    console.error('Failed to start sandbox:', (err as Error).message);
    await sandboxManager.destroy().catch(() => {});
    process.exit(1);
  }
}

// Run CLI if executed directly
const scriptPath = fileURLToPath(import.meta.url);
const argPath = process.argv[1];

// Handle symlinks by resolving real paths
let isMainModule = false;
try {
  isMainModule = realpathSync(scriptPath) === realpathSync(argPath);
} catch {
  // If realpathSync fails (file doesn't exist yet during build), compare directly
  isMainModule = scriptPath === argPath || scriptPath.replace('.ts', '.js') === argPath;
}

if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

// Export for testing
export {
  parseArgs,
  buildSystemPrompt,
  getAllowedTools,
  type CliOptions
};
