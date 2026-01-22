#!/usr/bin/env node

/**
 * Reflexive - AI-powered introspection for Node.js applications
 *
 * Can be used as:
 * 1. CLI: npx reflexive ./app.js - Monitor external processes
 * 2. Library: makeReflexive({ ... }) - Instrument your own app
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync, watch } from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Shared: AppState - tracks logs and custom state
// ============================================================================

class AppState {
  constructor() {
    this.logs = [];
    this.maxLogs = 500;
    this.startTime = Date.now();
    this.customState = {};
    this.eventHandlers = new Map();
  }

  log(type, message) {
    const entry = {
      type,
      message: String(message),
      timestamp: new Date().toISOString()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  getLogs(count = 50, filter = null) {
    let filtered = this.logs;
    if (filter) {
      filtered = this.logs.filter(l => l.type === filter);
    }
    return filtered.slice(-count);
  }

  searchLogs(query) {
    const lower = query.toLowerCase();
    return this.logs.filter(l => l.message.toLowerCase().includes(lower));
  }

  setState(key, value) {
    this.customState[key] = value;
    this.emit('stateChange', { key, value });
  }

  getState(key) {
    return key ? this.customState[key] : this.customState;
  }

  getStatus() {
    return {
      pid: process.pid,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memoryUsage: process.memoryUsage(),
      customState: this.customState
    };
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(h => h(data));
  }
}

// ============================================================================
// Shared: Dashboard HTML generator
// ============================================================================

function getDashboardHTML(options = {}) {
  const {
    title = 'Reflexive',
    status = {},
    showControls = false,
    logsEndpoint = '/reflexive/logs',
    statusEndpoint = '/reflexive/status',
    chatEndpoint = '/reflexive/chat'
  } = options;

  const controlsHTML = showControls ? `
      <div class="controls">
        <button class="btn success" id="start-btn" ${status.isRunning ? 'disabled' : ''}>Start</button>
        <button class="btn" id="restart-btn">Restart</button>
        <button class="btn danger" id="stop-btn" ${!status.isRunning ? 'disabled' : ''}>Stop</button>
      </div>` : '';

  const controlsScript = showControls ? `
    document.getElementById('start-btn').onclick = async () => {
      await fetch('/start', { method: 'POST' });
      refresh();
    };
    document.getElementById('restart-btn').onclick = async () => {
      await fetch('/restart', { method: 'POST' });
      refresh();
    };
    document.getElementById('stop-btn').onclick = async () => {
      await fetch('/stop', { method: 'POST' });
      refresh();
    };` : '';

  const statusUpdateScript = showControls ? `
        document.getElementById('status-text').textContent = state.isRunning ? 'Running' : 'Stopped';
        document.querySelector('.dot').className = 'dot ' + (state.isRunning ? 'running' : 'stopped');
        document.getElementById('start-btn').disabled = state.isRunning;
        document.getElementById('stop-btn').disabled = !state.isRunning;` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 16px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #222;
      margin-bottom: 16px;
    }
    h1 { font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 8px; }
    .entry { font-size: 0.8rem; color: #666; font-family: monospace; }
    .controls { display: flex; gap: 8px; }
    .btn {
      padding: 6px 12px;
      background: #222;
      border: 1px solid #333;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .btn:hover { background: #333; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.danger { border-color: #ef4444; }
    .btn.danger:hover { background: #7f1d1d; }
    .btn.success { border-color: #22c55e; }
    .btn.success:hover { background: #14532d; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: #14532d;
      border-radius: 12px;
      font-size: 0.75rem;
    }
    .status-badge .dot, .status .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .dot.running { background: #22c55e; }
    .dot.stopped { background: #ef4444; }

    .grid { display: grid; grid-template-columns: 1fr 350px; gap: 16px; height: calc(100vh - 100px); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }

    .panel {
      background: #111118;
      border: 1px solid #222;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-header {
      padding: 10px 14px;
      background: #16161d;
      border-bottom: 1px solid #222;
      font-weight: 500;
      font-size: 0.8rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .message { margin-bottom: 12px; }
    .message.user .bubble { background: #1e3a5f; margin-left: 30px; }
    .message.assistant .bubble { background: #1a1a24; margin-right: 30px; }
    .bubble {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .bubble p { margin: 0 0 0.5em 0; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble pre {
      background: #0a0a0f;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 0.5em 0;
    }
    .bubble code {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.8rem;
    }
    .bubble :not(pre) > code {
      background: #0a0a0f;
      padding: 2px 5px;
      border-radius: 3px;
    }
    .bubble ul, .bubble ol { margin: 0.5em 0; padding-left: 1.5em; }
    .bubble li { margin: 0.25em 0; }
    .bubble h1, .bubble h2, .bubble h3 { margin: 0.5em 0; color: #fff; }
    .bubble h1 { font-size: 1.1rem; }
    .bubble h2 { font-size: 1rem; }
    .bubble h3 { font-size: 0.9rem; }
    .message-meta { font-size: 0.65rem; color: #555; margin-bottom: 3px; }

    .chat-input-area { padding: 12px; border-top: 1px solid #222; }
    .chat-input-wrapper { display: flex; gap: 8px; }
    .chat-input {
      flex: 1;
      padding: 10px 12px;
      background: #16161d;
      border: 1px solid #333;
      border-radius: 6px;
      color: #fff;
      font-size: 0.85rem;
      font-family: inherit;
    }
    .chat-input:focus { outline: none; border-color: #3b82f6; }
    .chat-send {
      padding: 10px 20px;
      background: #3b82f6;
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font-weight: 500;
    }
    .chat-send:disabled { opacity: 0.5; }

    .logs {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.7rem;
    }
    .log-entry {
      padding: 3px 6px;
      border-bottom: 1px solid #1a1a22;
      display: flex;
      gap: 8px;
    }
    .log-type { width: 50px; flex-shrink: 0; color: #666; }
    .log-entry.stdout .log-type, .log-entry.info .log-type { color: #22c55e; }
    .log-entry.stderr .log-type, .log-entry.error .log-type { color: #ef4444; }
    .log-entry.system .log-type, .log-entry.debug .log-type { color: #3b82f6; }
    .log-entry.warn .log-type { color: #eab308; }
    .log-message { color: #999; white-space: pre-wrap; word-break: break-all; }

    .thinking { display: flex; gap: 4px; padding: 8px; }
    .thinking span {
      width: 6px; height: 6px; background: #3b82f6; border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out;
    }
    .thinking span:nth-child(1) { animation-delay: -0.32s; }
    .thinking span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    .metrics {
      display: flex;
      gap: 16px;
      padding: 12px;
      background: #0d0d12;
      border-top: 1px solid #222;
      font-size: 0.75rem;
    }
    .metric { display: flex; gap: 4px; }
    .metric-label { color: #666; }
    .metric-value { color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>${title}</h1>
        ${status.entry ? `<div class="entry">${status.entry}</div>` : ''}
      </div>
      ${controlsHTML}
      ${!showControls ? '<div class="status-badge"><span class="dot running"></span><span>Running</span></div>' : ''}
    </header>

    <div class="grid">
      <div class="panel">
        <div class="panel-header">
          <span>Chat with your app</span>
          ${showControls ? `<div class="status"><span class="dot ${status.isRunning ? 'running' : 'stopped'}"></span><span id="status-text">${status.isRunning ? 'Running' : 'Stopped'}</span></div>` : ''}
        </div>
        <div class="chat-messages" id="messages"></div>
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <input class="chat-input" id="input" placeholder="Ask about your app..." />
            <button class="chat-send" id="send">Send</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">${showControls ? 'Process Output' : 'Application Logs'}</div>
        <div class="logs" id="logs"></div>
        <div class="metrics">
          <div class="metric">
            <span class="metric-label">PID:</span>
            <span class="metric-value" id="m-pid">${status.pid || '--'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Uptime:</span>
            <span class="metric-value" id="m-uptime">${status.uptime || 0}s</span>
          </div>
          ${showControls ? `<div class="metric"><span class="metric-label">Restarts:</span><span class="metric-value" id="m-restarts">${status.restartCount || 0}</span></div>` : ''}
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const logsEl = document.getElementById('logs');
    let isLoading = false;

    marked.setOptions({ breaks: true, gfm: true });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderMarkdown(text) {
      const rawHtml = marked.parse(text);
      return DOMPurify.sanitize(rawHtml);
    }

    function addUserMessage(text) {
      const div = document.createElement('div');
      div.className = 'message user';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = 'user';
      div.appendChild(meta);
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function createStreamingMessage() {
      const div = document.createElement('div');
      div.className = 'message assistant';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = 'assistant';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      div.appendChild(meta);
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      return bubble;
    }

    function updateBubbleContent(bubble, markdown) {
      const sanitized = renderMarkdown(markdown);
      bubble.innerHTML = sanitized;
    }

    function showThinking() {
      const div = document.createElement('div');
      div.id = 'thinking';
      const thinking = document.createElement('div');
      thinking.className = 'thinking';
      for (let i = 0; i < 3; i++) {
        thinking.appendChild(document.createElement('span'));
      }
      div.appendChild(thinking);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideThinking() {
      document.getElementById('thinking')?.remove();
    }

    async function sendMessage() {
      const message = inputEl.value.trim();
      if (!message || isLoading) return;

      inputEl.value = '';
      isLoading = true;
      sendBtn.disabled = true;
      addUserMessage(message);
      showThinking();

      try {
        const res = await fetch('${chatEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });

        hideThinking();
        const bubble = createStreamingMessage();
        let fullText = '';

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'text') {
                  fullText += data.content;
                  updateBubbleContent(bubble, fullText);
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.type === 'tool') {
                  // Format tool name (strip mcp__ prefix)
                  const toolName = data.name.replace(/^mcp__[^_]+__/, '');
                  const inputs = Object.entries(data.input || {})
                    .map(([k, v]) => k + ': ' + JSON.stringify(v))
                    .join(', ');
                  const toolStr = inputs ? '[' + toolName + ': ' + inputs + ']' : '[' + toolName + ']';
                  fullText += '\\n\\n' + toolStr + '\\n\\n';
                  updateBubbleContent(bubble, fullText);
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.type === 'error') {
                  updateBubbleContent(bubble, '**Error:** ' + data.message);
                }
              } catch (e) {}
            }
          }
        }

        if (!fullText) {
          bubble.textContent = 'No response';
        }
      } catch (e) {
        hideThinking();
        const bubble = createStreamingMessage();
        bubble.textContent = 'Error: ' + e.message;
      }

      isLoading = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }

    sendBtn.onclick = sendMessage;
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') sendMessage();
    };

    ${controlsScript}

    function renderLogs(logs) {
      logsEl.innerHTML = logs.map(l =>
        '<div class="log-entry ' + l.type + '">' +
        '<span class="log-type">' + l.type + '</span>' +
        '<span class="log-message">' + escapeHtml(l.message) + '</span></div>'
      ).join('');
      logsEl.scrollTop = logsEl.scrollHeight;
    }

    async function refresh() {
      try {
        const [state, logs] = await Promise.all([
          fetch('${statusEndpoint}').then(r => r.json()),
          fetch('${logsEndpoint}?count=100').then(r => r.json())
        ]);

        document.getElementById('m-pid').textContent = state.pid || '--';
        document.getElementById('m-uptime').textContent = (state.uptime || 0) + 's';
        ${showControls ? "document.getElementById('m-restarts').textContent = state.restartCount || 0;" : ''}
        ${statusUpdateScript}
        renderLogs(logs);
      } catch (e) {}
    }

    refresh();
    setInterval(refresh, 2000);
    inputEl.focus();
  </script>
</body>
</html>`;
}

// ============================================================================
// Shared: Streaming chat handler
// ============================================================================

async function* createChatStream(message, options) {
  const {
    contextSummary,
    systemPrompt,
    mcpServer,
    mcpServerName,
    queryOptions = {}
  } = options;

  const enrichedPrompt = `<app_context>
${contextSummary}
</app_context>

${message}`;

  const fullOptions = {
    model: 'sonnet',
    permissionMode: 'bypassPermissions',
    maxTurns: 50,
    mcpServers: { [mcpServerName]: mcpServer },
    systemPrompt,
    includePartialMessages: true,
    ...queryOptions
  };

  for await (const msg of query({ prompt: enrichedPrompt, options: fullOptions })) {
    // Handle streaming text deltas for real-time output
    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield { type: 'text', content: event.delta.text };
      }
    }
    // Handle complete messages for tool use notifications
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          yield { type: 'tool', name: block.name, input: block.input };
        }
      }
    }
  }
  yield { type: 'done' };
}

// ============================================================================
// Shared: SSE response handler
// ============================================================================

async function handleSSEResponse(res, chatStream) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    for await (const chunk of chatStream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  }
  res.end();
}

// ============================================================================
// Library Mode: makeReflexive - instrument your own app
// ============================================================================

function createIntrospectionServer(appState, options = {}) {
  const tools = [
    tool(
      'get_app_status',
      'Get current application status including PID, uptime, and memory usage',
      {},
      async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify(appState.getStatus(), null, 2)
        }]
      })
    ),

    tool(
      'get_logs',
      'Get recent application logs',
      {
        count: z.number().optional().describe('Number of logs to return (default 50)'),
        type: z.string().optional().describe('Filter by log type (info, warn, error, debug)')
      },
      async ({ count = 50, type }) => {
        const logs = appState.getLogs(count, type);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(logs, null, 2)
          }]
        };
      }
    ),

    tool(
      'search_logs',
      'Search through application logs',
      {
        query: z.string().describe('Search query')
      },
      async ({ query }) => {
        const results = appState.searchLogs(query);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }]
        };
      }
    ),

    tool(
      'get_custom_state',
      'Get application custom state',
      {
        key: z.string().optional().describe('Specific state key to retrieve')
      },
      async ({ key }) => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(appState.getState(key), null, 2)
          }]
        };
      }
    )
  ];

  if (options.tools) {
    tools.push(...options.tools);
  }

  return createSdkMcpServer({ name: 'reflexive', tools });
}

export function makeReflexive(options = {}) {
  const {
    port = 3099,
    title = 'Reflexive',
    systemPrompt = '',
    tools = [],
    onReady = () => {}
  } = options;

  const appState = new AppState();
  const mcpServer = createIntrospectionServer(appState, { tools });

  // Intercept console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  console.log = (...args) => {
    appState.log('info', args.map(String).join(' '));
    originalConsole.log(...args);
  };
  console.info = (...args) => {
    appState.log('info', args.map(String).join(' '));
    originalConsole.info(...args);
  };
  console.warn = (...args) => {
    appState.log('warn', args.map(String).join(' '));
    originalConsole.warn(...args);
  };
  console.error = (...args) => {
    appState.log('error', args.map(String).join(' '));
    originalConsole.error(...args);
  };
  console.debug = (...args) => {
    appState.log('debug', args.map(String).join(' '));
    originalConsole.debug(...args);
  };

  const baseSystemPrompt = `You are an AI assistant embedded inside a running Node.js application.
You can introspect the application's state, logs, and custom data using the available tools.
Help the user understand what's happening in their application, debug issues, and answer questions.
${systemPrompt}`;

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/reflexive' || pathname === '/reflexive/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHTML({
        title,
        status: appState.getStatus(),
        showControls: false
      }));
      return;
    }

    if (pathname === '/reflexive/chat' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { message } = JSON.parse(body);

      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'message required' }));
        return;
      }

      const status = appState.getStatus();
      const recentLogs = appState.getLogs(10);
      const contextSummary = `Application PID: ${status.pid}, uptime: ${status.uptime}s
Recent logs: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;

      const chatStream = createChatStream(message, {
        contextSummary,
        systemPrompt: baseSystemPrompt,
        mcpServer,
        mcpServerName: 'reflexive'
      });

      await handleSSEResponse(res, chatStream);
      return;
    }

    if (pathname === '/reflexive/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(appState.getStatus()));
      return;
    }

    if (pathname === '/reflexive/logs') {
      const count = parseInt(url.searchParams.get('count') || '50', 10);
      const type = url.searchParams.get('type');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(appState.getLogs(count, type)));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    originalConsole.log(`Reflexive dashboard: http://localhost:${port}/reflexive`);
    onReady({ port, appState, server });
  });

  return {
    appState,
    server,
    log: (type, message) => appState.log(type, message),
    setState: (key, value) => appState.setState(key, value),
    getState: (key) => appState.getState(key)
  };
}

// ============================================================================
// CLI Mode: Process manager for external processes
// ============================================================================

class ProcessManager {
  constructor(options) {
    this.options = options;
    this.entry = resolve(options.entry);
    this.cwd = dirname(this.entry);
    this.child = null;
    this.isRunning = false;
    this.restartCount = 0;
    this.startTime = null;
    this.logs = [];
    this.maxLogs = 500;
    this.exitCode = null;
    this.watcher = null;
  }

  start() {
    if (this.isRunning) return;

    const args = [...this.options.nodeArgs, this.entry, ...this.options.appArgs];

    this.child = spawn(process.execPath, args, {
      cwd: this.cwd,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['inherit', 'pipe', 'pipe']
    });

    this.isRunning = true;
    this.startTime = Date.now();
    this.exitCode = null;

    this._log('system', `Started: node ${args.join(' ')}`);

    this.child.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      this._log('stdout', text.trim());
    });

    this.child.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      this._log('stderr', text.trim());
    });

    this.child.on('exit', (code, signal) => {
      this.isRunning = false;
      this.exitCode = code;
      this._log('system', `Exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);

      // Only auto-restart on crash (non-zero exit code), not on signal kills (intentional stop/restart)
      if (this.options.watch && code !== null && code !== 0) {
        setTimeout(() => this.restart(), 1000);
      }
    });

    this.child.on('error', (err) => {
      this._log('error', `Process error: ${err.message}`);
    });

    if (this.options.watch && !this.watcher) {
      this._setupWatcher();
    }
  }

  stop() {
    if (!this.isRunning || !this.child) return Promise.resolve();

    return new Promise((resolve) => {
      const killTimeout = setTimeout(() => {
        if (this.isRunning) {
          this.child.kill('SIGKILL');
        }
      }, 5000);

      this.child.once('exit', () => {
        clearTimeout(killTimeout);
        this.isRunning = false;
        resolve();
      });

      this.child.kill('SIGTERM');
    });
  }

  async restart() {
    this._log('system', 'Restarting...');
    await this.stop();
    this.restartCount++;
    this.start();
  }

  _log(type, message) {
    const entry = {
      type,
      message,
      timestamp: new Date().toISOString()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  _setupWatcher() {
    let debounceTimer = null;

    this.watcher = watch(this.cwd, { recursive: true }, (event, filename) => {
      if (!filename) return;
      if (filename.includes('node_modules')) return;
      if (filename.startsWith('.')) return;
      if (filename.includes('/.')) return;
      if (!filename.endsWith('.js') && !filename.endsWith('.mjs') && !filename.endsWith('.json')) return;
      if (filename.includes('.tmp') || filename.includes('.swp') || filename.includes('~')) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this._log('system', `File changed: ${filename}`);
        this.restart();
      }, 500);
    });
  }

  getState() {
    return {
      isRunning: this.isRunning,
      pid: this.child?.pid || null,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      restartCount: this.restartCount,
      exitCode: this.exitCode,
      entry: this.entry,
      cwd: this.cwd
    };
  }

  getLogs(count = 50) {
    return this.logs.slice(-count);
  }

  send(message) {
    if (this.child && this.child.stdin) {
      this.child.stdin.write(message + '\n');
    }
  }
}

function createCliMcpServer(processManager, options) {
  return createSdkMcpServer({
    name: 'reflexive-cli',
    tools: [
      tool(
        'get_process_state',
        'Get the state of the running process: pid, uptime, restart count, exit code',
        {},
        async () => ({
          content: [{
            type: 'text',
            text: JSON.stringify(processManager.getState(), null, 2)
          }]
        })
      ),

      tool(
        'get_output_logs',
        'Get stdout/stderr output from the running process',
        {
          count: z.number().optional().describe('Number of log entries to return (default 50)'),
          type: z.enum(['stdout', 'stderr', 'system', 'error', 'all']).optional()
            .describe('Filter by log type')
        },
        async ({ count, type }) => {
          let logs = processManager.getLogs(count || 50);
          if (type && type !== 'all') {
            logs = logs.filter(l => l.type === type);
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(logs, null, 2)
            }]
          };
        }
      ),

      tool(
        'restart_process',
        'Restart the running process',
        {},
        async () => {
          if (!options.capabilities.restart) {
            return {
              content: [{
                type: 'text',
                text: 'Restart capability not enabled. Run with --capabilities restart'
              }]
            };
          }
          await processManager.restart();
          return {
            content: [{
              type: 'text',
              text: 'Process restarted successfully'
            }]
          };
        }
      ),

      tool(
        'stop_process',
        'Stop the running process',
        {},
        async () => {
          await processManager.stop();
          return {
            content: [{
              type: 'text',
              text: 'Process stopped'
            }]
          };
        }
      ),

      tool(
        'start_process',
        'Start the process if it is stopped',
        {},
        async () => {
          if (processManager.isRunning) {
            return {
              content: [{
                type: 'text',
                text: 'Process is already running'
              }]
            };
          }
          processManager.start();
          return {
            content: [{
              type: 'text',
              text: 'Process started'
            }]
          };
        }
      ),

      tool(
        'send_input',
        'Send input to the process stdin',
        {
          input: z.string().describe('Text to send to stdin')
        },
        async ({ input }) => {
          processManager.send(input);
          return {
            content: [{
              type: 'text',
              text: `Sent to stdin: ${input}`
            }]
          };
        }
      ),

      tool(
        'search_logs',
        'Search through process output logs',
        {
          query: z.string().describe('Search term'),
          type: z.enum(['stdout', 'stderr', 'all']).optional()
        },
        async ({ query, type }) => {
          let logs = processManager.logs;
          if (type && type !== 'all') {
            logs = logs.filter(l => l.type === type);
          }
          const matches = logs.filter(l =>
            l.message.toLowerCase().includes(query.toLowerCase())
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(matches.slice(-20), null, 2)
            }]
          };
        }
      )
    ]
  });
}

function getAllowedTools(capabilities) {
  const tools = ['Read', 'Glob', 'Grep'];

  if (capabilities.writeFiles) {
    tools.push('Write', 'Edit', 'MultiEdit');
  }
  if (capabilities.shellAccess) {
    tools.push('Bash');
  }
  if (capabilities.networkAccess) {
    tools.push('WebSearch', 'WebFetch');
  }

  return tools;
}

function buildSystemPrompt(processManager, options) {
  const state = processManager.getState();

  return `# Reflexive CLI Agent

You are an AI assistant monitoring and controlling a Node.js process from the outside.

## Target Process
- Entry: ${state.entry}
- Working Directory: ${state.cwd}
- Status: ${state.isRunning ? 'Running' : 'Stopped'}
- PID: ${state.pid || 'N/A'}
- Uptime: ${state.uptime}s
- Restarts: ${state.restartCount}

## Your Capabilities
- Read files: YES
- Write files: ${options.capabilities.writeFiles ? 'YES' : 'NO'}
- Shell access: ${options.capabilities.shellAccess ? 'YES' : 'NO'}
- Restart process: ${options.capabilities.restart ? 'YES' : 'NO'}

## CLI-Specific Tools
In addition to file tools, you have:
- \`get_process_state\` - Get process status, PID, uptime
- \`get_output_logs\` - View stdout/stderr from the process
- \`search_logs\` - Search through output logs
- \`restart_process\` - Restart the process
- \`stop_process\` / \`start_process\` - Control process lifecycle
- \`send_input\` - Send text to the process stdin

## Guidelines
1. Use get_output_logs to see what the process is doing
2. Read source files to understand the code
3. If there are errors in the logs, analyze them and suggest fixes
4. You can restart the process after making file changes
5. Be direct and helpful - the developer trusts you
`;
}

// ============================================================================
// CLI: Argument parsing and main
// ============================================================================

function parseArgs(args) {
  const options = {
    entry: null,
    port: 3099,
    host: 'localhost',
    open: false,
    watch: false,
    capabilities: {
      readFiles: true,
      writeFiles: false,
      shellAccess: false,
      restart: true,
      networkAccess: false
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
    } else if (arg === '--capabilities' || arg === '-c') {
      const caps = args[++i].split(',');
      for (const cap of caps) {
        options.capabilities[cap.trim()] = true;
      }
    } else if (arg === '--write') {
      options.capabilities.writeFiles = true;
    } else if (arg === '--shell') {
      options.capabilities.shellAccess = true;
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

function printHelp() {
  console.log(`
Reflexive CLI

Run any Node.js application with an AI agent that can see and control it.

USAGE:
  reflexive [options] <entry-file> [-- app-args...]

OPTIONS:
  -p, --port <port>       Dashboard port (default: 3099)
  -h, --host <host>       Dashboard host (default: localhost)
  -o, --open              Open dashboard in browser
  -w, --watch             Restart on file changes
  -c, --capabilities      Enable capabilities (comma-separated)
      --write             Enable file writing
      --shell             Enable shell access
      --node-args <args>  Arguments to pass to Node.js
      --help              Show this help

CAPABILITIES:
  readFiles      Read project files (default: on)
  writeFiles     Write/edit files
  shellAccess    Run shell commands
  restart        Restart the process (default: on)
  networkAccess  Web search/fetch

EXAMPLES:
  reflexive ./index.js
  reflexive --port 4000 --watch ./server.js
  reflexive --write --shell ./script.js
  reflexive ./server.js -- --port 8080

The agent can:
  - See stdout/stderr from your app
  - View process memory, CPU, uptime
  - Read your source files
  - Query logs (if you use console.log)
  - Restart your app
  - Modify files (if --write enabled)
  - Run commands (if --shell enabled)
`);
}

async function startCliDashboard(processManager, options) {
  const mcpServer = createCliMcpServer(processManager, options);

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/' || pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML({
          title: 'Reflexive CLI',
          status: processManager.getState(),
          showControls: true,
          logsEndpoint: '/logs',
          statusEndpoint: '/state',
          chatEndpoint: '/chat'
        }));
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
        const recentLogs = processManager.getLogs(10);
        const contextSummary = `Process: ${state.isRunning ? 'running' : 'stopped'}, PID: ${state.pid}, uptime: ${state.uptime}s
Recent output: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;

        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: buildSystemPrompt(processManager, options),
          mcpServer,
          mcpServerName: 'reflexive-cli',
          queryOptions: {
            cwd: processManager.cwd,
            allowedTools: getAllowedTools(options.capabilities)
          }
        });

        await handleSSEResponse(res, chatStream);
        return;
      }

      if (pathname === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(processManager.getState()));
        return;
      }

      if (pathname === '/logs') {
        const count = parseInt(url.searchParams.get('count') || '50', 10);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(processManager.getLogs(count)));
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

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
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

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (!options.entry) {
    console.error('Error: No entry file specified\n');
    printHelp();
    process.exit(1);
  }

  if (!existsSync(options.entry)) {
    console.error(`Error: Entry file not found: ${options.entry}\n`);
    process.exit(1);
  }

  const processManager = new ProcessManager(options);
  const { port } = await startCliDashboard(processManager, options);
  const url = `http://${options.host}:${port}`;

  console.log(`
Reflexive CLI

  Dashboard: ${url}
  Entry:     ${resolve(options.entry)}
  Watch:     ${options.watch ? 'enabled' : 'disabled'}

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
    spawn(cmd, [url], { shell: true, detached: true });
  }

  processManager.start();

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await processManager.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await processManager.stop();
    process.exit(0);
  });
}

// ============================================================================
// Exports and CLI entry point
// ============================================================================

export { AppState, createIntrospectionServer };

// Run CLI if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
