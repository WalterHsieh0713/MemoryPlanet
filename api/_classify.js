// The Claude classify call, shared by the local dev server (server.js) and the deployed
// serverless function (api/classify.js). Zero dependencies (Node 18+ global fetch).
// Calls Claude with a forced tool call, so the response is schema-valid JSON rather than
// prose we'd have to parse. Any failure returns a non-200 and the client falls back to its
// keyword heuristic — per docs/CONTRACT.md, classify must never reject.
const CATEGORIES = ['achievement', 'everyday', 'travel', 'home', 'social', 'other'];

// Serverless platforms cut a function off at their own limit; answer before that happens,
// so the browser gets a real 502 and falls back instead of waiting for a gateway timeout.
const CLASSIFY_TIMEOUT_MS = 9000;

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

// Returns { status, body } rather than writing a response, so both callers can send it
// their own way.
async function classifyText(text) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 503, body: { error: 'no ANTHROPIC_API_KEY configured' } };
  }
  if (!text) return { status: 400, body: { error: 'text is required' } };

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
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
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
      return { status: 502, body: { error: 'claude request failed' } };
    }

    const message = await response.json();
    if (message.stop_reason === 'refusal') {
      return { status: 502, body: { error: 'declined' } };
    }

    const call = (message.content || []).find((b) => b.type === 'tool_use');
    const result = call && validateClassification(call.input);
    if (!result) {
      console.error('[classify] no usable tool_use block in response');
      return { status: 502, body: { error: 'unexpected response shape' } };
    }
    return { status: 200, body: result };
  } catch (err) {
    console.error('[classify]', err.name === 'TimeoutError' ? 'timed out' : err.message);
    return { status: 502, body: { error: 'claude request failed' } };
  }
}

module.exports = { classifyText, validateClassification, CATEGORIES };
