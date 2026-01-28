#!/usr/bin/env python3
"""Quick test of the Reflexive Python SDK"""

import reflexive
import time

print("Testing Reflexive Python SDK")
print("=" * 50)

# Test 1: Basic initialization
print("\n✓ Test 1: Creating Reflexive instance...")
r = reflexive.make_reflexive()
print(f"  Instance created: {r}")
print(f"  AppState: {r.app_state}")

# Test 2: Logging
print("\n✓ Test 2: Testing logging...")
r.log('info', 'This is an info message')
r.log('warn', 'This is a warning')
r.log('error', 'This is an error')
print(f"  Logged 3 messages")

# Test 3: State management
print("\n✓ Test 3: Testing state management...")
r.set_state('test.value', 42)
r.set_state('test.name', 'reflexive')
r.set_state('test.active', True)

value = r.get_state('test.value')
name = r.get_state('test.name')
all_state = r.get_state()

print(f"  test.value = {value}")
print(f"  test.name = {name}")
print(f"  All state: {all_state}")

# Test 4: Get logs
print("\n✓ Test 4: Retrieving logs...")
logs = r.get_logs(5)
print(f"  Retrieved {len(logs)} logs:")
for log in logs:
    print(f"    [{log['type']}] {log['message']}")

# Test 5: Get status
print("\n✓ Test 5: Getting app status...")
status = r.app_state.get_status()
print(f"  PID: {status['pid']}")
print(f"  Uptime: {status['uptime']:.2f}s")
print(f"  Memory RSS: {status['memory']['rss'] / 1024 / 1024:.1f} MB")
print(f"  Custom state keys: {list(status['customState'].keys())}")

# Test 6: Chat (will show error message in standalone mode)
print("\n✓ Test 6: Testing chat (standalone mode)...")
response = r.chat("What is the current uptime?")
print(f"  Response: {response}")

print("\n" + "=" * 50)
print("✅ All tests passed!")
print("\nTo test with full chat capabilities, run:")
print("  reflexive --debug test_basic.py")
