/**
 * CLI mode MCP tools for Reflexive
 *
 * These tools are exposed to the AI agent when running in CLI mode,
 * providing control over the child process, logs, and debugging capabilities.
 */

import { z } from 'zod';
import type { ProcessManager } from '../managers/process-manager.js';
import type { Capabilities } from '../types/index.js';
import { createTool, textResult, jsonResult, errorResult, combineTools, type AnyToolDefinition } from './tools.js';

export interface CliToolsOptions {
  processManager: ProcessManager;
  capabilities: Capabilities;
  inject?: boolean;
  eval?: boolean;
  debug?: boolean;
}

/**
 * Create MCP tools for CLI mode
 */
export function createCliTools(options: CliToolsOptions): AnyToolDefinition[] {
  const { processManager, capabilities, inject, eval: evalEnabled, debug } = options;

  const tools: AnyToolDefinition[] = [
    createTool(
      'get_process_state',
      'Get the state of the running process: pid, uptime, restart count, exit code',
      {},
      async () => jsonResult(processManager.getState())
    ),

    createTool(
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
        return jsonResult(logs);
      }
    ),

    createTool(
      'restart_process',
      'Restart the running process',
      {},
      async () => {
        if (!capabilities.restart) {
          return textResult('Restart capability not enabled. Run with --capabilities restart');
        }
        await processManager.restart();
        return textResult('Process restarted successfully');
      }
    ),

    createTool(
      'stop_process',
      'Stop the running process',
      {},
      async () => {
        await processManager.stop();
        return textResult('Process stopped');
      }
    ),

    createTool(
      'start_process',
      'Start the process if it is stopped',
      {},
      async () => {
        if (processManager.isRunning()) {
          return textResult('Process is already running');
        }
        processManager.start();
        return textResult('Process started');
      }
    ),

    createTool(
      'send_input',
      'Send input to the process stdin',
      {
        input: z.string().describe('Text to send to stdin')
      },
      async ({ input }) => {
        processManager.send(input);
        return textResult(`Sent to stdin: ${input}`);
      }
    ),

    createTool(
      'search_logs',
      'Search through process output logs',
      {
        query: z.string().describe('Search term'),
        type: z.enum(['stdout', 'stderr', 'all']).optional()
      },
      async ({ query, type }) => {
        let logs = processManager.searchLogs(query);
        if (type && type !== 'all') {
          logs = logs.filter(l => l.type === type);
        }
        return jsonResult(logs.slice(-20));
      }
    )
  ];

  // Injection-related tools (only when --inject flag is set)
  if (inject) {
    tools.push(
      createTool(
        'get_injected_state',
        'Get state from the injected process (only available with --inject flag). Returns custom state set via process.reflexive.setState()',
        {},
        async () => {
          if (!processManager.getState().injectionReady) {
            return textResult('Injection not ready yet. The process may still be starting up.');
          }
          // Query for latest state
          processManager.queryInjectedState();
          return jsonResult({
            injectionReady: processManager.getState().injectionReady,
            state: processManager.getInjectedState()
          });
        }
      ),

      createTool(
        'get_injection_logs',
        'Get logs specifically from the injection module (console intercepts, errors, performance, diagnostics)',
        {
          count: z.number().optional().describe('Number of log entries (default 50)'),
          category: z.enum(['all', 'log', 'error', 'state', 'span', 'perf', 'diagnostic', 'event']).optional()
            .describe('Filter by injection log category')
        },
        async ({ count, category }) => {
          let logs = processManager.getLogs(count || 50);
          // Filter to only injection logs
          logs = logs.filter(l => l.type.startsWith('inject:'));
          if (category && category !== 'all') {
            logs = logs.filter(l => l.type === `inject:${category}`);
          }
          return jsonResult(logs);
        }
      )
    );
  }

  // Eval-related tools (only when --eval flag is set)
  if (evalEnabled) {
    tools.push(
      createTool(
        'evaluate_in_app',
        'Execute JavaScript code inside the running application. DANGEROUS: Only available with --eval flag. Can inspect variables, call functions, or modify behavior at runtime.',
        {
          code: z.string().describe('JavaScript code to evaluate in the app context'),
          timeout: z.number().optional().describe('Timeout in milliseconds (default 10000)')
        },
        async ({ code, timeout }) => {
          if (!processManager.getState().injectionReady) {
            return textResult('Injection not ready. The process may still be starting.');
          }

          try {
            const result = await processManager.evaluate(code, timeout || 10000);
            return jsonResult(result);
          } catch (err) {
            return errorResult(`Eval error: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'list_app_globals',
        'List global variables available in the app context. Useful for discovering what can be inspected.',
        {},
        async () => {
          if (!processManager.getState().injectionReady) {
            return textResult('Injection not ready.');
          }

          try {
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
            return jsonResult(result);
          } catch (err) {
            return errorResult(`Error: ${(err as Error).message}`);
          }
        }
      )
    );
  }

  // V8 Inspector debugging tools (only when --debug flag is set)
  if (debug) {
    tools.push(
      createTool(
        'debug_set_breakpoint',
        'Set a real V8 debugger breakpoint at a specific file and line number. Requires --debug flag. The process will pause when this line is executed.',
        {
          file: z.string().describe('Absolute path to the file'),
          line: z.number().describe('Line number (1-based)'),
          condition: z.string().optional().describe('Optional JavaScript condition expression (e.g., "x > 5")')
        },
        async ({ file, line, condition }) => {
          if (!processManager.isDebuggerConnected()) {
            return textResult('Debugger not connected. The process may still be starting.');
          }

          try {
            const result = await processManager.debugSetBreakpoint(file, line, condition);
            return textResult(`Breakpoint set:\n  ID: ${result.breakpointId}\n  File: ${file}\n  Line: ${line}${condition ? `\n  Condition: ${condition}` : ''}\n\nExecution will pause when this line is reached.`);
          } catch (err) {
            return errorResult(`Failed to set breakpoint: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_remove_breakpoint',
        'Remove a V8 debugger breakpoint by its ID.',
        {
          breakpointId: z.string().describe('The breakpoint ID to remove (from debug_set_breakpoint or debug_list_breakpoints)')
        },
        async ({ breakpointId }) => {
          try {
            await processManager.debugRemoveBreakpoint(breakpointId);
            return textResult(`Breakpoint ${breakpointId} removed.`);
          } catch (err) {
            return errorResult(`Failed to remove breakpoint: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_list_breakpoints',
        'List all V8 debugger breakpoints that have been set.',
        {},
        async () => {
          const breakpoints = processManager.debugListBreakpoints();
          if (breakpoints.length === 0) {
            return textResult('No debugger breakpoints set. Use debug_set_breakpoint to add one.');
          }

          const list = breakpoints.map(bp =>
            `  ${bp.id}\n    File: ${bp.file}\n    Line: ${bp.line}${bp.condition ? `\n    Condition: ${bp.condition}` : ''}`
          ).join('\n\n');

          return textResult(`V8 Debugger Breakpoints:\n\n${list}`);
        }
      ),

      createTool(
        'debug_resume',
        'Resume execution after the debugger has paused at a breakpoint.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused.');
          }

          try {
            await processManager.debugResume();
            return textResult('Execution resumed.');
          } catch (err) {
            return errorResult(`Failed to resume: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_pause',
        'Pause execution immediately. The debugger will stop at the next JavaScript statement.',
        {},
        async () => {
          try {
            await processManager.debugPause();
            return textResult('Pause requested. Execution will stop at the next JavaScript statement.');
          } catch (err) {
            return errorResult(`Failed to pause: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_step_over',
        'Step over the current line of code (execute it and pause at the next line).',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Cannot step.');
          }

          try {
            await processManager.debugStepOver();
            return textResult('Stepped over. Use debug_get_call_stack to see current position.');
          } catch (err) {
            return errorResult(`Failed to step over: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_step_into',
        'Step into a function call (pause at the first line of the called function).',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Cannot step.');
          }

          try {
            await processManager.debugStepInto();
            return textResult('Stepped into. Use debug_get_call_stack to see current position.');
          } catch (err) {
            return errorResult(`Failed to step into: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_step_out',
        'Step out of the current function (execute remaining code and pause at the caller).',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Cannot step.');
          }

          try {
            await processManager.debugStepOut();
            return textResult('Stepped out. Use debug_get_call_stack to see current position.');
          } catch (err) {
            return errorResult(`Failed to step out: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_get_call_stack',
        'Get the current call stack while the debugger is paused. Shows function names, file locations, and line numbers.',
        {},
        async () => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Call stack is only available when paused.');
          }

          const callStack = processManager.debugGetCallStack();
          if (!callStack || callStack.length === 0) {
            return textResult('No call stack available.');
          }

          const formatted = callStack.map((frame, i) =>
            `#${i} ${frame.functionName} at ${frame.url}:${frame.lineNumber}`
          ).join('\n');

          return textResult(`Call Stack:\n\n${formatted}`);
        }
      ),

      createTool(
        'debug_evaluate',
        'Evaluate an expression in the current debugger context. When paused at a breakpoint, you can inspect local variables.',
        {
          expression: z.string().describe('JavaScript expression to evaluate'),
          callFrameId: z.string().optional().describe('Call frame ID for scope context (from debug_get_call_stack)')
        },
        async ({ expression, callFrameId }) => {
          try {
            const result = await processManager.debugEvaluate(expression, callFrameId || null);
            return jsonResult(result);
          } catch (err) {
            return errorResult(`Evaluation error: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_get_scope_variables',
        'Get variables in a specific scope while paused. Shows local, closure, and global variables.',
        {
          callFrameId: z.string().describe('Call frame ID (from debug_get_call_stack)'),
          scopeType: z.enum(['local', 'closure', 'global', 'with', 'block', 'script', 'catch']).optional()
            .describe('Type of scope to inspect (default: local)')
        },
        async ({ callFrameId, scopeType }) => {
          if (!processManager.isDebuggerPaused()) {
            return textResult('Debugger is not paused. Scope variables only available when paused.');
          }

          try {
            const variables = await processManager.debugGetScopeVariables(callFrameId, scopeType || 'local');
            return jsonResult(variables);
          } catch (err) {
            return errorResult(`Failed to get scope variables: ${(err as Error).message}`);
          }
        }
      ),

      createTool(
        'debug_get_state',
        'Get the current state of the V8 debugger: connected status, paused status, breakpoints, and call stack.',
        {},
        async () => {
          const state = processManager.getDebuggerState();
          return jsonResult(state);
        }
      )
    );
  }

  return tools;
}

/**
 * Combine CLI tools with local file tools
 */
export function createAllCliTools(options: CliToolsOptions): AnyToolDefinition[] {
  const cliTools = createCliTools(options);
  // Local tools would be added here if needed
  return combineTools(cliTools);
}
