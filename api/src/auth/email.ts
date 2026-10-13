import type { Env } from '../env';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(code: string, link: string) {
  const subject = `Tu código para entrar a Patiamor: ${code}`;
  const text = [
    `Tu código para entrar a Patiamor es: ${code}`,
    '',
    `O entra directamente con este enlace: ${link}`,
    '',
    'El código y el enlace vencen en 15 minutos. Si no pediste entrar, ignora este correo.',
  ].join('\n');
  // Light only: Apple Mail and Outlook otherwise recolour the frame and button in dark mode.
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
  <body style="margin:0;background:#e3f1f4;font-family:Arial,Helvetica,sans-serif;color:#1d2340">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border-radius:16px;border:10px solid #1e7f49" cellpadding="0" cellspacing="0">
      <tr><td style="padding:28px 28px 8px;font-size:26px;font-weight:bold">Patiamor</td></tr>
      <tr><td style="padding:0 28px;font-size:16px;line-height:1.5">Usa este código para entrar:</td></tr>
      <tr><td style="padding:16px 28px;font-size:36px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace">${escape(code)}</td></tr>
      <tr><td style="padding:0 28px 8px;font-size:16px;line-height:1.5">O entra con un toque:</td></tr>
      <tr><td style="padding:8px 28px 24px"><a href="${escape(link)}" style="display:inline-block;background:#c8285f;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">Entrar a Patiamor</a></td></tr>
      <tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.5;color:#4a5275">El código y el enlace vencen en 15 minutos. Si no pediste entrar, ignora este correo.</td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Resend's free tier allows 100 emails a day (and 3,000 a month) across the whole account. */
export class EmailQuotaError extends Error {}

/** Resend answers a spent quota with 429 and a `name` of daily_quota_exceeded or monthly_quota_exceeded. */
export function isQuotaError(status: number, body: string): boolean {
  if (status !== 429) return false;
  try {
    return /quota_exceeded$/.test(String((JSON.parse(body) as { name?: unknown }).name ?? ''));
  } catch {
    return false;
  }
}

/** Sends the sign-in email through Resend, or logs it outside production when no key is configured. */
export async function sendSignInEmail(env: Env, to: string, code: string, link: string): Promise<void> {
  const { subject, text, html } = render(code, link);
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT === 'production') throw new Error('RESEND_API_KEY is not configured');
    console.log(`[dev email] to=${to} code=${code} link=${link}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isQuotaError(res.status, body)) throw new EmailQuotaError(body.slice(0, 300));
    throw new Error(`Resend responded ${res.status}: ${body.slice(0, 300)}`);
  }
}
