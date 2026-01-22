// Reflexive - Programmatic API for self-instrumenting applications
import { createServer } from 'http';
import { spawn } from 'child_process';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// In-process state tracking
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

// Create MCP server with introspection tools
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

  // Add custom tools if provided
  if (options.tools) {
    tools.push(...options.tools);
  }

  return createSdkMcpServer({ name: 'reflexive', tools });
}

// Dashboard HTML generator
function getDashboardHTML(appState, title = 'Reflexive') {
  const status = appState.getStatus();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ ${title}</title>
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
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: #14532d;
      border-radius: 12px;
      font-size: 0.75rem;
    }
    .status-badge .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }

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
    .log-entry.info .log-type { color: #22c55e; }
    .log-entry.warn .log-type { color: #eab308; }
    .log-entry.error .log-type { color: #ef4444; }
    .log-entry.debug .log-type { color: #3b82f6; }
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
      <h1>⚡ ${title}</h1>
      <div class="status-badge">
        <span class="dot"></span>
        <span>Running</span>
      </div>
    </header>

    <div class="grid">
      <div class="panel">
        <div class="panel-header">Chat with your app</div>
        <div class="chat-messages" id="messages"></div>
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <input class="chat-input" id="input" placeholder="Ask about your app..." />
            <button class="chat-send" id="send">Send</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">Application Logs</div>
        <div class="logs" id="logs"></div>
        <div class="metrics">
          <div class="metric">
            <span class="metric-label">PID:</span>
            <span class="metric-value" id="m-pid">${status.pid}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Uptime:</span>
            <span class="metric-value" id="m-uptime">${status.uptime}s</span>
          </div>
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
        const res = await fetch('/reflexive/chat', {
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

    function renderLogs(logs) {
      logsEl.textContent = '';
      logs.forEach(l => {
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + l.type;
        const typeSpan = document.createElement('span');
        typeSpan.className = 'log-type';
        typeSpan.textContent = l.type;
        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-message';
        msgSpan.textContent = l.message;
        entry.appendChild(typeSpan);
        entry.appendChild(msgSpan);
        logsEl.appendChild(entry);
      });
      logsEl.scrollTop = logsEl.scrollHeight;
    }

    async function refresh() {
      try {
        const [status, logs] = await Promise.all([
          fetch('/reflexive/status').then(r => r.json()),
          fetch('/reflexive/logs?count=100').then(r => r.json())
        ]);

        document.getElementById('m-pid').textContent = status.pid;
        document.getElementById('m-uptime').textContent = status.uptime + 's';
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

// Main instrumentation function
export function instrument(options = {}) {
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

  // Chat handler with streaming
  async function* handleChatStream(message) {
    const status = appState.getStatus();
    const recentLogs = appState.getLogs(10);

    const contextSummary = `Application PID: ${status.pid}, uptime: ${status.uptime}s
Recent logs: ${recentLogs.slice(-3).map(l => l.message).join('; ')}`;

    const enrichedPrompt = `<app_context>
${contextSummary}
</app_context>

${message}`;

    const baseSystemPrompt = `You are an AI assistant embedded inside a running Node.js application.
You can introspect the application's state, logs, and custom data using the available tools.
Help the user understand what's happening in their application, debug issues, and answer questions.
${systemPrompt}`;

    const queryOptions = {
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      maxTurns: 50,
      mcpServers: { 'reflexive': mcpServer },
      systemPrompt: baseSystemPrompt,
      includePartialMessages: true
    };

    for await (const msg of query({ prompt: enrichedPrompt, options: queryOptions })) {
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

  // Create dashboard server
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

    // Dashboard routes
    if (pathname === '/reflexive' || pathname === '/reflexive/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHTML(appState, title));
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

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      try {
        for await (const chunk of handleChatStream(message)) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
      }
      res.end();
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

    // Not a reflexive route
    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    originalConsole.log(`⚡ Reflexive dashboard: http://localhost:${port}/reflexive`);
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

export { AppState, createIntrospectionServer };
