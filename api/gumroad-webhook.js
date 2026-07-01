// /api/gumroad-webhook.js — Revenue Tracking (Section 5)
// Configure in Gumroad: Settings → Advanced → Ping URL → https://yoursite.com/api/gumroad-webhook
// Tracks: Field Guide ($97) · AI Budget Calculator ($97) · Course ($67) purchases

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Gumroad sends application/x-www-form-urlencoded
  const body = req.body;
  const secret = req.headers['x-gumroad-signature'] || body?.webhook_secret;

  // Verify webhook secret if configured
  if (process.env.GUMROAD_WEBHOOK_SECRET && secret !== process.env.GUMROAD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const now = new Date().toISOString();
  const tsMs = Date.now();

  // Parse Gumroad payload
  const event = {
    gumroadId:    body?.sale_id || body?.id || '',
    product:      body?.product_name || body?.product_permalink || 'unknown',
    amount:       parseFloat(body?.price || body?.amount || 0) / 100, // Gumroad sends cents
    currency:     body?.currency || 'USD',
    email:        body?.email || '',
    name:         body?.full_name || '',
    country:      body?.ip_country || '',
    refunded:     body?.refunded === 'true' || body?.refunded === true,
    test:         body?.test === 'true' || body?.test === true,
    timestamp:    now,
    tsMs,
    // UTM from Gumroad if passed via referrer
    referrer:     body?.referrer || '',
  };

  // Skip test purchases and refunds from totals
  const isCountable = !event.test && !event.refunded;

  const R = (path, b) => fetch(
    `${process.env.UPSTASH_REDIS_REST_URL}${path}`,
    { method:'POST', headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' }, body: JSON.stringify(b) }
  );

  try {
    // Store event
    await R(`/rpush/clerking:revenue:all`, { value: JSON.stringify(event) });

    // Per-product revenue
    const safeProduct = event.product.replace(/[^a-z0-9_\-]/gi,'_').slice(0,60);
    await R(`/rpush/clerking:revenue:by_product:${safeProduct}`, { value: JSON.stringify(event) });

    if (isCountable) {
      // Revenue counters
      const amountCents = Math.round(event.amount * 100);
      await R(`/incrby/clerking:stats:revenue_total_cents`, { value: amountCents });
      await R(`/incrby/clerking:stats:revenue_by_product_cents:${safeProduct}`, { value: amountCents });
      await R(`/incr/clerking:stats:purchases_total`, {});
      await R(`/incr/clerking:stats:purchases_by_product:${safeProduct}`, {});

      // Daily revenue
      const dateKey = now.slice(0,10);
      await R(`/incrby/clerking:stats:revenue_by_day:${dateKey}`, { value: amountCents });
    }

    // Slack alert
    if (process.env.SLACK_WEBHOOK_URL_CLERKING || process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL_CLERKING || process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `💰 *Clerking Sale*${event.test ? ' [TEST]' : ''}${event.refunded ? ' [REFUNDED]' : ''}\n*Product:* ${event.product}\n*Amount:* $${event.amount.toFixed(2)}\n*Customer:* ${event.name || '—'} · ${event.email || '—'}\n*Country:* ${event.country || '—'}` }),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('gumroad webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}