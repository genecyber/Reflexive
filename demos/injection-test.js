/**
 * Injection Mode Demo
 *
 * Tests --inject and --eval features.
 * Run with: npx reflexive --inject demos/injection-test.js
 * Or:       npx reflexive --eval demos/injection-test.js
 * Or:       npx reflexive --demo inject
 */

import http from 'http';
import https from 'https';

const PORT = process.env.PORT || 8080;

// === Expose some globals for eval testing ===
global.config = {
  port: PORT,
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

// === Console interception tests ===
console.log('App starting up...');
console.info('This is an info message');
console.warn('This is a warning');
console.error('This is an error (not a real error, just testing)');
console.debug('Debug info here');

// === HTTP Server ===
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

server.listen(PORT, () => {
  console.log(`
================================================================================
                     REFLEXIVE INJECTION MODE DEMO
================================================================================
  Server running at http://localhost:${PORT}
  PID: ${process.pid}
--------------------------------------------------------------------------------
  HOW TO RUN:
    Injection only:  npx reflexive --inject demos/injection-test.js
    With eval:       npx reflexive --eval demos/injection-test.js
--------------------------------------------------------------------------------
  GLOBAL VARIABLES (for --eval testing):
    config     - App configuration object
    users      - Map of user data
    cache      - Simple cache with get/set/clear
    addUser()  - Function to add new users
    getStats() - Function to get app statistics
--------------------------------------------------------------------------------
  TRY WITH --eval:
    "What's in the config object?"
    "How many users are there?"
    "Call addUser with name 'Alice'"
    "Clear the cache"
================================================================================
`);
});

// === HTTP Client requests (for diagnostics_channel tracking) ===
function makeExternalRequest() {
  console.log('Making external HTTP request...');

  https.get('https://httpbin.org/get', (res) => {
    console.log(`External request status: ${res.statusCode}`);
    res.on('data', () => {});
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
  arrays = null;
}

setTimeout(createMemoryPressure, 5000);
setInterval(createMemoryPressure, 20000);

// === Use process.reflexive if available ===
if (process.reflexive) {
  console.log('Reflexive injection detected! Setting custom state...');

  process.reflexive.setState('app.name', 'injection-test');
  process.reflexive.setState('app.version', '1.0.0');

  let requestCount = 0;
  const originalEmit = server.emit.bind(server);
  server.emit = function(event, ...args) {
    if (event === 'request') {
      requestCount++;
      process.reflexive.setState('requests.total', requestCount);
    }
    return originalEmit(event, ...args);
  };

  setInterval(() => {
    const mem = process.memoryUsage();
    process.reflexive.setState('memory', {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
    });
  }, 5000);
}

console.log('Demo app ready! Make HTTP requests: curl http://localhost:' + PORT + '/test');
