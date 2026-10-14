import type { Env } from '../env';
import { isoIn } from './crypto';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Message = { subject: string; text: string; html: string };

/** The painted-frame email shell. Light only: Apple Mail and Outlook otherwise recolour the frame and button in dark mode. */
const shell = (rows: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
  <body style="margin:0;background:#e3f1f4;font-family:Arial,Helvetica,sans-serif;color:#1d2340">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border-radius:16px;border:10px solid #1e7f49" cellpadding="0" cellspacing="0">
      <tr><td style="padding:28px 28px 8px;font-size:26px;font-weight:bold">Patiamor</td></tr>
      ${rows}
    </table>
  </td></tr></table></body></html>`;

const button = (href: string, label: string) =>
  `<a href="${escape(href)}" style="display:inline-block;background:#c8285f;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">${escape(label)}</a>`;

function renderSignIn(code: string, link: string): Message {
  const subject = `Tu código para entrar a Patiamor: ${code}`;
  const text = [
    `Tu código para entrar a Patiamor es: ${code}`,
    '',
    `O entra directamente con este enlace: ${link}`,
    '',
    'El código y el enlace vencen en 15 minutos. Si no pediste entrar, ignora este correo.',
  ].join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px;font-size:16px;line-height:1.5">Usa este código para entrar:</td></tr>
      <tr><td style="padding:16px 28px;font-size:36px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace">${escape(code)}</td></tr>
      <tr><td style="padding:0 28px 8px;font-size:16px;line-height:1.5">O entra con un toque:</td></tr>
      <tr><td style="padding:8px 28px 24px">${button(link, 'Entrar a Patiamor')}</td></tr>
      <tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.5;color:#4a5275">El código y el enlace vencen en 15 minutos. Si no pediste entrar, ignora este correo.</td></tr>`);
  return { subject, text, html };
}

function renderRequestSent(o: { pet: string; lister: string; listUrl: string }): Message {
  const subject = `Tu solicitud para conocer a ${o.pet} fue enviada`;
  const text = [
    `Enviamos tu solicitud para conocer a ${o.pet} a ${o.lister}.`,
    '',
    `Revisarán tus respuestas y, si es buena opción, te escribirán por WhatsApp o correo para coordinar una visita. Suele tomar unos días.`,
    '',
    `Puedes ver cómo va, o retirar la solicitud, en mi lista: ${o.listUrl}`,
  ].join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">Tu solicitud para conocer a ${escape(o.pet)} fue enviada a ${escape(o.lister)}.</td></tr>
      <tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">Revisarán tus respuestas y, si es buena opción, te escribirán por WhatsApp o correo para coordinar una visita. Suele tomar unos días.</td></tr>
      <tr><td style="padding:16px 28px 24px">${button(o.listUrl, 'Ver mi lista')}</td></tr>
      <tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.5;color:#4a5275">Puedes retirar la solicitud cuando quieras desde mi lista.</td></tr>`);
  return { subject, text, html };
}

export type ShelterDecision = 'verified' | 'rejected' | 'suspended';

function renderShelterDecision(o: { shelter: string; decision: ShelterDecision; reason: string | null; portalUrl: string }): Message {
  const copy = {
    verified: {
      subject: `${o.shelter} ya está verificado en Patiamor`,
      lede: `¡Listo! Verificamos a ${o.shelter}. Ya puedes publicar a tus animales y aparecerán con el sello de refugio verificado.`,
    },
    rejected: {
      subject: `Tu solicitud para ${o.shelter} necesita cambios`,
      lede: `Revisamos la solicitud de ${o.shelter} y por ahora no pudimos verificarla. Puedes corregirla y enviarla de nuevo desde el portal.`,
    },
    suspended: {
      subject: `${o.shelter} está suspendido en Patiamor`,
      lede: `Suspendimos a ${o.shelter} y sus animales ya no se muestran. Escríbenos si crees que es un error.`,
    },
  }[o.decision];
  const reason = o.reason ? `Motivo: ${o.reason}` : '';
  const text = [copy.lede, reason, '', `Portal de refugios: ${o.portalUrl}`].filter((l, i) => l || i === 2).join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(copy.lede)}</td></tr>
      ${reason ? `<tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">${escape(reason)}</td></tr>` : ''}
      <tr><td style="padding:16px 28px 28px">${button(o.portalUrl, 'Ir al portal')}</td></tr>`);
  return { subject: copy.subject, text, html };
}

/** To the admins: someone asked to adopt more than three. */
function renderBulkAdmin(o: { who: string; animals: number; species: string; adminUrl: string }): Message {
  const lede = `${o.who} quiere adoptar a ${o.animals} animales (${o.species}) a la vez.`;
  const text = [lede, '', `Revísala junto con sus solicitudes en curso: ${o.adminUrl}`].join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(lede)}</td></tr>
      <tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">Está esperando una respuesta. Puedes verla con sus solicitudes en curso y aprobarla o no.</td></tr>
      <tr><td style="padding:16px 28px 28px">${button(o.adminUrl, 'Revisar la solicitud')}</td></tr>`);
  return { subject: `Solicitud especial: ${o.animals} animales`, text, html };
}

export type BulkDecision = 'approved' | 'declined';

/** To the adopter, when an admin has decided. */
function renderBulkDecision(o: { decision: BulkDecision; animals: number; note: string | null; listUrl: string }): Message {
  const copy = {
    approved: {
      subject: 'Aprobamos tu solicitud para adoptar a varios animales',
      lede: `¡Buenas noticias! Revisamos tu solicitud para adoptar a ${o.animals} animales y la aprobamos. Te escribiremos para ponerte en contacto con el refugio o los refugios con los que encaje; ellos eligen qué animales van contigo.`,
    },
    declined: {
      subject: 'Sobre tu solicitud para adoptar a varios animales',
      lede: `Revisamos tu solicitud para adoptar a ${o.animals} animales y por ahora no pudimos aprobarla. Mientras tanto, puedes seguir con tus tres espacios de siempre.`,
    },
  }[o.decision];
  const note = o.note ? (o.decision === 'declined' ? `Motivo: ${o.note}` : o.note) : '';
  const text = [copy.lede, note, '', `Mi lista: ${o.listUrl}`].filter((l, i) => l || i === 2).join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(copy.lede)}</td></tr>
      ${note ? `<tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">${escape(note)}</td></tr>` : ''}
      <tr><td style="padding:16px 28px 28px">${button(o.listUrl, 'Ver mi lista')}</td></tr>`);
  return { subject: copy.subject, text, html };
}

/** To the admins: someone asks to be allowed to register a shelter. */
function renderOwnerAdmin(o: { who: string; shelter: string; adminUrl: string }): Message {
  const lede = `${o.who} pide poder registrar «${o.shelter}» en Patiamor.`;
  const text = [lede, '', `Revisa la solicitud (hay parecidos si ya conocemos el refugio): ${o.adminUrl}`].join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(lede)}</td></tr>
      <tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">Contáctala para conocerla y confirmar los datos del refugio; después puedes aprobarla o registrar el refugio tú.</td></tr>
      <tr><td style="padding:16px 28px 28px">${button(o.adminUrl, 'Revisar la solicitud')}</td></tr>`);
  return { subject: `Solicitud de dueño de refugio: ${o.shelter}`, text, html };
}

/** To the person, when an admin has decided on their request to be a shelter owner. */
function renderOwnerDecision(o: { decision: BulkDecision; note: string | null; portalUrl: string }): Message {
  const copy = {
    approved: {
      subject: 'Ya puedes registrar tu refugio en Patiamor',
      lede: 'Aprobamos tu solicitud. Ya puedes registrar tu refugio desde el portal; después lo verificamos y tus animales aparecerán a quienes viven cerca.',
      cta: 'Registrar mi refugio',
    },
    declined: {
      subject: 'Sobre tu solicitud para registrar un refugio',
      lede: 'Revisamos tu solicitud y por ahora no pudimos aprobarla.',
      cta: 'Ir al portal',
    },
  }[o.decision];
  const note = o.note ? (o.decision === 'declined' ? `Motivo: ${o.note}` : o.note) : '';
  const text = [copy.lede, note, '', `Portal de refugios: ${o.portalUrl}`].filter((l, i) => l || i === 2).join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(copy.lede)}</td></tr>
      ${note ? `<tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">${escape(note)}</td></tr>` : ''}
      <tr><td style="padding:16px 28px 28px">${button(o.portalUrl, copy.cta)}</td></tr>`);
  return { subject: copy.subject, text, html };
}

/** To an adopter whose pause an admin lifted. */
function renderPauseCleared(o: { note: string | null; exploreUrl: string }): Message {
  const lede = 'Revisamos tu cuenta y quitamos la pausa: ya puedes volver a enviar solicitudes de adopción.';
  const text = [lede, o.note ?? '', '', `Ver quién espera: ${o.exploreUrl}`].filter((l, i) => l || i === 2).join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(lede)}</td></tr>
      ${o.note ? `<tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">${escape(o.note)}</td></tr>` : ''}
      <tr><td style="padding:16px 28px 28px">${button(o.exploreUrl, 'Ver quién espera')}</td></tr>`);
  return { subject: 'Ya puedes volver a enviar solicitudes en Patiamor', text, html };
}

const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`);

/** The shelter's morning summary: new requests since the last one, and how many are still unopened. */
function renderDigest(o: { shelter: string; fresh: number; pets: string[]; unopened: number; inboxUrl: string }): Message {
  const what = o.fresh === 1 ? `1 solicitud nueva para ${o.pets[0]}` : `${o.fresh} solicitudes nuevas para ${listOf(o.pets)}`;
  const subject = `${o.shelter}: ${o.fresh === 1 ? '1 solicitud nueva' : `${o.fresh} solicitudes nuevas`} en Patiamor`;
  const waiting = o.unopened > o.fresh ? `En total tienes ${o.unopened} sin abrir.` : '';
  const text = [`Buenos días. ${sentenceCase(what)}.`, waiting, '', `Míralas y responde desde el portal: ${o.inboxUrl}`, '', 'Te escribimos una vez al día, solo cuando hay solicitudes nuevas.']
    .filter((l, i) => l || i === 2 || i === 4)
    .join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">Buenos días. ${escape(sentenceCase(what))}.</td></tr>
      ${waiting ? `<tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">${escape(waiting)}</td></tr>` : ''}
      <tr><td style="padding:16px 28px 24px">${button(o.inboxUrl, 'Ver solicitudes')}</td></tr>
      <tr><td style="padding:0 28px 28px;font-size:13px;line-height:1.5;color:#4a5275">Te escribimos una vez al día, solo cuando hay solicitudes nuevas.</td></tr>`);
  return { subject, text, html };
}

/** "Avísame": pets this person was waiting for can take requests again. */
function renderAvailable(o: { pets: { name: string; url: string }[] }): Message {
  const names = listOf(o.pets.map((p) => p.name));
  const one = o.pets.length === 1;
  const subject = one ? `${names} vuelve a recibir solicitudes` : `${names} vuelven a recibir solicitudes`;
  const lede = one ? `${names} vuelve a recibir solicitudes en Patiamor. Nos pediste que te avisáramos.` : `${names} vuelven a recibir solicitudes en Patiamor. Nos pediste que te avisáramos.`;
  const text = [lede, '', ...o.pets.map((p) => `${p.name}: ${p.url}`)].join('\n');
  const html = shell(`
      <tr><td style="padding:0 28px 8px;font-size:18px;line-height:1.4;font-weight:bold">${escape(lede)}</td></tr>
      ${o.pets.map((p) => `<tr><td style="padding:12px 28px 4px">${button(p.url, `Ver a ${p.name}`)}</td></tr>`).join('')}
      <tr><td style="padding:16px 28px 28px;font-size:13px;line-height:1.5;color:#4a5275">Si ya no te interesa, no tienes que hacer nada: este aviso no se repite.</td></tr>`);
  return { subject, text, html };
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

export type EmailKind = 'signin' | 'request_sent' | 'shelter_decision' | 'digest' | 'available' | 'bulk_admin' | 'bulk_decision' | 'owner_admin' | 'owner_decision' | 'pause_cleared';

// One budget for every email (email_log, migration 0007). Sign-in codes may use all of it; everything
// else stops short, so a busy day of confirmations can never lock people out of signing in.
const DAILY_CAP = 100;
const SIGNIN_RESERVE = 20;

export async function hasEmailBudget(db: D1Database, kind: EmailKind): Promise<boolean> {
  const row = await db.prepare('SELECT count(*) AS n FROM email_log WHERE created_at > ?').bind(isoIn(-24 * 60 * 60 * 1000)).first<{ n: number }>();
  return (row?.n ?? 0) < (kind === 'signin' ? DAILY_CAP : DAILY_CAP - SIGNIN_RESERVE);
}

/** Addresses that are never real people: the staging sample data (@ejemplo.do) and the reserved example
 *  domains. Mail to them would only bounce, which hurts our sender reputation, and waste the budget.
 *  (.test stays sendable: the API tests use it to count what would be sent.) */
const FAKE_RECIPIENT = /@(ejemplo\.do|example\.(com|org|net))$/i;

/** Sends through Resend (or logs it outside production when no key is configured) and records it in the budget. */
async function send(env: Env, kind: EmailKind, to: string, { subject, text, html }: Message, devNote: string): Promise<void> {
  if (FAKE_RECIPIENT.test(to)) {
    console.log(`[skipped email: sample address] kind=${kind} to=${to} ${devNote}`);
    return;
  }
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT === 'production') throw new Error('RESEND_API_KEY is not configured');
    console.log(`[dev email] kind=${kind} to=${to} ${devNote}`);
  } else {
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
  await env.DB.prepare('INSERT INTO email_log (kind) VALUES (?)').bind(kind).run();
}

export const sendSignInEmail = (env: Env, to: string, code: string, link: string) =>
  send(env, 'signin', to, renderSignIn(code, link), `code=${code} link=${link}`);

export const sendRequestSentEmail = (env: Env, to: string, o: { pet: string; lister: string; listUrl: string }) =>
  send(env, 'request_sent', to, renderRequestSent(o), `pet=${o.pet} lister=${o.lister}`);

export const sendShelterDecisionEmail = (env: Env, to: string, o: { shelter: string; decision: ShelterDecision; reason: string | null; portalUrl: string }) =>
  send(env, 'shelter_decision', to, renderShelterDecision(o), `shelter=${o.shelter} decision=${o.decision}`);

export const sendBulkAdminEmail = (env: Env, to: string, o: { who: string; animals: number; species: string; adminUrl: string }) =>
  send(env, 'bulk_admin', to, renderBulkAdmin(o), `who=${o.who} animals=${o.animals}`);

export const sendBulkDecisionEmail = (env: Env, to: string, o: { decision: BulkDecision; animals: number; note: string | null; listUrl: string }) =>
  send(env, 'bulk_decision', to, renderBulkDecision(o), `decision=${o.decision} animals=${o.animals}`);

export const sendOwnerAdminEmail = (env: Env, to: string, o: { who: string; shelter: string; adminUrl: string }) =>
  send(env, 'owner_admin', to, renderOwnerAdmin(o), `who=${o.who} shelter=${o.shelter}`);

export const sendOwnerDecisionEmail = (env: Env, to: string, o: { decision: BulkDecision; note: string | null; portalUrl: string }) =>
  send(env, 'owner_decision', to, renderOwnerDecision(o), `decision=${o.decision}`);

export const sendPauseClearedEmail = (env: Env, to: string, o: { note: string | null; exploreUrl: string }) =>
  send(env, 'pause_cleared', to, renderPauseCleared(o), 'pause lifted');

export const sendDigestEmail = (env: Env, to: string, o: { shelter: string; fresh: number; pets: string[]; unopened: number; inboxUrl: string }) =>
  send(env, 'digest', to, renderDigest(o), `shelter=${o.shelter} fresh=${o.fresh} unopened=${o.unopened}`);

export const sendAvailableEmail = (env: Env, to: string, o: { pets: { name: string; url: string }[] }) =>
  send(env, 'available', to, renderAvailable(o), `pets=${o.pets.map((p) => p.name).join('|')}`);
