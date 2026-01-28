#!/usr/bin/env python3
"""
Data pipeline example with AI-powered monitoring

Demonstrates using Reflexive to monitor a data processing pipeline
and ask AI for insights about performance and errors.

Run with: reflexive --debug data_pipeline.py
"""

import reflexive
import time
import random

# Create Reflexive instance with web UI
r = reflexive.make_reflexive({
    'web_ui': True,
    'port': 3099,
    'title': 'Data Pipeline Monitor'
})

print("🔄 Data Pipeline Monitor")
print("Dashboard: http://localhost:3099/reflexive")
print("=" * 50)
print()

# Pipeline stats
records_processed = 0
errors = 0
processing_times = []


def process_record(record_id: int) -> tuple[bool, float]:
    """Simulate processing a data record"""
    # Simulate varying processing time
    processing_time = random.uniform(0.1, 0.5)
    time.sleep(processing_time)

    # Simulate occasional errors
    success = random.random() > 0.15

    return success, processing_time


print("Starting data pipeline...")
r.log('system', 'Pipeline started')

for i in range(100):
    record_id = i + 1

    success, proc_time = process_record(record_id)
    processing_times.append(proc_time)

    if success:
        records_processed += 1
        r.log('info', f'✓ Record {record_id} processed in {proc_time:.2f}s')
    else:
        errors += 1
        r.log('error', f'✗ Record {record_id} failed after {proc_time:.2f}s')

    # Update state
    r.set_state('records.processed', records_processed)
    r.set_state('records.errors', errors)
    r.set_state('records.total', record_id)

    # Calculate and track average processing time
    avg_time = sum(processing_times) / len(processing_times)
    r.set_state('performance.avg_time', round(avg_time, 3))

    # Error rate
    error_rate = (errors / record_id) * 100
    r.set_state('performance.error_rate', round(error_rate, 2))

    # Ask AI for insights periodically
    if record_id % 20 == 0:
        print("\n" + "=" * 50)
        print(f"📊 Checkpoint at record {record_id}")
        print("Asking AI for analysis...")

        analysis = r.chat(
            "Analyze the data pipeline performance. "
            "Is the error rate acceptable? "
            "Is processing time consistent? "
            "Give a brief assessment."
        )

        print(f"\n🤖 AI Analysis:\n{analysis}\n")
        print("=" * 50 + "\n")

        # Log the analysis
        r.log('system', f'AI checkpoint analysis at record {record_id}')

print("\n✅ Pipeline completed!")
print(f"Processed: {records_processed} records")
print(f"Errors: {errors} ({error_rate:.1f}%)")
print(f"Avg time: {avg_time:.3f}s")

r.log('system', 'Pipeline completed successfully')
