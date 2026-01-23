# Breakpoint System Audit

This document provides a comprehensive audit of all breakpoint-related code in the Reflexive codebase.

## Executive Summary

The current breakpoint system in Reflexive is **pattern-based, not true debugger breakpoints**. It uses:
- IPC messaging between parent (reflexive.js) and child (inject.cjs) processes
- Promise-based pause/resume mechanism
- Conditional breakpoints that match log message patterns

**Important Finding**: `evaluate_in_app` DOES run code inside the target process and can modify state, but only in global scope.

## Architecture Overview

```
Dashboard UI
    ↓ POST /break or /breakpoint/:id/trigger
HTTP Server (reflexive.js)
    ↓ processManager.triggerBreakpoint()
Child Process IPC
    ↓ {reflexive: true, type: 'triggerBreakpoint'}
inject.cjs Message Handler
    ↓ setImmediate(async () => process.reflexive.breakpoint())
App Code Execution
    ↓ Breakpoint Hit - Promise Created
    ↓ sendToParent('breakpoint', {action: 'hit'})
IPC → HTTP Server
    ↓ activeBreakpoint = {...}
    ↓ emit('breakpointHit')
Dashboard UI
    ↓ Polls /breakpoint-status every 1s
    ↓ Shows "PAUSED" state
    ↓ User clicks Resume
HTTP Server: POST /resume
    ↓ processManager.resumeBreakpoint(returnValue)
Child Process IPC
    ↓ {reflexive: true, type: 'resumeBreakpoint', returnValue}
inject.cjs Handler
    ↓ breakpointResolve(msg.returnValue)
App Code
    ↓ Promise Resolves - Execution Continues
    ↓ sendToParent('breakpoint', {action: 'resumed'})
```

---

## Code Locations

### src/reflexive.js

#### ProcessManager Class - State (Lines 2457-2462)

```javascript
// Breakpoint state
this.activeBreakpoint = null;
this.lastBreakpoint = null;
// Conditional breakpoints
this.conditionalBreakpoints = [];
this.conditionalBreakpointIdCounter = 0;
```

#### ProcessManager Methods

| Method | Lines | Description |
|--------|-------|-------------|
| `getActiveBreakpoint()` | 2798-2800 | Returns current active breakpoint or null |
| `resumeBreakpoint(returnValue)` | 2802-2816 | Sends IPC to resume, optionally with return value |
| `triggerBreakpoint(label)` | 2817-2827 | Sends IPC to trigger breakpoint in child |
| `addConditionalBreakpoint(pattern, label, enabled)` | 2830-2841 | Creates pattern-based breakpoint |
| `getConditionalBreakpoints()` | 2843-2845 | Returns copy of all conditional breakpoints |
| `removeConditionalBreakpoint(id)` | 2847-2854 | Removes breakpoint by ID |
| `checkConditionalBreakpoints(logMessage)` | 2856-2870 | Checks logs against patterns, triggers if match |

#### IPC Message Handler (Lines 2707-2734)

```javascript
case 'breakpoint':
  // action: 'hit' → sets activeBreakpoint, emits breakpointHit event
  // action: 'resumed' → clears activeBreakpoint, emits breakpointResumed event

case 'breakpointError':
  // Logs breakpoint-related errors
```

#### MCP Tools

| Tool | Lines | Parameters | Description |
|------|-------|------------|-------------|
| `get_active_breakpoint` | 3280-3312 | none | Check if paused at breakpoint |
| `resume_breakpoint` | 3314-3346 | `returnValue` (optional) | Resume from breakpoint |
| `trigger_breakpoint` | 3348-3379 | `label` (optional) | Trigger breakpoint to pause |
| `set_conditional_breakpoint` | 3381-3406 | `pattern`, `label`, `enabled` | Set pattern-based breakpoint |
| `list_breakpoints` | 3408-3440 | none | List all conditional breakpoints |
| `remove_breakpoint` | 3442-3473 | `id` | Remove conditional breakpoint |

#### HTTP Endpoints

| Endpoint | Lines | Method | Description |
|----------|-------|--------|-------------|
| `/break` | 3935-3945 | POST | Trigger breakpoint |
| `/resume` | 3947-3957 | POST | Resume from breakpoint |
| `/breakpoint-status` | 3959-3973 | GET | Get current breakpoint state |
| `/breakpoint/:id` | 3976-3989 | POST | Toggle conditional breakpoint |
| `/breakpoint/:id` | 3992-3998 | DELETE | Remove conditional breakpoint |

---

### src/inject.cjs

#### State Variables (Lines 177-180)

```javascript
const breakpoints = new Map();     // For future use (unused)
let breakpointIdCounter = 0;       // Increments for each breakpoint
let activeBreakpoint = null;       // Current paused breakpoint
let breakpointResolve = null;      // Promise resolver for pause/resume
```

#### process.reflexive.breakpoint() (Lines 209-230)

```javascript
async breakpoint(label = 'breakpoint', context = {}) {
  // Generates unique ID
  // Captures stack trace
  // Sends 'breakpoint' message with action='hit'
  // Prints 🔴 message to console
  // Returns Promise that resolves when resumed
}
```

**CRITICAL**: This is async and pauses execution until `breakpointResolve()` is called.

#### IPC Message Handlers

| Message Type | Lines | Description |
|--------------|-------|-------------|
| `resumeBreakpoint` | 340-357 | Calls breakpointResolve(), clears state |
| `getActiveBreakpoint` | 359-375 | Returns current breakpoint info |
| `triggerBreakpoint` | 377-390 | Calls process.reflexive.breakpoint() via setImmediate |

---

### Demo Apps

#### demo-ai-features.js (Lines 512-539)

```javascript
if (url.pathname === '/debug/breakpoint') {
  if (process.reflexive && process.reflexive.breakpoint) {
    const context = { requestUrl, timestamp, peopleCount, stats };
    const result = await process.reflexive.breakpoint('debug-endpoint', context);
    // Returns message about completed breakpoint
  }
}
```

**Note**: The `await` actually pauses the endpoint handler until resumed.

---

## Evaluate In App Analysis

### Does it ACTUALLY affect app state?

**YES** - `evaluate_in_app` runs code inside the target process and can modify state.

#### Evidence

1. **Execution Location** (src/inject.cjs Lines 282-332):
   ```javascript
   // Code runs in the child process (target app)
   const evalInGlobal = eval;
   const result = evalInGlobal(msg.code);
   ```

2. **Scope Access**:
   - Runs in global scope via indirect eval
   - Can access and modify `global` variables
   - **Cannot** access module-scoped variables
   - Demo apps work because they explicitly expose things to `global`

3. **Security Gating**:
   - Requires explicit `--eval` flag
   - Requires `REFLEXIVE_EVAL` environment variable
   - Tool description: "Can inspect variables, call functions, **or modify behavior at runtime**"

### What CAN be accessed

```javascript
// These work because they're on global:
global.config
global.users
global.cache
process.env
process.memoryUsage()
```

### What CANNOT be accessed

```javascript
// Module-scoped variables in the target app
const privateVar = 'secret';  // Not accessible
let moduleState = {};         // Not accessible
```

---

## Key Findings

### Current Limitations

1. **No V8 Inspector Integration** - Uses pattern matching on logs, not real debugger
2. **Global Scope Only** - eval only accesses `global`, not module scope
3. **No Line-Level Breakpoints** - Cannot set breakpoint at specific line numbers
4. **No Call Stack Inspection** - Limited to what's captured at breakpoint time
5. **No Variable Inspection** - Cannot inspect local variables in scope

### What Works

1. **Pause/Resume** - Reliably pauses and resumes execution
2. **Pattern Matching** - Conditional breakpoints trigger on log patterns
3. **Context Passing** - Can pass context object to breakpoint
4. **Return Values** - Can pass return value back when resuming
5. **Global State Modification** - Can modify things on `global`

### Security Considerations

1. **Requires explicit flags** - Must use `--inject` and `--eval`
2. **Full access to global scope** - Can modify any global state
3. **No timeout on breakpoints** - Will wait forever if not resumed
4. **Can access process.env** - Environment variables exposed

---

## Conditional Breakpoint Flow

```
Any console.log() → ProcessManager._log()
    ↓
checkConditionalBreakpoints(logMessage)
    ↓
Pattern match on enabled breakpoints?
    ├─ YES: triggerBreakpoint(label) → IPC → 'triggerBreakpoint' message
    └─ NO: Continue
```

**Pattern Matching**: Case-insensitive substring match on entire log message.

---

## Dashboard UI Components

### HTML Structure (Lines 1098-1109)

```html
<div class="debug-section" id="breakpoints-section">
  <div class="debug-header" id="breakpoints-header">
    <span class="count" id="breakpoints-count">0</span>
    <div class="breakpoint-controls">
      <!-- break-now-btn and resume-btn buttons -->
    </div>
  </div>
  <div class="debug-content" id="breakpoints-content">
    <!-- Breakpoint list rendered here -->
  </div>
</div>
```

### JavaScript Functions

| Function | Description |
|----------|-------------|
| `renderBreakpoints(currentBp)` | Renders UI with current + conditional breakpoints |
| `checkBreakpointStatus()` | Polls /breakpoint-status every 1000ms |

---

## Recommended Improvements

To achieve true debugging capabilities, Reflexive should integrate with the V8 Inspector Protocol:

1. **Start target with `--inspect`** or enable inspector programmatically
2. **Connect via WebSocket** to the inspector endpoint
3. **Use CDP commands** like:
   - `Debugger.enable`
   - `Debugger.setBreakpointByUrl`
   - `Debugger.pause` / `Debugger.resume`
   - `Debugger.stepInto` / `Debugger.stepOut` / `Debugger.stepOver`
   - `Runtime.evaluate` (with proper scope access)
   - `Debugger.evaluateOnCallFrame` (for local variables)

See `docs/V8-INSPECTOR-RESEARCH.md` for implementation details.
