import { Mail, MessageCircle, Phone } from 'lucide';
import { api, type CloseReason, type InboxRequest } from '../api';
import { frameFor, type PetSummary } from '../data';
import { $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, t, type Key } from '../i18n';
import { photo } from '../ui/canvas';
import { toast } from '../ui/toast';

// A shelter's requests (#/refugio/<id>/solicitudes, PAT-5). Shelters reach adopters through their own
// WhatsApp, phone or email from here, and mark each step; adopters see every step in their list.
// Opening a new request marks it seen. New requests also arrive in a morning email (api/src/digest.ts).

type Tab = 'nuevas' | 'curso' | 'cerradas';
const TAB_OF: Record<string, Tab> = { sent: 'nuevas', seen: 'curso', contacted: 'curso', visit: 'curso', adopted: 'cerradas', closed: 'cerradas', withdrawn: 'cerradas' };
const CLOSE_REASONS: CloseReason[] = ['otra_familia', 'no_encaja', 'sin_respuesta', 'otro'];
const DAY = 86_400_000;

/** "hoy", "ayer", "hace 3 días", then the date. */
function when(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  if (days < 1) return t('inbox.today');
  if (days < 2) return t('inbox.yesterday');
  if (days < 14) return t('inbox.daysAgo', { n: days });
  return formatDate(iso.slice(0, 10));
}

const digits = (phone: string) => phone.replace(/\D/g, '');
/** "+18095551234" → "809-555-1234". */
const showPhone = (p: string) => {
  const d = digits(p).replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p;
};

export async function renderInbox(root: HTMLElement, shelterId: string, tab: Tab = 'nuevas') {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let requests: InboxRequest[];
  let shelterName = '';
  try {
    const [list, shelters] = await Promise.all([api.shelterRequests(shelterId), api.myShelters()]);
    requests = list;
    shelterName = shelters.find((s) => s.id === shelterId)?.name ?? '';
  } catch {
    return mount(root, html`<section class="portal"><p class="loading-note" role="alert">${t('portal.notFound')}</p><a class="button button--outline" href="#/refugio">${t('portal.back')}</a></section>`);
  }
  let current = tab;

  const draw = () => {
    const counts = { nuevas: 0, curso: 0, cerradas: 0 };
    for (const r of requests) counts[TAB_OF[r.status]]++;
    const shown = requests.filter((r) => TAB_OF[r.status] === current);
    mount(
      root,
      html`
        <section class="portal inbox" aria-labelledby="portal-title">
          <a class="text-button portal__back" href="#/refugio">${t('portal.back')}</a>
          <div class="listings__head">
            <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('inbox.title')}</h1>
            <p class="portal__who">${shelterName}</p>
          </div>
          <p class="portal__lede inbox__lede">${t('inbox.lede')}</p>
          <nav class="list-tabs" aria-label="${t('inbox.title')}">
            ${(['nuevas', 'curso', 'cerradas'] as Tab[]).map(
              (k) => html`<button class="list-tabs__tab" type="button" data-tab="${k}" aria-current="${k === current ? 'page' : 'false'}">${t(`inbox.tab.${k}`)}${counts[k] && k !== 'cerradas' ? html` <span class="list-tabs__count">${counts[k]}</span>` : ''}</button>`,
            )}
          </nav>
          ${shown.length ? html`<ul class="inbox__list">${shown.map((r) => card(r, shelterName, shelterId))}</ul>` : html`<p class="passed__empty">${t(`inbox.empty.${current}`)}</p>`}
        </section>`,
    );
    $$<HTMLButtonElement>('[data-tab]', root).forEach((b) => b.addEventListener('click', () => ((current = b.dataset.tab as Tab), draw())));
    bind();
  };

  const replace = (updated: InboxRequest) => {
    requests = requests.map((r) => (r.id === updated.id ? updated : r));
  };

  const bind = () => {
    // Opening a new request tells the adopter it was seen (once).
    $$<HTMLDetailsElement>('details[data-request]', root).forEach((d) =>
      d.addEventListener('toggle', async () => {
        const r = requests.find((x) => x.id === d.dataset.request);
        if (!d.open || r?.status !== 'sent') return;
        try {
          replace(await api.moveRequest(r.id, 'seen'));
          d.querySelector('[data-chip]')!.outerHTML = chip('seen').value;
        } catch {
          /* stays "nueva"; the next opening tries again */
        }
      }),
    );
    $$<HTMLButtonElement>('[data-move]', root).forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.closest<HTMLElement>('[data-request]')!.dataset.request!;
        const to = b.dataset.move as 'contacted' | 'visit';
        b.disabled = true;
        try {
          const updated = await api.moveRequest(id, to);
          replace(updated);
          toast(t(`inbox.done.${to}`));
          current = TAB_OF[updated.status]; // follow the request to its tab, still open
          draw();
          root.querySelector<HTMLDetailsElement>(`details[data-request="${id}"]`)?.setAttribute('open', '');
        } catch {
          b.disabled = false;
          toast(t('auth.err.network'));
        }
      }),
    );
    $$<HTMLFormElement>('form[data-close]', root).forEach((f) =>
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reason = new FormData(f).get('reason') as CloseReason | null;
        if (!reason) return toast(t('inbox.closeNeedReason'));
        const id = f.dataset.close!;
        try {
          replace(await api.moveRequest(id, 'closed', reason));
          toast(t('inbox.done.closed'));
          draw(); // it leaves this tab for Cerradas
        } catch {
          toast(t('auth.err.network'));
        }
      }),
    );
  };

  draw();
}

const chip = (status: string): Raw => html`<span class="status-chip status-chip--req-${status}" data-chip>${t(`inbox.status.${status as 'sent'}`)}</span>`;

function card(r: InboxRequest, shelter: string, shelterId: string): Raw {
  const open = TAB_OF[r.status] !== 'cerradas';
  const pet = r.pet;
  const first = r.contact.name.split(/\s+/)[0];
  return html`
    <li>
      <details class="request-card" data-request="${r.id}">
        <summary class="request-card__head">
          <span class="mini-frame mini-frame--sm" data-frame="${frameFor(pet.id)}">${photo({ photo: pet.photo } as PetSummary, 'lazy', true)}</span>
          <span class="request-card__who">
            <strong>${t('inbox.wants', { who: r.contact.name, pet: pet.name })}</strong>
            <span class="request-card__meta">${when(r.createdAt)}${pet.status === 'reserved' ? html` · ${t('inbox.petReserved', { pet: pet.name })}` : pet.requestsPaused ? html` · ${t('inbox.petPaused')}` : ''}</span>
          </span>
          ${chip(r.status)}
        </summary>
        <div class="request-card__body">
          ${open && r.contact.pref ? contactButtons(r, shelter, first) : ''}
          ${r.status === 'withdrawn' ? html`<p class="portal-card__reason"><strong>${t('inbox.withdrew')}</strong> «${t(`request.withdraw.${r.closedReason as 'situacion'}`)}»</p>` : ''}
          ${r.status === 'closed' ? html`<p class="muted">${t('inbox.closedBecause', { reason: t(`inbox.reason.${(r.closedReason ?? 'otro') as CloseReason}`) })}</p>` : ''}
          ${r.message ? html`<blockquote class="request-card__message">${r.message}</blockquote>` : ''}
          <dl class="portal-facts">
            ${answer('inbox.q.space', r.answers.space)}
            ${answer('inbox.q.time', r.answers.time)}
            ${answer('inbox.q.cost', r.answers.cost)}
            ${fact('inbox.q.home', r.about.home && t(`request.home.${r.about.home as 'casa'}`))}
            ${fact('inbox.q.otherPets', r.about.otherPets.length ? r.about.otherPets.map((p) => t(`request.otherPets.${p as 'perros'}`)).join(', ') : t('inbox.none'))}
            ${fact('inbox.q.kids', r.about.kids && t(`request.kids.${r.about.kids as 'no'}`))}
            ${fact('inbox.q.experience', r.about.experience && t(`request.experience.${r.about.experience as 'si'}`))}
            ${fact('inbox.q.visit', r.about.visit && t(`request.visit.${r.about.visit as 'semana'}`))}
          </dl>
          ${open ? actions(r) : ''}
          <a class="text-button request-card__pet" href="#/refugio/${encodeURIComponent(shelterId)}/animales/${encodeURIComponent(pet.id)}">${t('inbox.petLink', { pet: pet.name })}</a>
        </div>
      </details>
    </li>`;
}

const fact = (label: Key, value: string | null) => (value ? html`<div><dt>${t(label)}</dt><dd>${value}</dd></div>` : '');
/** The reflection answers: "Sí" plainly, "Lo está pensando" marked so it stands out. */
const answer = (label: Key, value: string) =>
  html`<div><dt>${t(label)}</dt><dd>${value === 'si' ? t('inbox.answer.si') : html`<span class="request-card__thinking">${t('inbox.answer.pensando')}</span>`}</dd></div>`;

/** The adopter's preferred channel first and largest; the others as plain links. */
function contactButtons(r: InboxRequest, shelter: string, first: string): Raw {
  const c = r.contact;
  const text = t('inbox.waText', { name: first, shelter, pet: r.pet.name });
  const options = {
    whatsapp: c.phone ? { href: `https://wa.me/${digits(c.phone)}?text=${encodeURIComponent(text)}`, label: t('inbox.contact.whatsapp'), glyph: MessageCircle, external: true } : null,
    llamada: c.phone ? { href: `tel:${c.phone}`, label: t('inbox.contact.call', { phone: showPhone(c.phone) }), glyph: Phone, external: false } : null,
    correo: c.email ? { href: `mailto:${c.email}?subject=${encodeURIComponent(t('inbox.mailSubject', { pet: r.pet.name }))}&body=${encodeURIComponent(text)}`, label: t('inbox.contact.email'), glyph: Mail, external: false } : null,
  };
  const order = [c.pref!, ...(['whatsapp', 'llamada', 'correo'] as const).filter((k) => k !== c.pref)];
  const [main, ...rest] = order.map((k) => options[k as keyof typeof options]).filter(Boolean);
  if (!main) return html``;
  return html`
    <div class="request-card__contact">
      <p class="muted">${t('inbox.prefers', { name: first, how: t(`request.pref.${c.pref!}`) })}</p>
      <a class="button button--primary" href="${main.href}" ${main.external ? html`target="_blank" rel="noopener"` : ''}>${icon(main.glyph, 20)}${main.label}</a>
      <p class="request-card__alt">
        ${rest.map((o) => html`<a href="${o!.href}" ${o!.external ? html`target="_blank" rel="noopener"` : ''}>${icon(o!.glyph, 16)}${o!.label}</a>`)}
        ${c.email ? html`<span class="muted">${c.email}</span>` : ''}
      </p>
    </div>`;
}

function actions(r: InboxRequest): Raw {
  const next: ('contacted' | 'visit')[] = r.status === 'contacted' ? ['visit'] : r.status === 'visit' ? [] : ['contacted', 'visit'];
  return html`
    <div class="request-card__actions">
      ${next.map((s) => html`<button class="button button--outline button--small" type="button" data-move="${s}">${t(`inbox.move.${s}`)}</button>`)}
    </div>
    <details class="request-card__close">
      <summary class="text-button">${t('inbox.close')}</summary>
      <form data-close="${r.id}">
        <fieldset class="question">
          <legend>${t('inbox.closeWhy')}</legend>
          <div class="segmented segmented--stack">
            ${CLOSE_REASONS.map((k) => html`<label><input type="radio" name="reason" value="${k}" /><span>${t(`inbox.reason.${k}`)}</span></label>`)}
          </div>
        </fieldset>
        <p class="muted">${t('inbox.closeNote')}</p>
        <button class="button button--ink button--small" type="submit">${t('inbox.closeConfirm')}</button>
      </form>
    </details>`;
}
