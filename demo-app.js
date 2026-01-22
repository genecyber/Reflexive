import http from 'http';

const PORT = 8080;
let requestCount = 0;
const visitors = new Map();

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
      <ul>
        <li><a href="/status">/status</a> - Server stats</li>
        <li><a href="/slow">/slow</a> - Slow endpoint (2s delay)</li>
        <li><a href="/error">/error</a> - Throws an error</li>
        <li><a href="/memory">/memory</a> - Memory usage</li>
        <li><a href="/silent-error">/silent-error</a> - Silent exception (no logs)</li>
        <li><a href="/foo/example">/foo/[bar]</a> - Dynamic path endpoint</li>
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
  else if (req.url === '/silent-error') {
    // Throw and catch an exception without any logging
    try {
      throw new Error('This exception is caught silently');
    } catch (e) {
      // Silently caught - no console.log, console.error, nothing
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Request handled (silent exception occurred)');
  }
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
  console.log(`Demo app running at http://localhost:${PORT}`);
  console.log(`PID: ${process.pid}`);
});

// Log something periodically
setInterval(() => {
  console.log(`[heartbeat] ${requestCount} requests served, ${visitors.size} unique visitors`);
}, 10000);
