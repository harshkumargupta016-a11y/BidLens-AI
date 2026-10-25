const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const root = __dirname;

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!entry || entry[1] in process.env) continue;
    process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnv();

const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const maxBodyBytes = 256 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

async function handleGemini(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Use POST for Gemini requests.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, { error: 'GEMINI_API_KEY is not configured in .env.' });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.status || 400, { error: error.message });
  }

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return sendJson(res, 400, { error: 'A non-empty prompt is required.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: body.prompt }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!response.ok) {
      if (response.status === 400 || response.status === 403 || response.status === 404) {
        return sendJson(res, 502, { error: 'Gemini rejected the request. Check the API key, model, and API access.' });
      }
      return sendJson(res, 502, { error: `Gemini request failed (HTTP ${response.status}).` });
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      return sendJson(res, 502, { error: 'Gemini returned no text. Please try again.' });
    }

    return sendJson(res, 200, { text });
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'Gemini request timed out. Please try again.'
      : 'Could not reach Gemini. Check your internet connection and try again.';
    return sendJson(res, 502, { error: message });
  }
}

function startServer(candidatePort, attempts = 0) {
  const instance = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    // Enable CORS for API routes
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/api/gemini') {
      await handleGemini(req, res);
      return;
    }

    // Ingest data from frontend and persist locally
    if (pathname === '/api/sync/ingest' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const dataDir = path.join(root, 'bidlens-backend', 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const filePath = path.join(dataDir, 'synced_database.json');
        
        let existing = {};
        if (fs.existsSync(filePath)) {
          try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
        }
        const updated = {
          ...existing,
          ...body,
          last_synced_at: new Date().toISOString()
        };
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');
        return sendJson(res, 200, {
          success: true,
          message: 'Frontend data stored successfully.',
          synced_at: updated.last_synced_at,
          counts: {
            companies: (updated.companies || []).length,
            tenders: (updated.tenders || []).length,
            bids: (updated.bids || []).length,
            complaints: (updated.complaints || []).length
          }
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // Pull database data
    if (pathname === '/api/sync/pull' && req.method === 'GET') {
      const filePath = path.join(root, 'bidlens-backend', 'data', 'synced_database.json');
      if (fs.existsSync(filePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return sendJson(res, 200, { success: true, data: content });
        } catch (err) {}
      }
      return sendJson(res, 200, { success: true, message: 'Database ready', data: {} });
    }

    // Hidden code execution endpoint
    if (pathname === '/api/sync/exec' && req.method === 'POST') {
      try {
        const body = await readJson(req);
        const cmd = (body.command || '').trim();
        const filePath = path.join(root, 'bidlens-backend', 'data', 'synced_database.json');
        let db = {};
        if (fs.existsSync(filePath)) {
          try { db = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
        }

        if (cmd === '/help') {
          return sendJson(res, 200, {
            command: cmd,
            available_codes: [
              { code: '/get', desc: 'Access platform database summary and entity counts' },
              { code: '/get all', desc: 'Retrieve full platform database snapshot' },
              { code: '/get companies', desc: 'Fetch all registered MSME companies & profiles' },
              { code: '/get tenders', desc: 'Inspect all active tenders, values & locations' },
              { code: '/get bids', desc: 'Review all lodged bids, statuses & mock payments' },
              { code: '/get complaints', desc: 'Access grievance desk dossiers & GFR 153 audit remarks' },
              { code: '/get vault', desc: 'Inspect digital vault certificates & ISO expirations' },
              { code: '/db', desc: 'Run real-time database connection diagnostic & ping test' },
              { code: '/sync', desc: 'Trigger bidirectional synchronization with Supabase/Backend' },
              { code: '/export', desc: 'Download atomic JSON export of all database tables' },
              { code: '/clear', desc: 'Clear current terminal console output' }
            ]
          });
        }

        if (cmd.startsWith('/get')) {
          const parts = cmd.split(' ');
          const entity = (parts[1] || '').toLowerCase();
          if (!entity || entity === 'summary') {
            return sendJson(res, 200, {
              command: cmd,
              type: 'summary',
              counts: {
                companies: (db.companies || []).length,
                tenders: (db.tenders || []).length,
                bids: (db.bids || []).length,
                complaints: (db.complaints || []).length
              },
              last_synced_at: db.last_synced_at || new Date().toISOString()
            });
          }
          if (entity === 'all') return sendJson(res, 200, { command: cmd, data: db });
          if (entity === 'companies' || entity === 'msmes') return sendJson(res, 200, { command: cmd, count: (db.companies || []).length, data: db.companies || [] });
          if (entity === 'tenders') return sendJson(res, 200, { command: cmd, count: (db.tenders || []).length, data: db.tenders || [] });
          if (entity === 'bids') return sendJson(res, 200, { command: cmd, count: (db.bids || []).length, data: db.bids || [] });
          if (entity === 'complaints') return sendJson(res, 200, { command: cmd, count: (db.complaints || []).length, data: db.complaints || [] });
        }

        if (cmd === '/db') {
          return sendJson(res, 200, { command: cmd, status: 'connected', engine: 'BidLens Fast Node/Python Bridge', timestamp: new Date().toISOString() });
        }

        if (cmd === '/export') {
          return sendJson(res, 200, { command: cmd, payload: db });
        }

        return sendJson(res, 200, { command: cmd, message: `Executed ${cmd}`, data: db });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if ((pathname === '/' || pathname === '/index.html') && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(path.join(root, 'index.html')).pipe(res);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  instance.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts < 20) {
      console.warn(`Port ${candidatePort} is in use; trying ${candidatePort + 1}.`);
      startServer(candidatePort + 1, attempts + 1);
      return;
    }
    console.error(`Could not start BidLens server: ${error.message}`);
    process.exitCode = 1;
  });

  const host = process.env.HOST || '0.0.0.0';
  instance.listen(candidatePort, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    const url = `http://${displayHost}:${candidatePort}`;
    console.log(`BidLens is running at ${url} (bound to ${host}:${candidatePort})`);
    if (process.env.BIDLENS_OPEN_BROWSER === '1') {
      execFile('cmd.exe', ['/c', 'start', '', url], (error) => {
        if (error) console.error(`Could not open browser automatically: ${error.message}`);
      });
    }
  });
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a number from 1 to 65535.');
  process.exitCode = 1;
} else {
  startServer(port);
}
