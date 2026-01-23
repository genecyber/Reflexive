/**
 * Reflexive Injection Module
 *
 * This module is injected into child processes via --require
 * It provides deep instrumentation without the app needing to import reflexive.
 *
 * Usage: node --require reflexive/inject ./app.js
 * Or via CLI: reflexive --inject ./app.js
 */

// Only run if we're in a child process spawned by reflexive
if (!process.send || !process.env.REFLEXIVE_INJECT) {
  // Not running under reflexive, silently no-op
  module.exports = {};
  return;
}

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

// Send message to parent reflexive process
function sendToParent(type, data) {
  try {
    process.send({ reflexive: true, type, data, timestamp: Date.now() });
  } catch (e) {
    // Parent may have disconnected
  }
}

// Intercept console methods
function interceptConsole() {
  console.log = (...args) => {
    sendToParent('log', { level: 'info', message: args.map(String).join(' ') });
    originalConsole.log(...args);
  };

  console.info = (...args) => {
    sendToParent('log', { level: 'info', message: args.map(String).join(' ') });
    originalConsole.info(...args);
  };

  console.warn = (...args) => {
    sendToParent('log', { level: 'warn', message: args.map(String).join(' ') });
    originalConsole.warn(...args);
  };

  console.error = (...args) => {
    sendToParent('log', { level: 'error', message: args.map(String).join(' ') });
    originalConsole.error(...args);
  };

  console.debug = (...args) => {
    sendToParent('log', { level: 'debug', message: args.map(String).join(' ') });
    originalConsole.debug(...args);
  };
}

// Capture uncaught exceptions and rejections
function interceptErrors() {
  process.on('uncaughtException', (err) => {
    sendToParent('error', {
      type: 'uncaughtException',
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    // Print error and exit gracefully instead of re-throwing
    // (re-throwing adds inject.cjs to the stack trace which is confusing)
    originalConsole.error('\n' + err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    sendToParent('error', {
      type: 'unhandledRejection',
      message: reason?.message || String(reason),
      stack: reason?.stack,
      name: reason?.name
    });
  });
}

// Set up diagnostics_channel subscriptions if available
function setupDiagnostics() {
  let dc;
  try {
    dc = require('diagnostics_channel');
  } catch (e) {
    return; // Not available in this Node version
  }

  // HTTP client requests
  const httpClientStart = dc.channel('http.client.request.start');
  if (httpClientStart.hasSubscribers !== false) {
    httpClientStart.subscribe((message) => {
      sendToParent('diagnostic', {
        channel: 'http.client.request.start',
        request: {
          method: message.request?.method,
          host: message.request?.host,
          path: message.request?.path
        }
      });
    });
  }

  // HTTP server requests
  const httpServerStart = dc.channel('http.server.request.start');
  if (httpServerStart.hasSubscribers !== false) {
    httpServerStart.subscribe((message) => {
      sendToParent('diagnostic', {
        channel: 'http.server.request.start',
        request: {
          method: message.request?.method,
          url: message.request?.url
        }
      });
    });
  }
}

// Set up perf_hooks for GC and event loop stats
function setupPerfHooks() {
  let perf;
  try {
    perf = require('perf_hooks');
  } catch (e) {
    return;
  }

  // GC stats
  const obs = new perf.PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'gc') {
        sendToParent('perf', {
          type: 'gc',
          kind: entry.detail?.kind,
          duration: entry.duration,
          flags: entry.detail?.flags
        });
      }
    }
  });

  try {
    obs.observe({ entryTypes: ['gc'] });
  } catch (e) {
    // GC observation might not be available
  }

  // Event loop utilization (periodic)
  if (perf.monitorEventLoopDelay) {
    const h = perf.monitorEventLoopDelay({ resolution: 20 });
    h.enable();

    setInterval(() => {
      sendToParent('perf', {
        type: 'eventLoop',
        min: h.min,
        max: h.max,
        mean: h.mean,
        stddev: h.stddev,
        p50: h.percentile(50),
        p99: h.percentile(99)
      });
      h.reset();
    }, 10000).unref(); // Don't keep process alive
  }
}

// Breakpoint management
const breakpoints = new Map();
let breakpointIdCounter = 0;
let activeBreakpoint = null;
let breakpointResolve = null;

// Create process.reflexive API
function createReflexiveAPI() {
  const state = {};

  process.reflexive = {
    // Set custom state that the agent can query
    setState(key, value) {
      state[key] = value;
      sendToParent('state', { key, value });
    },

    // Get current state
    getState(key) {
      return key ? state[key] : { ...state };
    },

    // Log with custom level
    log(level, message, meta = {}) {
      sendToParent('log', { level, message, meta });
    },

    // Emit custom event
    emit(event, data) {
      sendToParent('event', { event, data });
    },

    // Set a breakpoint that pauses execution until resumed by the agent
    async breakpoint(label = 'breakpoint', context = {}) {
      const id = ++breakpointIdCounter;
      const stack = new Error().stack.split('\n').slice(2).join('\n');

      activeBreakpoint = { id, label, context, stack, timestamp: Date.now() };

      sendToParent('breakpoint', {
        action: 'hit',
        id,
        label,
        context: serializeResult(context),
        stack,
        state: process.reflexive.getState()
      });

      originalConsole.log(`\n🔴 BREAKPOINT [${label}] - Execution paused. Waiting for agent to resume...\n`);

      // Wait for resume signal from parent
      return new Promise((resolve) => {
        breakpointResolve = resolve;
      });
    },

    // List all breakpoints (for programmatic use)
    getBreakpoints() {
      return Array.from(breakpoints.values());
    },

    // Mark a span for tracing
    span(name, fn) {
      const start = Date.now();
      sendToParent('span', { name, phase: 'start', timestamp: start });

      const finish = (error) => {
        const end = Date.now();
        sendToParent('span', {
          name,
          phase: 'end',
          timestamp: end,
          duration: end - start,
          error: error?.message
        });
      };

      if (fn.constructor.name === 'AsyncFunction') {
        return fn().then(
          (result) => { finish(); return result; },
          (error) => { finish(error); throw error; }
        );
      } else {
        try {
          const result = fn();
          finish();
          return result;
        } catch (error) {
          finish(error);
          throw error;
        }
      }
    }
  };
}

// Handle messages from parent
function setupParentMessageHandler() {
  process.on('message', (msg) => {
    if (!msg || !msg.reflexive) return;

    switch (msg.type) {
      case 'getState':
        sendToParent('stateResponse', { state: process.reflexive.getState() });
        break;

      case 'eval':
        // Execute code in the app context
        // DANGEROUS: Only enabled with explicit --eval flag
        if (!process.env.REFLEXIVE_EVAL) {
          sendToParent('evalResponse', {
            id: msg.id,
            error: 'Eval not enabled. Run with --eval flag.',
            success: false
          });
          return;
        }

        try {
          // Use indirect eval to run in global scope
          const evalInGlobal = eval;
          const result = evalInGlobal(msg.code);

          // Handle promises
          if (result && typeof result.then === 'function') {
            result
              .then((resolved) => {
                sendToParent('evalResponse', {
                  id: msg.id,
                  result: serializeResult(resolved),
                  success: true
                });
              })
              .catch((err) => {
                sendToParent('evalResponse', {
                  id: msg.id,
                  error: err.message,
                  stack: err.stack,
                  success: false
                });
              });
          } else {
            sendToParent('evalResponse', {
              id: msg.id,
              result: serializeResult(result),
              success: true
            });
          }
        } catch (err) {
          sendToParent('evalResponse', {
            id: msg.id,
            error: err.message,
            stack: err.stack,
            success: false
          });
        }
        break;

      case 'getGlobals':
        // List available global variables
        const globals = Object.keys(global).filter(k => !k.startsWith('_'));
        sendToParent('globalsResponse', { globals });
        break;

      case 'resumeBreakpoint':
        // Resume from a breakpoint
        if (activeBreakpoint && breakpointResolve) {
          const bp = activeBreakpoint;
          originalConsole.log(`\n🟢 RESUMED [${bp.label}] - Continuing execution...\n`);
          sendToParent('breakpoint', {
            action: 'resumed',
            id: bp.id,
            label: bp.label,
            pauseDuration: Date.now() - bp.timestamp
          });
          activeBreakpoint = null;
          breakpointResolve(msg.returnValue);
          breakpointResolve = null;
        } else {
          sendToParent('breakpointError', { error: 'No active breakpoint to resume' });
        }
        break;

      case 'getActiveBreakpoint':
        // Get info about current breakpoint
        if (activeBreakpoint) {
          sendToParent('activeBreakpointResponse', {
            active: true,
            breakpoint: {
              id: activeBreakpoint.id,
              label: activeBreakpoint.label,
              context: serializeResult(activeBreakpoint.context),
              stack: activeBreakpoint.stack,
              pausedFor: Date.now() - activeBreakpoint.timestamp
            }
          });
        } else {
          sendToParent('activeBreakpointResponse', { active: false });
        }
        break;

      case 'triggerBreakpoint':
        // Remotely triggered breakpoint from dashboard
        if (!activeBreakpoint) {
          // Trigger breakpoint asynchronously so it doesn't block the message handler
          setImmediate(async () => {
            await process.reflexive.breakpoint(msg.label || 'remote', {
              triggeredRemotely: true,
              timestamp: new Date().toISOString()
            });
          });
        } else {
          sendToParent('breakpointError', { error: 'Already at a breakpoint' });
        }
        break;
    }
  });
}

// Serialize result for IPC (handle circular refs, functions, etc.)
function serializeResult(value, depth = 0) {
  if (depth > 3) return '[Max depth reached]';

  if (value === undefined) return 'undefined';
  if (value === null) return null;
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return value.toString() + 'n';

  if (value instanceof Error) {
    return { __type: 'Error', name: value.name, message: value.message, stack: value.stack };
  }

  if (value instanceof Map) {
    return { __type: 'Map', entries: Array.from(value.entries()).slice(0, 20) };
  }

  if (value instanceof Set) {
    return { __type: 'Set', values: Array.from(value.values()).slice(0, 20) };
  }

  if (Buffer.isBuffer(value)) {
    return { __type: 'Buffer', length: value.length, preview: value.slice(0, 50).toString('hex') };
  }

  if (Array.isArray(value)) {
    if (value.length > 100) {
      return { __type: 'Array', length: value.length, preview: value.slice(0, 20).map(v => serializeResult(v, depth + 1)) };
    }
    return value.map(v => serializeResult(v, depth + 1));
  }

  if (typeof value === 'object') {
    try {
      const keys = Object.keys(value);
      if (keys.length > 50) {
        const preview = {};
        keys.slice(0, 20).forEach(k => { preview[k] = serializeResult(value[k], depth + 1); });
        return { __type: 'Object', keyCount: keys.length, preview };
      }
      const result = {};
      keys.forEach(k => { result[k] = serializeResult(value[k], depth + 1); });
      return result;
    } catch (e) {
      return `[Object: ${value.constructor?.name || 'unknown'}]`;
    }
  }

  return value;
}

// Initialize everything
function init() {
  createReflexiveAPI();
  interceptConsole();
  interceptErrors();
  setupDiagnostics();
  setupPerfHooks();
  setupParentMessageHandler();

  // Notify parent that injection is complete
  sendToParent('ready', {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform
  });
}

init();

module.exports = {
  // Export for programmatic use if someone imports this directly
  setState: (key, value) => process.reflexive?.setState(key, value),
  getState: (key) => process.reflexive?.getState(key),
  log: (level, message, meta) => process.reflexive?.log(level, message, meta),
  emit: (event, data) => process.reflexive?.emit(event, data),
  span: (name, fn) => process.reflexive?.span(name, fn),
  breakpoint: (label, context) => process.reflexive?.breakpoint(label, context)
};
