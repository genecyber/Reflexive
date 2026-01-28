# Reflexive Python SDK - Quick Start

## TL;DR

```bash
# Install
npm install -g reflexive
pip install reflexive

# Use it
cat > app.py << 'EOF'
import reflexive
r = reflexive.make_reflexive()
r.set_state('count', 42)
print(r.chat('What is count?'))
EOF

# Run it
reflexive --debug app.py
```

## The Magic ✨

You can now use `.chat()` **inside your Python code** to ask AI questions about your running application:

```python
import reflexive

r = reflexive.make_reflexive()

# Your app logic
users = load_users()
r.set_state('users.count', len(users))

# Ask AI anything!
answer = r.chat('How many users are there?')
print(answer)  # "There are 42 users currently."

# AI sees your logs too
r.log('info', 'Processing payment...')
advice = r.chat('Should I retry failed payments?')
```

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│  YOU RUN: reflexive --debug app.py                       │
│                                                           │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ↓
         ┌─────────────────────┐
         │  Reflexive CLI      │  (Node.js)
         │  - Port 3099        │
         │  - Web Dashboard    │
         │  - Claude Agent SDK │
         └──────────┬──────────┘
                    │ Sets env:
                    │  REFLEXIVE_CLI_MODE=true
                    │  REFLEXIVE_CLI_PORT=3099
                    ↓
         ┌─────────────────────┐
         │  Python Process     │
         │                     │
         │  import reflexive   │
         │  r = make_reflexive()  # Detects CLI!
         │                     │
         │  r.chat("msg")      │  ──HTTP POST──┐
         │    ↓                │               │
         │  "AI response"      │  ←─SSE stream─┘
         └─────────────────────┘
```

**Key insight:** The CLI is the server, your Python app is the client!

## Two Ways to Use

### 1. Run via CLI (Recommended)

```bash
reflexive --debug app.py
```

**Pros:**
- ✅ Full debugger support (breakpoints!)
- ✅ Web dashboard
- ✅ All MCP tools available
- ✅ File operations, shell access

**Cons:**
- ❌ Requires `reflexive` command

### 2. Spawn CLI Automatically

```python
import reflexive

# Spawns Node CLI in background
r = reflexive.make_reflexive({'spawn_cli': True})

r.chat('message')  # Works!
```

**Pros:**
- ✅ No manual CLI invocation
- ✅ Works with `python app.py` directly
- ✅ CLI shuts down when app exits

**Cons:**
- ❌ Less debugger control
- ❌ Slightly slower startup (CLI boot time)

## Examples

### Example 1: Basic Usage

```python
import reflexive

r = reflexive.make_reflexive()

# Track state
r.set_state('version', '1.0.0')
r.set_state('requests', 0)

# Log events
r.log('info', 'App started')

# Ask AI
answer = r.chat('What version is this?')
print(answer)  # "This is version 1.0.0"
```

Run: `reflexive app.py`

### Example 2: AI-Powered Decision Making

```python
import reflexive

r = reflexive.make_reflexive()

def process_order(order):
    # Ask AI if this looks suspicious
    r.set_state('order.total', order.total)
    r.set_state('order.items', order.item_count)

    analysis = r.chat(
        f"Is this order suspicious? "
        f"Total: ${order.total}, Items: {order.item_count}"
    )

    if 'suspicious' in analysis.lower():
        r.log('warn', f'Flagged order: {order.id}')
        return 'manual_review'

    return 'auto_approve'
```

### Example 3: Monitoring Dashboard

```python
import reflexive
import time

r = reflexive.make_reflexive()

while True:
    # Collect metrics
    cpu = get_cpu_usage()
    memory = get_memory_usage()

    r.set_state('metrics.cpu', cpu)
    r.set_state('metrics.memory', memory)

    # Ask AI every minute
    if time.time() % 60 == 0:
        health = r.chat('How is system health?')

        if 'concern' in health.lower():
            alert_team(health)

    time.sleep(1)
```

Visit http://localhost:3099 to see live metrics!

## API Cheat Sheet

```python
import reflexive

# Create instance
r = reflexive.make_reflexive()
r = reflexive.make_reflexive({'spawn_cli': True})

# Chat with AI
answer = r.chat('What should I do?')

# Manage state
r.set_state('key', 'value')
value = r.get_state('key')
all_state = r.get_state()

# Logging
r.log('info', 'Message')
r.log('warn', 'Warning')
r.log('error', 'Error')

# Get logs
recent = r.get_logs(10)
errors = r.get_logs(50, 'error')

# Status
status = r.get_status()
# {'pid': 12345, 'uptime': 60.5, 'memory': {...}}
```

## Common Patterns

### Pattern: Periodic Health Check

```python
import reflexive
import time

r = reflexive.make_reflexive()

iteration = 0

while True:
    do_work()

    iteration += 1
    r.set_state('iterations', iteration)

    # Check every 100 iterations
    if iteration % 100 == 0:
        health = r.chat('Any concerns with current state?')
        print(f"AI says: {health}")

    time.sleep(0.1)
```

### Pattern: AI-Assisted Debugging

```python
import reflexive

r = reflexive.make_reflexive()

try:
    result = risky_operation()
except Exception as e:
    r.log('error', str(e))

    # Ask AI for debugging help
    advice = r.chat(f'I got this error: {e}. What might be wrong?')
    print(f"AI advice: {advice}")
```

### Pattern: Dynamic Configuration

```python
import reflexive

r = reflexive.make_reflexive()

def get_cache_strategy():
    # Ask AI based on current load
    load = get_system_load()
    r.set_state('system.load', load)

    recommendation = r.chat(
        'Should I use aggressive or conservative caching? '
        f'Current load: {load}'
    )

    return 'aggressive' if 'aggressive' in recommendation else 'conservative'
```

## Troubleshooting

### "Chat requires running under Reflexive CLI"

**Fix:**
```bash
# Option 1: Use CLI
reflexive app.py

# Option 2: Spawn in code
r = reflexive.make_reflexive({'spawn_cli': True})
```

### "Reflexive CLI not found"

**Fix:**
```bash
npm install -g reflexive
```

### Chat is very slow

**This is normal!** AI inference takes 5-30 seconds. Don't use `.chat()` in hot loops or per-request handlers.

**Good:**
```python
# ✅ Initialization
config = r.chat('What config should I use?')

# ✅ Periodic checks
if iteration % 100 == 0:
    health = r.chat('How is health?')
```

**Bad:**
```python
# ❌ Per-request
@app.route('/api')
def handler():
    answer = r.chat('Process this request')  # TOO SLOW!
```

## Next Steps

1. ✅ Try the examples above
2. 📚 Read [full documentation](./README.md)
3. 🏗️ See [architecture details](./ARCHITECTURE.md)
4. 💡 Check [example apps](./examples/)

## Questions?

**Q: Do I need Node.js?**
A: Yes, the CLI is Node.js-based.

**Q: Can I deploy this in production?**
A: Yes! Use `reflexive app.py` or `spawn_cli=True`.

**Q: Is this secure?**
A: CLI only listens on localhost. Don't expose the dashboard port.

**Q: Can I use this without the CLI?**
A: Not yet - Python needs the Node CLI for chat functionality.

---

**Now go build something cool! 🚀**
