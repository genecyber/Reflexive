/**
 * Demo app to test --inject and --eval features
 *
 * Run with injection only:
 *   reflexive --inject demo-inject.js
 *
 * Run with eval enabled:
 *   reflexive --eval demo-inject.js
 *
 * Then try in the dashboard:
 *   - "What's in the config object?"
 *   - "How many users are there?"
 *   - "Call addUser with name 'Alice'"
 *   - "Clear the cache"
 */

import http from 'http';
import https from 'https';

// === Expose some globals for eval testing ===
global.config = {
  port: 4567,
  env: 'development',
  debug: true,
  maxConnections: 100
};

global.users = new Map([
  [1, { id: 1, name: 'Demo User', role: 'admin' }],
  [2, { id: 2, name: 'Test User', role: 'user' }]
]);

global.cache = {
  data: new Map(),
  set(key, value) { this.data.set(key, value); },
  get(key) { return this.data.get(key); },
  clear() { this.data.clear(); console.log('Cache cleared'); },
  size() { return this.data.size; }
};

global.addUser = (name, role = 'user') => {
  const id = global.users.size + 1;
  const user = { id, name, role };
  global.users.set(id, user);
  console.log(`Added user: ${JSON.stringify(user)}`);
  return user;
};

global.getStats = () => ({
  users: global.users.size,
  cacheSize: global.cache.size(),
  uptime: process.uptime(),
  memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
});

// === Console interception (automatic) ===
console.log('App starting up...');
console.info('This is an info message');
console.warn('This is a warning');
console.error('This is an error (not a real error, just testing)');
console.debug('Debug info here');

// === HTTP Server (automatic tracking via diagnostics_channel) ===
const server = http.createServer((req, res) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);

  // Simulate some work
  const start = Date.now();
  let sum = 0;
  for (let i = 0; i < 1000000; i++) sum += i;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    path: req.url,
    processingTime: Date.now() - start
  }));
});

server.listen(4567, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    REFLEXIVE INJECTION MODE DEMO                               ║
║                    (Deep Instrumentation via --inject)                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:4567                                             ║
║  PID: ${String(process.pid).padEnd(73)}║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  HOW TO RUN THIS DEMO:                                                         ║
║                                                                                ║
║  Injection only (console capture, diagnostics):                                ║
║    npm run demo:inject                                                         ║
║    (or: node src/reflexive.js --inject demo-inject.js)                         ║
║                                                                                ║
║  With eval enabled (run code in app context):                                  ║
║    npm run demo:eval                                                           ║
║    (or: node src/reflexive.js --eval demo-inject.js)                           ║
║                                                                                ║
║  KEY FEATURES DEMONSTRATED:                                                    ║
║  • Console interception (all log levels captured)                              ║
║  • HTTP diagnostics via diagnostics_channel                                    ║
║  • GC and event loop metrics via perf_hooks                                    ║
║  • process.reflexive API for custom state                                      ║
║  • Breakpoints (pause/resume execution)                                        ║
║  • Remote eval (with --eval flag)                                              ║
║                                                                                ║
║  GLOBAL VARIABLES (for --eval testing):                                        ║
║    config    → App configuration object                                        ║
║    users     → Map of user data                                                ║
║    cache     → Simple cache with get/set/clear                                 ║
║    addUser() → Function to add new users                                       ║
║    getStats()→ Function to get app statistics                                  ║
║                                                                                ║
║  TRY WITH --inject:                                                            ║
║    "Show me the injection logs"                                                ║
║    "What HTTP requests have been made?"                                        ║
║    "Are there any GC events?"                                                  ║
║                                                                                ║
║  TRY WITH --eval:                                                              ║
║    "What's in the config object?"                                              ║
║    "How many users are there?"                                                 ║
║    "Call addUser with name 'Alice'"                                            ║
║    "Clear the cache"                                                           ║
║    "What are the current stats?"                                               ║
║                                                                                ║
║  WATCH TRIGGER IDEAS:                                                          ║
║    "External request failed" → "Investigate the HTTP error"                    ║
║    "memory pressure" → "Analyze memory usage patterns"                         ║
║    "event loop" → "Check for performance issues"                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
});

// === HTTP Client requests (automatic tracking) ===
function makeExternalRequest() {
  console.log('Making external HTTP request...');

  https.get('https://httpbin.org/get', (res) => {
    console.log(`External request status: ${res.statusCode}`);
    res.on('data', () => {}); // consume the data
  }).on('error', (err) => {
    console.error(`External request failed: ${err.message}`);
  });
}

// Make a request every 30 seconds
setTimeout(makeExternalRequest, 2000);
setInterval(makeExternalRequest, 30000);

// === Memory pressure (triggers GC) ===
function createMemoryPressure() {
  console.log('Creating memory pressure to trigger GC...');
  let arrays = [];
  for (let i = 0; i < 100; i++) {
    arrays.push(new Array(100000).fill(Math.random()));
  }
  // Let it get collected
  arrays = null;
}

// Trigger GC periodically
setTimeout(createMemoryPressure, 5000);
setInterval(createMemoryPressure, 20000);

// === Event loop blocking (shows in event loop metrics) ===
function blockEventLoop() {
  console.log('Blocking event loop briefly...');
  const start = Date.now();
  while (Date.now() - start < 100) {
    // Busy wait for 100ms
  }
  console.log('Event loop unblocked');
}

setTimeout(blockEventLoop, 8000);

// === Simulate an uncaught exception (after 60 seconds) ===
// Uncomment to test error capture:
// setTimeout(() => {
//   throw new Error('Intentional uncaught exception for testing');
// }, 60000);

// === Bonus: Use process.reflexive if available ===
if (process.reflexive) {
  console.log('Reflexive injection detected! Setting custom state...');

  process.reflexive.setState('app.name', 'demo-inject');
  process.reflexive.setState('app.version', '1.0.0');
  process.reflexive.setState('user', { name: 'Alice', age: 30, email: 'alice@example.com' });

  // Update request count
  let requestCount = 0;
  const originalEmit = server.emit.bind(server);
  server.emit = function(event, ...args) {
    if (event === 'request') {
      requestCount++;
      process.reflexive.setState('requests.total', requestCount);
    }
    return originalEmit(event, ...args);
  };

  // Periodic state updates
  setInterval(() => {
    const mem = process.memoryUsage();
    process.reflexive.setState('memory', {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
    });
  }, 5000);
}

console.log('Demo app ready! Make HTTP requests: curl http://localhost:4567/test');
