const MAX_BODY_BYTES = 32 * 1024;

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(body);
}

async function readBody(req) {
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    try {
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      const error = new Error('Request body must be valid JSON.');
      error.status = 400;
      throw error;
    }
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
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

module.exports = async function gemini(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Use POST for Gemini requests.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, { error: 'GEMINI_API_KEY is not configured for this deployment.' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, error.status || 400, { error: error.message });
  }

  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return sendJson(res, 400, { error: 'A non-empty prompt is required.' });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
      if ([400, 403, 404].includes(response.status)) {
        return sendJson(res, 502, { error: 'Gemini rejected the request. Check the deployment API key, model, and API access.' });
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
      : 'Could not reach Gemini. Check the deployment network and try again.';
    return sendJson(res, 502, { error: message });
  }
};
