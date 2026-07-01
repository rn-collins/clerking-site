// /api/events.js — Clerking Event Tracking v1
// Covers: Section 3 (engagement/behavioral) · Section 4 (content analytics)
//         Section 9 (error tracking) · Section 12 (A/B test recording)
// Called by analytics.js (client-side) for every tracked interaction

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, ...data } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Missing event type' });

  const timestamp = new Date().toISOString();
  const tsMs = Date.now();
  const dateKey = timestamp.slice(0, 10);

  // Enrich with server-side data
  const ua = req.headers['user-agent'] || '';
  const device = /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop';
  const event = { type, timestamp, tsMs, device, ...data };

  const R = (path, body) => fetch(
    `${process.env.UPSTASH_REDIS_REST_URL}${path}`,
    { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }
  ).catch(() => null);

  try {
    // Route by event type
    switch (type) {

      // ── SECTION 1 / 11: PAGEVIEW ──────────────────────────────────────────
      case 'pageview': {
        await R(`/rpush/clerking:events:pageviews`, { value: JSON.stringify(event) });
        await R(`/incr/clerking:stats:pageviews:${dateKey}`, {});
        await R(`/incr/clerking:stats:total_pageviews`, {});
        // Per-page counters (Section 4)
        if (data.page) {
          const safeP = data.page.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60);
          await R(`/incr/clerking:stats:pageviews_by_page:${safeP}`, {});
        }
        // Per-source counters (Section 1)
        if (data.trafficSource) {
          await R(`/incr/clerking:stats:pageviews_by_source:${data.trafficSource}`, {});
        }
        // Device breakdown (Section 11)
        await R(`/incr/clerking:stats:pageviews_by_device:${device}`, {});
        // New vs. returning (Section 11)
        const isNew = data.isNewVisitor ? 'new' : 'returning';
        await R(`/incr/clerking:stats:pageviews_by_visitor:${isNew}`, {});
        break;
      }

      // ── SECTION 3: SCROLL DEPTH ───────────────────────────────────────────
      case 'scroll_depth': {
        // Buckets: 25, 50, 75, 100
        const bucket = Math.floor((data.depth || 0) / 25) * 25;
        const page = (data.page || 'unknown').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        await R(`/incr/clerking:stats:scroll:${page}:${bucket}`, {});
        await R(`/rpush/clerking:events:scroll_depth`, { value: JSON.stringify(event) });
        break;
      }

      // ── SECTION 3: CTA CLICK ──────────────────────────────────────────────
      case 'cta_click': {
        const cta = (data.cta || 'unknown').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        await R(`/incr/clerking:stats:cta_clicks:${cta}`, {});
        await R(`/incr/clerking:stats:cta_clicks_total`, {});
        await R(`/rpush/clerking:events:cta_clicks`, { value: JSON.stringify(event) });
        break;
      }

      // ── SECTION 3: FORM OPEN (funnel step 2) ──────────────────────────────
      case 'form_open': {
        await R(`/incr/clerking:stats:funnel:form_opens:${dateKey}`, {});
        await R(`/incr/clerking:stats:funnel:form_opens_total`, {});
        await R(`/rpush/clerking:events:form_opens`, { value: JSON.stringify(event) });
        break;
      }

      // ── SECTION 3: FORM SUBMIT (funnel step 3) — also tracked by lead.js ──
      case 'form_submit': {
        await R(`/incr/clerking:stats:funnel:form_submits:${dateKey}`, {});
        await R(`/incr/clerking:stats:funnel:form_submits_total`, {});
        break;
      }

      // ── SECTION 3: LINK CLICK (email, LinkedIn, Gumroad) ─────────────────
      case 'link_click': {
        const dest = (data.destination || 'unknown').replace(/[^a-z0-9_\-:.\/]/gi,'_').slice(0,80);
        await R(`/incr/clerking:stats:link_clicks:${dest}`, {});
        await R(`/rpush/clerking:events:link_clicks`, { value: JSON.stringify(event) });
        break;
      }

      // ── SECTION 3: FEATURE INTERACTION (calculator, preview, etc.) ────────
      case 'feature': {
        const feat = (data.feature || 'unknown').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        const action = (data.action || 'interact').replace(/[^a-z0-9_\-]/gi,'_').slice(0,40);
        await R(`/incr/clerking:stats:features:${feat}:${action}`, {});
        await R(`/rpush/clerking:events:features`, { value: JSON.stringify(event) });
        break;
      }

      // ── SECTION 9: CLIENT-SIDE JS ERROR ───────────────────────────────────
      case 'js_error': {
        await R(`/rpush/clerking:errors:js`, { value: JSON.stringify({
          ...event,
          message: data.message,
          stack: data.stack,
          url: data.url,
          line: data.line,
        })});
        await R(`/incr/clerking:stats:errors:js`, {});
        break;
      }

      // ── SECTION 9: FORM ERROR (form submitted but API failed) ─────────────
      case 'form_error': {
        await R(`/rpush/clerking:errors:form`, { value: JSON.stringify(event) });
        await R(`/incr/clerking:stats:errors:form`, {});
        break;
      }

      // ── SECTION 12: A/B TEST IMPRESSION ───────────────────────────────────
      case 'ab_impression': {
        const test    = (data.testName || 'unknown').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        const variant = (data.variant  || 'control').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        await R(`/incr/clerking:ab:impressions:${test}:${variant}`, {});
        break;
      }

      // ── SECTION 12: A/B TEST CONVERSION ───────────────────────────────────
      case 'ab_conversion': {
        const test    = (data.testName || 'unknown').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        const variant = (data.variant  || 'control').replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
        await R(`/incr/clerking:ab:conversions:${test}:${variant}`, {});
        break;
      }

      // ── SECTION 13: SESSION END (time-on-page, pages per session) ─────────
      case 'session_end': {
        await R(`/rpush/clerking:events:sessions`, { value: JSON.stringify({
          ...event,
          duration: data.duration,         // ms
          pagesViewed: data.pagesViewed,
          converted: data.converted,
        })});
        if (data.duration) {
          await R(`/rpush/clerking:stats:session_durations`, { value: String(data.duration) });
        }
        break;
      }

      // ── SECTION 10: COMPETITOR / EXTERNAL VISIT ───────────────────────────
      case 'external_referral': {
        await R(`/rpush/clerking:events:external_referrals`, { value: JSON.stringify(event) });
        break;
      }

      default:
        await R(`/rpush/clerking:events:misc`, { value: JSON.stringify(event) });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('event handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}