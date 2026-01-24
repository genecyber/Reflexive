# Troubleshooting Reflexive

## Quick Diagnosis

If something breaks, run this and paste the output when reporting:

```bash
node --version
npm --version
npx reflexive --help
echo $ANTHROPIC_API_KEY | head -c 10
```

## Common Failures

### "Authentication failed" or "Invalid API key"

**Symptom:** Agent won't respond, error about API key

**Fix:**
```bash
# Option 1: Use Claude Code CLI auth (recommended)
npm install -g @anthropic-ai/claude-code
claude  # Follow login prompts

# Option 2: Set API key directly
export ANTHROPIC_API_KEY=sk-ant-...
```

**Check:** The Claude Code CLI stores credentials that Reflexive can use automatically. If you've logged in with `claude` before, it should just work.

---

### "Cannot find module 'reflexive'"

**Symptom:** Import fails or npx doesn't work

**Fix:**
```bash
# If using npx, try clearing cache
npx clear-npx-cache
npx reflexive ./app.js

# If using as dependency
npm install reflexive
```

---

### Dashboard loads but chat doesn't work

**Symptom:** You see the UI at localhost:3099 but messages don't get responses

**Causes:**
1. No authentication (see above)
2. Claude API is down
3. Network/proxy blocking requests

**Debug:**
```bash
# Check if you can reach Claude API
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

---

### Process starts but agent can't see output

**Symptom:** Your app runs, but agent says "no logs" or can't see stdout

**Causes:**
1. App uses a logging library that doesn't write to stdout
2. Output is buffered

**Fix:**
```bash
# Force unbuffered output
NODE_OPTIONS="--no-warnings" npx reflexive ./app.js

# Or in your app
process.stdout.write('message\n');  # Instead of console.log
```

---

### "--debug doesn't work" / Breakpoints don't hit

**Symptom:** You set breakpoints but they never trigger

**Causes:**
1. Code path not executed
2. Source maps issue
3. Node version < 18

**Check:**
```bash
# Verify Node version
node --version  # Should be >= 18

# Try with explicit debug port
npx reflexive --debug --node-args="--inspect=9229" ./app.js
```

---

### "--inject causes app to crash"

**Symptom:** App crashes or behaves differently with --inject

**Causes:**
1. Conflict with existing instrumentation (APM tools, etc)
2. App uses non-standard module loading

**Fix:**
```bash
# Try without injection first
npx reflexive ./app.js

# If that works, injection has a conflict
# Report the error message
```

---

### "--eval returns undefined for everything"

**Symptom:** `evaluate_in_app` always returns undefined

**Causes:**
1. Variable is out of scope
2. Async timing issue
3. Code threw but error was swallowed

**Debug:**
```javascript
// Try wrapping in try/catch
evaluate_in_app({ code: "try { yourVar } catch(e) { e.message }" })
```

---

### "Port 3099 already in use"

**Symptom:** Dashboard won't start

**Fix:**
```bash
# Use different port
npx reflexive --port 4000 ./app.js

# Or kill the existing process
lsof -i :3099
kill -9 <PID>
```

---

### File writes fail even with --write

**Symptom:** Agent says it can't write files

**Causes:**
1. File permissions
2. Path is outside working directory
3. File is locked

**Check:**
```bash
# Verify working directory
pwd
ls -la ./your-file.js
```

---

### Shell commands fail even with --shell

**Symptom:** Agent can't run shell commands

**Causes:**
1. Command not in PATH
2. Permissions issue
3. Shell not available

**Debug:**
```bash
# Check what shell is available
echo $SHELL
which bash
```

---

## Known Issues

### Interactive mode (-i) with certain CLI tools

Some CLI tools that do complex terminal manipulation (curses, raw mode) may not work well with interactive mode. Stick to simple stdin/stdout tools.

### Watch mode (-w) high CPU on large directories

If watching a directory with many files (node_modules), CPU may spike. Use .gitignore patterns or run from a subdirectory.

### V8 debugger with worker threads

Breakpoints in worker threads may not work correctly. Main thread debugging works fine.

---

## Reporting Bugs

Include this information:

1. **Command you ran:**
   ```bash
   npx reflexive --write --debug ./my-app.js
   ```

2. **Node and npm versions:**
   ```bash
   node --version && npm --version
   ```

3. **OS:**
   ```bash
   uname -a  # or Windows version
   ```

4. **Error message:** Full stack trace if available

5. **Minimal reproduction:** Smallest app.js that shows the problem

Open an issue at: https://github.com/anthropics/reflexive/issues

---

## Getting Help

- Check the [README](./README.md) for usage examples
- Search existing issues before opening a new one
- For Claude API issues, check https://status.anthropic.com
