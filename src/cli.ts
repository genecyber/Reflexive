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
import { existsSync, readFileSync, writeFileSync, realpathSync, statSync } from 'fs';
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
import type { Capabilities } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  watch: boolean;
  interactive: boolean;
  inject: boolean;
  eval: boolean;
  debug: boolean;
  sandbox: boolean;
  capabilities: Capabilities;
  nodeArgs: string[];
  appArgs: string[];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    entry: null,
    port: 3099,
    host: 'localhost',
    open: false,
    watch: false,
    interactive: false,
    inject: false,
    eval: false,
    debug: false,
    sandbox: false,
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
    } else if (arg === '--watch' || arg === '-w') {
      options.watch = true;
    } else if (arg === '--interactive' || arg === '-i') {
      options.interactive = true;
    } else if (arg === '--inject') {
      options.inject = true;
      options.capabilities.inject = true;
    } else if (arg === '--eval') {
      options.eval = true;
      options.inject = true; // --eval implies --inject
      options.capabilities.eval = true;
      options.capabilities.inject = true;
    } else if (arg === '--debug' || arg === '-d') {
      options.debug = true;
      options.capabilities.debug = true;
    } else if (arg === '--sandbox' || arg === '-s') {
      options.sandbox = true;
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
    } else if (arg === '--dangerously-skip-permissions') {
      options.capabilities.readFiles = true;
      options.capabilities.writeFiles = true;
      options.capabilities.shellAccess = true;
      options.capabilities.restart = true;
      options.capabilities.inject = true;
      options.capabilities.eval = true;
      options.capabilities.debug = true;
      options.inject = true;
      options.eval = true;
      options.debug = true;
    } else if (arg === '--node-args') {
      options.nodeArgs = args[++i].split(' ');
    } else if (arg === '--help') {
      printHelp();
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
  -w, --watch             Restart on file changes
  -i, --interactive       Interactive mode: proxy stdin/stdout through agent
  -s, --sandbox           Run in Vercel Sandbox (isolated environment)
      --inject            Inject deep instrumentation (console, diagnostics, perf)
      --eval              Enable runtime code evaluation (DANGEROUS, implies --inject)
  -d, --debug             Enable V8 Inspector debugging (real breakpoints, stepping, scope inspection)
  -c, --capabilities      Enable capabilities (comma-separated)
      --write             Enable file writing
      --shell             Enable shell access
      --dangerously-skip-permissions  Enable ALL capabilities (write, shell, inject, eval, debug, network)
      --node-args <args>  Arguments to pass to Node.js
      --help              Show this help

CAPABILITIES:
  readFiles      Read project files (default: on)
  writeFiles     Write/edit files
  shellAccess    Run shell commands
  restart        Restart the process (default: on)

EXAMPLES:
  reflexive                                    # Auto-detect from package.json
  reflexive ./index.js                         # Run specific file
  reflexive --sandbox ./app.js                 # Run in isolated Vercel Sandbox
  reflexive --watch --inject ./app.js          # Watch mode with injection
  reflexive --debug --eval ./server.js         # Full debugging capabilities
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
    'You are an AI assistant controlling a Node.js process.',
    `Entry file: ${state.entry}`,
    `Working directory: ${state.cwd}`,
  ];

  if (options.interactive) {
    parts.push('');
    parts.push('INTERACTIVE MODE: This is a CLI application that expects user input.');
    parts.push('When the process shows a prompt or is waiting for input, use send_input to respond.');
    parts.push('Read the recent output carefully to understand what the app is asking for.');
  }

  if (options.inject) {
    parts.push('');
    parts.push('INJECTION MODE: Deep instrumentation is enabled.');
    parts.push('You can access custom state via process.reflexive.setState() and get_injected_state.');
    parts.push('Console logs, errors, and diagnostics are captured.');
  }

  if (options.eval) {
    parts.push('');
    parts.push('EVAL MODE: Runtime code evaluation is enabled.');
    parts.push('You can execute arbitrary JavaScript in the app context with evaluate_in_app.');
    parts.push('Use this power responsibly - you can inspect and modify the running application.');
  }

  if (options.debug) {
    parts.push('');
    parts.push('DEBUG MODE: V8 Inspector debugging is enabled.');
    parts.push('You can set real breakpoints, step through code, and inspect variables.');
    parts.push('Use debug_set_breakpoint to add breakpoints at specific lines.');
    parts.push('When paused, use debug_get_call_stack and debug_get_scope_variables to inspect state.');
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
    'You are an AI assistant controlling a Node.js application running in an isolated Vercel Sandbox.',
    `Entry file: ${state.entry}`,
    'The app runs in a secure, isolated environment.',
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

  if (capabilities.inject) {
    tools.push('get_injected_state', 'get_injection_logs');
  }

  if (capabilities.eval) {
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
  // Create MCP server with CLI tools
  const cliTools = createCliTools({
    processManager,
    capabilities: options.capabilities,
    inject: options.inject,
    eval: options.eval,
    debug: options.debug
  });

  const mcpServer = createSdkMcpServer({
    name: 'reflexive-cli',
    tools: cliTools
  });

  // Store conversation session ID for continuity
  let conversationSessionId: string | null = null;

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
        const { message } = JSON.parse(body);

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message required' }));
          return;
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

        try {
          for await (const chunk of chatStream) {
            // Capture session ID for conversation continuity
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

      // Reset conversation (clear session history)
      if (pathname === '/reset-conversation' && req.method === 'POST') {
        conversationSessionId = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Conversation reset' }));
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

      if (pathname === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...processManager.getState(),
          capabilities: options.capabilities,
          showControls: true
        }));
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

      if (pathname === '/shutdown' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        await processManager.stop();
        process.exit(0);
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
  // Create MCP server with sandbox tools
  const sandboxTools = createSandboxTools({
    sandboxManager,
    capabilities: options.capabilities
  });

  const mcpServer = createSdkMcpServer({
    name: 'reflexive-sandbox',
    tools: sandboxTools
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
            inject: true,
            injectionReady: state.isRunning,
            debug: false,
            debuggerConnected: false,
            debuggerPaused: false,
            inspectorUrl: null
          },
          showControls: true,
          interactive: false,
          inject: true,
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
              inject: true,
              injectionReady: state.isRunning,
              debug: false,
              debuggerConnected: false,
              debuggerPaused: false,
              inspectorUrl: null
            },
            showControls: true,
            interactive: false,
            inject: true,
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
          inject: true,
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
    watch: options.watch,
    capabilities: {
      restart: options.capabilities.restart
    }
  });

  const { port } = await startCliDashboard(processManager, options);
  const url = `http://${options.host}:${port}`;

  console.log(`
Reflexive CLI

  Dashboard: ${url}
  Entry:     ${resolve(options.entry)}
  Watch:     ${options.watch ? 'enabled' : 'disabled'}
  Interactive: ${options.interactive ? 'enabled (stdin proxied)' : 'disabled'}
  Debug:     ${options.debug ? 'enabled (V8 Inspector)' : 'disabled'}

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

  processManager.start();

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
