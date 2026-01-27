/**
 * Demo application for testing
 * This simulates a simple Node.js app that Reflexive would monitor
 */

// Simple counter state
let counter = 0;

// Simulate periodic activity
const interval = setInterval(() => {
  counter++;
  console.log(`Counter: ${counter}`);

  if (counter % 5 === 0) {
    console.warn(`Counter reached ${counter}`);
  }

  if (counter >= 10) {
    console.log('Demo complete');
    clearInterval(interval);
    process.exit(0);
  }
}, 1000);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  clearInterval(interval);
  process.exit(0);
});

// Export for potential testing
export { counter };
