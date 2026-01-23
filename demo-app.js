import http from 'http';

const PORT = 8080;
let requestCount = 0;
const visitors = new Map();
let dbConnected = true;
let authFailures = 0;

const server = http.createServer((req, res) => {
  requestCount++;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] ${req.method} ${req.url}`);

  // Track visitors by IP
  const ip = req.socket.remoteAddress;
  visitors.set(ip, (visitors.get(ip) || 0) + 1);

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <h1>Demo App</h1>
      <p>Request #${requestCount}</p>
      <h3>Basic Endpoints</h3>
      <ul>
        <li><a href="/status">/status</a> - Server stats</li>
        <li><a href="/slow">/slow</a> - Slow endpoint (2s delay)</li>
        <li><a href="/error">/error</a> - Throws an error</li>
        <li><a href="/memory">/memory</a> - Memory usage</li>
      </ul>
      <h3>Watch Trigger Demos</h3>
      <ul>
        <li><a href="/login?user=admin&pass=wrong">/login</a> - Auth failure (try wrong password)</li>
        <li><a href="/login?user=admin&pass=secret">/login</a> - Auth success</li>
        <li><a href="/db-query">/db-query</a> - Simulated DB query (may fail randomly)</li>
        <li><a href="/api/users">/api/users</a> - API endpoint with rate limiting</li>
        <li><a href="/webhook">/webhook</a> - Incoming webhook simulation</li>
        <li><a href="/toggle-db">/toggle-db</a> - Toggle DB connection state</li>
      </ul>
    `);
  }
  else if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime: process.uptime(),
      requests: requestCount,
      visitors: visitors.size,
      pid: process.pid
    }, null, 2));
  }
  else if (req.url === '/slow') {
    console.log('Starting slow operation...');
    setTimeout(() => {
      console.log('Slow operation complete');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Done after 2 seconds');
    }, 2000);
  }
  else if (req.url === '/error') {
    console.error('About to throw an error!');
    throw new Error('Intentional error for testing');
  }
  else if (req.url === '/memory') {
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`
    }, null, 2));
  }
  // ============ Watch Trigger Demo Endpoints ============
  else if (req.url.startsWith('/login')) {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const user = params.get('user') || 'unknown';
    const pass = params.get('pass') || '';

    if (pass === 'secret') {
      console.log(`[AUTH] ✓ Login successful for user: ${user}`);
      authFailures = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, user, message: 'Welcome!' }));
    } else {
      authFailures++;
      console.error(`[AUTH] ✗ Login FAILED for user: ${user} (attempt #${authFailures})`);
      if (authFailures >= 3) {
        console.error(`[AUTH] ⚠️ SECURITY WARNING: Multiple failed login attempts for user: ${user}`);
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
    }
  }
  else if (req.url === '/db-query') {
    if (!dbConnected) {
      console.error('[DATABASE] ✗ Connection failed: Database is not connected');
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Database unavailable' }));
      return;
    }
    // Simulate random query performance
    const queryTime = Math.random() * 500;
    if (queryTime > 400) {
      console.warn(`[DATABASE] ⚠️ Slow query detected: ${queryTime.toFixed(0)}ms`);
    }
    if (Math.random() < 0.2) {
      console.error('[DATABASE] ✗ Query failed: Deadlock detected');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Query failed - deadlock' }));
    } else {
      console.log(`[DATABASE] ✓ Query completed in ${queryTime.toFixed(0)}ms`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, rows: Math.floor(Math.random() * 100), queryTime: queryTime.toFixed(0) + 'ms' }));
    }
  }
  else if (req.url.startsWith('/api/')) {
    const visitorCount = visitors.get(ip) || 0;
    if (visitorCount > 10) {
      console.warn(`[RATE_LIMIT] ⚠️ Rate limit exceeded for IP: ${ip} (${visitorCount} requests)`);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests', retryAfter: 60 }));
    } else {
      console.log(`[API] Request from ${ip} to ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ users: ['alice', 'bob', 'charlie'] }));
    }
  }
  else if (req.url === '/webhook') {
    const eventType = ['payment.success', 'payment.failed', 'user.created', 'subscription.hacked'][Math.floor(Math.random() * 4)];
    console.log(`[WEBHOOK] Received event: ${eventType}`);
    if (eventType === 'payment.failed') {
      console.error(`[WEBHOOK] ⚠️ Payment failure webhook received - needs attention!`);
    }
    if (eventType === 'subscription.hacked') {
      console.warn(`[WEBHOOK] Security alert: subscription hacked`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true, event: eventType }));
  }
  else if (req.url === '/toggle-db') {
    dbConnected = !dbConnected;
    if (dbConnected) {
      console.log('[DATABASE] ✓ Connection restored');
    } else {
      console.error('[DATABASE] ✗ Connection lost!');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ dbConnected }));
  }
  // ============ End Watch Trigger Demo Endpoints ============
  else if (req.url.startsWith('/foo/')) {
    const bar = req.url.slice(5); // Extract everything after '/foo/'
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      path: req.url,
      bar: bar
    }, null, 2));
  }
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         REFLEXIVE DEMO APP                                     ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Server running at http://localhost:${PORT}                                       ║
║  PID: ${process.pid}                                                              ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  HOW TO USE THIS DEMO:                                                         ║
║                                                                                ║
║  1. Run with Reflexive:  npm run demo:app                                      ║
║  2. Open dashboard:      http://localhost:3100                                 ║
║  3. Try the Watch Triggers feature:                                            ║
║     - Click 👁 on any log entry to create a watch                              ║
║     - Set a pattern like "Login FAILED" or "Deadlock"                          ║
║     - Add a prompt like "Investigate this error"                               ║
║     - The agent auto-responds when matching logs appear!                       ║
║                                                                                ║
║  DEMO ENDPOINTS (visit in browser or curl):                                    ║
║                                                                                ║
║  Auth Demo:                                                                    ║
║    /login?user=admin&pass=wrong   → Triggers auth failure logs                 ║
║    /login?user=admin&pass=secret  → Successful login                           ║
║    (3+ failures triggers SECURITY WARNING)                                     ║
║                                                                                ║
║  Database Demo:                                                                ║
║    /db-query    → Random success/slow/deadlock                                 ║
║    /toggle-db   → Simulate DB connection loss                                  ║
║                                                                                ║
║  Other:                                                                        ║
║    /api/users   → Rate limiting (10+ requests = warning)                       ║
║    /webhook     → Random webhook events (payment failures, churn)              ║
║                                                                                ║
║  SUGGESTED WATCH PATTERNS:                                                     ║
║    "Login FAILED"     → "Investigate why authentication is failing"            ║
║    "Slow query"       → "Check what's causing database slowness"               ║
║    "Deadlock"         → "Analyze the deadlock and suggest a fix"               ║
║    "payment.failed"   → "Alert! Check the payment processing system"           ║
║    "SECURITY WARNING" → "Potential brute force - suggest mitigations"          ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
});

// Log something periodically
setInterval(() => {
  console.log(`[heartbeat] ${requestCount} requests served, ${visitors.size} unique visitors`);
}, 10000);
