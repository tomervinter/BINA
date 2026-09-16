// Sends transactional email via Postmark's plain REST API (no SDK needed — Node's
// built-in fetch is enough for a single POST). Falls back to logging the email to
// the console when POSTMARK_API_KEY isn't set (local dev, or production before
// Postmark is actually configured) — the password-reset/email-verification flows
// work and are fully testable either way; only real delivery is gated on the key.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.POSTMARK_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log(`[DEV] Email not sent (POSTMARK_API_KEY/EMAIL_FROM not set). Would send to ${to}:\nSubject: ${subject}\n${html}`);
    return { delivered: false };
  }

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html, MessageStream: 'outbound' })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Postmark send failed (${res.status}): ${body}`);
  }
  return { delivered: true };
}

module.exports = { sendEmail };
