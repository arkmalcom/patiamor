import { EyeOff, House, RotateCcw } from 'lucide';
import { api, ApiError, type InboxRequest, type PetChange, type PetStatus, type WithdrawReason } from '../api';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { failText, formatDate, t, type Key } from '../i18n';
import { petChanged } from '../store';
import { closeSheet, openSheet } from './sheet';
import { toast } from './toast';

// How an animal's time on Patiamor ends (PAT-11), in one sheet used by Tus animales, the animal's page
// and the inbox: "Se fue a casa" (and with which family), "Retirar" (with a reason for the shelter's
// records), or "Volver a publicar". Ending closes the animal's open requests, so the sheet says so first.

export interface OutcomePet {
  id: string;
  name: string;
  status: PetStatus;
}

const WITHDRAW_REASONS: WithdrawReason[] = ['familia_original', 'salud', 'fallecio', 'otro'];
const OPEN = ['sent', 'seen', 'contacted', 'visit'];
const OUTSIDE = 'fuera';
/** Errors the server may give here that have their own message (the publishing rules, on relisting). */
const KNOWN = ['photo_required', 'story_required', 'too_young', 'shelter_not_verified', 'shelter_suspended'];

const live = (s: PetStatus) => s === 'available' || s === 'reserved';

/** Opens the sheet. `requestId` (from the inbox) goes straight to "Se fue a casa" with that family chosen. */
export function openOutcome(pet: OutcomePet, shelterId: string, onDone: (change: PetChange) => void, opts: { requestId?: string } = {}) {
  const finish = (change: PetChange, message: string) => {
    closeSheet();
    // onDone first: it records where the screen goes next (a tab in the URL) before petChanged
    // refreshes the catalogue, which re-renders the current route.
    onDone(change);
    petChanged(pet.id);
    toast(message);
  };
  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : '';
    if (code === 'pick_family' || code === 'pick_reason') return toast(t(code === 'pick_family' ? 'outcome.pickFamily' : 'outcome.pickReason'));
    toast(KNOWN.includes(code) ? t(`listing.err.${code}` as Key) : failText(err));
  };
  /** Runs the change from the sheet's confirm button, keeping it disabled while it's in flight. */
  const confirm = (root: HTMLElement, run: () => Promise<void>) =>
    $<HTMLFormElement>('form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $<HTMLButtonElement>('button[type=submit]', root);
      btn.disabled = true;
      try {
        await run();
      } catch (err) {
        btn.disabled = false;
        fail(err);
      }
    });

  const start = () => {
    if (!live(pet.status)) return relist();
    const dialog = openSheet(
      t('outcome.title', { name: pet.name }),
      html`
        <div class="outcome__choices">
          <button class="outcome__choice" type="button" data-go="adopted">${icon(House, 24)}<span><strong>${t('outcome.adopted')}</strong><small>${t('outcome.adoptedHint')}</small></span></button>
          <button class="outcome__choice" type="button" data-go="withdraw">${icon(EyeOff, 24)}<span><strong>${t('outcome.withdraw')}</strong><small>${t('outcome.withdrawHint')}</small></span></button>
        </div>`,
    );
    $$<HTMLButtonElement>('[data-go]', dialog).forEach((b) => b.addEventListener('click', () => (b.dataset.go === 'adopted' ? adopted() : withdraw())));
  };

  const adopted = async () => {
    const dialog = openSheet(t('outcome.adoptedTitle', { name: pet.name }), html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
    let open: InboxRequest[];
    try {
      open = (await api.shelterRequests(shelterId)).filter((r) => r.pet.id === pet.id && OPEN.includes(r.status));
    } catch (err) {
      closeSheet();
      return fail(err);
    }
    const chosen = opts.requestId && open.some((r) => r.id === opts.requestId) ? opts.requestId : open.length ? '' : OUTSIDE;
    const others = (id: string) => (id === OUTSIDE ? open.length : open.length - 1);
    const body = $('.sheet__body', dialog);
    mount(
      body,
      html`
        <form class="outcome__form" novalidate>
          <fieldset class="question">
            <legend>${t('outcome.whichFamily')}</legend>
            <div class="segmented segmented--stack">
              ${open.map(
                // Where the request stands and when it came, so two families with the same name can be told apart.
                (r) => html`<label><input type="radio" name="family" value="${r.id}" ${r.id === chosen ? 'checked' : ''} /><span class="outcome__family"><strong>${r.contact.name}</strong><small>${t(`inbox.status.${r.status as 'sent'}`)} · ${formatDate(r.createdAt.slice(0, 10))}</small></span></label>`,
              )}
              <label><input type="radio" name="family" value="${OUTSIDE}" ${chosen === OUTSIDE ? 'checked' : ''} /><span>${t('outcome.outside')}</span></label>
            </div>
          </fieldset>
          <p class="muted" data-note></p>
          <button class="button button--primary button--block" type="submit">${icon(House, 20)}${t('outcome.adoptedConfirm')}</button>
        </form>`,
    );
    const note = $('[data-note]', body);
    const pick = () => new FormData($<HTMLFormElement>('form', body)).get('family') as string | null;
    const explain = () => {
      const id = pick();
      const n = id ? others(id) : 0;
      note.textContent = !id ? t('outcome.pickFamily') : n ? t(n === 1 ? 'outcome.closes1' : 'outcome.closesN', { n, name: pet.name }) : t('outcome.closesNone', { name: pet.name });
    };
    explain();
    body.addEventListener('change', explain);
    confirm(body, async () => {
      const family = pick();
      if (!family) throw new ApiError('pick_family', {});
      const change = await api.markAdopted(pet.id, family === OUTSIDE ? undefined : family);
      finish(change, t('outcome.adoptedDone', { name: pet.name }));
    });
  };

  const withdraw = () => {
    const dialog = openSheet(
      t('outcome.withdrawTitle', { name: pet.name }),
      html`
        <form class="outcome__form" novalidate>
          <fieldset class="question">
            <legend>${t('outcome.withdrawWhy')}</legend>
            <div class="segmented segmented--stack">
              ${WITHDRAW_REASONS.map((k) => html`<label><input type="radio" name="reason" value="${k}" /><span>${t(`outcome.reason.${k}`)}</span></label>`)}
            </div>
          </fieldset>
          <p class="muted">${t('outcome.withdrawNote', { name: pet.name })}</p>
          <button class="button button--ink button--block" type="submit">${icon(EyeOff, 20)}${t('outcome.withdrawConfirm')}</button>
        </form>`,
    );
    const body = $('.sheet__body', dialog);
    confirm(body, async () => {
      const reason = new FormData($<HTMLFormElement>('form', body)).get('reason') as WithdrawReason | null;
      if (!reason) throw new ApiError('pick_reason', {});
      const change = await api.withdrawPet(pet.id, reason);
      finish(change, t('outcome.withdrawDone', { name: pet.name }));
    });
  };

  const relist = () => {
    const dialog = openSheet(
      t('outcome.relistTitle', { name: pet.name }),
      html`
        <form class="outcome__form" novalidate>
          <p>${t('outcome.relistBody', { name: pet.name })}</p>
          ${pet.status === 'adopted' ? html`<p class="muted">${t('outcome.relistAdopted')}</p>` : ''}
          <button class="button button--primary button--block" type="submit">${icon(RotateCcw, 20)}${t('outcome.relistConfirm')}</button>
        </form>`,
    );
    const body = $('.sheet__body', dialog);
    confirm(body, async () => {
      const change = await api.relistPet(pet.id);
      finish(change, t('outcome.relistDone', { name: pet.name }));
    });
  };

  if (opts.requestId) adopted();
  else start();
}

/** The button that opens the sheet, worded for where the animal is now. */
export const outcomeButton = (pet: OutcomePet, small = false): Raw =>
  html`<button class="button button--outline ${small ? 'button--small' : ''}" type="button" data-outcome="${pet.id}">${t(live(pet.status) ? 'outcome.open' : 'outcome.relist')}</button>`;
