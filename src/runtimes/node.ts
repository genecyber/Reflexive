/**
 * Node.js Runtime Configuration
 *
 * Uses V8 Inspector Protocol for native debugging support.
 * This is the default runtime for .js, .mjs, .cjs, and .ts files.
 */

import type { LanguageRuntime, DebugConnectionOptions } from '../types/debug.js';
import { V8InspectorAdapter } from '../adapters/v8-inspector-adapter.js';

export const nodeRuntime: LanguageRuntime = {
  name: 'node',
  displayName: 'Node.js',
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
  command: process.execPath, // Use current Node.js executable
  defaultPort: 9229,
  protocol: 'v8-inspector',

  buildArgs(port: number, entryFile: string, args?: string[]): string[] {
    // Use --inspect-brk to pause on first line, allowing us to set breakpoints
    // Port 0 means random available port, but we use specific port for predictability
    return [`--inspect-brk=${port}`, entryFile, ...(args || [])];
  },

  buildEnv(_port: number): Record<string, string> {
    return {
      // Force color output
      FORCE_COLOR: '1',
    };
  },

  parseDebugReady(output: string, _port: number): DebugConnectionOptions | null {
    // V8 Inspector outputs: "Debugger listening on ws://127.0.0.1:9229/uuid"
    const match = output.match(/ws:\/\/([\d.]+):(\d+)\/([\w-]+)/);
    if (match) {
      return {
        wsUrl: `ws://${match[1]}:${match[2]}/${match[3]}`,
      };
    }
    return null;
  },

  createAdapter() {
    return new V8InspectorAdapter();
  },

  async validateSetup() {
    // Node.js is always available since we're running in it
    return { valid: true };
  },
};
