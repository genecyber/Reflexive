// Self-instrumenting demo app
// Run with: node demo-instrumented.js

import http from 'http';
import { makeReflexive } from './src/reflexive.js';

// Instrument this process - starts dashboard on port 3099
const reflexive = makeReflexive({
  port: 3099,
  title: 'Task Queue Demo',
  systemPrompt: `This is a task queue simulation app. It has:
- An HTTP API for submitting and viewing tasks
- A background worker that processes tasks
- Custom state tracking for queue metrics

Help the user understand the queue state, debug issues, and monitor task processing.`
});

// Application state
const tasks = [];
let taskIdCounter = 0;
let processedCount = 0;
let failedCount = 0;

// Expose state to Reflexive
function updateMetrics() {
  reflexive.setState('queueLength', tasks.filter(t => t.status === 'pending').length);
  reflexive.setState('processedCount', processedCount);
  reflexive.setState('failedCount', failedCount);
  reflexive.setState('totalTasks', tasks.length);
}

// Task processor (simulates work)
async function processTask(task) {
  task.status = 'processing';
  console.log(`Processing task ${task.id}: ${task.name}`);

  // Simulate work with random duration
  const duration = 1000 + Math.random() * 2000;
  await new Promise(r => setTimeout(r, duration));

  // 20% chance of failure for demo purposes
  if (Math.random() < 0.2) {
    task.status = 'failed';
    task.error = 'Random failure for demonstration';
    failedCount++;
    console.error(`Task ${task.id} failed: ${task.error}`);
  } else {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    processedCount++;
    console.log(`Task ${task.id} completed successfully`);
  }

  updateMetrics();
}

// Background worker
async function worker() {
  while (true) {
    const pendingTask = tasks.find(t => t.status === 'pending');

    if (pendingTask) {
      await processTask(pendingTask);
    } else {
      // No tasks, wait a bit
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

// Start worker
worker();

// HTTP API
const PORT = 8080;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  console.log(`${req.method} ${url.pathname}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/') {
    res.end(JSON.stringify({
      name: 'Task Queue Demo',
      endpoints: {
        'POST /tasks': 'Create a new task',
        'GET /tasks': 'List all tasks',
        'GET /tasks/:id': 'Get task by ID',
        'GET /metrics': 'Get queue metrics',
        'POST /tasks/batch': 'Create multiple tasks'
      },
      dashboard: 'http://localhost:3099/reflexive'
    }, null, 2));
    return;
  }

  if (url.pathname === '/tasks' && req.method === 'GET') {
    res.end(JSON.stringify(tasks, null, 2));
    return;
  }

  if (url.pathname === '/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const task = {
          id: ++taskIdCounter,
          name: data.name || `Task ${taskIdCounter}`,
          priority: data.priority || 'normal',
          status: 'pending',
          createdAt: new Date().toISOString(),
          data: data.data || {}
        };
        tasks.push(task);
        updateMetrics();
        console.log(`Created task ${task.id}: ${task.name}`);
        res.writeHead(201);
        res.end(JSON.stringify(task, null, 2));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/tasks/batch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const count = data.count || 5;
        const created = [];

        for (let i = 0; i < count; i++) {
          const task = {
            id: ++taskIdCounter,
            name: `Batch Task ${taskIdCounter}`,
            priority: 'normal',
            status: 'pending',
            createdAt: new Date().toISOString(),
            data: { batchIndex: i }
          };
          tasks.push(task);
          created.push(task);
        }

        updateMetrics();
        console.log(`Created ${count} batch tasks`);
        res.writeHead(201);
        res.end(JSON.stringify({ created: created.length, tasks: created }, null, 2));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname.startsWith('/tasks/') && req.method === 'GET') {
    const id = parseInt(url.pathname.split('/')[2]);
    const task = tasks.find(t => t.id === id);
    if (task) {
      res.end(JSON.stringify(task, null, 2));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Task not found' }));
    }
    return;
  }

  if (url.pathname === '/metrics') {
    const pending = tasks.filter(t => t.status === 'pending').length;
    const processing = tasks.filter(t => t.status === 'processing').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;

    res.end(JSON.stringify({
      queue: {
        pending,
        processing,
        completed,
        failed,
        total: tasks.length
      },
      rates: {
        successRate: tasks.length > 0 ? ((completed / (completed + failed)) * 100).toFixed(1) + '%' : 'N/A',
        processedCount,
        failedCount
      },
      memory: process.memoryUsage()
    }, null, 2));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Task Queue API running at http://localhost:${PORT}`);
  console.log(`Reflexive dashboard at http://localhost:3099/reflexive`);

  // Create some initial tasks
  setTimeout(() => {
    for (let i = 0; i < 3; i++) {
      tasks.push({
        id: ++taskIdCounter,
        name: `Initial Task ${taskIdCounter}`,
        priority: 'normal',
        status: 'pending',
        createdAt: new Date().toISOString(),
        data: {}
      });
    }
    updateMetrics();
    console.log('Created 3 initial tasks');
  }, 1000);
});

// Periodic status log
setInterval(() => {
  const pending = tasks.filter(t => t.status === 'pending').length;
  console.log(`[heartbeat] Queue: ${pending} pending, ${processedCount} processed, ${failedCount} failed`);
}, 15000);
