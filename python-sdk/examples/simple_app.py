#!/usr/bin/env python3
"""
Simple Reflexive Python app demonstrating reflexive.chat()

This shows how to use the Python SDK to add AI capabilities to your app.

Run in two ways:

1. Via Reflexive CLI (recommended):
   reflexive --debug simple_app.py

2. Standalone with spawned CLI:
   python simple_app.py
"""

import reflexive
import time

# Option 1: Detect CLI mode automatically
# When run with `reflexive simple_app.py`, this connects to parent
# When run standalone, chat() won't work unless spawn_cli=True
r = reflexive.make_reflexive({
    'spawn_cli': True,  # Set to True to spawn CLI in background
    'debug': True,      # Enable debugger
    'port': 3099
})

print("🐍 Reflexive Python Example")
print("=" * 50)
print()

# Track some state
counter = 0

for i in range(5):
    counter += 1

    # Update state (visible to AI)
    r.set_state('counter', counter)
    r.set_state('iteration', i + 1)
    r.set_state('timestamp', time.time())

    # Log activity
    r.log('info', f'Processing iteration {i + 1}')

    print(f"Iteration {i + 1}: counter = {counter}")

    # Ask AI for insights
    if i == 2:
        print("\n" + "=" * 50)
        print("Asking AI to analyze the counter...")

        response = r.chat("What is the current value of counter? Explain what the app is doing.")

        print(f"\n🤖 AI Response:\n{response}\n")
        print("=" * 50 + "\n")

    time.sleep(1)

print("\n✅ Done!")
print(f"Final counter: {counter}")

# One more AI interaction
print("\nAsking AI for a final summary...")
summary = r.chat("Summarize what this app did. Be brief.")
print(f"\n🤖 Summary:\n{summary}")
