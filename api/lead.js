// /api/clerking-lead.js
// Vercel serverless function — handles all Clerking form submissions
// Triggers: Tally webhook (attorney founding cohort, student waitlist, attorney intake, student intake, general contact)
// Outputs: Upstash Redis storage + Slack alert + Resend confirmation email

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  const body = req.body;
  // Tally sends { formId, formName, createdAt, data: [{ label, value }] }
  const formName = body?.formName || body?.form_name || 'unknown';
  const fields = body?.data || body?.fields || [];
  const timestamp = new Date().toISOString();

  // Parse fields into a clean object
  const parsed = {};
  fields.forEach(field => {
    const key = (field.label || field.name || '').toLowerCase().replace(/\s+/g, '_');
    parsed[key] = field.value || '';
  });

  // Determine form type
  const formType = (() => {
    if (formName.toLowerCase().includes('attorney') && formName.toLowerCase().includes('founding')) return 'attorney_founding';
    if (formName.toLowerCase().includes('attorney') && formName.toLowerCase().includes('intake')) return 'attorney_intake';
    if (formName.toLowerCase().includes('student') && formName.toLowerCase().includes('intake')) return 'student_intake';
    if (formName.toLowerCase().includes('student')) return 'student_waitlist';
    if (formName.toLowerCase().includes('contact')) return 'general_contact';
    return 'unknown';
  })();

  const email = parsed.email || parsed.email_address || '';
  const name = parsed.full_name || parsed.name || parsed.first_name || '';

  try {
    // ── 1. UPSTASH REDIS STORAGE ──
    const redisKey = `clerking:leads:${formType}:${Date.now()}`;
    const redisPayload = JSON.stringify({ formType, name, email, timestamp, fields: parsed });

    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(redisKey)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: redisPayload }),
    });

    // Also push to type-specific list for easy retrieval
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/rpush/clerking:leads:${formType}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: redisPayload }),
    });

    // ── 2. SLACK ALERT ──
    const slackEmoji = {
      attorney_founding: '🏛️',
      attorney_intake: '⚖️',
      student_intake: '🎓',
      student_waitlist: '📚',
      general_contact: '✉️',
      unknown: '❓'
    }[formType] || '📋';

    const slackText = `${slackEmoji} *New Clerking ${formType.replace(/_/g, ' ')} — ${timestamp.slice(0,10)}*\n\n*Name:* ${name || '—'}\n*Email:* ${email || '—'}\n*Form:* ${formName}\n\n${
      Object.entries(parsed).slice(0, 8).map(([k, v]) => `*${k}:* ${v}`).join('\n')
    }`;

    await fetch(process.env.SLACK_WEBHOOK_URL_CLERKING || process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: slackText }),
    });

    // ── 3. RESEND CONFIRMATION EMAIL ──
    if (email) {
      const emailTemplates = {
        attorney_founding: {
          subject: 'Your Clerking founding cohort spot is reserved — what happens next',
          html: buildAttorneyFoundingEmail(name),
        },
        attorney_intake: {
          subject: 'Clerking received your intake — match coming within 24–48 hours',
          html: buildAttorneyIntakeEmail(name),
        },
        student_intake: {
          subject: "You're on the Clerking student waitlist — here's how to prepare",
          html: buildStudentWaitlistEmail(name),
        },
        student_waitlist: {
          subject: "You're on the Clerking student waitlist — here's how to prepare",
          html: buildStudentWaitlistEmail(name),
        },
        general_contact: {
          subject: 'Clerking received your message — RN will respond within 2 business days',
          html: buildGeneralEmail(name),
        },
      };

      const template = emailTemplates[formType] || emailTemplates.general_contact;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Clerking <rn@rncollins.com>',
          to: [email],
          subject: template.subject,
          html: template.html,
        }),
      });

      // Also send RN a copy
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Clerking System <rn@rncollins.com>',
          to: ['rn@rncollins.com'],
          subject: `[CLERKING] New ${formType} — ${name} · ${email}`,
          html: `<pre>${JSON.stringify({ formType, name, email, timestamp, fields: parsed }, null, 2)}</pre>`,
        }),
      });
    }

    return res.status(200).json({ success: true, formType, timestamp });

  } catch (err) {
    console.error('Clerking lead handler error:', err);
    return res.status(500).json({ error: 'Handler failed', details: err.message });
  }
}

// ── EMAIL TEMPLATES ──
function buildAttorneyFoundingEmail(name) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">
  <div style="background:#111827;padding:20px 30px;border-radius:10px 10px 0 0">
    <p style="color:#fff;font-weight:700;font-size:18px;margin:0">Clerking</p>
  </div>
  <div style="padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <p>Hi ${name || 'there'},</p>
    <p>Your founding cohort spot is reserved. You're in the first 20 attorneys with access to Clerking — that means locked pricing for life and priority matching when the platform activates.</p>
    <h3 style="color:#3b82f6">What happens next</h3>
    <ol>
      <li>RN will reach out within 2 business days to confirm your practice area and what you're looking for in a clerk.</li>
      <li>When the student roster is ready, you'll be the first to know — and the first matched.</li>
      <li>Billing does not activate until matching is live. Nothing is charged until you say go.</li>
    </ol>
    <p>Questions? Reply to this email or reach RN directly at <a href="mailto:rn@rncollins.com" style="color:#3b82f6">rn@rncollins.com</a>.</p>
    <hr style="border:1px solid #f1f5f9;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af">Clerking · rncollins.com/clerking · Not a law firm. All student work supervised under ABA Model Rule 5.3.</p>
  </div>
</body></html>`;
}

function buildStudentWaitlistEmail(name) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">
  <div style="background:#6B2937;padding:20px 30px;border-radius:10px 10px 0 0">
    <p style="color:#fff;font-weight:700;font-size:18px;margin:0">Clerking</p>
  </div>
  <div style="padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <p>Hi ${name || 'there'},</p>
    <p>You're on the Clerking student waitlist. Here's how to make sure you're positioned well when matching goes live.</p>
    <h3 style="color:#6B2937">If you subscribed to the Placement tier ($50/month)</h3>
    <p>You'll be in RN's active matching pool — meaning when an attorney needs a clerk in your practice area, you'll be considered first. To complete your vetting:</p>
    <ol>
      <li>Email a legal writing sample to <a href="mailto:rn@rncollins.com" style="color:#6B2937">rn@rncollins.com</a> with the subject line: <strong>Clerking Writing Sample — [Your Name] — [Your School]</strong></li>
      <li>Minimum 3 pages. Acceptable: research memo, appellate brief excerpt, law review note, seminar paper, or clinic work product.</li>
      <li>RN reviews within 5 business days and confirms you're in the pool.</li>
    </ol>
    <h3 style="color:#6B2937">Prepare now</h3>
    <ul>
      <li>Download your templates from the Google Drive link in your Stripe confirmation email.</li>
      <li>Your name is on every deliverable — only commit to work you're proud of and can stand behind.</li>
      <li>When a match comes through, RN will contact you directly. Respond within 24 hours.</li>
    </ul>
    <p><strong>A quick tax note:</strong> You'll be paid as an independent contractor. Set aside 25–30% of your clerk earnings for taxes. If you earn over $600 from any single attorney in a calendar year, they'll issue a Form 1099-NEC. Not legal or tax advice — just heads up so it doesn't catch you off guard.</p>
    <hr style="border:1px solid #f1f5f9;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af">Clerking · rncollins.com/clerking · Questions? Reply to this email.</p>
  </div>
</body></html>`;
}

function buildAttorneyIntakeEmail(name) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">
  <div style="background:#111827;padding:20px 30px;border-radius:10px 10px 0 0">
    <p style="color:#fff;font-weight:700;font-size:18px;margin:0">Clerking</p>
  </div>
  <div style="padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <p>Hi ${name || 'there'},</p>
    <p>Your intake is in. RN is reviewing your practice area and project details now.</p>
    <p>You can expect:</p>
    <ul>
      <li>A clerk match within <strong>24–48 hours</strong> (Pro subscribers) or within <strong>24 hours</strong> (Elite).</li>
      <li>A three-way introduction email with the student's profile and writing sample.</li>
      <li>An engagement letter template ready to countersign.</li>
    </ul>
    <p>The student will reach out to you directly within 24 hours of the intro to discuss the first project.</p>
    <p>Questions? Reply here or reach RN at <a href="mailto:rn@rncollins.com" style="color:#3b82f6">rn@rncollins.com</a>.</p>
    <hr style="border:1px solid #f1f5f9;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af">Clerking · rncollins.com/clerking</p>
  </div>
</body></html>`;
}

function buildGeneralEmail(name) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">
  <div style="background:#111827;padding:20px 30px;border-radius:10px 10px 0 0">
    <p style="color:#fff;font-weight:700;font-size:18px;margin:0">Clerking</p>
  </div>
  <div style="padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
    <p>Hi ${name || 'there'},</p>
    <p>RN received your message and will respond within 2 business days.</p>
    <p>If this is time-sensitive, reply to this email directly and note the urgency.</p>
    <hr style="border:1px solid #f1f5f9;margin:24px 0">
    <p style="font-size:12px;color:#9ca3af">Clerking · rncollins.com/clerking</p>
  </div>
</body></html>`;
}