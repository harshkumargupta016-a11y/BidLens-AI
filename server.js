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
const maxBodyBytes = 32 * 1024;

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

  if (!process.env.GEMINI_API_KEY) {
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
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: body.prompt }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(30_000),
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

    if (pathname === '/api/gemini') {
      await handleGemini(req, res);
      return;
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

  instance.listen(candidatePort, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${candidatePort}`;
    console.log(`BidLens is running at ${url}`);
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
