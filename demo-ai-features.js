/**
 * Demo: AI-Powered Application Features
 *
 * This demo shows how to use Reflexive to add AI-powered features to your app:
 * 1. Dynamic AI endpoints (e.g., /poem/:topic generates poems on any topic)
 * 2. AI-powered data operations (filtering, suggestions)
 * 3. Breakpoints for debugging with AI assistance
 *
 * Run with: node demo-ai-features.js
 * Then visit: http://localhost:8080
 * Dashboard: http://localhost:3099/reflexive
 */

import http from 'http';
import { makeReflexive } from './src/reflexive.js';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// Sample data for the dropdown demo
const people = [
  { id: 1, name: 'Alice Chen', role: 'Engineer', department: 'Platform', skills: ['Go', 'Kubernetes', 'AWS'] },
  { id: 2, name: 'Bob Smith', role: 'Designer', department: 'Product', skills: ['Figma', 'CSS', 'User Research'] },
  { id: 3, name: 'Carol Davis', role: 'Engineer', department: 'Frontend', skills: ['React', 'TypeScript', 'GraphQL'] },
  { id: 4, name: 'Dan Wilson', role: 'Manager', department: 'Platform', skills: ['Leadership', 'Agile', 'Strategy'] },
  { id: 5, name: 'Eva Martinez', role: 'Data Scientist', department: 'Analytics', skills: ['Python', 'ML', 'SQL'] },
  { id: 6, name: 'Frank Johnson', role: 'Engineer', department: 'Backend', skills: ['Java', 'Spring', 'PostgreSQL'] },
  { id: 7, name: 'Grace Lee', role: 'DevOps', department: 'Platform', skills: ['Terraform', 'Docker', 'CI/CD'] },
  { id: 8, name: 'Henry Brown', role: 'Engineer', department: 'Mobile', skills: ['Swift', 'Kotlin', 'React Native'] },
];

// Initialize Reflexive with custom tools
const reflexive = makeReflexive({
  port: 3099,
  title: 'AI Features Demo',
  systemPrompt: `You are an AI assistant embedded in a demo application that showcases AI-powered features.

The app has:
1. A /poem/:topic endpoint - when called, generate a short, creative poem about the topic
2. A people directory with filtering - help users find people by natural language queries
3. Breakpoint debugging - the app has breakpoints you can inspect and control

When generating poems, be creative and keep them to 4-8 lines.
When filtering people, interpret natural language like "engineers who know React" or "people in Platform team".

Available people data: ${JSON.stringify(people, null, 2)}`,

  // Custom tools for AI-powered features
  tools: [
    tool(
      'generate_poem',
      'Generate a creative poem about a given topic. Called by the /poem/:topic endpoint.',
      {
        topic: z.string().describe('The topic to write a poem about')
      },
      async ({ topic }) => {
        // The agent will use this tool and return a poem
        return {
          content: [{
            type: 'text',
            text: `Please generate a short, creative poem (4-8 lines) about: ${topic}`
          }]
        };
      }
    ),

    tool(
      'filter_people',
      'Filter the people list based on natural language criteria. Examples: "engineers", "people who know Python", "Platform team members"',
      {
        query: z.string().describe('Natural language query to filter people')
      },
      async ({ query }) => {
        // The agent interprets the query and returns matching people
        return {
          content: [{
            type: 'text',
            text: `Filter the people list based on this query: "${query}"\n\nPeople data:\n${JSON.stringify(people, null, 2)}\n\nReturn JSON array of matching people IDs.`
          }]
        };
      }
    ),

    tool(
      'get_people_list',
      'Get the full list of people in the directory',
      {},
      async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify(people, null, 2)
        }]
      })
    )
  ]
});

// Track state
reflexive.setState('totalPeople', people.length);
reflexive.setState('poemsGenerated', 0);
reflexive.setState('filtersApplied', 0);

let poemsGenerated = 0;
let filtersApplied = 0;

// Generate the web UI
function getIndexHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Features Demo</title>
  <link rel="icon" type="image/jpeg" href="/favicon.ico">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header { display: flex; align-items: center; gap: 20px; margin-bottom: 40px; }
    .logo { width: 80px; height: 80px; border-radius: 12px; object-fit: cover; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .header-content { flex: 1; }
    h1 { font-size: 2rem; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    h2 { font-size: 1.2rem; margin-bottom: 16px; color: #fff; display: flex; align-items: center; gap: 8px; }
    .emoji { font-size: 1.4rem; }
    input, select {
      width: 100%;
      padding: 12px 16px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      margin-bottom: 12px;
    }
    input::placeholder { color: #666; }
    button {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4); }
    button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .result {
      margin-top: 16px;
      padding: 16px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      white-space: pre-wrap;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.9rem;
      min-height: 60px;
    }
    .result.poem { font-style: italic; line-height: 1.8; }
    .people-list { display: grid; gap: 12px; margin-top: 16px; }
    .person {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
    }
    .person-name { font-weight: 600; color: #fff; }
    .person-role { color: #888; font-size: 0.85rem; }
    .person-skills { display: flex; gap: 6px; flex-wrap: wrap; }
    .skill {
      padding: 2px 8px;
      background: rgba(102, 126, 234, 0.3);
      border-radius: 4px;
      font-size: 0.75rem;
    }
    .loading { opacity: 0.6; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
    .dashboard-link {
      display: inline-block;
      margin-top: 20px;
      color: #667eea;
      text-decoration: none;
    }
    .dashboard-link:hover { text-decoration: underline; }
    .note { font-size: 0.85rem; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="/logo" alt="Reflexive Logo" class="logo" />
      <div class="header-content">
        <h1>AI Features Demo</h1>
        <p class="subtitle">Demonstrating AI-powered endpoints and data operations with Reflexive</p>
      </div>
    </div>

    <div class="card">
      <h2><span class="emoji">📝</span> AI Poem Generator</h2>
      <p style="margin-bottom: 16px; color: #888;">Enter any topic and get a unique AI-generated poem</p>
      <input type="text" id="poem-topic" placeholder="Enter a topic (e.g., 'coffee', 'autumn', 'coding')..." />
      <button onclick="generatePoem()">Generate Poem</button>
      <div class="result poem" id="poem-result">Your poem will appear here...</div>
      <p class="note">Try: "the joy of debugging", "a rainy Monday", "machine learning"</p>
    </div>

    <div class="card">
      <h2><span class="emoji">👥</span> AI-Powered People Filter</h2>
      <p style="margin-bottom: 16px; color: #888;">Use natural language to find people in the directory</p>
      <input type="text" id="filter-query" placeholder="e.g., 'engineers who know React' or 'Platform team'" />
      <button onclick="filterPeople()">Find People</button>
      <div class="people-list" id="people-list">
        ${people.map(p => `
          <div class="person" data-id="${p.id}">
            <div>
              <div class="person-name">${p.name}</div>
              <div class="person-role">${p.role} · ${p.department}</div>
            </div>
            <div class="person-skills">
              ${p.skills.map(s => `<span class="skill">${s}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <p class="note">Try: "designers", "people who know AWS", "Backend team engineers"</p>
    </div>

    <div class="card">
      <h2><span class="emoji">🔧</span> Breakpoint Demo</h2>
      <p style="margin-bottom: 16px; color: #888;">Trigger a breakpoint and control execution from the Reflexive dashboard</p>
      <button onclick="triggerBreakpoint()">Trigger Breakpoint</button>
      <div class="result" id="breakpoint-result">Click to trigger a breakpoint. Watch the dashboard!</div>
      <p class="note">Open the <a href="http://localhost:3099/reflexive" target="_blank" style="color: #667eea;">Reflexive dashboard</a> to see and resume the breakpoint.</p>
    </div>

    <div class="card" style="background: linear-gradient(135deg, rgba(52, 211, 153, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%); border-color: rgba(52, 211, 153, 0.3);">
      <h2><span class="emoji">⚡</span> Quick Add Person (AI Injected!)</h2>
      <p style="margin-bottom: 16px; color: #888;">Click to instantly add a randomly generated person to the directory</p>
      <button onclick="quickAddPerson()" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
        ⚡ Add Random Person
      </button>
      <div class="result" id="quick-add-result">Click the button to add someone new!</div>
      <p class="note" style="color: #10b981;">✨ This feature calls reflexive.chat() just like the poem generator!</p>
    </div>

    <a href="http://localhost:3099/reflexive" target="_blank" class="dashboard-link">Open Reflexive Dashboard →</a>
  </div>

  <script>
    async function generatePoem() {
      const topic = document.getElementById('poem-topic').value.trim();
      if (!topic) return alert('Please enter a topic');

      const result = document.getElementById('poem-result');
      result.textContent = 'Generating poem...';
      result.classList.add('loading');

      try {
        const res = await fetch('/poem/' + encodeURIComponent(topic));
        const data = await res.json();
        result.textContent = data.poem || data.error || 'No poem generated';
      } catch (e) {
        result.textContent = 'Error: ' + e.message;
      }
      result.classList.remove('loading');
    }

    async function filterPeople() {
      const query = document.getElementById('filter-query').value.trim();
      if (!query) return alert('Please enter a filter query');

      const list = document.getElementById('people-list');
      list.classList.add('loading');

      try {
        const res = await fetch('/filter?q=' + encodeURIComponent(query));
        const data = await res.json();

        // Highlight matching people
        document.querySelectorAll('.person').forEach(el => {
          el.style.opacity = data.matchingIds?.includes(parseInt(el.dataset.id)) ? '1' : '0.3';
        });
      } catch (e) {
        alert('Error: ' + e.message);
      }
      list.classList.remove('loading');
    }

    async function triggerBreakpoint() {
      const result = document.getElementById('breakpoint-result');
      result.textContent = 'Triggering breakpoint... Check the dashboard!';
      result.classList.add('loading');

      try {
        const res = await fetch('/debug/breakpoint');
        const data = await res.json();
        result.textContent = data.message || 'Breakpoint completed';
      } catch (e) {
        result.textContent = 'Error: ' + e.message;
      }
      result.classList.remove('loading');
    }

    async function quickAddPerson() {
      const result = document.getElementById('quick-add-result');
      result.textContent = 'Asking AI to generate a person...';
      result.classList.add('loading');

      try {
        const res = await fetch('/api/quick-add', { method: 'POST' });
        const data = await res.json();

        if (data.error) {
          result.textContent = 'Error: ' + data.error;
        } else {
          result.textContent = '✨ Added: ' + data.name + ' (' + data.role + ' in ' + data.department + ')';

          // Refresh the people list after a short delay
          setTimeout(() => location.reload(), 1500);
        }
      } catch (e) {
        result.textContent = 'Error: ' + e.message;
      }
      result.classList.remove('loading');
    }

  </script>
</body>
</html>`;
}

// HTTP Server
const PORT = 8080;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  console.log(`${req.method} ${url.pathname}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve logo
  if (url.pathname === '/logo' || url.pathname === '/logo1.jpg') {
    try {
      const fs = await import('fs/promises');
      const logoPath = new URL('./logo1.jpg', import.meta.url);
      const logoData = await fs.readFile(logoPath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(logoData);
    } catch (e) {
      res.writeHead(404);
      res.end('Logo not found');
    }
    return;
  }

  // Serve secondary logo
  if (url.pathname === '/logo2.jpg') {
    try {
      const fs = await import('fs/promises');
      const logoPath = new URL('./logo2.jpg', import.meta.url);
      const logoData = await fs.readFile(logoPath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(logoData);
    } catch (e) {
      res.writeHead(404);
      res.end('Logo not found');
    }
    return;
  }

  // Serve favicon (using logo2)
  if (url.pathname === '/favicon.ico') {
    try {
      const fs = await import('fs/promises');
      const logoPath = new URL('./logo2.jpg', import.meta.url);
      const logoData = await fs.readFile(logoPath);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(logoData);
    } catch (e) {
      res.writeHead(404);
      res.end('Favicon not found');
    }
    return;
  }

  // Serve index page
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end(getIndexHTML());
    return;
  }

  // AI Poem endpoint
  if (url.pathname.startsWith('/poem/')) {
    const topic = decodeURIComponent(url.pathname.slice(6));
    console.log(`Generating poem about: ${topic}`);

    // Use Reflexive's chat to generate the poem
    try {
      const poem = await reflexive.chat(`Generate a short, creative poem (4-8 lines) about: ${topic}. Return ONLY the poem text, no explanation.`);
      poemsGenerated++;
      reflexive.setState('poemsGenerated', poemsGenerated);

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ topic, poem }));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // AI Filter endpoint
  if (url.pathname === '/filter') {
    const query = url.searchParams.get('q');
    console.log(`Filtering people: ${query}`);

    try {
      const response = await reflexive.chat(
        `Given this people data:\n${JSON.stringify(people, null, 2)}\n\n` +
        `Filter for: "${query}"\n\n` +
        `Return ONLY a JSON object like {"matchingIds": [1,2,3]} with the IDs of matching people. No explanation.`
      );

      // Parse the response to extract IDs
      const match = response.match(/\{[\s\S]*"matchingIds"[\s\S]*\}/);
      let matchingIds = [];
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          matchingIds = parsed.matchingIds || [];
        } catch (e) {
          // Try to extract numbers from response
          matchingIds = (response.match(/\d+/g) || []).map(Number);
        }
      }

      filtersApplied++;
      reflexive.setState('filtersApplied', filtersApplied);

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ query, matchingIds }));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message, matchingIds: [] }));
    }
    return;
  }

  // Quick Add Person endpoint (uses AI to generate person data)
  if (url.pathname === '/api/quick-add' && req.method === 'POST') {
    console.log('Quick adding person with AI...');

    try {
      // Use reflexive.chat() to generate a random person - just like the poem endpoint!
      const prompt = `Generate a random person for a company directory. Return ONLY valid JSON in this exact format with no markdown, no explanation:
{"name": "FirstName LastName", "role": "Job Title", "department": "Department Name", "skills": ["Skill1", "Skill2", "Skill3"]}

Use realistic, diverse names. Choose from these roles: Engineer, Designer, Product Manager, Data Scientist, DevOps, QA Engineer.
Departments: Platform, Frontend, Backend, Mobile, Analytics, Infrastructure.
Skills: JavaScript, Python, React, Vue, Docker, Kubernetes, AWS, GCP, TypeScript, Go, Rust, SQL, NoSQL, GraphQL, REST, CI/CD`;

      const aiResponse = await reflexive.chat(prompt);

      // Parse the JSON response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse AI response');
      }

      const personData = JSON.parse(jsonMatch[0]);

      // Add to people array
      const newPerson = {
        id: people.length + 1,
        ...personData
      };

      people.push(newPerson);
      reflexive.setState('totalPeople', people.length);
      console.log(`✨ AI generated and added: ${newPerson.name} (${newPerson.role})`);

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(newPerson));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Breakpoint demo endpoint
  if (url.pathname === '/debug/breakpoint') {
    console.log('Triggering breakpoint demo...');

    // Use process.reflexive.breakpoint if available (when running with --inject)
    if (process.reflexive && process.reflexive.breakpoint) {
      const context = {
        requestUrl: url.pathname,
        timestamp: new Date().toISOString(),
        peopleCount: people.length,
        stats: { poemsGenerated, filtersApplied }
      };

      console.log('Hitting breakpoint - check dashboard to resume');
      const result = await process.reflexive.breakpoint('debug-endpoint', context);

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        message: 'Breakpoint completed! Execution was paused and resumed.',
        returnValue: result
      }));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        message: 'Breakpoint feature requires --inject flag. Run: reflexive --inject demo-ai-features.js'
      }));
    }
    return;
  }

  // Get people
  if (url.pathname === '/api/people') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(people));
    return;
  }

  // 404
  res.writeHead(404);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    AI Features Demo                            ║
╠════════════════════════════════════════════════════════════════╣
║  Web App:    http://localhost:${PORT}                             ║
║  Dashboard:  http://localhost:3099/reflexive                   ║
╠════════════════════════════════════════════════════════════════╣
║  Features:                                                     ║
║  • /poem/:topic  - AI-generated poems                          ║
║  • /filter?q=... - Natural language people filter              ║
║  • /debug/breakpoint - Breakpoint demo (needs --inject)        ║
╠════════════════════════════════════════════════════════════════╣
║  For breakpoints, run with:                                    ║
║  node src/reflexive.js --inject demo-ai-features.js            ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
