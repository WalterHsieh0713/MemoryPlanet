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
// The Claude call itself lives in api/_classify.js, shared with the deployed serverless
// function (api/classify.js) so there is only one implementation.
const { classifyText } = require('./api/_classify.js');

async function classify(req, res) {
  const raw = await readBody(req);
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  let text = '';
  try {
    text = (JSON.parse(raw || '{}').text || '').trim();
  } catch (_) {
    return json(400, { error: 'body must be JSON' });
  }

  const out = await classifyText(text);
  return json(out.status, out.body);
}

function underRoot(file) {
  const root = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  return file === ROOT || file.startsWith(root);
}

// GET /api/assets?dir=<path under the repo> -> { dir, files: [...] }, the .glb names in it.
// Dev-only, and deliberately so: it exists for /asset-sheet/, the contact sheet that renders a
// pack so you can see what a model actually is before cataloguing it. server.js is not
// deployed, so this adds nothing to production. Guarded like the static handler below —
// resolved under ROOT/assets, and anything that escapes is refused.
function listAssets(url, res) {
  const dir = path.normalize(path.join(ROOT, decodeURIComponent(url.searchParams.get('dir') || '')));
  const assets = path.join(ROOT, 'assets');
  const assetsRoot = assets.endsWith(path.sep) ? assets : assets + path.sep;
  if (!underRoot(dir) || (dir !== assets && !dir.startsWith(assetsRoot))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readdir(dir, (err, names) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (err) return res.end(JSON.stringify({ error: 'no such folder' }));
    res.end(JSON.stringify({
      dir: path.relative(ROOT, dir).replace(/\\/g, '/'),
      files: names.filter((n) => n.toLowerCase().endsWith('.glb')).sort()
    }));
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/classify') return await classify(req, res);
    if (req.method === 'GET' && url.pathname === '/api/assets') return listAssets(url, res);

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!underRoot(file) || /(^|[\\/])\.env/.test(file)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.stat(file, (statErr, stat) => {
      // Directory requested without a trailing slash (e.g. /size-test) — redirect to add
      // the slash rather than serving index.html's content at that URL: the page's own
      // relative asset paths (e.g. "size-test.js") resolve against the URL's directory,
      // so serving it at a slash-less URL would silently 404 every relative reference.
      if (!statErr && stat.isDirectory()) {
        res.writeHead(301, { Location: url.pathname + '/' });
        return res.end();
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(buf);
      });
    });
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`Memory Planet: http://localhost:${PORT}`));
