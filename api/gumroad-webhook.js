const ALLOWED_ORIGIN = 'https://clerking-site.vercel.app';

export default function handler(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  return res.status(410).json({
    error: 'Gumroad revenue tracking is not active on this prelaunch deployment',
    status: 'retired'
  });
}
