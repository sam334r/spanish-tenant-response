// Vercel Serverless Function — keeps the Anthropic API key server-side.
// POST /api/translate { mode: 'to-english' | 'to-spanish', text: string }
// → { translation: string }

export default async function handler(req, res) {
  // CORS / method guard
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured (missing ANTHROPIC_API_KEY)' });
  }

  // Body parsing (Vercel typically auto-parses JSON, but be defensive)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { mode, text } = body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 4000) {
    return res.status(400).json({ error: 'text is too long (max 4000 chars)' });
  }
  if (mode !== 'to-english' && mode !== 'to-spanish') {
    return res.status(400).json({ error: 'mode must be "to-english" or "to-spanish"' });
  }

  // Build the prompt. Output ONLY the translation.
  let prompt;
  if (mode === 'to-english') {
    prompt = `Translate the following Spanish message from a tenant into natural, conversational English a US landlord/property manager would write. Preserve meaning and tone. Output ONLY the translation — no preamble, no quotes, no explanation.\n\nSpanish:\n${text}`;
  } else {
    prompt = `Translate the following English message from a US landlord/property manager into natural, conversational Spanish suitable for sending to a Spanish-speaking tenant. Use a warm but professional tone. Use "usted" (formal) form. Preserve meaning. Output ONLY the translation — no preamble, no quotes, no explanation.\n\nEnglish:\n${text}`;
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Anthropic API error', r.status, errText.slice(0, 500));
      return res.status(502).json({ error: 'Translation service error (' + r.status + ')' });
    }

    const data = await r.json();
    const translation = (data?.content?.[0]?.text || '').trim();
    return res.status(200).json({ translation });
  } catch (e) {
    console.error('Translate handler error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
