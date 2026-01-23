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
import { existsSync, watch, realpathSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

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
    title = '⚡ Reflexive',
    status = {},
    showControls = false,
    interactive = false,
    inject = false,
    debug = false,
    capabilities = {},
    logsEndpoint = '/reflexive/logs',
    statusEndpoint = '/reflexive/status',
    chatEndpoint = '/reflexive/chat',
    cliInputEndpoint = '/cli-input'
  } = options;

  const controlsHTML = showControls ? `
      <div class="controls">
        <button class="btn success" id="start-btn" ${status.isRunning ? 'disabled' : ''}>Start</button>
        <button class="btn" id="restart-btn">Restart</button>
        <button class="btn danger" id="stop-btn" ${!status.isRunning ? 'disabled' : ''}>Stop</button>
        <button class="btn power" id="power-btn" title="Shutdown Reflexive">⏻</button>
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
    };
    document.getElementById('power-btn').onclick = async () => {
      if (confirm('Shutdown Reflexive completely?')) {
        // Show goodbye screen (static content, no user input)
        document.body.innerHTML = \`
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0f;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:20px;">
            <div style="font-size:4rem;margin-bottom:20px;">&#x1F44B;</div>
            <h1 style="font-size:2rem;margin-bottom:10px;color:#fff;">Thank you for using Reflexive</h1>
            <p style="color:#888;margin-bottom:30px;">We hope you enjoyed building apps by talking to them.</p>
            <div style="display:flex;gap:20px;flex-wrap:wrap;justify-content:center;">
              <a href="https://github.com/genecyber/Reflexive" target="_blank" style="display:flex;align-items:center;gap:8px;padding:12px 24px;background:#222;border:1px solid #333;border-radius:8px;color:#fff;text-decoration:none;transition:all 0.2s;">
                <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                Star on GitHub
              </a>
              <a href="https://x.com/reflexiveai" target="_blank" style="display:flex;align-items:center;gap:8px;padding:12px 24px;background:#222;border:1px solid #333;border-radius:8px;color:#fff;text-decoration:none;transition:all 0.2s;">
                <svg height="18" width="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Follow on X
              </a>
              <a href="https://discord.gg/reflexive" target="_blank" style="display:flex;align-items:center;gap:8px;padding:12px 24px;background:#222;border:1px solid #333;border-radius:8px;color:#fff;text-decoration:none;transition:all 0.2s;">
                <svg height="20" width="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                Join Discord
              </a>
            </div>
            <p style="margin-top:40px;color:#555;font-size:0.85rem;">Server has been shut down. You can close this tab.</p>
          </div>
        \`;
        await fetch('/shutdown', { method: 'POST' });
      }
    };` : '';

  const statusUpdateScript = showControls ? `
        document.getElementById('status-text').textContent = state.isRunning ? 'Running' : 'Stopped';
        document.querySelector('.dot').className = 'dot ' + (state.isRunning ? 'running' : 'stopped');
        document.getElementById('start-btn').disabled = state.isRunning;
        document.getElementById('stop-btn').disabled = !state.isRunning;` : '';

  const breakpointScript = showControls && inject ? `
    const breakNowBtn = document.getElementById('break-now-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const breakpointsContent = document.getElementById('breakpoints-content');
    const breakpointsCount = document.getElementById('breakpoints-count');
    let isAtBreakpoint = false;
    const breakpointHistory = [];

    breakNowBtn.onclick = async () => {
      breakNowBtn.disabled = true;
      await fetch('/break', { method: 'POST' });
    };

    resumeBtn.onclick = async () => {
      await fetch('/resume', { method: 'POST' });
    };

    let conditionalBreakpoints = [];

    function renderBreakpoints(currentBp) {
      // Show debug panels if we have any breakpoints
      if (breakpointHistory.length > 0 || currentBp || conditionalBreakpoints.length > 0) {
        debugPanels.classList.add('visible');
      }

      const activeCount = (currentBp ? 1 : 0) + conditionalBreakpoints.filter(b => b.enabled).length;
      breakpointsCount.textContent = activeCount;

      if (breakpointHistory.length === 0 && !currentBp && conditionalBreakpoints.length === 0) {
        breakpointsContent.innerHTML = '<div class="debug-empty">No breakpoints. Ask the agent to set one.</div>';
        return;
      }

      let html = '';

      // Active breakpoint (paused)
      if (currentBp) {
        html += '<div class="debug-item" style="background: rgba(239, 68, 68, 0.1);">' +
          '<input type="checkbox" checked disabled>' +
          '<span class="pattern" style="color: #ef4444;">🔴 ' + escapeHtml(currentBp.label || 'breakpoint') + '</span>' +
          '<span class="hit-count">paused</span>' +
        '</div>';
      }

      // Conditional breakpoints (set by agent)
      conditionalBreakpoints.forEach(bp => {
        html += '<div class="debug-item' + (bp.enabled ? '' : ' disabled') + '" data-bp-id="' + bp.id + '">' +
          '<input type="checkbox"' + (bp.enabled ? ' checked' : '') + ' title="' + (bp.enabled ? 'Disable' : 'Enable') + '">' +
          '<span class="pattern">' + escapeHtml(bp.pattern) + '</span>' +
          '<span class="hit-count">' + bp.hitCount + ' hits</span>' +
          '<span class="actions">' +
            '<button class="action-btn delete" title="Delete">✕</button>' +
          '</span>' +
        '</div>';
      });

      // History
      breakpointHistory.slice().reverse().forEach(bp => {
        html += '<div class="debug-item disabled" style="opacity: 0.5;">' +
          '<input type="checkbox" disabled>' +
          '<span class="pattern" style="color: #666;">' + escapeHtml(bp.label || 'breakpoint') + '</span>' +
          '<span class="hit-count">' + bp.duration + 'ms</span>' +
        '</div>';
      });

      breakpointsContent.innerHTML = html;

      // Add event listeners for conditional breakpoints
      breakpointsContent.querySelectorAll('.debug-item[data-bp-id]').forEach(item => {
        const id = parseInt(item.dataset.bpId);

        item.querySelector('input[type="checkbox"]').onchange = async () => {
          await fetch('/breakpoint/' + id, { method: 'POST' });
        };

        const deleteBtn = item.querySelector('.delete');
        if (deleteBtn) {
          deleteBtn.onclick = async () => {
            await fetch('/breakpoint/' + id, { method: 'DELETE' });
          };
        }
      });
    }

    // Poll for breakpoint status
    async function checkBreakpointStatus() {
      try {
        const res = await fetch('/breakpoint-status');
        const data = await res.json();

        // Update conditional breakpoints list
        conditionalBreakpoints = data.conditionalBreakpoints || [];

        if (data.paused && !isAtBreakpoint) {
          isAtBreakpoint = true;
          breakNowBtn.classList.add('paused');
          breakNowBtn.disabled = true;
          resumeBtn.disabled = false;
          renderBreakpoints(data.breakpoint);
        } else if (!data.paused && isAtBreakpoint) {
          isAtBreakpoint = false;
          breakNowBtn.classList.remove('paused');
          breakNowBtn.disabled = false;
          resumeBtn.disabled = true;
          // Add to history
          if (data.lastBreakpoint) {
            breakpointHistory.push({
              label: data.lastBreakpoint.label,
              duration: data.lastBreakpoint.pauseDuration || 0
            });
          }
          renderBreakpoints(null);
        } else {
          // Just update the conditional breakpoints display
          renderBreakpoints(data.paused ? data.breakpoint : null);
        }
      } catch (e) {}
    }
    setInterval(checkBreakpointStatus, 1000);
    checkBreakpointStatus();
  ` : '';

  const v8DebuggerScript = showControls && debug ? `
    const v8StepOver = document.getElementById('v8-step-over');
    const v8StepInto = document.getElementById('v8-step-into');
    const v8StepOut = document.getElementById('v8-step-out');
    const v8ResumeBtn = document.getElementById('v8-resume-btn');
    const v8StatusBadge = document.getElementById('debugger-status-badge');
    const v8DebuggerEmpty = document.getElementById('v8-debugger-empty');
    const v8BreakpointsList = document.getElementById('v8-breakpoints-list');
    const v8CallStack = document.getElementById('v8-call-stack');

    v8StepOver.onclick = async () => {
      v8StepOver.disabled = true;
      await fetch('/debugger-step-over', { method: 'POST' });
    };

    v8StepInto.onclick = async () => {
      v8StepInto.disabled = true;
      await fetch('/debugger-step-into', { method: 'POST' });
    };

    v8StepOut.onclick = async () => {
      v8StepOut.disabled = true;
      await fetch('/debugger-step-out', { method: 'POST' });
    };

    v8ResumeBtn.onclick = async () => {
      v8ResumeBtn.disabled = true;
      await fetch('/debugger-resume', { method: 'POST' });
    };

    let lastDebuggerState = { connected: false, paused: false };
    let breakpointsRestored = false;

    // localStorage key for breakpoints
    const BP_STORAGE_KEY = 'reflexive-breakpoints';

    function saveBreakpointsToStorage(breakpoints) {
      try {
        // Save essential data (file, line, condition, prompt, promptEnabled)
        const toSave = breakpoints.map(bp => ({
          file: bp.file,
          line: bp.line,
          condition: bp.condition,
          prompt: bp.prompt,
          promptEnabled: bp.promptEnabled
        }));
        localStorage.setItem(BP_STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        console.error('Failed to save breakpoints to localStorage:', e);
      }
    }

    function loadBreakpointsFromStorage() {
      try {
        const stored = localStorage.getItem(BP_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch (e) {
        console.error('Failed to load breakpoints from localStorage:', e);
        return [];
      }
    }

    async function restoreBreakpointsFromStorage() {
      const stored = loadBreakpointsFromStorage();
      if (stored.length === 0) return;

      console.log('Restoring', stored.length, 'breakpoints from localStorage');
      for (const bp of stored) {
        try {
          await fetch('/debugger-breakpoints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bp)
          });
        } catch (e) {
          console.error('Failed to restore breakpoint:', bp, e);
        }
      }
    }

    async function checkDebuggerStatus() {
      try {
        const res = await fetch('/debugger-status');
        const data = await res.json();

        if (!data.enabled) {
          v8StatusBadge.textContent = 'disabled';
          v8StatusBadge.style.background = '#333';
          return;
        }

        // Update status badge
        if (!data.connected) {
          v8StatusBadge.textContent = 'waiting';
          v8StatusBadge.style.background = '#92400e';
        } else if (data.paused) {
          v8StatusBadge.textContent = 'PAUSED';
          v8StatusBadge.style.background = '#ef4444';
        } else {
          v8StatusBadge.textContent = 'running';
          v8StatusBadge.style.background = '#14532d';
        }

        // Enable/disable step controls based on pause state
        const isPaused = data.connected && data.paused;
        v8StepOver.disabled = !isPaused;
        v8StepInto.disabled = !isPaused;
        v8StepOut.disabled = !isPaused;
        v8ResumeBtn.disabled = !isPaused;

        // Update breakpoints list - fetch full breakpoint data
        const bpRes = await fetch('/debugger-breakpoints');
        const bpData = await bpRes.json();

        // If debugger connected but no breakpoints, try to restore from localStorage
        if (data.connected && !breakpointsRestored && (!bpData.breakpoints || bpData.breakpoints.length === 0)) {
          breakpointsRestored = true;
          const stored = loadBreakpointsFromStorage();
          if (stored.length > 0) {
            console.log('Restoring', stored.length, 'breakpoints from localStorage');
            await restoreBreakpointsFromStorage();
            // Re-fetch after restore
            const refreshed = await fetch('/debugger-breakpoints');
            const refreshedData = await refreshed.json();
            bpData.breakpoints = refreshedData.breakpoints || [];
          }
        }

        // Save breakpoints to localStorage whenever we have them
        if (bpData.breakpoints && bpData.breakpoints.length > 0) {
          saveBreakpointsToStorage(bpData.breakpoints);
        }

        if (bpData.breakpoints && bpData.breakpoints.length > 0) {
          v8BreakpointsList.style.display = 'block';
          v8DebuggerEmpty.style.display = 'none';
          v8BreakpointsList.innerHTML = bpData.breakpoints.map(bp => {
            const filename = bp.file.split('/').pop();
            const hasPrompt = bp.prompt && bp.prompt.trim();
            return '<div class="debug-item breakpoint-item" data-bp-id="' + escapeHtml(bp.id) + '">' +
              '<input type="checkbox" class="bp-enabled" ' + (bp.enabled !== false ? 'checked' : '') + ' title="Enable/disable breakpoint">' +
              '<span class="pattern" style="font-family:monospace;font-size:0.8em;flex:1;">' + escapeHtml(filename) + ':' + bp.line + '</span>' +
              (bp.hitCount > 0 ? '<span class="hit-count">' + bp.hitCount + '</span>' : '') +
              '<button class="bp-prompt-btn' + (hasPrompt ? ' has-prompt' : '') + '" title="' + (hasPrompt ? 'Edit prompt' : 'Add prompt') + '">💬</button>' +
              (hasPrompt ? '<input type="checkbox" class="bp-prompt-enabled" ' + (bp.promptEnabled ? 'checked' : '') + ' title="Enable prompt on hit">' : '') +
              '<button class="bp-delete-btn" title="Remove breakpoint">×</button>' +
            '</div>';
          }).join('');

          // Add event handlers for breakpoint controls
          v8BreakpointsList.querySelectorAll('.breakpoint-item').forEach(item => {
            const bpId = item.dataset.bpId;

            item.querySelector('.bp-enabled').onchange = async (e) => {
              await fetch('/debugger-breakpoint/' + encodeURIComponent(bpId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: e.target.checked })
              });
            };

            const promptEnabled = item.querySelector('.bp-prompt-enabled');
            if (promptEnabled) {
              promptEnabled.onchange = async (e) => {
                await fetch('/debugger-breakpoint/' + encodeURIComponent(bpId), {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ promptEnabled: e.target.checked })
                });
              };
            }

            item.querySelector('.bp-prompt-btn').onclick = () => {
              openBreakpointPromptModal(bpId);
            };

            item.querySelector('.bp-delete-btn').onclick = async () => {
              await fetch('/debugger-breakpoint/' + encodeURIComponent(bpId), {
                method: 'DELETE'
              });
              checkDebuggerStatus();
            };
          });
        } else {
          v8BreakpointsList.style.display = 'none';
          // Clear localStorage if all breakpoints were deleted (but only if we've already restored once)
          if (breakpointsRestored) {
            localStorage.removeItem(BP_STORAGE_KEY);
          }
          if (!data.paused) {
            v8DebuggerEmpty.style.display = 'block';
            v8DebuggerEmpty.textContent = data.connected ? 'Connected. Set breakpoints via chat.' : 'Waiting for debugger connection...';
          }
        }

        // Update call stack when paused
        if (data.paused && data.callStack && data.callStack.length > 0) {
          v8CallStack.style.display = 'block';
          v8DebuggerEmpty.style.display = 'none';
          v8CallStack.innerHTML = '<div style="font-size:0.75em;color:#888;margin-bottom:4px;">Call Stack:</div>' +
            data.callStack.slice(0, 5).map((frame, i) => {
              const filename = (frame.url || '').split('/').pop() || 'unknown';
              return '<div class="debug-item" style="padding:4px 8px;">' +
                '<span style="color:#666;margin-right:4px;">#' + i + '</span>' +
                '<span class="pattern" style="font-family:monospace;font-size:0.75em;">' +
                  escapeHtml(frame.functionName) + ' at ' + filename + ':' + frame.lineNumber +
                '</span>' +
              '</div>';
            }).join('');
        } else {
          v8CallStack.style.display = 'none';
        }

        // Show debug panels if debugger is active
        if (data.connected) {
          debugPanels.classList.add('visible');
        }

        // Handle triggered breakpoint prompts
        if (data.triggeredPrompts && data.triggeredPrompts.length > 0 && !isLoading) {
          for (const triggered of data.triggeredPrompts) {
            triggerBreakpointPrompt(triggered.breakpoint, triggered.callFrames);
          }
        }

        lastDebuggerState = data;
      } catch (e) {}
    }

    setInterval(checkDebuggerStatus, 1000);
    checkDebuggerStatus();
  ` : '';

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
    /* Custom scrollbars */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #1a1a22; border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #444; }
    * { scrollbar-width: thin; scrollbar-color: #333 #1a1a22; }
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
    .btn.power { border-color: #f59e0b; color: #f59e0b; font-size: 1rem; padding: 4px 10px; }
    .btn.power:hover { background: #78350f; }
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

    .grid { display: flex; gap: 0; height: calc(100vh - 100px); }
    @media (max-width: 900px) { .grid { flex-direction: column; } }

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
    .panel.collapsed { width: 42px !important; min-width: 42px; }
    .panel.collapsed .logs-wrapper { display: none; }
    .panel.collapsed .metrics { display: none; }
    .panel.collapsed .panel-header-actions { display: none; }
    .panel.collapsed .panel-header { writing-mode: vertical-rl; text-orientation: mixed; padding: 14px 10px; border-bottom: none; justify-content: flex-start; }
    .panel.collapsed .panel-header-toggle::before { transform: rotate(-90deg); }
    .resize-handle:has(+ .panel.collapsed) { width: 0; overflow: hidden; }

    .resize-handle {
      width: 8px;
      background: transparent;
      cursor: col-resize;
      flex-shrink: 0;
      position: relative;
      transition: background 0.15s;
    }
    .resize-handle:hover, .resize-handle.dragging { background: #333; }
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 4px;
      height: 40px;
      background: #444;
      border-radius: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .resize-handle:hover::after, .resize-handle.dragging::after { opacity: 1; }
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
    .panel-header-actions { display: flex; gap: 6px; }
    .panel-btn {
      padding: 2px 8px;
      background: transparent;
      border: 1px solid #333;
      border-radius: 4px;
      color: #888;
      cursor: pointer;
      font-size: 0.75rem;
      transition: all 0.15s;
    }
    .panel-btn:hover { background: #222; color: #fff; border-color: #444; }
    .panel-btn.active { background: #333; color: #fff; }
    .panel-btn.breakpoint-btn { border-color: #f59e0b; color: #f59e0b; }
    .panel-btn.breakpoint-btn:hover { background: #78350f; }
    .panel-btn.breakpoint-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .panel-btn.breakpoint-btn.paused { background: #dc2626; border-color: #dc2626; color: #fff; animation: pulse-red 1.5s infinite; }
    @keyframes pulse-red { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
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

    .tool-call {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      margin: 8px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      font-size: 0.85rem;
    }
    .tool-call .tool-icon {
      font-size: 1rem;
    }
    .tool-call .tool-name {
      color: #60a5fa;
      font-weight: 600;
    }
    .tool-call .tool-params {
      color: #94a3b8;
      font-size: 0.8rem;
      max-width: 350px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-call.send-input {
      background: linear-gradient(135deg, #1e3a2f 0%, #0f291a 100%);
      border-color: #22543d;
    }
    .tool-call.send-input .tool-name {
      color: #4ade80;
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
    .chat-stop {
      padding: 10px 14px;
      background: #ef4444;
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font-weight: 500;
      display: none;
    }
    .chat-stop:hover { background: #dc2626; }
    .chat-stop.visible { display: block; }
    .chat-send.hidden { display: none; }

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
    .log-type { width: 70px; flex-shrink: 0; color: #666; font-size: 0.65rem; }
    .log-entry.stdout .log-type, .log-entry.info .log-type { color: #22c55e; }
    .log-entry.stderr .log-type, .log-entry.error .log-type { color: #ef4444; }
    .log-entry.system .log-type, .log-entry.debug .log-type { color: #3b82f6; }
    .log-entry.warn .log-type { color: #eab308; }
    .log-entry.breakpoint-prompt .log-type { color: #f472b6; }
    .log-entry.breakpoint-prompt .log-message { color: #f9a8d4; }
    .log-message { color: #999; white-space: pre-wrap; word-break: break-all; }
    .log-link { color: #60a5fa; text-decoration: underline; cursor: pointer; }
    .log-link:hover { color: #93c5fd; }

    .log-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #1a1a22; background: #0d0d12; }
    .log-filter {
      padding: 3px 8px;
      font-size: 0.65rem;
      border-radius: 10px;
      border: 1px solid;
      cursor: pointer;
      transition: all 0.15s;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .log-filter.stdout { background: rgba(34, 197, 94, 0.15); border-color: #22c55e; color: #22c55e; }
    .log-filter.stderr { background: rgba(239, 68, 68, 0.15); border-color: #ef4444; color: #ef4444; }
    .log-filter.system { background: rgba(59, 130, 246, 0.15); border-color: #3b82f6; color: #3b82f6; }
    .log-filter.inject { background: rgba(168, 85, 247, 0.15); border-color: #a855f7; color: #a855f7; }
    .log-filter.disabled { opacity: 0.3; background: transparent; }
    .log-filter:hover { opacity: 0.8; }
    .log-filter { position: relative; }
    .log-filter[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1a1a22;
      border: 1px solid #333;
      color: #ccc;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 0.65rem;
      white-space: nowrap;
      z-index: 100;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .log-filter[data-tooltip]:hover::before {
      content: '';
      position: absolute;
      bottom: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #333;
      z-index: 100;
    }

    .logs-wrapper { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    .panel-header-toggle { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; }
    .panel-header-toggle::before { content: '▼'; font-size: 0.6rem; transition: transform 0.2s; }
    .panel.collapsed .panel-header-toggle::before { transform: rotate(-90deg); }
    .panel.collapsed .panel-header { border-bottom: none; }

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

    /* Interactive mode styles */
    .interactive-panel { display: ${interactive ? 'flex' : 'none'}; flex-direction: column; gap: 8px; padding: 12px; border-top: 1px solid #222; background: #0d0d12; }
    .cli-input-area { display: flex; gap: 8px; }
    .cli-input {
      flex: 1;
      padding: 10px 12px;
      background: #1a2e1a;
      border: 1px solid #2d5a2d;
      border-radius: 6px;
      color: #4ade80;
      font-size: 0.85rem;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .cli-input:focus { outline: none; border-color: #22c55e; }
    .cli-input::placeholder { color: #4ade8066; }
    .cli-send {
      padding: 10px 16px;
      background: #166534;
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.85rem;
    }
    .cli-send:hover { background: #15803d; }
    .cli-send:disabled { opacity: 0.5; }
    .waiting-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      color: #22c55e;
      animation: pulse 2s ease-in-out infinite;
    }
    .waiting-indicator.hidden { display: none; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .input-mode-toggle {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .mode-btn {
      padding: 4px 10px;
      background: #16161d;
      border: 1px solid #333;
      border-radius: 4px;
      color: #888;
      cursor: pointer;
      font-size: 0.7rem;
    }
    .mode-btn.active { background: #1e3a5f; border-color: #3b82f6; color: #fff; }
    .mode-btn:hover { background: #222; }
    .agent-auto-wrapper {
      display: flex;
      align-items: center;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #222;
    }
    .agent-auto-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.75rem;
      color: #888;
      cursor: pointer;
    }
    .agent-auto-label input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #3b82f6;
      cursor: pointer;
    }
    .agent-auto-label:hover { color: #fff; }
    .agent-auto-label.active { color: #3b82f6; }
    .agent-thinking {
      display: none;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      color: #3b82f6;
      margin-left: auto;
    }
    .agent-thinking.visible { display: flex; }

    /* Watch icon on log entries */
    .log-entry { position: relative; }
    .log-entry:hover .watch-icon { opacity: 1; }
    .watch-icon {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      opacity: 0;
      cursor: pointer;
      font-size: 0.75rem;
      color: #666;
      transition: all 0.15s;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .watch-icon:hover { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
    .watch-icon.watched { opacity: 1; color: #3b82f6; }

    /* Watch modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-overlay.visible { display: flex; }
    .modal {
      background: #16161d;
      border: 1px solid #333;
      border-radius: 8px;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .modal-header {
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      font-weight: 600;
      font-size: 0.9rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-close {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 1.2rem;
      padding: 0;
      line-height: 1;
    }
    .modal-close:hover { color: #fff; }
    .modal-body { padding: 16px; overflow-y: auto; }
    .modal-footer {
      padding: 12px 16px;
      border-top: 1px solid #333;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .form-group { margin-bottom: 16px; }
    .form-label {
      display: block;
      font-size: 0.75rem;
      color: #888;
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      background: #0a0a0f;
      border: 1px solid #333;
      border-radius: 6px;
      color: #fff;
      font-size: 0.85rem;
      font-family: inherit;
    }
    .form-input:focus { outline: none; border-color: #3b82f6; }
    .form-textarea {
      width: 100%;
      min-height: 100px;
      padding: 10px 12px;
      background: #0a0a0f;
      border: 1px solid #333;
      border-radius: 6px;
      color: #fff;
      font-size: 0.85rem;
      font-family: 'SF Mono', Monaco, monospace;
      resize: vertical;
    }
    .form-textarea:focus { outline: none; border-color: #3b82f6; }
    .matched-preview {
      background: #1a1a24;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 8px 10px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.75rem;
      color: #888;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* Horizontal resize handle for debug panels */
    .h-resize-handle {
      height: 6px;
      background: transparent;
      cursor: row-resize;
      flex-shrink: 0;
      position: relative;
      transition: background 0.15s;
    }
    .h-resize-handle:hover, .h-resize-handle.dragging { background: #333; }
    .h-resize-handle::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 30px;
      height: 3px;
      background: #444;
      border-radius: 2px;
    }

    /* Debug panels (Watch + Breakpoints) */
    .debug-panels {
      display: none;
      flex-direction: column;
      height: 180px;
      min-height: 60px;
      overflow-y: auto;
    }
    .debug-panels.visible { display: flex; }
    .debug-section {
      border-bottom: 1px solid #1a1a22;
    }
    .debug-section:last-child { border-bottom: none; }
    .debug-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: #0d0d12;
      cursor: pointer;
      font-size: 0.7rem;
      color: #888;
      user-select: none;
    }
    .debug-header:hover { color: #fff; }
    .debug-header .arrow { font-size: 0.55rem; transition: transform 0.15s; }
    .debug-header.collapsed .arrow { transform: rotate(-90deg); }
    .debug-header .count {
      margin-left: auto;
      background: #333;
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 0.6rem;
    }
    .debug-content {
      max-height: 120px;
      overflow-y: auto;
      background: #111118;
    }
    .debug-content.collapsed { display: none; }

    /* Permissions panel */
    .permissions-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 4px;
      padding: 8px;
    }
    .perm-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.65rem;
      background: #1a1a22;
    }
    .perm-item.enabled { color: #4ade80; }
    .perm-item.disabled { color: #666; }
    .perm-icon {
      font-size: 0.7rem;
      width: 14px;
      text-align: center;
    }
    .perm-item.enabled .perm-icon { color: #4ade80; }
    .perm-item.disabled .perm-icon { color: #ef4444; }

    .debug-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      font-size: 0.7rem;
      border-bottom: 1px solid #1a1a22;
    }
    .debug-item:last-child { border-bottom: none; }
    .debug-item:hover { background: #1a1a24; }
    .debug-item input[type="checkbox"] {
      width: 12px;
      height: 12px;
      accent-color: #3b82f6;
      cursor: pointer;
    }
    .debug-item .pattern {
      flex: 1;
      font-family: 'SF Mono', Monaco, monospace;
      color: #e0e0e0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .debug-item .hit-count {
      color: #666;
      font-size: 0.6rem;
    }
    .debug-item .actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .debug-item:hover .actions { opacity: 1; }
    .debug-item .action-btn {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      font-size: 0.7rem;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .debug-item .action-btn:hover { color: #fff; background: #333; }
    .debug-item .action-btn.delete:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }
    .debug-item.disabled { opacity: 0.4; }
    .debug-item.disabled .pattern { text-decoration: line-through; }
    .debug-empty {
      padding: 12px;
      text-align: center;
      font-size: 0.7rem;
      color: #555;
    }

    /* Log filter input */
    .log-filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: #0d0d12;
      border-bottom: 1px solid #1a1a22;
    }
    .log-filter-input {
      flex: 0 0 140px;
      padding: 4px 8px;
      background: #0a0a0f;
      border: 1px solid #333;
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 0.7rem;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .log-filter-input:focus {
      outline: none;
      border-color: #3b82f6;
    }
    .log-filter-input::placeholder { color: #555; }

    /* Breakpoint controls in debug section */
    .breakpoint-controls {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
    .bp-ctrl-btn {
      padding: 2px 8px;
      background: #1a1a24;
      border: 1px solid #333;
      border-radius: 4px;
      color: #888;
      font-size: 0.65rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .bp-ctrl-btn:hover:not(:disabled) {
      background: #252530;
      color: #fff;
      border-color: #444;
    }
    .bp-ctrl-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .bp-ctrl-btn.resume {
      background: #1a2a1a;
      border-color: #2d4a2d;
      color: #4ade80;
    }
    .bp-ctrl-btn.resume:hover:not(:disabled) {
      background: #2a3a2a;
      border-color: #3d5a3d;
    }
    .bp-ctrl-btn.paused {
      background: #3a1a1a;
      border-color: #5a2d2d;
      color: #ef4444;
      animation: pulse-red 1.5s infinite;
    }
    @keyframes pulse-red {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* Breakpoint item buttons */
    .breakpoint-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bp-prompt-btn, .bp-delete-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 4px;
      font-size: 0.7rem;
      border-radius: 3px;
      opacity: 0.5;
      transition: opacity 0.15s, background 0.15s;
    }
    .bp-prompt-btn:hover { opacity: 1; background: #252530; }
    .bp-prompt-btn.has-prompt { opacity: 1; color: #3b82f6; }
    .bp-delete-btn { color: #888; }
    .bp-delete-btn:hover { opacity: 1; color: #ef4444; background: rgba(239, 68, 68, 0.1); }
    .bp-prompt-enabled {
      width: 12px;
      height: 12px;
      accent-color: #3b82f6;
      cursor: pointer;
    }
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
          <div class="panel-header-actions">
            <button class="panel-btn" id="new-chat-btn" title="Start new conversation">+ New</button>
          </div>
          ${showControls ? `<div class="status"><span class="dot ${status.isRunning ? 'running' : 'stopped'}"></span><span id="status-text">${status.isRunning ? 'Running' : 'Stopped'}</span></div>` : ''}
        </div>
        <div class="chat-messages" id="messages"></div>
        <div class="chat-input-area">
          ${interactive ? `
          <div class="input-mode-toggle">
            <button class="mode-btn active" id="mode-agent">Ask Agent</button>
            <button class="mode-btn" id="mode-cli">Direct to CLI</button>
            <div class="waiting-indicator hidden" id="waiting-indicator">
              <span>●</span> CLI waiting for input
            </div>
          </div>
          ` : ''}
          <div class="chat-input-wrapper" id="agent-input-wrapper">
            <input class="chat-input" id="input" placeholder="${interactive ? 'Ask the agent about the CLI...' : 'Ask about your app...'}" />
            <button class="chat-send" id="send">Send</button>
            <button class="chat-stop" id="stop-response" title="Stop response">■</button>
          </div>
          ${interactive ? `
          <div class="cli-input-area" id="cli-input-wrapper" style="display: none;">
            <input class="cli-input" id="cli-input" placeholder="Type directly to the CLI..." />
            <button class="cli-send" id="cli-send">Send to CLI</button>
          </div>
          ` : ''}
          ${showControls ? `
          <div class="agent-auto-wrapper">
            <label class="agent-auto-label">
              <input type="checkbox" id="agent-auto-handle" />
              <span>Let agent continue after output</span>
            </label>
          </div>
          ` : ''}
        </div>
      </div>

      <div class="resize-handle" id="resize-handle"></div>

      <div class="panel ${interactive ? 'collapsed' : ''}" id="output-panel">
        <div class="panel-header">
          <span class="panel-header-toggle" id="logs-toggle">${showControls ? 'Process Output' : 'Application Logs'}</span>
          <div class="panel-header-actions">
            <button class="panel-btn" id="clear-logs-btn" title="Clear logs">⌫</button>
            <button class="panel-btn" id="pause-logs-btn" title="Pause auto-scroll">⏸</button>
          </div>
        </div>
        <div class="logs-wrapper" id="logs-wrapper">
          <div class="log-filter-bar">
            <input class="log-filter-input" id="log-filter-input" placeholder="Filter logs..." />
            <div class="log-filters" id="log-filters"></div>
          </div>
          <div class="logs" id="logs"></div>
        </div>
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
        ${showControls ? `<div class="h-resize-handle" id="h-resize-handle"></div>` : ''}
        <!-- Debug panels (Watch + Breakpoints + Permissions) -->
        <div class="debug-panels${showControls ? ' visible' : ''}" id="debug-panels">
          ${showControls ? `
          <div class="debug-section" id="permissions-section">
            <div class="debug-header" id="permissions-header">
              <span class="arrow">▼</span>
              <span>Permissions</span>
            </div>
            <div class="debug-content" id="permissions-content">
              <div class="permissions-grid">
                <div class="perm-item ${capabilities.readFiles ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${capabilities.readFiles ? '✓' : '✗'}</span>
                  <span class="perm-label">Read Files</span>
                </div>
                <div class="perm-item ${capabilities.writeFiles ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${capabilities.writeFiles ? '✓' : '✗'}</span>
                  <span class="perm-label">Write Files</span>
                </div>
                <div class="perm-item ${capabilities.shellAccess ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${capabilities.shellAccess ? '✓' : '✗'}</span>
                  <span class="perm-label">Shell Access</span>
                </div>
                <div class="perm-item ${capabilities.restart ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${capabilities.restart ? '✓' : '✗'}</span>
                  <span class="perm-label">Restart Process</span>
                </div>
                <div class="perm-item ${capabilities.networkAccess ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${capabilities.networkAccess ? '✓' : '✗'}</span>
                  <span class="perm-label">Network Access</span>
                </div>
                <div class="perm-item ${inject ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${inject ? '✓' : '✗'}</span>
                  <span class="perm-label">Injection</span>
                </div>
                <div class="perm-item ${debug ? 'enabled' : 'disabled'}">
                  <span class="perm-icon">${debug ? '✓' : '✗'}</span>
                  <span class="perm-label">V8 Debugging</span>
                </div>
              </div>
            </div>
          </div>
          ` : ''}
          <div class="debug-section" id="watch-section">
            <div class="debug-header" id="watch-header">
              <span class="arrow">▼</span>
              <span>Watch</span>
              <span class="count" id="watch-count">0</span>
            </div>
            <div class="debug-content" id="watch-content">
              <div class="debug-empty" id="watch-empty">No watches. Click 👁 on a log entry to add one.</div>
            </div>
          </div>
          ${showControls && inject ? `
          <div class="debug-section" id="breakpoints-section">
            <div class="debug-header" id="breakpoints-header">
              <span class="arrow">▼</span>
              <span>Breakpoints</span>
              <span class="count" id="breakpoints-count">0</span>
              <div class="breakpoint-controls">
                <button class="bp-ctrl-btn" id="break-now-btn" title="Break now (pause execution)">⏸ Break</button>
                <button class="bp-ctrl-btn resume" id="resume-btn" title="Resume execution" disabled>▶ Resume</button>
              </div>
            </div>
            <div class="debug-content" id="breakpoints-content">
              <div class="debug-empty" id="breakpoints-empty">No breakpoints hit yet.</div>
            </div>
          </div>
          ` : ''}
          ${showControls && debug ? `
          <div class="debug-section" id="v8-debugger-section">
            <div class="debug-header" id="v8-debugger-header">
              <span class="arrow">▼</span>
              <span>V8 Debugger</span>
              <span class="count debugger-status" id="debugger-status-badge">--</span>
              <div class="breakpoint-controls">
                <button class="bp-ctrl-btn" id="v8-step-over" title="Step Over" disabled>Step</button>
                <button class="bp-ctrl-btn" id="v8-step-into" title="Step Into" disabled>Into</button>
                <button class="bp-ctrl-btn" id="v8-step-out" title="Step Out" disabled>Out</button>
                <button class="bp-ctrl-btn resume" id="v8-resume-btn" title="Resume execution" disabled>▶</button>
              </div>
            </div>
            <div class="debug-content" id="v8-debugger-content">
              <div class="debug-empty" id="v8-debugger-empty">V8 Inspector ready. Set breakpoints via chat.</div>
              <div class="v8-breakpoints-list" id="v8-breakpoints-list" style="display:none;"></div>
              <div class="v8-call-stack" id="v8-call-stack" style="display:none;"></div>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- Watch Modal -->
  <div class="modal-overlay" id="watch-modal">
    <div class="modal">
      <div class="modal-header">
        <span id="modal-title">Add Watch Trigger</span>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Pattern (substring match)</label>
          <input class="form-input" id="watch-pattern" placeholder="e.g., error, connected, user login" />
        </div>
        <div class="form-group">
          <label class="form-label">Matched message preview</label>
          <div class="matched-preview" id="watch-preview">-</div>
        </div>
        <div class="form-group">
          <label class="form-label">Prompt to send to agent when triggered</label>
          <textarea class="form-textarea" id="watch-prompt" placeholder="e.g., Investigate this error and suggest a fix"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="modal-cancel">Cancel</button>
        <button class="btn success" id="modal-save">Save Watch</button>
      </div>
    </div>
  </div>

  <!-- Breakpoint Prompt Modal -->
  <div class="modal-overlay" id="bp-prompt-modal">
    <div class="modal">
      <div class="modal-header">
        <span id="bp-modal-title">Breakpoint Prompt</span>
        <button class="modal-close" id="bp-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Breakpoint Location</label>
          <div class="matched-preview" id="bp-location">-</div>
        </div>
        <div class="form-group">
          <label class="form-label">Prompt to send to agent when breakpoint hits</label>
          <textarea class="form-textarea" id="bp-prompt-input" placeholder="e.g., Analyze the current call stack and local variables, explain what's happening"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="bp-modal-cancel">Cancel</button>
        <button class="btn success" id="bp-modal-save">Save</button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const stopBtn = document.getElementById('stop-response');
    const logsEl = document.getElementById('logs');
    const outputPanel = document.getElementById('output-panel');
    const logsToggle = document.getElementById('logs-toggle');
    const logFiltersEl = document.getElementById('log-filters');
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    const pauseLogsBtn = document.getElementById('pause-logs-btn');
    const logFilterInput = document.getElementById('log-filter-input');
    let isLoading = false;
    let isPaused = false;
    let currentAbortController = null;
    let logFilterText = '';

    // Log filter input handler
    logFilterInput.oninput = () => {
      logFilterText = logFilterInput.value.toLowerCase();
      renderFilteredLogs();
    };

    // Watch state
    const watches = [];
    let watchIdCounter = 0;
    let editingWatchId = null;
    const debugPanels = document.getElementById('debug-panels');
    const watchModal = document.getElementById('watch-modal');
    const watchPattern = document.getElementById('watch-pattern');
    const watchPrompt = document.getElementById('watch-prompt');
    const watchPreview = document.getElementById('watch-preview');
    const watchContent = document.getElementById('watch-content');
    const watchCount = document.getElementById('watch-count');
    const watchEmpty = document.getElementById('watch-empty');
    const watchHeader = document.getElementById('watch-header');
    const modalTitle = document.getElementById('modal-title');

    // Modal handling
    function openWatchModal(message, existingWatch = null) {
      editingWatchId = existingWatch?.id || null;
      modalTitle.textContent = existingWatch ? 'Edit Watch Trigger' : 'Add Watch Trigger';
      watchPattern.value = existingWatch?.pattern || message.slice(0, 100);
      watchPrompt.value = existingWatch?.prompt || '';
      watchPreview.textContent = message.slice(0, 200) + (message.length > 200 ? '...' : '');
      watchModal.classList.add('visible');
      watchPrompt.focus();
    }

    function closeWatchModal() {
      watchModal.classList.remove('visible');
      editingWatchId = null;
    }

    document.getElementById('modal-close').onclick = closeWatchModal;
    document.getElementById('modal-cancel').onclick = closeWatchModal;
    watchModal.onclick = (e) => { if (e.target === watchModal) closeWatchModal(); };

    // Breakpoint prompt modal handling
    const bpPromptModal = document.getElementById('bp-prompt-modal');
    const bpLocation = document.getElementById('bp-location');
    const bpPromptInput = document.getElementById('bp-prompt-input');
    let editingBreakpointId = null;
    let breakpointsCache = [];

    async function openBreakpointPromptModal(breakpointId) {
      editingBreakpointId = breakpointId;
      // Fetch breakpoint data
      const res = await fetch('/debugger-breakpoints');
      const data = await res.json();
      breakpointsCache = data.breakpoints || [];
      const bp = breakpointsCache.find(b => b.id === breakpointId);
      if (bp) {
        const filename = bp.file.split('/').pop();
        bpLocation.textContent = filename + ':' + bp.line;
        bpPromptInput.value = bp.prompt || '';
        bpPromptModal.classList.add('visible');
        bpPromptInput.focus();
      }
    }

    function closeBreakpointPromptModal() {
      bpPromptModal.classList.remove('visible');
      editingBreakpointId = null;
    }

    document.getElementById('bp-modal-close').onclick = closeBreakpointPromptModal;
    document.getElementById('bp-modal-cancel').onclick = closeBreakpointPromptModal;
    bpPromptModal.onclick = (e) => { if (e.target === bpPromptModal) closeBreakpointPromptModal(); };

    document.getElementById('bp-modal-save').onclick = async () => {
      const prompt = bpPromptInput.value.trim();
      if (editingBreakpointId) {
        await fetch('/debugger-breakpoint/' + encodeURIComponent(editingBreakpointId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, promptEnabled: prompt.length > 0 })
        });
        closeBreakpointPromptModal();
        checkDebuggerStatus();
      }
    };

    // Breakpoint prompt trigger function (similar to watch trigger)
    async function triggerBreakpointPrompt(breakpoint, callStack) {
      // Show in chat that breakpoint prompt was triggered
      const div = document.createElement('div');
      div.className = 'message assistant';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      const filename = breakpoint.file.split('/').pop();
      meta.textContent = '🔴 breakpoint hit: ' + filename + ':' + breakpoint.line;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.style.borderLeft = '3px solid #ef4444';
      bubble.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
      div.appendChild(meta);
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      isLoading = true;
      sendBtn.disabled = true;

      try {
        const stackInfo = callStack && callStack.length > 0
          ? '\\n\\nCall Stack:\\n' + callStack.slice(0, 5).map((f, i) => '#' + i + ' ' + (f.functionName || '(anonymous)') + ' at ' + (f.url || '').split('/').pop() + ':' + f.lineNumber).join('\\n')
          : '';
        const contextMsg = 'BREAKPOINT HIT: Debugger paused at ' + filename + ':' + breakpoint.line + stackInfo + '\\n\\nUser prompt: ' + breakpoint.prompt;
        const res = await fetch('${chatEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: contextMsg })
        });

        let fullText = '';
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'text') {
                  fullText += data.content;
                  bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.type === 'tool') {
                  const toolName = data.name.replace(/^mcp__[^_]+__/, '');
                  const inputs = Object.entries(data.input || {}).map(([k, v]) => k + ': ' + JSON.stringify(v)).join(', ');
                  fullText += '\\n\\n<div class="tool-call"><span class="tool-icon">⚡</span><span class="tool-name">' + toolName + '</span>' + (inputs ? '<span class="tool-params">' + escapeHtml(inputs) + '</span>' : '') + '</div>\\n\\n';
                  bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                }
              } catch {}
            }
          }
        }
        // Log completion to process output
        const summary = fullText.slice(0, 150).replace(/\\n/g, ' ').trim();
        fetch('/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'breakpoint-prompt',
            message: '🟢 BREAKPOINT PROMPT COMPLETED: ' + filename + ':' + breakpoint.line + ' - ' + summary + (fullText.length > 150 ? '...' : '')
          })
        }).catch(() => {});
      } catch (err) {
        bubble.innerHTML = '<span style="color:#ef4444;">Error: ' + escapeHtml(err.message) + '</span>';
        fetch('/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'breakpoint-prompt',
            message: '❌ BREAKPOINT PROMPT ERROR: ' + filename + ':' + breakpoint.line + ' - ' + err.message
          })
        }).catch(() => {});
      }

      isLoading = false;
      sendBtn.disabled = false;
    }

    document.getElementById('modal-save').onclick = () => {
      const pattern = watchPattern.value.trim();
      const prompt = watchPrompt.value.trim();
      if (!pattern) return;

      if (editingWatchId !== null) {
        const watch = watches.find(w => w.id === editingWatchId);
        if (watch) {
          watch.pattern = pattern;
          watch.prompt = prompt;
        }
      } else {
        watches.push({
          id: ++watchIdCounter,
          pattern,
          prompt,
          enabled: true,
          hitCount: 0
        });
      }
      closeWatchModal();
      renderWatches();
      renderFilteredLogs(); // Re-render to update watch icons
    };

    function renderWatches() {
      const enabledCount = watches.filter(w => w.enabled).length;
      watchCount.textContent = enabledCount;
      debugPanels.classList.toggle('visible', watches.length > 0);

      if (watches.length === 0) {
        watchContent.innerHTML = '<div class="debug-empty">No watches. Click 👁 on a log entry to add one.</div>';
        return;
      }

      watchContent.innerHTML = watches.map(w => {
        const truncatedPattern = w.pattern.length > 40 ? w.pattern.slice(0, 40) + '...' : w.pattern;
        return '<div class="debug-item' + (w.enabled ? '' : ' disabled') + '" data-id="' + w.id + '">' +
          '<input type="checkbox"' + (w.enabled ? ' checked' : '') + ' title="' + (w.enabled ? 'Disable' : 'Enable') + '">' +
          '<span class="pattern" title="' + escapeHtml(w.pattern) + '">' + escapeHtml(truncatedPattern) + '</span>' +
          '<span class="hit-count">' + w.hitCount + ' hits</span>' +
          '<span class="actions">' +
            '<button class="action-btn edit" title="Edit">✎</button>' +
            '<button class="action-btn delete" title="Delete">✕</button>' +
          '</span>' +
        '</div>';
      }).join('');

      // Add event listeners
      watchContent.querySelectorAll('.debug-item').forEach(item => {
        const id = parseInt(item.dataset.id);
        const watch = watches.find(w => w.id === id);
        if (!watch) return;

        item.querySelector('input[type="checkbox"]').onchange = (e) => {
          watch.enabled = e.target.checked;
          renderWatches();
          renderFilteredLogs();
        };

        item.querySelector('.edit').onclick = () => {
          openWatchModal(watch.pattern, watch);
        };

        item.querySelector('.delete').onclick = () => {
          const idx = watches.findIndex(w => w.id === id);
          if (idx !== -1) watches.splice(idx, 1);
          renderWatches();
          renderFilteredLogs();
        };
      });
    }

    // Toggle debug section headers
    ${showControls ? `
    document.getElementById('permissions-header').onclick = () => {
      document.getElementById('permissions-header').classList.toggle('collapsed');
      document.getElementById('permissions-content').classList.toggle('collapsed');
    };
    ` : ''}
    watchHeader.onclick = () => {
      watchHeader.classList.toggle('collapsed');
      document.getElementById('watch-content').classList.toggle('collapsed');
    };
    ${showControls && inject ? `
    document.getElementById('breakpoints-header').onclick = (e) => {
      // Don't collapse if clicking on control buttons
      if (e.target.closest('.breakpoint-controls')) return;
      document.getElementById('breakpoints-header').classList.toggle('collapsed');
      document.getElementById('breakpoints-content').classList.toggle('collapsed');
    };
    ` : ''}
    ${showControls && debug ? `
    document.getElementById('v8-debugger-header').onclick = (e) => {
      // Don't collapse if clicking on control buttons
      if (e.target.closest('.breakpoint-controls')) return;
      document.getElementById('v8-debugger-header').classList.toggle('collapsed');
      document.getElementById('v8-debugger-content').classList.toggle('collapsed');
    };
    ` : ''}

    // Check if a log message matches any watch
    function checkWatchTriggers(log) {
      for (const watch of watches) {
        if (!watch.enabled) continue;
        if (log.message.toLowerCase().includes(watch.pattern.toLowerCase())) {
          watch.hitCount++;
          renderWatches();
          if (watch.prompt && !isLoading) {
            // Trigger the agent with the watch prompt
            triggerWatchPrompt(watch, log);
          }
          return watch;
        }
      }
      return null;
    }

    async function triggerWatchPrompt(watch, log) {
      // Show in chat that watch was triggered
      const div = document.createElement('div');
      div.className = 'message assistant';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = '👁 watch triggered: ' + watch.pattern.slice(0, 30);
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.style.borderLeft = '3px solid #3b82f6';
      bubble.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
      div.appendChild(meta);
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      isLoading = true;
      sendBtn.classList.add('hidden');
      stopBtn.classList.add('visible');
      currentAbortController = new AbortController();

      try {
        const contextMsg = 'WATCH TRIGGER: A log message matched pattern "' + watch.pattern + '"\\n\\nMatched message: ' + log.message + '\\n\\nUser prompt: ' + watch.prompt;
        const res = await fetch('${chatEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: contextMsg }),
          signal: currentAbortController.signal
        });

        let fullText = '';
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        try {
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
                    bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                  } else if (data.type === 'tool') {
                    const toolName = data.name.replace(/^mcp__[^_]+__/, '');
                    const inputs = Object.entries(data.input || {}).map(([k, v]) => k + ': ' + JSON.stringify(v)).join(', ');
                    fullText += '\\n\\n<div class="tool-call"><span class="tool-icon">⚡</span><span class="tool-name">' + toolName + '</span>' + (inputs ? '<span class="tool-params">' + escapeHtml(inputs) + '</span>' : '') + '</div>\\n\\n';
                    bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                  }
                } catch (e) {}
              }
            }
          }
        } catch (readError) {
          if (readError.name === 'AbortError') {
            fullText += '\\n\\n*[Response stopped]*';
            bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          bubble.textContent = 'Error: ' + e.message;
        }
      }

      currentAbortController = null;
      isLoading = false;
      sendBtn.classList.remove('hidden');
      stopBtn.classList.remove('visible');
    }

    // Get watch for a pattern
    function getWatchForMessage(message) {
      for (const watch of watches) {
        if (message.toLowerCase().includes(watch.pattern.toLowerCase())) {
          return watch;
        }
      }
      return null;
    }

    // Filter state - all enabled by default
    const logFilters = { stdout: true, stderr: true, system: true, 'breakpoint-prompt': true };
    const injectFilters = {}; // Dynamic inject namespaces
    const injectColors = {}; // Color assignments for inject namespaces
    let allLogs = [];

    // Color palette for inject namespaces
    const injectColorPalette = [
      '#a855f7', // purple
      '#f472b6', // pink
      '#fb923c', // orange
      '#38bdf8', // sky blue
      '#4ade80', // emerald
      '#facc15', // yellow
      '#c084fc', // violet
      '#22d3d8', // cyan
      '#fb7185', // rose
      '#a3e635', // lime
    ];
    let colorIndex = 0;

    function getInjectColor(namespace) {
      if (!injectColors[namespace]) {
        injectColors[namespace] = injectColorPalette[colorIndex % injectColorPalette.length];
        colorIndex++;
      }
      return injectColors[namespace];
    }

    // Tooltip descriptions for log types
    const logDescriptions = {
      system: 'Reflexive system messages (start, stop, errors)',
      stdout: 'Standard output from your application',
      stderr: 'Standard error output from your application',
      'breakpoint-prompt': 'Breakpoint prompt triggers and responses',
      'inject:info': 'Application info logs from instrumentation',
      'inject:warn': 'Warning messages from instrumentation',
      'inject:error': 'Error messages from instrumentation',
      'inject:debug': 'Debug messages from instrumentation',
      'inject:perf': 'Performance metrics (GC, event loop latency)',
      'inject:http': 'HTTP request/response tracking',
      'inject:db': 'Database query tracking',
      'inject:fs': 'File system operation tracking',
      'inject:net': 'Network connection tracking',
      'inject:timer': 'Timer and interval tracking',
      'inject:promise': 'Promise lifecycle tracking',
      'inject:memory': 'Memory usage snapshots',
      'inject:cpu': 'CPU usage metrics',
    };

    function getLogDescription(type) {
      if (logDescriptions[type]) return logDescriptions[type];
      if (type.startsWith('inject:')) {
        const ns = type.replace('inject:', '');
        return 'Instrumentation: ' + ns;
      }
      return null;
    }

    // Toggle output panel collapse
    logsToggle.onclick = () => outputPanel.classList.toggle('collapsed');

    // Resize handle
    const resizeHandle = document.getElementById('resize-handle');
    let isResizing = false;
    let startX, startWidth;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = outputPanel.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = startX - e.clientX;
      const newWidth = Math.max(200, Math.min(800, startWidth + diff));
      outputPanel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Horizontal resize handle for debug panels
    ${showControls ? `
    const hResizeHandle = document.getElementById('h-resize-handle');
    let isHResizing = false;
    let startY, startHeight;

    hResizeHandle.addEventListener('mousedown', (e) => {
      isHResizing = true;
      startY = e.clientY;
      startHeight = debugPanels.offsetHeight;
      hResizeHandle.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isHResizing) return;
      const diff = startY - e.clientY;
      const newHeight = Math.max(60, Math.min(400, startHeight + diff));
      debugPanels.style.height = newHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isHResizing) {
        isHResizing = false;
        hResizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
    ` : ''}

    // Clear logs button
    clearLogsBtn.onclick = () => {
      allLogs = [];
      logsEl.innerHTML = '';
      logFiltersEl.innerHTML = '';
      logFilterInput.value = '';
      logFilterText = '';
    };

    // New chat button - reset conversation
    document.getElementById('new-chat-btn').onclick = async () => {
      // Clear chat UI
      messagesEl.innerHTML = '';
      // Reset server-side session
      try {
        await fetch('/reset-conversation', { method: 'POST' });
      } catch (e) {
        console.error('Failed to reset conversation:', e);
      }
    };

    // Pause/resume auto-scroll button
    pauseLogsBtn.onclick = () => {
      isPaused = !isPaused;
      pauseLogsBtn.textContent = isPaused ? '▶' : '⏸';
      pauseLogsBtn.title = isPaused ? 'Resume auto-scroll' : 'Pause auto-scroll';
      pauseLogsBtn.classList.toggle('active', isPaused);
    };

    marked.setOptions({ breaks: true, gfm: true });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function ansiToHtml(text) {
      // Convert ANSI escape codes to HTML spans
      const ansiColors = {
        '30': '#000', '31': '#ef4444', '32': '#22c55e', '33': '#eab308',
        '34': '#3b82f6', '35': '#a855f7', '36': '#06b6d4', '37': '#e5e5e5',
        '90': '#737373', '91': '#fca5a5', '92': '#86efac', '93': '#fde047',
        '94': '#93c5fd', '95': '#d8b4fe', '96': '#67e8f9', '97': '#fff'
      };
      // First strip the ANSI codes and collect style info
      let openSpans = 0;
      const ESC = String.fromCharCode(27);
      let result = '';
      let i = 0;
      while (i < text.length) {
        if (text[i] === ESC && text[i+1] === '[') {
          // Found ANSI escape sequence
          let j = i + 2;
          while (j < text.length && /[0-9;]/.test(text[j])) j++;
          if (text[j] === 'm') {
            const codes = text.slice(i+2, j);
            if (!codes || codes === '0' || codes === '22' || codes === '39') {
              if (openSpans > 0) { result += '</span>'; openSpans--; }
            } else {
              const parts = codes.split(';');
              let style = '';
              for (const code of parts) {
                if (code === '1') style += 'font-weight:bold;';
                else if (code === '3') style += 'font-style:italic;';
                else if (code === '4') style += 'text-decoration:underline;';
                else if (ansiColors[code]) style += 'color:' + ansiColors[code] + ';';
              }
              if (style) { result += '<span style="' + style + '">'; openSpans++; }
            }
            i = j + 1;
            continue;
          }
        }
        // Escape HTML chars
        const c = text[i];
        if (c === '<') result += '&lt;';
        else if (c === '>') result += '&gt;';
        else if (c === '&') result += '&amp;';
        else result += c;
        i++;
      }
      while (openSpans > 0) { result += '</span>'; openSpans--; }
      // Convert URLs to clickable links
      result = result.replace(/(https?:\\/\\/[^\\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener" class="log-link">$1</a>');
      return result;
    }

    function stripAnsi(text) {
      const ESC = String.fromCharCode(27);
      return text.replace(new RegExp(ESC + '\\\\[[0-9;]*[a-zA-Z]', 'g'), '');
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
      sendBtn.classList.add('hidden');
      stopBtn.classList.add('visible');
      addUserMessage(message);
      showThinking();

      // Create abort controller for this request
      currentAbortController = new AbortController();

      try {
        const res = await fetch('${chatEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
          signal: currentAbortController.signal
        });

        hideThinking();
        const bubble = createStreamingMessage();
        let fullText = '';

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        try {
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
                    // Create HTML tool call badge
                    const toolHtml = '<div class="tool-call"><span class="tool-icon">⚡</span><span class="tool-name">' + toolName + '</span>' + (inputs ? '<span class="tool-params">' + escapeHtml(inputs) + '</span>' : '') + '</div>';
                    fullText += '\\n\\n' + toolHtml + '\\n\\n';
                    updateBubbleContent(bubble, fullText);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                  } else if (data.type === 'error') {
                    updateBubbleContent(bubble, '**Error:** ' + data.message);
                  }
                } catch (e) {}
              }
            }
          }
        } catch (readError) {
          if (readError.name === 'AbortError') {
            fullText += '\\n\\n*[Response stopped]*';
            updateBubbleContent(bubble, fullText);
          } else {
            throw readError;
          }
        }

        if (!fullText) {
          bubble.textContent = 'No response';
        }
      } catch (e) {
        hideThinking();
        if (e.name === 'AbortError') {
          const bubble = createStreamingMessage();
          bubble.textContent = '[Response stopped]';
        } else {
          const bubble = createStreamingMessage();
          bubble.textContent = 'Error: ' + e.message;
        }
      }

      currentAbortController = null;
      isLoading = false;
      sendBtn.classList.remove('hidden');
      stopBtn.classList.remove('visible');
      inputEl.focus();
    }

    function stopResponse() {
      if (currentAbortController) {
        currentAbortController.abort();
      }
    }

    sendBtn.onclick = sendMessage;
    stopBtn.onclick = stopResponse;
    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') sendMessage();
    };

    ${interactive ? `
    // Interactive mode handling
    const modeAgentBtn = document.getElementById('mode-agent');
    const modeCliBtn = document.getElementById('mode-cli');
    const agentInputWrapper = document.getElementById('agent-input-wrapper');
    const cliInputWrapper = document.getElementById('cli-input-wrapper');
    const cliInputEl = document.getElementById('cli-input');
    const cliSendBtn = document.getElementById('cli-send');
    const agentAssistBtn = document.getElementById('agent-assist');
    const waitingIndicator = document.getElementById('waiting-indicator');
    let currentMode = 'agent';

    function setMode(mode) {
      currentMode = mode;
      if (mode === 'agent') {
        modeAgentBtn.classList.add('active');
        modeCliBtn.classList.remove('active');
        agentInputWrapper.style.display = 'flex';
        cliInputWrapper.style.display = 'none';
        inputEl.focus();
      } else {
        modeAgentBtn.classList.remove('active');
        modeCliBtn.classList.add('active');
        agentInputWrapper.style.display = 'none';
        cliInputWrapper.style.display = 'flex';
        cliInputEl.focus();
      }
    }

    modeAgentBtn.onclick = () => setMode('agent');
    modeCliBtn.onclick = () => setMode('cli');

    async function sendCliInput() {
      const text = cliInputEl.value.trim();
      if (!text) return;

      cliInputEl.value = '';

      // Show in chat as user action
      const div = document.createElement('div');
      div.className = 'message user';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = 'you → cli';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.style.background = '#1a2e1a';
      bubble.style.fontFamily = "'SF Mono', Monaco, monospace";
      bubble.textContent = text;
      div.appendChild(meta);
      div.appendChild(bubble);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // Send to CLI
      try {
        await fetch('${cliInputEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text })
        });
        waitingIndicator.classList.add('hidden');
      } catch (e) {
        console.error('Failed to send CLI input:', e);
      }
    }

    cliSendBtn.onclick = sendCliInput;
    cliInputEl.onkeydown = (e) => {
      if (e.key === 'Enter') sendCliInput();
    };

    // Check for waiting state in refresh and stream CLI output to chat
    let lastLogTimestamp = '';
    const originalRefresh = refresh;
    refresh = async function() {
      await originalRefresh();
      try {
        const state = await fetch('${statusEndpoint}').then(r => r.json());
        const logs = await fetch('${logsEndpoint}?count=200').then(r => r.json());

        // Stream new CLI output to chat panel (batched) - filter by timestamp (ISO strings sort correctly)
        const newLogs = logs.filter(l => l.timestamp > lastLogTimestamp);
        if (newLogs.length > 0) {
          // Batch consecutive stdout/stderr into single messages
          let currentBatch = [];
          let currentType = null;

          const flushBatch = () => {
            if (currentBatch.length === 0) return;
            const rawText = currentBatch.join(String.fromCharCode(10));
            const strippedText = stripAnsi(rawText);
            if (!strippedText.trim()) { currentBatch = []; return; }

            const div = document.createElement('div');
            div.className = 'message assistant';
            const meta = document.createElement('div');
            meta.className = 'message-meta';
            meta.textContent = 'cli';
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.style.background = currentType === 'stderr' ? '#2d1a1a' : '#1a1a24';
            bubble.style.fontFamily = "'SF Mono', Monaco, monospace";
            bubble.style.fontSize = '0.8rem';
            bubble.style.whiteSpace = 'pre-wrap';
            // Use DOMPurify to sanitize the ANSI-to-HTML conversion
            bubble.innerHTML = DOMPurify.sanitize(ansiToHtml(rawText));
            div.appendChild(meta);
            div.appendChild(bubble);
            messagesEl.appendChild(div);
            currentBatch = [];
          };

          for (const log of newLogs) {
            if (log.type === 'stdout' || log.type === 'stderr') {
              if (currentType !== null && currentType !== log.type) {
                flushBatch();
              }
              currentType = log.type;
              currentBatch.push(log.message);
            }
          }
          flushBatch();
          lastLogTimestamp = logs[logs.length - 1].timestamp;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        if (state.waitingForInput) {
          waitingIndicator.classList.remove('hidden');
        } else {
          waitingIndicator.classList.add('hidden');
        }
      } catch (e) {}
    };
    ` : ''}

    ${showControls ? `
    // Agent auto-continue feature (works in all modes)
    const agentAutoCheckbox = document.getElementById('agent-auto-handle');
    const agentAutoLabel = document.querySelector('.agent-auto-label');
    let agentAutoHandling = false;
    let lastAutoLogCount = 0;
    let autoModeEnabled = false;

    if (agentAutoCheckbox) {
      agentAutoCheckbox.onchange = () => {
        autoModeEnabled = agentAutoCheckbox.checked;
        agentAutoLabel.classList.toggle('active', autoModeEnabled);
        if (autoModeEnabled) {
          lastAutoLogCount = -1; // Will be set on next refresh
        }
      };
    }

    async function triggerAgentContinue(isInteractiveWaiting) {
      if (agentAutoHandling || isLoading) return;
      agentAutoHandling = true;

      // Show thinking in chat
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.id = 'agent-auto-thinking';
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = 'agent (auto)';
      const thinking = document.createElement('div');
      thinking.className = 'thinking';
      for (let i = 0; i < 3; i++) thinking.appendChild(document.createElement('span'));
      div.appendChild(meta);
      div.appendChild(thinking);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const autoMessage = isInteractiveWaiting
          ? 'AUTO_CONTINUE: The CLI is waiting for input. Look at the recent output, understand what it is asking or expecting, and use the send_input tool to respond. Do not ask me - handle it directly.'
          : 'AUTO_CONTINUE: New output has appeared. Review the recent logs and continue working on the current task. If you see errors, investigate and fix them. If a task completed successfully, report it and proceed with any next steps. Do not ask me - just continue working.';

        const res = await fetch('${chatEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: autoMessage })
        });

        document.getElementById('agent-auto-thinking')?.remove();
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
                  const toolName = data.name.replace(/^mcp__[^_]+__/, '');
                  const inputs = Object.entries(data.input || {}).map(([k, v]) => k + ': ' + JSON.stringify(v)).join(', ');
                  fullText += '\\n\\n<div class="tool-call"><span class="tool-icon">⚡</span><span class="tool-name">' + toolName + '</span>' + (inputs ? '<span class="tool-params">' + escapeHtml(inputs) + '</span>' : '') + '</div>\\n\\n';
                  updateBubbleContent(bubble, fullText);
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                }
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        document.getElementById('agent-auto-thinking')?.remove();
        console.error('Agent auto-continue failed:', e);
      }

      agentAutoHandling = false;
    }

    // Check for auto-continue triggers periodically
    setInterval(async () => {
      if (!autoModeEnabled || agentAutoHandling || isLoading) return;

      try {
        const state = await fetch('${statusEndpoint}').then(r => r.json());
        const logs = await fetch('${logsEndpoint}?count=50').then(r => r.json());

        // Initialize baseline on first check
        if (lastAutoLogCount === -1) {
          lastAutoLogCount = logs.length;
          return;
        }

        // Check for triggers
        const hasNewOutput = logs.length > lastAutoLogCount;
        const isWaiting = state.waitingForInput;

        if (hasNewOutput) {
          lastAutoLogCount = logs.length;

          // In interactive mode, only trigger if waiting for input
          // In non-interactive mode, trigger on new output
          if (isWaiting || !${interactive}) {
            triggerAgentContinue(isWaiting);
          }
        }
      } catch (e) {}
    }, 2000);
    ` : ''}

    ${controlsScript}

    ${breakpointScript}

    ${v8DebuggerScript}

    function getLogCategory(type) {
      if (type.startsWith('inject:')) return type;
      return type;
    }

    function updateFilterChips(logs) {
      // Collect all unique types including inject namespaces
      const types = new Set();
      logs.forEach(l => {
        if (l.type.startsWith('inject:')) {
          types.add(l.type);
          if (!(l.type in injectFilters)) injectFilters[l.type] = true;
        } else {
          types.add(l.type);
        }
      });

      // Build chips HTML
      let chipsHtml = '';
      ['system', 'stdout', 'stderr'].forEach(t => {
        if (types.has(t)) {
          const isDisabled = !logFilters[t];
          const desc = getLogDescription(t);
          const tooltipAttr = desc ? ' data-tooltip="' + desc + '"' : '';
          chipsHtml += '<span class="log-filter ' + t + (isDisabled ? ' disabled' : '') + '" data-filter="' + t + '"' + tooltipAttr + '>' + t + '</span>';
        }
      });
      // Add inject namespace chips with unique colors
      Object.keys(injectFilters).sort().forEach(t => {
        const isDisabled = !injectFilters[t];
        const shortName = t.replace('inject:', '');
        const color = getInjectColor(t);
        const desc = getLogDescription(t);
        const tooltipAttr = desc ? ' data-tooltip="' + desc + '"' : '';
        const style = isDisabled
          ? 'opacity:0.3;background:transparent;border-color:' + color + ';color:' + color
          : 'background:' + color + '22;border-color:' + color + ';color:' + color;
        chipsHtml += '<span class="log-filter" style="' + style + '" data-filter="' + t + '"' + tooltipAttr + '>' + shortName + '</span>';
      });

      logFiltersEl.innerHTML = chipsHtml;

      // Add click handlers
      logFiltersEl.querySelectorAll('.log-filter').forEach(chip => {
        chip.onclick = () => {
          const filter = chip.dataset.filter;
          if (filter.startsWith('inject:')) {
            injectFilters[filter] = !injectFilters[filter];
            const color = getInjectColor(filter);
            chip.style.opacity = injectFilters[filter] ? '1' : '0.3';
            chip.style.background = injectFilters[filter] ? color + '22' : 'transparent';
          } else {
            logFilters[filter] = !logFilters[filter];
            chip.classList.toggle('disabled');
          }
          renderFilteredLogs();
        };
      });
    }

    function renderFilteredLogs() {
      const filtered = allLogs.filter(l => {
        // Filter by type chips
        if (l.type.startsWith('inject:')) {
          if (injectFilters[l.type] === false) return false;
        } else {
          if (logFilters[l.type] === false) return false;
        }
        // Filter by text input
        if (logFilterText && !l.message.toLowerCase().includes(logFilterText)) {
          return false;
        }
        return true;
      });
      logsEl.innerHTML = DOMPurify.sanitize(filtered.map((l, idx) => {
        const isInject = l.type.startsWith('inject:');
        const baseClass = isInject ? 'inject' : l.type;
        const colorStyle = isInject ? ' style="color:' + getInjectColor(l.type) + '"' : '';
        const watch = getWatchForMessage(l.message);
        const watchClass = watch ? ' watched' : '';
        return '<div class="log-entry ' + baseClass + '" data-category="' + l.type + '" data-idx="' + idx + '">' +
          '<span class="log-type"' + colorStyle + '>' + l.type + '</span>' +
          '<span class="log-message">' + ansiToHtml(l.message) + '</span>' +
          '<span class="watch-icon' + watchClass + '" title="Add watch trigger">👁</span></div>';
      }).join(''), { ADD_ATTR: ['data-idx', 'data-category'] });

      // Add click handlers for watch icons
      logsEl.querySelectorAll('.watch-icon').forEach(icon => {
        icon.onclick = (e) => {
          e.stopPropagation();
          const entry = icon.closest('.log-entry');
          const idx = parseInt(entry.dataset.idx);
          const log = filtered[idx];
          if (log) {
            const existingWatch = getWatchForMessage(log.message);
            openWatchModal(log.message, existingWatch);
          }
        };
      });

      if (!isPaused) {
        logsEl.scrollTop = logsEl.scrollHeight;
      }
    }

    // Track seen log timestamps to avoid re-triggering watches
    let lastSeenLogTimestamp = null;

    function renderLogs(logs) {
      // Check for new logs that match watches
      if (lastSeenLogTimestamp && logs.length > 0) {
        const newLogs = logs.filter(l => l.timestamp > lastSeenLogTimestamp);
        for (const log of newLogs) {
          checkWatchTriggers(log);
        }
      }
      if (logs.length > 0) {
        lastSeenLogTimestamp = logs[logs.length - 1].timestamp;
      }

      allLogs = logs;
      updateFilterChips(logs);
      renderFilteredLogs();
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
    queryOptions = {},
    sessionId = null  // Pass existing session ID to continue conversation
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

  // Resume existing session if we have a session ID
  if (sessionId) {
    fullOptions.resume = sessionId;
  }

  for await (const msg of query({ prompt: enrichedPrompt, options: fullOptions })) {
    // Capture and yield session ID from init message
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
      yield { type: 'session', sessionId: msg.session_id };
    }
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
    title = '⚡ Reflexive',
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

  // Programmatic chat function
  async function chat(message) {
    let fullResponse = '';
    const chatStream = createChatStream(message, {
      contextSummary: `Application state: ${JSON.stringify(appState.getStatus())}`,
      systemPrompt: baseSystemPrompt,
      mcpServer,
      mcpServerName: 'reflexive-introspection'
    });

    for await (const chunk of chatStream) {
      if (chunk.type === 'text') {
        fullResponse += chunk.content;
      }
    }
    return fullResponse;
  }

  return {
    appState,
    server,
    log: (type, message) => appState.log(type, message),
    setState: (key, value) => appState.setState(key, value),
    getState: (key) => appState.getState(key),
    chat  // Programmatic AI chat
  };
}

// ============================================================================
// V8 Inspector: Remote Debugger for CDP communication
// ============================================================================

class RemoteDebugger extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.messageId = 0;
    this.pending = new Map();
    this.scripts = new Map();
    this.breakpoints = new Map();  // Track breakpoints: id -> { file, line, condition }
    this.connected = false;
    this.paused = false;
    this.currentCallFrames = null;
    this.pauseReason = null;
  }

  async connect(wsUrl, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Debugger connection timeout'));
      }, timeout);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timer);
        this.connected = false;
        reject(err);
      });

      this.ws.on('message', (data) => {
        this._handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
      });
    });
  }

  _handleMessage(msg) {
    if (msg.id !== undefined) {
      // Response to a command
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      // Event notification
      this._handleEvent(msg.method, msg.params);
    }
  }

  _handleEvent(method, params) {
    switch (method) {
      case 'Debugger.paused':
        this.paused = true;
        this.currentCallFrames = params.callFrames;
        this.pauseReason = params.reason;
        this.emit('paused', {
          callFrames: params.callFrames,
          reason: params.reason,
          hitBreakpoints: params.hitBreakpoints || [],
          data: params.data
        });
        break;

      case 'Debugger.resumed':
        this.paused = false;
        this.currentCallFrames = null;
        this.pauseReason = null;
        this.emit('resumed');
        break;

      case 'Debugger.scriptParsed':
        this.scripts.set(params.scriptId, {
          scriptId: params.scriptId,
          url: params.url,
          startLine: params.startLine,
          endLine: params.endLine,
          hash: params.hash
        });
        this.emit('scriptParsed', params);
        break;

      case 'Debugger.breakpointResolved':
        this.emit('breakpointResolved', params);
        break;

      default:
        this.emit(method, params);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) {
        reject(new Error('Not connected to debugger'));
        return;
      }

      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async enable() {
    await this.send('Debugger.enable');
    await this.send('Runtime.enable');
    // Don't pause on exceptions by default
    await this.send('Debugger.setPauseOnExceptions', { state: 'none' });
  }

  async runIfWaitingForDebugger() {
    // Tell the runtime to start execution if it was started with --inspect-brk
    await this.send('Runtime.runIfWaitingForDebugger');
  }

  async setBreakpoint(file, line, condition) {
    // Convert to absolute file URL if not already
    const url = file.startsWith('file://') ? file : `file://${resolve(file)}`;

    const result = await this.send('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,  // Convert to 0-based
      url: url,
      condition: condition || ''
    });

    // Track the breakpoint
    this.breakpoints.set(result.breakpointId, {
      id: result.breakpointId,
      file: file,
      line: line,
      condition: condition || null,
      locations: result.locations
    });

    return {
      breakpointId: result.breakpointId,
      locations: result.locations
    };
  }

  async removeBreakpoint(breakpointId) {
    await this.send('Debugger.removeBreakpoint', { breakpointId });
    this.breakpoints.delete(breakpointId);
  }

  listBreakpoints() {
    return Array.from(this.breakpoints.values());
  }

  async resume() {
    // Don't check this.paused - the event might not have arrived yet
    // Let CDP handle it - will error if not paused
    await this.send('Debugger.resume');
  }

  async pause() {
    await this.send('Debugger.pause');
  }

  async stepOver() {
    if (!this.paused) return;
    await this.send('Debugger.stepOver');
  }

  async stepInto() {
    if (!this.paused) return;
    await this.send('Debugger.stepInto');
  }

  async stepOut() {
    if (!this.paused) return;
    await this.send('Debugger.stepOut');
  }

  async evaluate(expression, callFrameId = null) {
    if (callFrameId && this.paused) {
      return await this.send('Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression,
        returnByValue: true
      });
    } else {
      return await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true
      });
    }
  }

  async getProperties(objectId) {
    return await this.send('Runtime.getProperties', {
      objectId,
      ownProperties: true
    });
  }

  getCallStack() {
    if (!this.paused || !this.currentCallFrames) {
      return null;
    }

    return this.currentCallFrames.map(frame => ({
      callFrameId: frame.callFrameId,
      functionName: frame.functionName || '(anonymous)',
      url: frame.url,
      lineNumber: frame.location.lineNumber + 1,  // Convert to 1-based
      columnNumber: frame.location.columnNumber,
      scopeChain: frame.scopeChain.map(scope => ({
        type: scope.type,
        name: scope.name,
        objectId: scope.object.objectId
      }))
    }));
  }

  async getScopeVariables(callFrameId, scopeType = 'local') {
    if (!this.paused || !this.currentCallFrames) {
      return null;
    }

    // Find the call frame
    const frame = this.currentCallFrames.find(f => f.callFrameId === callFrameId);
    if (!frame) return null;

    // Find the scope
    const scope = frame.scopeChain.find(s => s.type === scopeType);
    if (!scope || !scope.object.objectId) return null;

    // Get properties
    const result = await this.getProperties(scope.object.objectId);

    return result.result.map(prop => ({
      name: prop.name,
      type: prop.value?.type,
      value: prop.value?.value,
      description: prop.value?.description
    }));
  }

  isPaused() {
    return this.paused;
  }

  isConnected() {
    return this.connected;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.paused = false;
    this.currentCallFrames = null;
    this.breakpoints.clear();
    this.scripts.clear();
  }
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
    // Interactive mode state
    this.interactive = options.interactive || false;
    this.waitingForInput = false;
    this.lastOutputTime = null;
    this.inputPromptPatterns = [
      /^You:\s*$/m,
      /^>\s*$/m,
      /\?\s*$/m,
      /:\s*$/m,
      />>>\s*$/m,
      /\$\s*$/m,
      /input:/i,
      /enter.*:/i,
      /prompt>/i
    ];
    this.pendingOutput = '';
    this.outputSettleTimeout = null;
    this.eventHandlers = new Map();
    // Injection mode state
    this.inject = options.inject || false;
    this.injectedState = {};
    this.injectionReady = false;
    // Eval callbacks
    this.evalCallbacks = new Map();
    this.evalIdCounter = 0;
    // Breakpoint state (legacy pattern-based)
    this.activeBreakpoint = null;
    this.lastBreakpoint = null;
    // Conditional breakpoints (legacy pattern-based)
    this.conditionalBreakpoints = [];
    this.conditionalBreakpointIdCounter = 0;
    // V8 Inspector debugging
    this.debug = options.debug || false;
    this.debugger = null;
    this.inspectorUrl = null;
    this.debuggerReady = false;
    // Persisted breakpoints survive restarts
    this.persistedBreakpoints = [];
    // Queue of triggered breakpoint prompts for dashboard to consume
    this.triggeredBreakpointPrompts = [];
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

  start() {
    if (this.isRunning) return;

    // Build node args, adding --require for injection if enabled
    const nodeArgs = [...this.options.nodeArgs];
    if (this.inject) {
      const injectPath = resolve(dirname(fileURLToPath(import.meta.url)), 'inject.cjs');
      nodeArgs.unshift('--require', injectPath);
    }

    // Add V8 Inspector flag if debugging is enabled
    if (this.debug) {
      // Use --inspect-brk=0 to pause on first line and use random port
      nodeArgs.unshift('--inspect-brk=0');
    }

    const args = [...nodeArgs, this.entry, ...this.options.appArgs];

    // In interactive mode, pipe stdin so we can send input programmatically
    const stdinMode = this.interactive ? 'pipe' : 'inherit';

    // Add IPC channel if injection is enabled
    const stdio = this.inject
      ? [stdinMode, 'pipe', 'pipe', 'ipc']
      : [stdinMode, 'pipe', 'pipe'];

    // Set up environment for injection
    const env = { ...process.env, FORCE_COLOR: '1' };
    if (this.inject) {
      env.REFLEXIVE_INJECT = 'true';
    }
    if (this.options.eval) {
      env.REFLEXIVE_EVAL = 'true';
    }

    // Reset debugger state
    if (this.debugger) {
      this.debugger.disconnect();
      this.debugger = null;
    }
    this.inspectorUrl = null;
    this.debuggerReady = false;

    this.child = spawn(process.execPath, args, {
      cwd: this.cwd,
      env,
      stdio
    });

    this.isRunning = true;
    this.startTime = Date.now();
    this.exitCode = null;
    this.waitingForInput = false;
    this.pendingOutput = '';

    this._log('system', `Started: node ${args.join(' ')}${this.interactive ? ' (interactive mode)' : ''}`);

    this.child.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      this._log('stdout', text.trim());

      if (this.interactive) {
        this._handleInteractiveOutput(text, 'stdout');
      }
    });

    this.child.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      this._log('stderr', text.trim());

      // Parse V8 Inspector URL from stderr when debugging
      if (this.debug && !this.inspectorUrl) {
        const match = text.match(/ws:\/\/[\d.]+:\d+\/[\w-]+/);
        if (match) {
          this.inspectorUrl = match[0];
          this._connectDebugger(this.inspectorUrl);
        }
      }

      if (this.interactive) {
        this._handleInteractiveOutput(text, 'stderr');
      }
    });

    this.child.on('exit', (code, signal) => {
      this.isRunning = false;
      this.exitCode = code;
      this._log('system', `Exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);

      // Clean up debugger connection
      if (this.debugger) {
        this.debugger.disconnect();
        this.debugger = null;
        this.debuggerReady = false;
        this.inspectorUrl = null;
      }

      // Only auto-restart on crash (non-zero exit code), not on signal kills (intentional stop/restart)
      if (this.options.watch && code !== null && code !== 0) {
        setTimeout(() => this.restart(), 1000);
      }
    });

    this.child.on('error', (err) => {
      this._log('error', `Process error: ${err.message}`);
    });

    // Handle IPC messages from injected child process
    if (this.inject) {
      this.child.on('message', (msg) => {
        if (!msg || !msg.reflexive) return;
        this._handleInjectedMessage(msg);
      });
    }

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
    // Check conditional breakpoints (but not for breakpoint-related logs to avoid loops)
    if (!type.includes('breakpoint')) {
      this.checkConditionalBreakpoints(message);
    }
  }

  _handleInjectedMessage(msg) {
    const { type, data, timestamp } = msg;

    switch (type) {
      case 'ready':
        this.injectionReady = true;
        this._log('system', `[inject] Injection ready - pid: ${data.pid}, node: ${data.nodeVersion}`);
        this.emit('injectionReady', data);
        break;

      case 'log':
        // Logs from intercepted console methods
        const level = data.level || 'info';
        this._log(`inject:${level}`, data.message);
        this.emit('injectedLog', { level, message: data.message, meta: data.meta, timestamp });
        break;

      case 'error':
        // Uncaught exceptions and unhandled rejections
        this._log('inject:error', `[${data.type}] ${data.name}: ${data.message}`);
        if (data.stack) {
          this._log('inject:error', data.stack);
        }
        this.emit('injectedError', data);
        break;

      case 'state':
        // State updates from process.reflexive.setState()
        this.injectedState[data.key] = data.value;
        this._log('inject:state', `State: ${data.key} = ${JSON.stringify(data.value)}`);
        this.emit('injectedState', data);
        break;

      case 'stateResponse':
        // Response to getState query
        this.injectedState = { ...this.injectedState, ...data.state };
        this.emit('stateResponse', data.state);
        break;

      case 'event':
        // Custom events from process.reflexive.emit()
        this._log('inject:event', `Event: ${data.event} - ${JSON.stringify(data.data)}`);
        this.emit('injectedEvent', data);
        break;

      case 'span':
        // Tracing spans from process.reflexive.span()
        if (data.phase === 'start') {
          this._log('inject:span', `▶ Span start: ${data.name}`);
        } else {
          const status = data.error ? `✗ error: ${data.error}` : '✓';
          this._log('inject:span', `◀ Span end: ${data.name} (${data.duration}ms) ${status}`);
        }
        this.emit('injectedSpan', data);
        break;

      case 'diagnostic':
        // diagnostics_channel messages
        this._log('inject:diagnostic', `[${data.channel}] ${JSON.stringify(data.request || data)}`);
        this.emit('injectedDiagnostic', data);
        break;

      case 'perf':
        // perf_hooks data (GC, event loop)
        if (data.type === 'gc') {
          this._log('inject:perf', `GC: kind=${data.kind}, duration=${data.duration?.toFixed(2)}ms`);
        } else if (data.type === 'eventLoop') {
          this._log('inject:perf', `Event Loop: mean=${data.mean?.toFixed(2)}ms, p99=${data.p99?.toFixed(2)}ms`);
        }
        this.emit('injectedPerf', data);
        break;

      case 'evalResponse':
        // Response from eval request
        const callback = this.evalCallbacks.get(data.id);
        if (callback) {
          this.evalCallbacks.delete(data.id);
          if (data.success) {
            callback.resolve(data.result);
          } else {
            callback.reject(new Error(data.error));
          }
        }
        if (data.success) {
          this._log('inject:eval', `Eval result: ${JSON.stringify(data.result).slice(0, 200)}`);
        } else {
          this._log('inject:eval', `Eval error: ${data.error}`);
        }
        this.emit('evalResponse', data);
        break;

      case 'globalsResponse':
        this._log('inject:globals', `Globals: ${data.globals.slice(0, 20).join(', ')}...`);
        this.emit('globalsResponse', data);
        break;

      case 'breakpoint':
        // Breakpoint hit or resumed
        if (data.action === 'hit') {
          this.activeBreakpoint = {
            id: data.id,
            label: data.label,
            context: data.context,
            stack: data.stack,
            state: data.state,
            timestamp: timestamp || Date.now()
          };
          this._log('inject:breakpoint', `🔴 BREAKPOINT HIT [${data.label}]`);
          this._log('inject:breakpoint', `Context: ${JSON.stringify(data.context)}`);
          if (data.stack) {
            this._log('inject:breakpoint', `Stack:\n${data.stack}`);
          }
          this.emit('breakpointHit', this.activeBreakpoint);
        } else if (data.action === 'resumed') {
          this._log('inject:breakpoint', `🟢 RESUMED [${data.label}] after ${data.pauseDuration}ms`);
          this.lastBreakpoint = { label: data.label, pauseDuration: data.pauseDuration };
          this.activeBreakpoint = null;
          this.emit('breakpointResumed', data);
        }
        break;

      case 'breakpointError':
        this._log('inject:breakpoint', `Breakpoint error: ${data.error}`);
        break;

      case 'activeBreakpointResponse':
        this.emit('activeBreakpointResponse', data);
        break;

      default:
        this._log('inject:unknown', `Unknown message type: ${type}`);
    }
  }

  evaluate(code, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.inject || !this.options.eval) {
        reject(new Error('Eval not enabled. Run with --eval flag.'));
        return;
      }
      if (!this.child || !this.injectionReady) {
        reject(new Error('Process not ready for eval.'));
        return;
      }

      const id = ++this.evalIdCounter;
      const timeoutHandle = setTimeout(() => {
        this.evalCallbacks.delete(id);
        reject(new Error('Eval timed out'));
      }, timeout);

      this.evalCallbacks.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        }
      });

      try {
        this.child.send({ reflexive: true, type: 'eval', id, code });
      } catch (e) {
        this.evalCallbacks.delete(id);
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to send eval: ${e.message}`));
      }
    });
  }

  queryInjectedState() {
    // Request current state from injected child process
    if (this.inject && this.child && this.injectionReady) {
      try {
        this.child.send({ reflexive: true, type: 'getState' });
      } catch (e) {
        // Child may have disconnected
      }
    }
  }

  getInjectedState() {
    return { ...this.injectedState };
  }

  getActiveBreakpoint() {
    return this.activeBreakpoint;
  }

  resumeBreakpoint(returnValue) {
    if (!this.activeBreakpoint) {
      return false;
    }
    if (this.inject && this.child && this.injectionReady) {
      try {
        this.child.send({ reflexive: true, type: 'resumeBreakpoint', returnValue });
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  triggerBreakpoint(label = 'remote') {
    if (this.inject && this.child && this.injectionReady) {
      try {
        this.child.send({ reflexive: true, type: 'triggerBreakpoint', label });
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  // Conditional breakpoints
  addConditionalBreakpoint(pattern, label, enabled = true) {
    const bp = {
      id: ++this.conditionalBreakpointIdCounter,
      pattern,
      label,
      enabled,
      hitCount: 0,
      createdAt: Date.now()
    };
    this.conditionalBreakpoints.push(bp);
    return bp;
  }

  getConditionalBreakpoints() {
    return [...this.conditionalBreakpoints];
  }

  removeConditionalBreakpoint(id) {
    const idx = this.conditionalBreakpoints.findIndex(bp => bp.id === id);
    if (idx !== -1) {
      this.conditionalBreakpoints.splice(idx, 1);
      return true;
    }
    return false;
  }

  checkConditionalBreakpoints(logMessage) {
    // Don't check if already at a breakpoint
    if (this.activeBreakpoint) return null;

    for (const bp of this.conditionalBreakpoints) {
      if (!bp.enabled) continue;
      if (logMessage.toLowerCase().includes(bp.pattern.toLowerCase())) {
        bp.hitCount++;
        // Trigger the breakpoint
        this.triggerBreakpoint(bp.label);
        return bp;
      }
    }
    return null;
  }

  // V8 Inspector debugging methods
  async _connectDebugger(wsUrl) {
    try {
      this.debugger = new RemoteDebugger();

      // Forward debugger events
      this.debugger.on('paused', (data) => {
        this._log('debug', `Debugger paused: ${data.reason}${data.hitBreakpoints?.length ? ` at ${data.hitBreakpoints.join(', ')}` : ''}`);

        // Check if any hit breakpoint has a prompt to trigger
        if (data.hitBreakpoints && data.hitBreakpoints.length > 0) {
          for (const bpId of data.hitBreakpoints) {
            const bp = this.persistedBreakpoints.find(b => b.id === bpId);
            if (bp && bp.prompt && bp.promptEnabled) {
              bp.hitCount = (bp.hitCount || 0) + 1;
              // Queue the prompt for the dashboard to consume
              this.triggeredBreakpointPrompts.push({
                breakpoint: { ...bp },
                callFrames: data.callFrames,
                timestamp: Date.now()
              });
              const filename = bp.file.split('/').pop();
              this._log('breakpoint-prompt', `🔴 BREAKPOINT PROMPT TRIGGERED: ${filename}:${bp.line}`);
              this._log('breakpoint-prompt', `   Prompt: "${bp.prompt.slice(0, 100)}${bp.prompt.length > 100 ? '...' : ''}"`);
            }
          }
        }

        this.emit('debuggerPaused', data);
      });

      this.debugger.on('resumed', () => {
        this._log('debug', 'Debugger resumed');
        this.emit('debuggerResumed');
      });

      this.debugger.on('disconnected', () => {
        this._log('debug', 'Debugger disconnected');
        this.debuggerReady = false;
        this.emit('debuggerDisconnected');
      });

      await this.debugger.connect(wsUrl);
      await this.debugger.enable();

      this.debuggerReady = true;
      this._log('system', `[debug] V8 Inspector connected: ${wsUrl}`);
      this.emit('debuggerReady', { url: wsUrl });

      // Re-apply persisted breakpoints from previous session
      if (this.persistedBreakpoints && this.persistedBreakpoints.length > 0) {
        this._log('debug', `Restoring ${this.persistedBreakpoints.length} breakpoint(s)`);
        for (const bp of this.persistedBreakpoints) {
          try {
            const result = await this.debugger.setBreakpoint(bp.file, bp.line, bp.condition);
            // Update the ID since new session gives new IDs
            bp.id = result.breakpointId;
            this._log('debug', `Restored breakpoint: ${bp.file}:${bp.line}`);
          } catch (err) {
            this._log('error', `Failed to restore breakpoint ${bp.file}:${bp.line}: ${err.message}`);
          }
        }
      }

      // Auto-resume from initial --inspect-brk pause
      // Use a short delay to allow breakpoints to be restored first
      setTimeout(async () => {
        if (this.debugger) {
          try {
            // With --inspect-brk, process is waiting for debugger
            // runIfWaitingForDebugger starts it, but it immediately pauses on first line
            // So we need to also call resume()
            this._log('debug', 'Starting app (runIfWaitingForDebugger)');
            await this.debugger.runIfWaitingForDebugger();

            // Give it a moment to hit the first-line breakpoint
            await new Promise(r => setTimeout(r, 50));

            // Now resume from the first-line breakpoint
            this._log('debug', 'Resuming from first-line breakpoint');
            await this.debugger.resume();
          } catch (err) {
            this._log('debug', `Start error (non-critical): ${err.message}`);
          }
        }
      }, 200);

    } catch (err) {
      this._log('error', `Failed to connect debugger: ${err.message}`);
      this.debugger = null;
    }
  }

  // Debugger API methods
  async debugSetBreakpoint(file, line, condition) {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    // Resolve to absolute path for consistency
    const absFile = resolve(file);
    const result = await this.debugger.setBreakpoint(absFile, line, condition);
    this._log('debug', `Breakpoint set: ${absFile}:${line}${condition ? ` (${condition})` : ''}`);

    // Persist for restarts (avoid duplicates)
    const existing = this.persistedBreakpoints.find(bp => bp.file === absFile && bp.line === line);
    if (!existing) {
      this.persistedBreakpoints.push({
        file: absFile,
        line,
        condition,
        id: result.breakpointId,
        enabled: true,
        prompt: '',
        promptEnabled: false,
        hitCount: 0
      });
    }

    return result;
  }

  async debugRemoveBreakpoint(breakpointId) {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.removeBreakpoint(breakpointId);
    this._log('debug', `Breakpoint removed: ${breakpointId}`);

    // Remove from persisted list
    this.persistedBreakpoints = this.persistedBreakpoints.filter(bp => bp.id !== breakpointId);
  }

  debugListBreakpoints() {
    if (!this.debugger) {
      return [];
    }
    // Merge debugger breakpoints with persisted data (prompt, etc.)
    const debuggerBps = this.debugger.listBreakpoints();
    return debuggerBps.map(bp => {
      const persisted = this.persistedBreakpoints.find(p => p.id === bp.id);
      return {
        ...bp,
        prompt: persisted?.prompt || '',
        promptEnabled: persisted?.promptEnabled || false,
        enabled: persisted?.enabled !== false,
        hitCount: persisted?.hitCount || 0
      };
    });
  }

  // Get persisted breakpoints (includes those not yet set in debugger)
  getPersistedBreakpoints() {
    return [...this.persistedBreakpoints];
  }

  // Get and clear triggered breakpoint prompts (dashboard consumes these)
  getTriggeredBreakpointPrompts() {
    const prompts = [...this.triggeredBreakpointPrompts];
    this.triggeredBreakpointPrompts = [];
    return prompts;
  }

  // Update breakpoint properties (prompt, enabled states)
  updateBreakpoint(breakpointId, updates) {
    const bp = this.persistedBreakpoints.find(b => b.id === breakpointId);
    if (!bp) {
      return null;
    }

    // Apply updates
    if (updates.prompt !== undefined) bp.prompt = updates.prompt;
    if (updates.promptEnabled !== undefined) bp.promptEnabled = updates.promptEnabled;
    if (updates.enabled !== undefined) bp.enabled = updates.enabled;

    return bp;
  }

  async debugResume() {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.resume();
  }

  async debugPause() {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.pause();
  }

  async debugStepOver() {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.stepOver();
  }

  async debugStepInto() {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.stepInto();
  }

  async debugStepOut() {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    await this.debugger.stepOut();
  }

  async debugEvaluate(expression, callFrameId = null) {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    return await this.debugger.evaluate(expression, callFrameId);
  }

  debugGetCallStack() {
    if (!this.debugger) {
      return null;
    }
    return this.debugger.getCallStack();
  }

  async debugGetScopeVariables(callFrameId, scopeType = 'local') {
    if (!this.debugger || !this.debuggerReady) {
      throw new Error('Debugger not connected');
    }
    return await this.debugger.getScopeVariables(callFrameId, scopeType);
  }

  isDebuggerPaused() {
    return this.debugger?.isPaused() || false;
  }

  isDebuggerConnected() {
    return this.debugger?.isConnected() || false;
  }

  getDebuggerState() {
    return {
      connected: this.isDebuggerConnected(),
      paused: this.isDebuggerPaused(),
      inspectorUrl: this.inspectorUrl,
      breakpoints: this.debugListBreakpoints(),
      callStack: this.debugGetCallStack()
    };
  }

  _handleInteractiveOutput(text, source) {
    this.lastOutputTime = Date.now();
    this.pendingOutput += text;

    // Clear any existing settle timeout
    if (this.outputSettleTimeout) {
      clearTimeout(this.outputSettleTimeout);
    }

    // Check for prompt patterns immediately
    const looksLikePrompt = this.inputPromptPatterns.some(pattern =>
      pattern.test(this.pendingOutput.slice(-100))
    );

    // Set a timeout to detect when output has "settled" (CLI is waiting)
    // Use longer timeouts to give CLI apps time to finish streaming
    this.outputSettleTimeout = setTimeout(() => {
      // Output has settled - CLI is likely waiting for input
      const wasWaiting = this.waitingForInput;
      this.waitingForInput = true;

      if (!wasWaiting) {
        // Emit event with the output that led to this prompt
        this.emit('waitingForInput', {
          output: this.pendingOutput,
          looksLikePrompt,
          timestamp: new Date().toISOString()
        });
      }

      // Reset pending output after emitting
      this.pendingOutput = '';
    }, looksLikePrompt ? 10000 : 10000); // 10 seconds - give streaming chat apps time to finish
  }

  sendInput(text, addNewline = true) {
    if (!this.child || !this.child.stdin) {
      return false;
    }

    this.waitingForInput = false;
    const input = addNewline ? text + '\n' : text;
    this.child.stdin.write(input);
    this._log('stdin', text);
    this.emit('inputSent', { text, timestamp: new Date().toISOString() });
    return true;
  }

  getRecentOutput(lines = 20) {
    const recent = this.logs
      .filter(l => l.type === 'stdout' || l.type === 'stderr')
      .slice(-lines);
    return recent.map(l => l.message).join('\n');
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
      cwd: this.cwd,
      interactive: this.interactive,
      waitingForInput: this.waitingForInput,
      inject: this.inject,
      injectionReady: this.injectionReady,
      injectedState: this.inject ? this.injectedState : undefined,
      debug: this.debug,
      debuggerConnected: this.isDebuggerConnected(),
      debuggerPaused: this.isDebuggerPaused(),
      inspectorUrl: this.inspectorUrl
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
      ),

      tool(
        'get_injected_state',
        'Get state from the injected process (only available with --inject flag). Returns custom state set via process.reflexive.setState()',
        {},
        async () => {
          if (!processManager.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag to enable deep instrumentation.'
              }]
            };
          }
          if (!processManager.injectionReady) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not ready yet. The process may still be starting up.'
              }]
            };
          }
          // Query for latest state
          processManager.queryInjectedState();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                injectionReady: processManager.injectionReady,
                state: processManager.getInjectedState()
              }, null, 2)
            }]
          };
        }
      ),

      tool(
        'get_injection_logs',
        'Get logs specifically from the injection module (console intercepts, errors, performance, diagnostics)',
        {
          count: z.number().optional().describe('Number of log entries (default 50)'),
          category: z.enum(['all', 'log', 'error', 'state', 'span', 'perf', 'diagnostic', 'event']).optional()
            .describe('Filter by injection log category')
        },
        async ({ count, category }) => {
          if (!processManager.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag.'
              }]
            };
          }
          let logs = processManager.getLogs(count || 50);
          // Filter to only injection logs
          logs = logs.filter(l => l.type.startsWith('inject:'));
          if (category && category !== 'all') {
            logs = logs.filter(l => l.type === `inject:${category}`);
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
        'evaluate_in_app',
        'Execute JavaScript code inside the running application. DANGEROUS: Only available with --eval flag. Can inspect variables, call functions, or modify behavior at runtime.',
        {
          code: z.string().describe('JavaScript code to evaluate in the app context'),
          timeout: z.number().optional().describe('Timeout in milliseconds (default 10000)')
        },
        async ({ code, timeout }) => {
          if (!options.eval) {
            return {
              content: [{
                type: 'text',
                text: 'Eval not enabled. Run with --eval flag to enable runtime code evaluation.\n\nWARNING: --eval allows arbitrary code execution in the target app.'
              }]
            };
          }
          if (!processManager.injectionReady) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not ready. The process may still be starting.'
              }]
            };
          }

          try {
            const result = await processManager.evaluate(code, timeout || 10000);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Eval error: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'list_app_globals',
        'List global variables available in the app context. Useful for discovering what can be inspected.',
        {},
        async () => {
          if (!options.eval) {
            return {
              content: [{
                type: 'text',
                text: 'Eval not enabled. Run with --eval flag.'
              }]
            };
          }
          if (!processManager.injectionReady) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not ready.'
              }]
            };
          }

          try {
            // Get common useful globals
            const result = await processManager.evaluate(`
              const globals = {};
              // Check for common app-level vars
              ['app', 'server', 'db', 'config', 'router', 'express', 'http', 'https', 'fs', 'path'].forEach(name => {
                if (typeof global[name] !== 'undefined') globals[name] = typeof global[name];
              });
              // Add any other non-internal globals
              Object.keys(global).forEach(k => {
                if (!k.startsWith('_') && !['global', 'process', 'console', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance', 'fetch'].includes(k)) {
                  globals[k] = typeof global[k];
                }
              });
              globals;
            `);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Error: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'get_active_breakpoint',
        'Check if the app is paused at a breakpoint. Returns breakpoint info including label, context, and stack trace.',
        {},
        async () => {
          if (!options.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag to use breakpoints.'
              }]
            };
          }
          const bp = processManager.getActiveBreakpoint();
          if (bp) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  paused: true,
                  breakpoint: bp
                }, null, 2)
              }]
            };
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ paused: false }, null, 2)
            }]
          };
        }
      ),

      tool(
        'resume_breakpoint',
        'Resume execution from a paused breakpoint. Optionally provide a return value that will be returned from the breakpoint() call.',
        {
          returnValue: z.any().optional().describe('Optional value to return from the breakpoint')
        },
        async ({ returnValue }) => {
          if (!options.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag.'
              }]
            };
          }
          const bp = processManager.getActiveBreakpoint();
          if (!bp) {
            return {
              content: [{
                type: 'text',
                text: 'No active breakpoint to resume.'
              }]
            };
          }
          processManager.resumeBreakpoint(returnValue);
          return {
            content: [{
              type: 'text',
              text: `Resumed from breakpoint [${bp.label}]. Execution continuing.`
            }]
          };
        }
      ),

      tool(
        'trigger_breakpoint',
        'Trigger a breakpoint to pause app execution immediately. The app will pause at the next opportunity and you can then inspect state with get_active_breakpoint. Use resume_breakpoint to continue.',
        {
          label: z.string().optional().describe('Label for this breakpoint (e.g., "debug-login", "inspect-state")')
        },
        async ({ label }) => {
          if (!options.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag to use breakpoints.'
              }]
            };
          }
          if (processManager.getActiveBreakpoint()) {
            return {
              content: [{
                type: 'text',
                text: 'Already paused at a breakpoint. Use resume_breakpoint first.'
              }]
            };
          }
          processManager.triggerBreakpoint(label || 'agent-triggered');
          return {
            content: [{
              type: 'text',
              text: `Breakpoint triggered with label "${label || 'agent-triggered'}". The app will pause at the next opportunity. Use get_active_breakpoint to check status and inspect context.`
            }]
          };
        }
      ),

      tool(
        'set_conditional_breakpoint',
        'Set a breakpoint that triggers when a specific log pattern appears. When the app logs a message matching the pattern, execution will pause automatically. Use list_breakpoints to see active breakpoints.',
        {
          pattern: z.string().describe('Log pattern to match (case-insensitive substring match). E.g., "login failed", "error", "POST /api"'),
          label: z.string().optional().describe('Label for this breakpoint'),
          enabled: z.boolean().optional().describe('Whether the breakpoint is enabled (default true)')
        },
        async ({ pattern, label, enabled = true }) => {
          if (!options.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag to use breakpoints.'
              }]
            };
          }
          const bp = processManager.addConditionalBreakpoint(pattern, label || pattern, enabled);
          return {
            content: [{
              type: 'text',
              text: `Conditional breakpoint set:\n  ID: ${bp.id}\n  Pattern: "${pattern}"\n  Label: "${bp.label}"\n  Enabled: ${bp.enabled}\n\nThe app will pause when a log message matches this pattern.`
            }]
          };
        }
      ),

      tool(
        'list_breakpoints',
        'List all conditional breakpoints that have been set.',
        {},
        async () => {
          if (!options.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag to use breakpoints.'
              }]
            };
          }
          const breakpoints = processManager.getConditionalBreakpoints();
          if (breakpoints.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No conditional breakpoints set. Use set_conditional_breakpoint to add one.'
              }]
            };
          }
          const list = breakpoints.map(bp =>
            `  [${bp.id}] ${bp.enabled ? '●' : '○'} "${bp.pattern}" (${bp.hitCount} hits)`
          ).join('\n');
          return {
            content: [{
              type: 'text',
              text: `Conditional breakpoints:\n${list}`
            }]
          };
        }
      ),

      tool(
        'remove_breakpoint',
        'Remove a conditional breakpoint by ID.',
        {
          id: z.number().describe('Breakpoint ID to remove')
        },
        async ({ id }) => {
          if (!options.inject) {
            return {
              content: [{
                type: 'text',
                text: 'Injection not enabled. Run with --inject flag to use breakpoints.'
              }]
            };
          }
          const removed = processManager.removeConditionalBreakpoint(id);
          if (removed) {
            return {
              content: [{
                type: 'text',
                text: `Breakpoint ${id} removed.`
              }]
            };
          }
          return {
            content: [{
              type: 'text',
              text: `Breakpoint ${id} not found.`
            }]
          };
        }
      ),

      // V8 Inspector debugging tools
      tool(
        'debug_set_breakpoint',
        'Set a real V8 debugger breakpoint at a specific file and line number. Requires --debug flag. The process will pause when this line is executed.',
        {
          file: z.string().describe('Absolute path to the file'),
          line: z.number().describe('Line number (1-based)'),
          condition: z.string().optional().describe('Optional JavaScript condition expression (e.g., "x > 5")')
        },
        async ({ file, line, condition }) => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag to enable V8 Inspector debugging.'
              }]
            };
          }
          if (!processManager.isDebuggerConnected()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger not connected. The process may still be starting.'
              }]
            };
          }

          try {
            const result = await processManager.debugSetBreakpoint(file, line, condition);
            return {
              content: [{
                type: 'text',
                text: `Breakpoint set:\n  ID: ${result.breakpointId}\n  File: ${file}\n  Line: ${line}${condition ? `\n  Condition: ${condition}` : ''}\n\nExecution will pause when this line is reached.`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to set breakpoint: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_remove_breakpoint',
        'Remove a V8 debugger breakpoint by its ID.',
        {
          breakpointId: z.string().describe('The breakpoint ID to remove (from debug_set_breakpoint or debug_list_breakpoints)')
        },
        async ({ breakpointId }) => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          try {
            await processManager.debugRemoveBreakpoint(breakpointId);
            return {
              content: [{
                type: 'text',
                text: `Breakpoint ${breakpointId} removed.`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to remove breakpoint: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_list_breakpoints',
        'List all V8 debugger breakpoints that have been set.',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          const breakpoints = processManager.debugListBreakpoints();
          if (breakpoints.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No debugger breakpoints set. Use debug_set_breakpoint to add one.'
              }]
            };
          }

          const list = breakpoints.map(bp =>
            `  ${bp.id}\n    File: ${bp.file}\n    Line: ${bp.line}${bp.condition ? `\n    Condition: ${bp.condition}` : ''}`
          ).join('\n\n');

          return {
            content: [{
              type: 'text',
              text: `V8 Debugger Breakpoints:\n\n${list}`
            }]
          };
        }
      ),

      tool(
        'debug_resume',
        'Resume execution after the debugger has paused at a breakpoint.',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          if (!processManager.isDebuggerPaused()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger is not paused.'
              }]
            };
          }

          try {
            await processManager.debugResume();
            return {
              content: [{
                type: 'text',
                text: 'Execution resumed.'
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to resume: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_pause',
        'Pause execution immediately. The debugger will stop at the next JavaScript statement.',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          try {
            await processManager.debugPause();
            return {
              content: [{
                type: 'text',
                text: 'Pause requested. Execution will stop at the next JavaScript statement.'
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to pause: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_step_over',
        'Step over the current line of code (execute it and pause at the next line).',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          if (!processManager.isDebuggerPaused()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger is not paused. Cannot step.'
              }]
            };
          }

          try {
            await processManager.debugStepOver();
            return {
              content: [{
                type: 'text',
                text: 'Stepped over. Use debug_get_call_stack to see current position.'
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to step over: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_step_into',
        'Step into a function call (pause at the first line of the called function).',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          if (!processManager.isDebuggerPaused()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger is not paused. Cannot step.'
              }]
            };
          }

          try {
            await processManager.debugStepInto();
            return {
              content: [{
                type: 'text',
                text: 'Stepped into. Use debug_get_call_stack to see current position.'
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to step into: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_step_out',
        'Step out of the current function (continue until the function returns).',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          if (!processManager.isDebuggerPaused()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger is not paused. Cannot step.'
              }]
            };
          }

          try {
            await processManager.debugStepOut();
            return {
              content: [{
                type: 'text',
                text: 'Stepping out. Execution will pause after the current function returns.'
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to step out: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_evaluate',
        'Evaluate a JavaScript expression in the current debug context. When paused, can access local variables.',
        {
          expression: z.string().describe('JavaScript expression to evaluate'),
          callFrameId: z.string().optional().describe('Call frame ID to evaluate in (from debug_get_call_stack). If not provided, evaluates in global scope.')
        },
        async ({ expression, callFrameId }) => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          try {
            const result = await processManager.debugEvaluate(expression, callFrameId);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Evaluation error: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_get_call_stack',
        'Get the current call stack when the debugger is paused. Shows all function calls leading to the current position.',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          if (!processManager.isDebuggerPaused()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger is not paused. No call stack available.'
              }]
            };
          }

          const callStack = processManager.debugGetCallStack();
          if (!callStack || callStack.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No call stack available.'
              }]
            };
          }

          const formatted = callStack.map((frame, i) =>
            `#${i} ${frame.functionName} at ${frame.url}:${frame.lineNumber}:${frame.columnNumber}\n    callFrameId: ${frame.callFrameId}\n    scopes: ${frame.scopeChain.map(s => s.type).join(', ')}`
          ).join('\n\n');

          return {
            content: [{
              type: 'text',
              text: `Call Stack:\n\n${formatted}`
            }]
          };
        }
      ),

      tool(
        'debug_get_scope_variables',
        'Get variables from a specific scope when the debugger is paused.',
        {
          callFrameId: z.string().describe('Call frame ID (from debug_get_call_stack)'),
          scopeType: z.enum(['local', 'closure', 'global', 'with', 'block', 'script', 'catch', 'module']).optional()
            .describe('Type of scope to inspect (default: local)')
        },
        async ({ callFrameId, scopeType = 'local' }) => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          if (!processManager.isDebuggerPaused()) {
            return {
              content: [{
                type: 'text',
                text: 'Debugger is not paused. No scope available.'
              }]
            };
          }

          try {
            const variables = await processManager.debugGetScopeVariables(callFrameId, scopeType);
            if (!variables || variables.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `No ${scopeType} variables found in this scope.`
                }]
              };
            }

            const formatted = variables.map(v =>
              `  ${v.name}: ${v.type}${v.value !== undefined ? ` = ${JSON.stringify(v.value)}` : (v.description ? ` (${v.description})` : '')}`
            ).join('\n');

            return {
              content: [{
                type: 'text',
                text: `${scopeType.charAt(0).toUpperCase() + scopeType.slice(1)} Variables:\n\n${formatted}`
              }]
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Failed to get scope variables: ${err.message}`
              }]
            };
          }
        }
      ),

      tool(
        'debug_get_state',
        'Get the current debugger state including connection status, pause status, and breakpoints.',
        {},
        async () => {
          if (!options.debug) {
            return {
              content: [{
                type: 'text',
                text: 'Debugging not enabled. Run with --debug flag.'
              }]
            };
          }

          const state = processManager.getDebuggerState();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(state, null, 2)
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

  const interactiveSection = options.interactive ? `
## Interactive Mode ENABLED

This is an interactive CLI application. The process communicates via stdin/stdout.

**CRITICAL: Two types of requests you'll receive:**

1. **AUTO_RESPOND_TO_CLI requests** - When the message starts with "AUTO_RESPOND_TO_CLI":
   - The user wants you to DIRECTLY respond to the CLI
   - You MUST use the \`send_input\` tool to send your response
   - Look at the recent CLI output to understand what it's asking
   - Formulate an appropriate response and send it immediately
   - Be conversational and natural - you're talking to another AI/CLI
   - Do NOT ask the user what to say - just respond intelligently

2. **Normal user questions** - Any other message:
   - The user is asking YOU a question
   - Respond to the USER, not the CLI
   - Help them understand what's happening, suggest responses, explain things
   - Only use \`send_input\` if they explicitly ask you to send something to the CLI

**The \`send_input\` tool** sends text directly to the CLI's stdin. The CLI will receive your text as if the user typed it.
` : '';

  return `# Reflexive CLI Agent

You are an AI assistant monitoring and controlling a Node.js process from the outside.

## Target Process
- Entry: ${state.entry}
- Working Directory: ${state.cwd}
- Status: ${state.isRunning ? 'Running' : 'Stopped'}
- PID: ${state.pid || 'N/A'}
- Uptime: ${state.uptime}s
- Restarts: ${state.restartCount}
${options.interactive ? `- Mode: INTERACTIVE (stdin/stdout proxied)` : ''}
${options.inject ? `- Mode: INJECTED (deep instrumentation active)` : ''}
${state.waitingForInput ? `- ⚠️ CLI IS WAITING FOR INPUT` : ''}

## Your Capabilities
- Read files: YES
- Write files: ${options.capabilities.writeFiles ? 'YES' : 'NO'}
- Shell access: ${options.capabilities.shellAccess ? 'YES' : 'NO'}
- Restart process: ${options.capabilities.restart ? 'YES' : 'NO'}
- Injection: ${options.inject ? 'ENABLED' : 'NO'}
- V8 Debugging: ${options.debug ? 'ENABLED' : 'NO'}
${options.debug && state.debuggerConnected ? `- Debugger: ${state.debuggerPaused ? 'PAUSED' : 'Connected'}` : ''}
${interactiveSection}
## CLI-Specific Tools
In addition to file tools, you have:
- \`get_process_state\` - Get process status, PID, uptime
- \`get_output_logs\` - View stdout/stderr from the process
- \`search_logs\` - Search through output logs
- \`restart_process\` - Restart the process
- \`stop_process\` / \`start_process\` - Control process lifecycle
- \`send_input\` - Send text to the process stdin${options.interactive ? ' (USE THIS to respond to the CLI)' : ''}
${options.inject ? `- \`get_injected_state\` - Get custom state from process.reflexive.setState()
- \`get_injection_logs\` - Get logs from injection module (console, errors, perf, spans)` : ''}
${options.eval ? `- \`evaluate_in_app\` - Execute JavaScript in the app (inspect vars, call functions, modify behavior)
- \`list_app_globals\` - List available global variables in the app` : ''}
${options.debug ? `
## V8 Inspector Debugging Tools
You have access to REAL debugger capabilities via the V8 Inspector:
- \`debug_set_breakpoint\` - Set a breakpoint at a specific file:line
- \`debug_remove_breakpoint\` - Remove a breakpoint by ID
- \`debug_list_breakpoints\` - List all breakpoints
- \`debug_resume\` - Resume execution after hitting a breakpoint
- \`debug_pause\` - Pause execution immediately
- \`debug_step_over\` / \`debug_step_into\` / \`debug_step_out\` - Step through code
- \`debug_evaluate\` - Evaluate expression in current debug context (can access local variables when paused)
- \`debug_get_call_stack\` - Get the call stack when paused
- \`debug_get_scope_variables\` - Inspect local/closure/global variables when paused
- \`debug_get_state\` - Get debugger connection and pause status` : ''}

## Guidelines
1. Use get_output_logs to see what the process is doing
2. Read source files to understand the code
3. If there are errors in the logs, analyze them and suggest fixes
4. You can restart the process after making file changes
5. Be direct and helpful - the developer trusts you
${options.debug ? `6. Use debugging tools to set breakpoints and inspect runtime state when investigating issues` : ''}
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
    interactive: false,
    inject: false,
    eval: false,
    debug: false,
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
    } else if (arg === '--interactive' || arg === '-i') {
      options.interactive = true;
    } else if (arg === '--inject') {
      options.inject = true;
    } else if (arg === '--eval') {
      options.eval = true;
      options.inject = true; // --eval implies --inject
    } else if (arg === '--debug' || arg === '-d') {
      options.debug = true;
    } else if (arg === '--capabilities' || arg === '-c') {
      const caps = args[++i].split(',');
      for (const cap of caps) {
        options.capabilities[cap.trim()] = true;
      }
    } else if (arg === '--write') {
      options.capabilities.writeFiles = true;
    } else if (arg === '--shell') {
      options.capabilities.shellAccess = true;
    } else if (arg === '--dangerously-skip-permissions') {
      options.capabilities.readFiles = true;
      options.capabilities.writeFiles = true;
      options.capabilities.shellAccess = true;
      options.capabilities.networkAccess = true;
      options.capabilities.restart = true;
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

function printHelp() {
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
  networkAccess  Web search/fetch

EXAMPLES:
  reflexive                                    # Auto-detect from package.json
  reflexive ./index.js
  reflexive --port 4000 --watch ./server.js
  reflexive --write --shell ./script.js
  reflexive --debug ./server.js                # Enable V8 Inspector debugging
  reflexive --dangerously-skip-permissions     # All capabilities, auto-detect entry
  reflexive ./server.js -- --port 8080

The agent can:
  - See stdout/stderr from your app
  - View process memory, CPU, uptime
  - Read your source files
  - Query logs (if you use console.log)
  - Restart your app
  - Modify files (if --write enabled)
  - Run commands (if --shell enabled)
  - Set real breakpoints at specific lines (if --debug enabled)
  - Step through code and inspect variables (if --debug enabled)
`);
}

async function resolveEntryFromPackageJson(options) {
  const pkgPath = resolve(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }

  const scripts = pkg.scripts || {};
  const scriptNames = Object.keys(scripts);

  if (scriptNames.length === 0) {
    return null;
  }

  let selectedScript;

  // If only 'start' script exists, use it automatically
  if (scriptNames.length === 1 && scriptNames[0] === 'start') {
    selectedScript = 'start';
    console.log(`Found package.json with start script, running: ${scripts.start}\n`);
  } else {
    // Let user select from available scripts
    console.log('Found package.json with scripts:\n');
    scriptNames.forEach((name, i) => {
      console.log(`  ${i + 1}) ${name}: ${scripts[name]}`);
    });
    console.log();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('Select script number (or press Enter for "start"): ', resolve);
    });
    rl.close();

    if (answer.trim() === '') {
      if (scripts.start) {
        selectedScript = 'start';
      } else {
        console.error('No "start" script found.');
        return null;
      }
    } else {
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < scriptNames.length) {
        selectedScript = scriptNames[idx];
      } else {
        console.error('Invalid selection.');
        return null;
      }
    }
  }

  const scriptCmd = scripts[selectedScript];

  // Parse the script command to extract the entry file and args
  // Handle: "node app.js", "node ./src/index.js --port 3000", etc.
  const parts = scriptCmd.split(/\s+/);
  let entryFile = null;
  let scriptArgs = [];
  let foundEntry = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Skip 'node', 'nodejs', or node flags
    if (part === 'node' || part === 'nodejs') continue;
    if (part.startsWith('-') && !foundEntry) continue;

    if (!foundEntry && (part.endsWith('.js') || part.endsWith('.mjs') || part.endsWith('.cjs'))) {
      entryFile = part;
      foundEntry = true;
      // Enable inject for .js files
      options.inject = true;
    } else if (foundEntry) {
      scriptArgs.push(part);
    }
  }

  if (!entryFile) {
    // Try to find any file that might be an entry point
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part !== 'node' && part !== 'nodejs' && !part.startsWith('-') && existsSync(resolve(process.cwd(), part))) {
        entryFile = part;
        scriptArgs = parts.slice(i + 1);
        break;
      }
    }
  }

  if (entryFile) {
    options.appArgs = [...scriptArgs, ...options.appArgs];
    console.log(`Running: ${entryFile} ${options.appArgs.join(' ')}\n`);
    return entryFile;
  }

  return null;
}

async function startCliDashboard(processManager, options) {
  const mcpServer = createCliMcpServer(processManager, options);

  // Store conversation session ID for continuity
  let conversationSessionId = null;

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
          title: '⚡ Reflexive CLI',
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
        const contextSummary = `Process: ${state.isRunning ? 'running' : 'stopped'}, PID: ${state.pid}, uptime: ${state.uptime}s${state.waitingForInput ? ', ⚠️ WAITING FOR INPUT' : ''}${recentOutput}`;

        const chatStream = createChatStream(message, {
          contextSummary,
          systemPrompt: buildSystemPrompt(processManager, options),
          mcpServer,
          mcpServerName: 'reflexive-cli',
          sessionId: conversationSessionId,  // Pass existing session for continuity
          queryOptions: {
            cwd: processManager.cwd,
            allowedTools: getAllowedTools(options.capabilities)
          }
        });

        // Custom SSE handler that also captures session ID
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
          res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
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

      // Allow dashboard to log messages (for breakpoint prompt responses, etc.)
      if (pathname === '/log' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const { type, message } = JSON.parse(body);
          processManager._log(type || 'dashboard', message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
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

      // Breakpoint controls (only when inject is enabled)
      if (pathname === '/break' && req.method === 'POST') {
        if (options.inject && processManager.injectionReady) {
          processManager.triggerBreakpoint();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Injection not enabled or not ready' }));
        }
        return;
      }

      if (pathname === '/resume' && req.method === 'POST') {
        if (options.inject && processManager.getActiveBreakpoint()) {
          processManager.resumeBreakpoint();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No active breakpoint' }));
        }
        return;
      }

      if (pathname === '/breakpoint-status') {
        const bp = processManager.getActiveBreakpoint();
        const lastBp = processManager.lastBreakpoint;
        const conditionalBps = processManager.getConditionalBreakpoints();
        // Clear lastBreakpoint after reading so we only get it once
        processManager.lastBreakpoint = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          paused: !!bp,
          breakpoint: bp || null,
          lastBreakpoint: lastBp || null,
          conditionalBreakpoints: conditionalBps
        }));
        return;
      }

      // Toggle conditional breakpoint enabled state
      if (pathname.startsWith('/breakpoint/') && req.method === 'POST') {
        const id = parseInt(pathname.split('/')[2]);
        const bps = processManager.getConditionalBreakpoints();
        const bp = bps.find(b => b.id === id);
        if (bp) {
          bp.enabled = !bp.enabled;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, enabled: bp.enabled }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Breakpoint not found' }));
        }
        return;
      }

      // Delete conditional breakpoint
      if (pathname.startsWith('/breakpoint/') && req.method === 'DELETE') {
        const id = parseInt(pathname.split('/')[2]);
        const removed = processManager.removeConditionalBreakpoint(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: removed }));
        return;
      }

      // V8 Inspector debugging endpoints (only when --debug is enabled)
      if (pathname === '/debugger-status') {
        if (!options.debug) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ enabled: false }));
          return;
        }
        const state = processManager.getDebuggerState();
        const triggeredPrompts = processManager.getTriggeredBreakpointPrompts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: true, ...state, triggeredPrompts }));
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
          res.end(JSON.stringify({ error: err.message }));
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
          res.end(JSON.stringify({ error: err.message }));
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
          res.end(JSON.stringify({ error: err.message }));
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
          res.end(JSON.stringify({ error: err.message }));
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
          res.end(JSON.stringify({ error: err.message }));
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

      // Create a new breakpoint (for restoring from localStorage)
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
            processManager.updateBreakpoint(bp.id, { prompt, promptEnabled });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, breakpoint: bp }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
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
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // Update breakpoint properties (prompt, enabled states)
      if (pathname.startsWith('/debugger-breakpoint/') && req.method === 'PATCH') {
        if (!options.debug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Debug mode not enabled' }));
          return;
        }
        const breakpointId = decodeURIComponent(pathname.slice('/debugger-breakpoint/'.length));
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
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
            res.end(JSON.stringify({ error: err.message }));
          }
        });
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
    // Try to resolve from package.json
    const resolved = await resolveEntryFromPackageJson(options);
    if (resolved) {
      options.entry = resolved;
      options.open = true; // Auto-open dashboard when no explicit entry
    } else {
      console.error('Error: No entry file specified and no package.json scripts found\n');
      printHelp();
      process.exit(1);
    }
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
    spawn(cmd, [url], { shell: true, detached: true });
  }

  processManager.start();

  // Ignore SIGHUP so process survives terminal closing
  process.on('SIGHUP', () => {});

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

// Run CLI if executed directly (handle symlinks by resolving real paths)
const scriptPath = fileURLToPath(import.meta.url);
const argPath = process.argv[1];
const isMainModule = realpathSync(scriptPath) === realpathSync(argPath);
if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
