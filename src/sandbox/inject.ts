/**
 * Sandbox Inject Script
 *
 * This script runs inside the Vercel Sandbox and provides:
 * - Console log interception (console.log/error/warn)
 * - process.reflexive API for setting state
 * - Writes all logs/state to /tmp/reflexive-logs.jsonl
 *
 * The SandboxManager polls this file to get logs and state.
 */

// Path to log file that SandboxManager will poll
const LOG_FILE_PATH = '/tmp/reflexive-logs.jsonl';

// Import fs for writing logs
import * as fs from 'fs';

// Track custom state
const customState: Record<string, unknown> = {};

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

/**
 * Write a log entry to the log file
 */
function writeLogEntry(entry: { type: string; data: Record<string, unknown>; ts: number }): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LOG_FILE_PATH, line);
  } catch {
    // Ignore write errors silently
  }
}

/**
 * Log a message with a given level
 */
function log(level: string, message: string, meta?: Record<string, unknown>): void {
  writeLogEntry({
    type: 'log',
    data: { level, message, ...meta },
    ts: Date.now(),
  });
}

/**
 * Intercept console methods to capture logs
 */
function interceptConsole(): void {
  console.log = (...args: unknown[]) => {
    log('info', args.map(String).join(' '));
    originalConsole.log(...args);
  };

  console.info = (...args: unknown[]) => {
    log('info', args.map(String).join(' '));
    originalConsole.info(...args);
  };

  console.warn = (...args: unknown[]) => {
    log('warn', args.map(String).join(' '));
    originalConsole.warn(...args);
  };

  console.error = (...args: unknown[]) => {
    log('error', args.map(String).join(' '));
    originalConsole.error(...args);
  };

  console.debug = (...args: unknown[]) => {
    log('debug', args.map(String).join(' '));
    originalConsole.debug(...args);
  };
}

/**
 * Capture uncaught exceptions and rejections
 */
function interceptErrors(): void {
  process.on('uncaughtException', (err: Error) => {
    writeLogEntry({
      type: 'error',
      data: {
        errorType: 'uncaughtException',
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      ts: Date.now(),
    });
    // Print and exit
    originalConsole.error('\n' + err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason as Error;
    writeLogEntry({
      type: 'error',
      data: {
        errorType: 'unhandledRejection',
        name: err?.name,
        message: err?.message || String(reason),
        stack: err?.stack,
      },
      ts: Date.now(),
    });
  });
}

/**
 * Create the process.reflexive API
 */
function createReflexiveAPI(): void {
  // Extend process with reflexive property
  (process as NodeJS.Process & { reflexive: typeof reflexiveAPI }).reflexive = reflexiveAPI;
}

const reflexiveAPI = {
  /**
   * Set custom state that can be queried by the agent
   */
  setState(key: string, value: unknown): void {
    customState[key] = value;
    writeLogEntry({
      type: 'state',
      data: { key, value },
      ts: Date.now(),
    });
  },

  /**
   * Get current state
   */
  getState(key?: string): unknown {
    return key ? customState[key] : { ...customState };
  },

  /**
   * Log with custom level
   */
  log(level: string, message: string, meta?: Record<string, unknown>): void {
    log(level, message, meta);
  },

  /**
   * Emit a custom event
   */
  emit(event: string, data: unknown): void {
    writeLogEntry({
      type: 'event',
      data: { event, payload: data },
      ts: Date.now(),
    });
  },
};

/**
 * Initialize the inject script
 */
function init(): void {
  // Clear log file on start
  try {
    fs.writeFileSync(LOG_FILE_PATH, '');
  } catch {
    // Ignore errors if we can't write
  }

  createReflexiveAPI();
  interceptConsole();
  interceptErrors();

  // Write ready message
  writeLogEntry({
    type: 'ready',
    data: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
    },
    ts: Date.now(),
  });
}

// Run initialization
init();

// Export for testing
export { LOG_FILE_PATH, reflexiveAPI, writeLogEntry, log };
