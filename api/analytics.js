// /api/analytics.js — Clerking Analytics Aggregation Engine
// Covers: ALL 14 SECTIONS — aggregates from Upstash and returns structured data
// Protected by ADMIN_API_KEY query param or Authorization header

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', 'https://clerking-site.vercel.app');
  if (req.headers.origin && req.headers.origin !== 'https://clerking-site.vercel.app') return res.status(403).json({ error: 'Origin not allowed' });
  if (!process.env.ADMIN_API_KEY || !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return res.status(503).json({ error: 'Operator analytics are not configured' });

  // ── AUTH ─────────────────────────────────────────────────────────────────────
  const key = req.query.key || req.headers.authorization?.replace('Bearer ','');
  if (key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const G = async (path) => {
    const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}${path}`,
      { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
    const j = await r.json();
    return j.result;
  };
  const GET = async (key) => G(`/get/${encodeURIComponent(key)}`);
  const LLEN = async (key) => parseInt(await G(`/llen/${encodeURIComponent(key)}`)) || 0;
  const LRANGE = async (key, start=0, end=99) => {
    const r = await G(`/lrange/${encodeURIComponent(key)}/${start}/${end}`);
    if (!Array.isArray(r)) return [];
    return r.map(v => { try { return JSON.parse(v); } catch { return v; } });
  };

  // Helper: parse stored JSON values
  const n = (v) => parseInt(v) || 0;

  // Generate last 30 day keys
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    last30.push(d.toISOString().slice(0, 10));
  }

  try {
    // ── SECTION 1: TRAFFIC INTELLIGENCE ──────────────────────────────────────
    const totalPageviews   = n(await GET('clerking:stats:total_pageviews'));
    const totalLeads       = n(await GET('clerking:stats:total_leads'));

    const pvBySource = {};
    for (const src of ['linkedin','google','direct','rncollins','referral','email']) {
      pvBySource[src] = n(await GET(`clerking:stats:pageviews_by_source:${src}`));
    }

    const pvByDevice = {
      mobile:  n(await GET('clerking:stats:pageviews_by_device:mobile')),
      desktop: n(await GET('clerking:stats:pageviews_by_device:desktop')),
      tablet:  n(await GET('clerking:stats:pageviews_by_device:tablet')),
    };

    const pvByVisitor = {
      new:       n(await GET('clerking:stats:pageviews_by_visitor:new')),
      returning: n(await GET('clerking:stats:pageviews_by_visitor:returning')),
    };

    // Daily pageviews for trend chart (last 30 days)
    const dailyPageviews = {};
    for (const d of last30) {
      dailyPageviews[d] = n(await GET(`clerking:stats:pageviews:${d}`));
    }

    // ── SECTION 2: LEAD & CONVERSION ANALYTICS ───────────────────────────────
    const dailyLeads = {};
    for (const d of last30) {
      dailyLeads[d] = n(await GET(`clerking:stats:daily_leads:${d}`));
    }

    const leadsByType = {};
    for (const t of ['attorney_founding','attorney_intake','student_intake','student_waitlist','general_contact','unknown']) {
      leadsByType[t] = await LLEN(`clerking:leads:by_type:${t}`);
    }

    const leadsBySource = {};
    for (const src of ['linkedin','google','direct','rncollins','referral','email']) {
      leadsBySource[src] = await LLEN(`clerking:leads:by_source:${src}`);
    }

    const leadsByDevice = {
      mobile:  await LLEN('clerking:leads:by_device:mobile'),
      desktop: await LLEN('clerking:leads:by_device:desktop'),
    };

    const repeatInquiries = n(await GET('clerking:stats:repeat_inquiries'));

    // Conversion rate: leads / pageviews
    const conversionRate = totalPageviews > 0
      ? ((totalLeads / totalPageviews) * 100).toFixed(2) + '%'
      : 'N/A';

    // Funnel (Section 2 + 3)
    const funnelFormOpens   = n(await GET('clerking:stats:funnel:form_opens_total'));
    const funnelFormSubmits = n(await GET('clerking:stats:funnel:form_submits_total'));
    const formOpenRate   = totalPageviews > 0 ? ((funnelFormOpens   / totalPageviews) * 100).toFixed(1) + '%' : 'N/A';
    const formSubmitRate = funnelFormOpens > 0 ? ((funnelFormSubmits / funnelFormOpens) * 100).toFixed(1) + '%' : 'N/A';

    // Recent leads (last 20)
    const recentLeads = await LRANGE('clerking:leads:all', -20, -1);

    // ── SECTION 3: ENGAGEMENT & BEHAVIORAL ────────────────────────────────────
    // CTA clicks
    const ctaClicks = {};
    for (const cta of ['contact_the_architect','course_link','field_guide_link','email_link','linkedin_link','calculator_start']) {
      ctaClicks[cta] = n(await GET(`clerking:stats:cta_clicks:${cta}`));
    }
    const totalCtaClicks = n(await GET('clerking:stats:cta_clicks_total'));

    // Scroll depth on main Clerking page
    const scrollDepth = {};
    const page = 'clerking'; // main page slug
    for (const pct of [25, 50, 75, 100]) {
      scrollDepth[pct] = n(await GET(`clerking:stats:scroll:${page}:${pct}`));
    }

    // Feature interactions (calculator etc.)
    const features = {};
    for (const [feat, action] of [['calculator','start'],['calculator','complete'],['field_guide','preview'],['calculator','result']]) {
      features[`${feat}:${action}`] = n(await GET(`clerking:stats:features:${feat}:${action}`));
    }

    // Session durations (sample last 50)
    const rawDurations = await LRANGE('clerking:stats:session_durations', -50, -1);
    const durations = rawDurations.map(v => parseInt(v)||0).filter(v => v > 0);
    const avgSessionMs = durations.length > 0 ? Math.round(durations.reduce((a,b)=>a+b,0) / durations.length) : 0;

    // ── SECTION 4: CONTENT ANALYTICS ──────────────────────────────────────────
    // Pages by slug
    const pageViews = {};
    for (const p of ['clerking','clerking_templates','clerking_about','clerking_contact','set_for','aloha_ai']) {
      pageViews[p] = n(await GET(`clerking:stats:pageviews_by_page:${p}`));
    }

    // ── SECTION 5: PRODUCT & REVENUE ──────────────────────────────────────────
    // Gumroad events
    const revenueEvents = await LRANGE('clerking:revenue:all', -50, -1);
    const totalRevenue  = revenueEvents.reduce((acc, e) => acc + (e.amount || 0), 0);
    const revenueByProduct = {};
    revenueEvents.forEach(e => {
      const prod = e.product || 'unknown';
      revenueByProduct[prod] = (revenueByProduct[prod] || 0) + (e.amount || 0);
    });

    // Waitlist count (Section 5 / future platform)
    const waitlistCount = await LLEN('clerking:waitlist:all');

    // ── SECTION 7: LEAD INTELLIGENCE / PIPELINE ────────────────────────────────
    // Pipeline status counts — scan recent leads
    const allRecentLeads = await LRANGE('clerking:leads:all', -100, -1);
    const pipeline = { new:0, contacted:0, in_conversation:0, proposal:0, client:0, won:0, lost:0 };
    allRecentLeads.forEach(l => {
      const s = l.pipelineStatus || 'new';
      pipeline[s] = (pipeline[s]||0) + 1;
    });

    // Repeat inquiry rate
    const repeatRate = totalLeads > 0
      ? ((repeatInquiries / totalLeads) * 100).toFixed(1) + '%'
      : '0%';

    // ── SECTION 8: SEO PLACEHOLDER (populated by GSC API when connected) ──────
    const seo = { note: 'Connect Google Search Console via GSC_ACCESS_TOKEN env var to populate.' };

    // ── SECTION 9: PERFORMANCE & ERRORS ──────────────────────────────────────
    const errors = {
      js:   n(await GET('clerking:stats:errors:js')),
      form: n(await GET('clerking:stats:errors:form')),
      api:  n(await GET('clerking:stats:errors:api')),
    };
    const recentErrors = await LRANGE('clerking:errors:js', -10, -1);

    // ── SECTION 11: AUDIENCE / DEVICE ─────────────────────────────────────────
    // Already captured above in pvByDevice and leadsByDevice

    // ── SECTION 12: A/B TESTING ────────────────────────────────────────────────
    // Active tests — cta_copy, headline, form_length
    const abTests = {};
    for (const test of ['cta_copy', 'headline', 'form_length', 'pricing_display', 'social_proof']) {
      abTests[test] = {};
      for (const variant of ['control', 'variant_a', 'variant_b']) {
        const impressions  = n(await GET(`clerking:ab:impressions:${test}:${variant}`));
        const conversions  = n(await GET(`clerking:ab:conversions:${test}:${variant}`));
        const cvr = impressions > 0 ? ((conversions/impressions)*100).toFixed(1)+'%' : 'N/A';
        abTests[test][variant] = { impressions, conversions, conversionRate: cvr };
      }
    }

    // ── SECTION 13: TIME-BASED & TREND ────────────────────────────────────────
    const leadsByDay = {};
    for (const day of ['sun','mon','tue','wed','thu','fri','sat']) {
      leadsByDay[day] = n(await GET(`clerking:stats:leads_by_day:${day}`));
    }
    const leadsByHour = {};
    for (let h = 0; h < 24; h++) {
      leadsByHour[h] = n(await GET(`clerking:stats:leads_by_hour:${h}`));
    }
    // Peak hour
    const peakHour = Object.entries(leadsByHour).sort((a,b)=>b[1]-a[1])[0];
    const peakDay  = Object.entries(leadsByDay ).sort((a,b)=>b[1]-a[1])[0];

    // ── SECTION 14: OPERATIONAL / SLACK ───────────────────────────────────────
    const opsMetrics = {
      totalLeadsAllTime: totalLeads,
      repeatInquiries,
      repeatRate,
      recentLeadCount_30d: Object.values(dailyLeads).reduce((a,b)=>a+b,0),
      avgDailyLeads_30d: (Object.values(dailyLeads).reduce((a,b)=>a+b,0) / 30).toFixed(1),
    };

    // ── ASSEMBLE FULL RESPONSE ────────────────────────────────────────────────
    return res.status(200).json({
      generated: new Date().toISOString(),
      s1_traffic: {
        totalPageviews, dailyPageviews, pvBySource, pvByDevice, pvByVisitor,
        topSource: Object.entries(pvBySource).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'unknown',
      },
      s2_conversion: {
        totalLeads, leadsByType, leadsBySource, leadsByDevice, repeatInquiries,
        conversionRate, formOpenRate, formSubmitRate,
        funnel: { pageviews: totalPageviews, formOpens: funnelFormOpens, formSubmits: funnelFormSubmits },
        dailyLeads, recentLeads: recentLeads.slice(-5),
      },
      s3_engagement: {
        ctaClicks, totalCtaClicks, scrollDepth, features,
        avgSessionSec: Math.round(avgSessionMs/1000),
        topCta: Object.entries(ctaClicks).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'none',
      },
      s4_content: { pageViews },
      s5_revenue: { totalRevenue, revenueByProduct, revenueEvents: revenueEvents.slice(-10), waitlistCount },
      s7_leadIntel: { pipeline, repeatRate, allLeadCount: totalLeads, recentLeads: allRecentLeads.slice(-10) },
      s8_seo: seo,
      s9_errors: { errors, recentJsErrors: recentErrors },
      s11_audience: { pvByDevice, leadsByDevice },
      s12_ab: abTests,
      s13_trends: { leadsByDay, leadsByHour, peakHour: peakHour?.[0], peakDay: peakDay?.[0] },
      s14_ops: opsMetrics,
    });

  } catch (err) {
    console.error('analytics aggregation error:', err);
    return res.status(500).json({ error: err.message });
  }
}