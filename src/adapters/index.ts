/**
 * Debug Adapter exports
 *
 * This module provides adapters for different debug protocols:
 * - V8InspectorAdapter: For Node.js debugging via Chrome DevTools Protocol
 * - DAPAdapter: For DAP-compliant debuggers (Python, Go, .NET, Rust, etc.)
 */

export { V8InspectorAdapter } from './v8-inspector-adapter.js';
export { DAPAdapter } from './dap-adapter.js';

// Re-export types
export type {
  DebugAdapter,
  DebugConnectionOptions,
  BreakpointResult,
  BreakpointInfo,
  StackFrame,
  Scope,
  Variable,
  EvaluateResult,
  Thread,
  PausedEventData,
  DebugAdapterEvents,
  LanguageRuntime,
  RuntimeRegistry,
} from '../types/debug.js';
