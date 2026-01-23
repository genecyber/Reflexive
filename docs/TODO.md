# Reflexive TODO

## Claude Agent SDK Features to Add

### High Priority

- [ ] **V8 Inspector Integration** - Replace pattern-based breakpoints with real debugger
  - Start target with `--inspect-brk=0` to pause on first line
  - Connect via WebSocket to CDP endpoint
  - Use `Debugger.setBreakpointByUrl` for line-level breakpoints
  - Handle `Debugger.paused` events for call stack / scope inspection
  - Add MCP tools: `set_breakpoint`, `remove_breakpoint`, `debug_resume`, `step_over/into/out`, `evaluate`
  - See `docs/V8-INSPECTOR-RESEARCH.md` for implementation details

- [ ] **Plugins with Lifecycle Hooks** - Intercept tool calls, add automatic logging, modify behavior
  ```javascript
  plugins: [{
    onToolCall: async (tool, input) => { /* log all tool usage */ }
  }]
  ```

- [ ] **Session Management (v2 API)** - Persist chat history across restarts
  ```javascript
  unstable_v2_createSession()
  unstable_v2_resumeSession(sessionId)
  ```

- [ ] **Granular Permission Control** - Dynamic permissions based on app state
  ```javascript
  canUseTool: async (tool, input) => { /* custom logic */ }
  ```

### Medium Priority

- [ ] **Subagents / Orchestration** - Specialized sub-agents for different tasks
  ```javascript
  agents: {
    'debugger': { description: '...', tools: [...] },
    'code-reviewer': { description: '...', tools: [...] }
  }
  ```

- [ ] **Tool Restrictions** - Allowlist/blocklist for tools per session
  ```javascript
  tools: ['read_file', 'search_logs'],
  disallowedTools: ['shell_command']
  ```

- [ ] **Budget Limits** - Cap spending per query
  ```javascript
  maxBudgetUsd: 0.50
  ```

### Low Priority

- [ ] **Session Forking** - Branch conversations for exploration
  ```javascript
  forkSession: true
  ```

- [ ] **Permission Modes** - Pre-configured permission levels
  - `acceptEdits` - auto-accept file edits
  - `bypassPermissions` - skip all prompts

## Other Features

- [ ] Multi-session support with tabs (detect existing server, add session)
- [ ] Chat history persistence to disk
- [ ] Export conversation as markdown
