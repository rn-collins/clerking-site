// /api/waitlist.js — Placement Platform Pre-Launch Waitlist (Section 5)
// Captures early interest in the post-bar (2029+) two-sided placement platform
// Displays at bottom of Clerking site as low-friction email capture

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const R = (path, body) => fetch(
    `${process.env.UPSTASH_REDIS_REST_URL}${path}`,
    { method:'POST', headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify(body) }
  );
  const G = (path) => fetch(`${process.env.UPSTASH_REDIS_REST_URL}${path}`,
    { headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } }).then(r=>r.json()).then(j=>j.result);

  // GET — return waitlist count (public, for social proof counter on site)
  if (req.method === 'GET') {
    try {
      const count = parseInt(await G('/get/clerking:waitlist:count')) || 0;
      return res.status(200).json({ count });
    } catch { return res.status(200).json({ count: 0 }); }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { email, name, role, utm_source, utm_campaign } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const timestamp = new Date().toISOString();
  const tsMs = Date.now();

  // Duplicate check
  try {
    const existing = await G(`/get/${encodeURIComponent(`clerking:waitlist:email:${email}`)}`);
    if (existing) return res.status(200).json({ ok: true, alreadyRegistered: true, message: "You're already on the list." });
  } catch(_) {}

  const entry = { email, name: name||'', role: role||'', utm_source: utm_source||'', utm_campaign: utm_campaign||'', timestamp, tsMs };

  try {
    // Store
    await R(`/set/${encodeURIComponent(`clerking:waitlist:email:${email}`)}`, { value: JSON.stringify(entry) });
    await R(`/rpush/clerking:waitlist:all`, { value: JSON.stringify(entry) });
    await R(`/incr/clerking:waitlist:count`, {});

    // Source tracking (Section 5 waitlist source attribution)
    if (utm_source) await R(`/incr/clerking:waitlist:by_source:${utm_source}`, {});
    if (role) await R(`/incr/clerking:waitlist:by_role:${role}`, {});

    // Geographic (from IP — rough country)
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || '';
    if (ip) entry.ip = ip;

    // Confirmation email
    if (process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method:'POST',
        headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({
          from: 'Clerking <rn@rncollins.com>',
          to: [email],
          subject: "You're on the Clerking platform waitlist",
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#6B2937;padding:20px 30px"><p style="color:#fff;font-weight:700;font-size:18px;margin:0">Clerking</p></div><div style="padding:30px;border:1px solid #e5e7eb;border-top:none"><p>Hi ${name||'there'},</p><p>You're on the waitlist for the Clerking placement platform — the two-sided marketplace connecting verified law students with attorneys who need fractional research and writing support.</p><p>The platform launches post-bar (2029+). As a waitlist member, you'll get early access and founding pricing when it goes live.</p><p style="color:#6B2937;font-size:13px">— RN Collins · Founder, Clerking</p><hr style="border:1px solid #f1f5f9;margin:24px 0"><p style="font-size:12px;color:#9ca3af">Clerking · rncollins.com/clerking</p></div></div>`,
        }),
      });
    }

    // Slack
    if (process.env.SLACK_WEBHOOK_URL_CLERKING || process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL_CLERKING || process.env.SLACK_WEBHOOK_URL, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text: `🚀 *Waitlist signup* — ${email}${name ? ` (${name})` : ''}${role ? ` · ${role}` : ''}${utm_source ? ` · via ${utm_source}` : ''}` }),
      });
    }

    return res.status(200).json({ ok: true, message: "You're on the list." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}