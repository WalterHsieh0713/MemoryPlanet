// Only public browser configuration. Never return server/service-role credentials.
module.exports = function config(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end('{}'); }
  var url = (process.env.SUPABASE_URL || '').trim();
  var key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  var publicKey = key.startsWith('sb_publishable_');
  if (!publicKey && key.split('.').length === 3) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch (_) {}
  }
  var validUrl = false;
  try {
    var parsed = new URL(url);
    validUrl = parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch (_) {}
  res.end(JSON.stringify(validUrl && publicKey ? { url: url, key: key } : { configured: false }));
};
