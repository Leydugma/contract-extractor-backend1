// Vercel serverless function: /api/extract
// Holds the Gemini API key server-side. The browser app never sees it.
// Uses Google's Gemini API (gemini-2.5-flash) — free tier, no credit card required.

module.exports = async function handler(req, res) {
  // Allow the app (running anywhere - your machine, a customer's machine) to call this.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { base64, mimeType, facilityNames = [], vendorNames = [] } = req.body || {};
    if (!base64 || !mimeType) {
      res.status(400).json({ error: 'Missing base64 or mimeType in request body' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Set it in your Vercel project settings.' });
      return;
    }

    const prompt = `Extract key details from this vendor service contract document. Respond with ONLY a raw JSON object, no markdown fences, no preamble, matching exactly this shape:
{"vendorName": string or null, "facilityName": string or null, "serviceLine": string or null, "startDate": "YYYY-MM-DD" or null, "endDate": "YYYY-MM-DD" or null, "cost": number or null, "costFrequency": "monthly" or "quarterly" or "annual" or "one-time" or null, "termsSummary": string or null}
Known facility names already in the system (match to one of these exactly if the document clearly refers to one of them): ${JSON.stringify(facilityNames)}
Known vendor names already in the system (match to one of these exactly if the document clearly refers to one of them): ${JSON.stringify(vendorNames)}
Dates must be in YYYY-MM-DD format, inferred from the contract's effective/start and expiration/end/termination dates. Cost should be the recurring or total contract price as a plain number with no currency symbol. termsSummary should be a brief 1-2 sentence plain-English summary of key obligations, not copied verbatim from the document.`;

    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64 } },
              { text: prompt }
            ]
          }]
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      res.status(geminiRes.status).json({ error: data?.error?.message || 'Gemini API error' });
      return;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('\n');
    if (!text) {
      res.status(500).json({ error: 'Model returned no text content' });
      return;
    }

    const cleaned = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      res.status(500).json({ error: 'Could not parse model output as JSON', raw: cleaned.slice(0, 300) });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
}

