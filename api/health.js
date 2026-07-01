// /api/health.js — Uptime Monitoring Endpoint (Section 9)
// Configure UptimeRobot / BetterUptime / Freshping to ping this URL every 5 minutes
// Returns 200 with system status — alerts if Upstash/Redis unreachable

export default async function handler(req, res) {
  const start = Date.now();
  const checks = {};

  // Check Upstash connectivity
  try {
    const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ping`,
      { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
    const j = await r.json();
    checks.upstash = j.result === 'PONG' ? 'ok' : 'degraded';
  } catch { checks.upstash = 'error'; }

  const latencyMs = Date.now() - start;
  const allOk = Object.values(checks).every(v => v === 'ok');

  // Log uptime ping to Upstash for trend analysis
  try {
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/rpush/clerking:uptime:pings`,
      { method:'POST', headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ value: JSON.stringify({ ts: new Date().toISOString(), latencyMs, checks, ok: allOk }) }) });
    // Keep only last 2880 pings (1 week at 5-min intervals)
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ltrim/clerking:uptime:pings/0/-2879`,
      { method:'POST', headers:{ Authorization:`Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type':'application/json' }, body:'{}' });
  } catch(_) {}

  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    latencyMs, checks,
    timestamp: new Date().toISOString(),
    service: 'Clerking Analytics',
  });
}