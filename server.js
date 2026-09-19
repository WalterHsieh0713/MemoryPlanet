// Static file server + local proxy for the Claude classify call.
// Zero dependencies (Node 18+). Run:  node server.js   ->  http://localhost:8000
const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (KEY=value lines) so nobody needs the dotenv package.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no .env is fine: classify falls back client-side */ }

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// POST /api/classify  { text } -> { title, category, mood, people, importance }
// Calls Claude with a forced tool call, so the response is schema-valid JSON rather than
// prose we'd have to parse. Any failure here returns a non-200 and the client falls back to
// its keyword heuristic — per docs/CONTRACT.md, classify must never reject.
const CATEGORIES = ['achievement', 'everyday', 'travel', 'home', 'social', 'other'];

const MEMORY_TOOL = {
  name: 'record_memory',
  description: 'Record the structured details of a single journal entry.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        description: 'A short, warm title for this memory, at most 48 characters. No trailing period.'
      },
      category: { type: 'string', enum: CATEGORIES },
      mood: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', description: 'One lowercase word, e.g. joyful, steady, low, rough.' },
          valence: { type: 'number', description: 'Pleasantness from -1 (awful) to 1 (wonderful).' },
          intensity: { type: 'number', description: 'Strength of feeling from 0 (flat) to 1 (overwhelming).' }
        },
        required: ['label', 'valence', 'intensity']
      },
      people: {
        type: 'array',
        description: 'Real people mentioned. Never include places, pets, companies or events.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            relationship: {
              type: 'string',
              description: 'Best guess: family, friend, partner, work, or unknown.'
            }
          },
          required: ['name', 'relationship']
        }
      },
      importance: {
        type: 'integer',
        description: 'How significant this entry seems in the writer\'s life, 1 (routine) to 5 (landmark).'
      }
    },
    required: ['title', 'category', 'mood', 'people', 'importance']
  }
};

const SYSTEM_PROMPT = [
  'You read a single personal journal entry and record its details with the record_memory tool.',
  'The entry becomes one building on a small toy planet, so the title should read like a label',
  'on a keepsake — warm, concrete and specific to what happened, never generic.',
  'Only list a person when the text really refers to a person. Place names, venues, pets, brands',
  'and events are not people. Prefer the name exactly as written.',
  'Always call the tool exactly once.'
].join(' ');

function validateClassification(input) {
  if (!input || typeof input !== 'object') return null;
  const mood = input.mood || {};
  const clamp = (n, lo, hi, dflt) =>
    typeof n === 'number' && isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;

  return {
    title: String(input.title || 'A moment').slice(0, 80),
    category: CATEGORIES.includes(input.category) ? input.category : 'other',
    mood: {
      label: String(mood.label || 'steady').toLowerCase().slice(0, 24),
      valence: clamp(mood.valence, -1, 1, 0),
      intensity: clamp(mood.intensity, 0, 1, 0.3)
    },
    people: Array.isArray(input.people)
      ? input.people
          .filter((p) => p && typeof p.name === 'string' && p.name.trim())
          .slice(0, 8)
          .map((p) => ({
            name: p.name.trim().slice(0, 40),
            relationship: String(p.relationship || 'friend').slice(0, 24)
          }))
      : [],
    importance: Math.round(clamp(input.importance, 1, 5, 2))
  };
}

async function classify(req, res) {
  const raw = await readBody(req);
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, { error: 'no ANTHROPIC_API_KEY configured' });
  }

  let text = '';
  try {
    text = (JSON.parse(raw || '{}').text || '').trim();
  } catch (_) {
    return json(400, { error: 'body must be JSON' });
  }
  if (!text) return json(400, { error: 'text is required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // Heavy journal entries can trip a safety decline; this retries on a fallback model
        // inside the same call rather than dropping the user to the keyword heuristic.
        'anthropic-beta': 'server-side-fallback-2026-06-01'
      },
      // Don't let a slow API call hang the journal UI — the client falls back instead.
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 2048,
        // Low effort: this is a small extraction task, and the user is watching a text box.
        // Thinking stays on (adaptive, the Opus 5 default) — disabling it can push tool calls
        // into visible text, which would break the forced-tool parsing below.
        output_config: { effort: 'low' },
        fallbacks: [{ model: 'claude-opus-4-8' }],
        system: SYSTEM_PROMPT,
        tools: [MEMORY_TOOL],
        tool_choice: { type: 'tool', name: 'record_memory' },
        messages: [{ role: 'user', content: text }]
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[classify] Claude API %d: %s', response.status, detail.slice(0, 300));
      return json(502, { error: 'claude request failed' });
    }

    const message = await response.json();
    if (message.stop_reason === 'refusal') {
      return json(502, { error: 'declined' });
    }

    const call = (message.content || []).find((b) => b.type === 'tool_use');
    const result = call && validateClassification(call.input);
    if (!result) {
      console.error('[classify] no usable tool_use block in response');
      return json(502, { error: 'unexpected response shape' });
    }
    return json(200, result);
  } catch (err) {
    console.error('[classify]', err.name === 'TimeoutError' ? 'timed out' : err.message);
    return json(502, { error: 'claude request failed' });
  }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/classify') return await classify(req, res);

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || /(^|[\\/])\.env/.test(file)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`Memory Planet: http://localhost:${PORT}`));
