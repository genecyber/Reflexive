/**
 * Basic HTTP Server Demo
 *
 * A simple HTTP server with various endpoints for testing Reflexive features.
 * Run with: npx reflexive demos/basic-server.js
 * Or:       npx reflexive --demo basic
 */

import http from 'http';

const PORT = process.env.PORT || 8080;
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
      <h1>Reflexive Demo App</h1>
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
        <li><a href="/login?user=admin&pass=wrong">/login (wrong)</a> - Auth failure</li>
        <li><a href="/login?user=admin&pass=secret">/login (correct)</a> - Auth success</li>
        <li><a href="/db-query">/db-query</a> - Simulated DB query</li>
        <li><a href="/api/users">/api/users</a> - API endpoint</li>
        <li><a href="/webhook">/webhook</a> - Webhook simulation</li>
        <li><a href="/toggle-db">/toggle-db</a> - Toggle DB state</li>
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
  else if (req.url.startsWith('/login')) {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const user = params.get('user') || 'unknown';
    const pass = params.get('pass') || '';

    if (pass === 'secret') {
      console.log(`[AUTH] Login successful for user: ${user}`);
      authFailures = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, user, message: 'Welcome!' }));
    } else {
      authFailures++;
      console.error(`[AUTH] Login FAILED for user: ${user} (attempt #${authFailures})`);
      if (authFailures >= 3) {
        console.error(`[AUTH] SECURITY WARNING: Multiple failed login attempts for user: ${user}`);
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
    }
  }
  else if (req.url === '/db-query') {
    if (!dbConnected) {
      console.error('[DATABASE] Connection failed: Database is not connected');
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Database unavailable' }));
      return;
    }
    const queryTime = Math.random() * 500;
    if (queryTime > 400) {
      console.warn(`[DATABASE] Slow query detected: ${queryTime.toFixed(0)}ms`);
    }
    if (Math.random() < 0.2) {
      console.error('[DATABASE] Query failed: Deadlock detected');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Query failed - deadlock' }));
    } else {
      console.log(`[DATABASE] Query completed in ${queryTime.toFixed(0)}ms`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, rows: Math.floor(Math.random() * 100), queryTime: queryTime.toFixed(0) + 'ms' }));
    }
  }
  else if (req.url.startsWith('/api/')) {
    const visitorCount = visitors.get(ip) || 0;
    if (visitorCount > 10) {
      console.warn(`[RATE_LIMIT] Rate limit exceeded for IP: ${ip} (${visitorCount} requests)`);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests', retryAfter: 60 }));
    } else {
      console.log(`[API] Request from ${ip} to ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ users: ['alice', 'bob', 'charlie'] }));
    }
  }
  else if (req.url === '/webhook') {
    const eventType = ['payment.success', 'payment.failed', 'user.created', 'subscription.cancelled'][Math.floor(Math.random() * 4)];
    console.log(`[WEBHOOK] Received event: ${eventType}`);
    if (eventType === 'payment.failed') {
      console.error(`[WEBHOOK] Payment failure webhook received - needs attention!`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true, event: eventType }));
  }
  else if (req.url === '/toggle-db') {
    dbConnected = !dbConnected;
    if (dbConnected) {
      console.log('[DATABASE] Connection restored');
    } else {
      console.error('[DATABASE] Connection lost!');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ dbConnected }));
  }
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`
================================================================================
                         REFLEXIVE BASIC SERVER DEMO
================================================================================
  Server running at http://localhost:${PORT}
  PID: ${process.pid}
--------------------------------------------------------------------------------
  SUGGESTED WATCH PATTERNS:
    "Login FAILED"     -> "Investigate authentication failure"
    "Slow query"       -> "Check database performance"
    "Deadlock"         -> "Analyze deadlock and suggest fix"
    "SECURITY WARNING" -> "Potential brute force - suggest mitigations"
================================================================================
`);
});

// Log heartbeat periodically
setInterval(() => {
  console.log(`[heartbeat] ${requestCount} requests served, ${visitors.size} unique visitors`);
}, 10000);
