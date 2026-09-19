// POST /api/classify  { text } -> { title, category, mood, people, importance }
// The deployed counterpart of the same route in server.js; both call the shared module.
const { classifyText } = require('./_classify.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch (_) {
      res.status(400).json({ error: 'body must be JSON' });
      return;
    }
  }

  const text = String((body && body.text) || '').trim();
  const out = await classifyText(text);
  res.status(out.status).json(out.body);
};
