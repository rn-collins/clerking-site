// /api/ab.js — A/B Test Variant Assignment (Section 12)
// Assigns stable variants by visitor_id. Called by analytics.js on page load.
// Active tests: cta_copy · headline · form_length · pricing_display · social_proof · lead_magnet

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { visitorId } = req.query;
  if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });

  // Active test definitions
  // Each test has variants with weights (must sum to 1)
  const TESTS = {
    cta_copy: {
      variants: [
        { name: 'control',   value: 'Contact the Architect',    weight: 0.34 },
        { name: 'variant_a', value: 'Get Started',               weight: 0.33 },
        { name: 'variant_b', value: 'Work With Me',              weight: 0.33 },
      ]
    },
    headline: {
      variants: [
        { name: 'control',   value: 'The law clerk placement platform for the next generation of attorneys.', weight: 0.5 },
        { name: 'variant_a', value: 'Fractional law clerks. Supervised, vetted, ready now.', weight: 0.5 },
      ]
    },
    form_length: {
      variants: [
        { name: 'control',   value: 'short',  weight: 0.5 }, // name + email + inquiry type
        { name: 'variant_a', value: 'medium', weight: 0.5 }, // + message field
      ]
    },
    pricing_display: {
      variants: [
        { name: 'control',   value: 'visible',  weight: 0.5 }, // price shown on page
        { name: 'variant_a', value: 'on_inquiry', weight: 0.5 }, // price revealed on form open
      ]
    },
    social_proof: {
      variants: [
        { name: 'control',   value: 'below_cta', weight: 0.5 },
        { name: 'variant_a', value: 'above_cta', weight: 0.5 },
      ]
    },
    lead_magnet: {
      variants: [
        { name: 'control',   value: 'calculator', weight: 0.5 },
        { name: 'variant_a', value: 'sample_template', weight: 0.5 },
      ]
    },
  };

  // Deterministic assignment: hash visitorId + testName → variant
  // Uses consistent hashing so the same visitor always gets the same variant
  function assignVariant(visitorId, testName, variants) {
    const str = `${visitorId}:${testName}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const pct = Math.abs(hash) / 2147483647; // 0..1

    let cumulative = 0;
    for (const v of variants) {
      cumulative += v.weight;
      if (pct < cumulative) return v;
    }
    return variants[0];
  }

  const assignments = {};
  for (const [testName, test] of Object.entries(TESTS)) {
    const assigned = assignVariant(visitorId, testName, test.variants);
    assignments[testName] = {
      variant: assigned.name,
      value: assigned.value,
    };
  }

  // Cache assignment for this visitor (for analytics correlation)
  try {
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/setex/${encodeURIComponent(`clerking:ab:visitor:${visitorId}`)}/${30 * 86400}`,
      { method:'POST',
        headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ value: JSON.stringify(assignments) }) });
  } catch(_) {}

  return res.status(200).json({ visitorId, assignments });
}