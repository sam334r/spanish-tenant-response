// Vercel Serverless Function - keeps the Anthropic API key server-side.
// Modes:
//   POST { mode: 'to-english',       text }              -> { translation }
//   POST { mode: 'to-spanish',       text }              -> { translation }
//   POST { mode: 'image-to-english', imageData (base64), mediaType } -> { translation }

export const config = { maxDuration: 30 };

const MODEL = 'claude-haiku-4-5-20251001';

export default async function handler(req, res) {
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { mode } = body || {};

  let payload;
  try {
    if (mode === 'to-english' || mode === 'to-spanish') {
      payload = buildTextPayload(mode, body.text);
    } else if (mode === 'image-to-english') {
      payload = buildImagePayload(body.imageData, body.mediaType);
    } else {
      return res.status(400).json({ error: 'mode must be "to-english", "to-spanish", or "image-to-english"' });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Anthropic API error', r.status, errText.slice(0, 500));
      return res.status(502).json({ error: 'Translation service error (' + r.status + ')' });
    }
    const data = await r.json();
    const translation = (data && data.content && data.content[0] && data.content[0].text || '').trim();
    return res.status(200).json({ translation });
  } catch (e) {
    console.error('Translate handler error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

function buildTextPayload(mode, text) {
  if (!text || typeof text !== 'string' || !text.trim()) throw new Error('text is required');
  if (text.length > 4000) throw new Error('text is too long (max 4000 chars)');
  let prompt;
  if (mode === 'to-english') {
    prompt = 'Translate the following Spanish message from a tenant into natural, conversational English a US landlord/property manager would write. Preserve meaning and tone. Output ONLY the translation - no preamble, no quotes, no explanation.\n\nSpanish:\n' + text;
  } else {
    prompt = 'Translate the following English message from a US landlord/property manager into natural, conversational Spanish suitable for sending to a Spanish-speaking tenant. Use a warm but professional tone. Use "usted" (formal) form. Preserve meaning. Output ONLY the translation - no preamble, no quotes, no explanation.\n\nEnglish:\n' + text;
  }
  return {
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  };
}

function buildImagePayload(imageData, mediaType) {
  if (!imageData || typeof imageData !== 'string') throw new Error('imageData is required');
  let data = imageData;
  let mt = mediaType;
  if (data.indexOf('data:') === 0) {
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (m) { mt = mt || m[1]; data = m[2]; }
  }
  const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(mt)) throw new Error('image must be png, jpeg, webp, or gif');
  if (data.length > 7000000) throw new Error('image is too large (max ~5MB)');

  const instruction = 'This image is a screenshot of one or more Spanish-language text messages from a tenant - likely from SMS, WhatsApp, Facebook Messenger, or similar. Read every Spanish message in the image, in the order they appear (top to bottom). Translate each into natural, conversational English a US landlord would write. If there are multiple separate messages, present each as its own line. Ignore timestamps, sender labels, and UI chrome. If there is no Spanish text in the image, say so plainly. Output ONLY the translation(s) - no preamble, no quotes, no explanation of the layout.';

  return {
    model: MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mt, data: data } },
        { type: 'text',  text: instruction }
      ]
    }]
  };
}
