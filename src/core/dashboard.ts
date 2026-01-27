/**
 * Dashboard HTML Generator
 *
 * Generates the self-contained SPA dashboard HTML for Reflexive.
 * This includes the chat interface, log viewer, and control panels.
 */

import type { ProcessState, Capabilities } from '../types/index.js';

export interface DashboardOptions {
  title?: string;
  status?: Partial<ProcessState> & { entry?: string };
  showControls?: boolean;
  interactive?: boolean;
  inject?: boolean;
  debug?: boolean;
  capabilities?: Partial<Capabilities>;
  logsEndpoint?: string;
  statusEndpoint?: string;
  chatEndpoint?: string;
  cliInputEndpoint?: string;
}

/**
 * Generate CSS styles for the dashboard
 */
function getStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
    }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #1a1a22; border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #444; }
    * { scrollbar-width: thin; scrollbar-color: #333 #1a1a22; }
    .container { max-width: 1400px; margin: 0 auto; padding: 8px 12px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      border-bottom: 1px solid #222;
      margin-bottom: 10px;
    }
    h1 { font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 0; }
    .logo-text {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: 2px;
      background: linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-shadow: 0 0 30px rgba(74, 222, 128, 0.3);
    }
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
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.running { background: #22c55e; }
    .dot.stopped { background: #ef4444; }
    .grid { display: flex; gap: 0; height: calc(100vh - 100px); }
    .panel {
      background: #111118;
      border: 1px solid #222;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }
    .panel:first-child { flex: 1; }
    .panel:last-child { width: 380px; flex-shrink: 0; }
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
    .log-type { width: 85px; flex-shrink: 0; color: #666; font-size: 0.65rem; }
    .log-entry.stdout .log-type, .log-entry.info .log-type { color: #22c55e; }
    .log-entry.stderr .log-type, .log-entry.error .log-type { color: #ef4444; }
    .log-entry.system .log-type { color: #3b82f6; }
    .log-message { color: #999; white-space: pre-wrap; word-break: break-all; }
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
  `;
}

/**
 * Generate JavaScript for the dashboard
 * Note: Uses DOMPurify for XSS protection when rendering markdown
 */
function getScript(options: DashboardOptions): string {
  const {
    logsEndpoint = '/reflexive/logs',
    statusEndpoint = '/reflexive/status',
    chatEndpoint = '/reflexive/chat',
    showControls = false
  } = options;

  return `
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const logsEl = document.getElementById('logs');
    let isLoading = false;
    let allLogs = [];

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function addUserMessage(text) {
      const div = document.createElement('div');
      div.className = 'message user';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function createStreamingMessage() {
      const div = document.createElement('div');
      div.className = 'message assistant';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      return bubble;
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
                  // Use DOMPurify to sanitize the rendered markdown
                  bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
                  messagesEl.scrollTop = messagesEl.scrollHeight;
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
      allLogs = logs;
      logsEl.innerHTML = DOMPurify.sanitize(logs.map(l => {
        return '<div class="log-entry ' + escapeHtml(l.type) + '">' +
          '<span class="log-type">' + escapeHtml(l.type) + '</span>' +
          '<span class="log-message">' + escapeHtml(l.message) + '</span>' +
        '</div>';
      }).join(''));
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
        ${showControls ? `
        document.getElementById('m-restarts').textContent = state.restartCount || 0;
        document.getElementById('status-text').textContent = state.isRunning ? 'Running' : 'Stopped';
        document.querySelector('.dot').className = 'dot ' + (state.isRunning ? 'running' : 'stopped');
        ` : ''}
        renderLogs(logs);
      } catch (e) {}
    }

    refresh();
    setInterval(refresh, 2000);
    inputEl.focus();
  `;
}

/**
 * Generate the complete dashboard HTML
 */
export function getDashboardHTML(options: DashboardOptions = {}): string {
  const {
    title = 'Reflexive',
    status = {},
    showControls = false
  } = options;

  const controlsHTML = showControls ? `
    <div class="controls">
      <button class="btn success" id="start-btn" ${status.isRunning ? 'disabled' : ''}>Start</button>
      <button class="btn" id="restart-btn">Restart</button>
      <button class="btn danger" id="stop-btn" ${!status.isRunning ? 'disabled' : ''}>Stop</button>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${getStyles()}</style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1><span class="logo-text">REFLEXIVE</span></h1>
        ${status.entry ? `<div class="entry">${escapeHtml(status.entry)}</div>` : ''}
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
        <div class="panel-header">
          <span>${showControls ? 'Process Output' : 'Application Logs'}</span>
        </div>
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
  <script>${getScript(options)}</script>
</body>
</html>`;
}

/**
 * Helper to escape HTML entities
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Generate a minimal error page
 */
export function getErrorHTML(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - ${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .error-box {
      background: #1a1a24;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      text-align: center;
    }
    h1 { color: #ef4444; margin-bottom: 12px; }
    p { color: #888; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}
