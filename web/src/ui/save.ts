import { Heart, Mail } from 'lucide';
import { api, ApiError } from '../api';
import { CONTACT_EMAIL, frameFor, type PetDetail, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { away, t } from '../i18n';
import { petCache, isSaved, loadSaved, MAX_SLOTS, placePet, removeSaved, savePet, stashPendingSave, state, takePendingSave, type Answer, type Answers } from '../store';
import { renderAuth } from './auth';
import { listerLabel, miniFrame } from './canvas';
import { closeSheet, openSheet } from './sheet';
import { toast } from './toast';

// Saving is deliberate: full list → choose what to release; then reflect; then (if needed) sign in.

type Done = (saved: boolean) => void;

export function startSave(petId: string, done: Done = () => {}) {
  if (isSaved(petId)) return done(true);
  if (state.saved.length >= MAX_SLOTS) return openFull(petId, done);
  openReflect(petId, done);
}

const pronoun = (pet: PetSummary) => (pet.sex === 'hembra' ? 'la' : 'lo');

function cautions(pet: PetSummary): string[] {
  const out: string[] = [];
  if (pet.goodWith.cats === false) out.push(t('reflect.notCats'));
  if (pet.goodWith.dogs === false) out.push(t('reflect.notDogs'));
  if (pet.goodWith.kids === false) out.push(t('reflect.notKids'));
  return [...out, ...((pet as PetDetail).needs ?? [])];
}

function question(name: keyof Answers, text: string): Raw {
  return html`
    <fieldset class="question">
      <legend>${text}</legend>
      <div class="segmented">
        <label><input type="radio" name="${name}" value="si" /><span>${t('reflect.yes')}</span></label>
        <label><input type="radio" name="${name}" value="pensando" /><span>${t('reflect.unsure')}</span></label>
      </div>
    </fieldset>`;
}

/** Dogs need walks; cats need play and company. */
function timeQuestion(pet: PetSummary, lo: string): string {
  const cat = pet.species === 'gato';
  if (pet.energy === 'alta') return cat ? t('reflect.q.time.high.cat', { name: pet.name }) : t('reflect.q.time.high', { name: pet.name, lo });
  return cat ? t('reflect.q.time.cat', { lo }) : t('reflect.q.time', { lo });
}

const savedToast = (pet: PetSummary) => toast(`${pet.name} · ${t('profile.saved')} (${state.saved.length} de ${MAX_SLOTS})`);

/** Saves on the server; a full list (e.g. filled on another device) routes to the release/contact sheet. */
async function commitSave(pet: PetSummary, answers: Answers, done: Done): Promise<boolean> {
  try {
    await savePet(pet.id, answers);
    savedToast(pet);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'shortlist_full') {
      await loadSaved().catch(() => {});
      openFull(pet.id, done);
    } else if (err instanceof ApiError && err.code === 'not_found') {
      toast(t('save.unavailable', { name: pet.name }));
    } else {
      toast(t('auth.err.network'));
    }
    return false;
  }
}

function openReflect(petId: string, done: Done) {
  const pet = petCache.get(petId);
  if (!pet) return;
  const p = placePet(pet);
  const lo = pronoun(pet);
  const slot = state.saved.length + 1;
  const caution = cautions(pet);
  const body = html`
    <form class="reflect" id="reflect-form">
      <div class="reflect__intro">
        ${miniFrame(pet)}
        <div>
          <p class="reflect__pet">${pet.name} · ${away(p.km)}</p>
          <p class="muted">${t('reflect.body')}</p>
          <p class="reflect__slot">${t('reflect.slot', { n: slot })}</p>
        </div>
      </div>
      ${question('space', pet.size === 'grande' && pet.species === 'perro' ? t('reflect.q.space.big', { name: pet.name }) : t('reflect.q.space', { un: t(`animal.${pet.species}.un`) }))}
      ${question('time', timeQuestion(pet, lo))}
      ${question('cost', t('reflect.q.cost'))}
      ${caution.length
        ? html`<div class="mind">
            <h3 class="mind__title">${t('reflect.mind')}</h3>
            <ul class="mind__list">${caution.map((c) => html`<li>${c}</li>`)}</ul>
          </div>`
        : ''}
      <p class="unsure-note" hidden data-unsure>${t('reflect.unsureNote', { lo })}</p>
    </form>`;
  const footer = html`
    <button class="button button--ghost" type="button" data-cancel>${t('reflect.cancel')}</button>
    <button class="button button--primary" type="submit" form="reflect-form" disabled data-save>${icon(Heart, 18)}<span>${t('reflect.answerAll')}</span></button>`;

  let saved = false;
  const dialog = openSheet(t('reflect.title', { name: pet.name }), body, { footer, onClose: () => done(saved) });
  const form = $<HTMLFormElement>('#reflect-form', dialog);
  const saveBtn = $<HTMLButtonElement>('[data-save]', dialog);
  const read = (): Partial<Answers> => Object.fromEntries(new FormData(form)) as Partial<Answers>;

  form.addEventListener('change', () => {
    const a = read();
    const complete = !!(a.space && a.time && a.cost);
    saveBtn.disabled = !complete;
    $('span', saveBtn).textContent = complete ? t('reflect.save') : t('reflect.answerAll');
    $('[data-unsure]', dialog).hidden = !Object.values(a).includes('pensando' as Answer);
  });
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = read() as Answers;
    const commit = async () => {
      saveBtn.disabled = true;
      saved = await commitSave(pet, answers, done);
      if (saved) closeSheet();
      else saveBtn.disabled = false;
    };
    if (state.signedIn) await commit();
    else showAuth(pet, answers, commit, () => done(saved));
  });
}

function showAuth(pet: PetSummary, answers: Answers, onSignedIn: () => void, onClose: () => void) {
  const dialog = openSheet(t('auth.title', { name: pet.name }), html`<p class="muted auth__intro">${t('auth.body')}</p><div data-auth></div>`, { onClose });
  renderAuth($('[data-auth]', dialog), {
    next: location.hash || '#/',
    // Google and the email link leave this page; the save finishes when the user returns signed in.
    beforeRedirect: () => stashPendingSave({ petId: pet.id, answers }),
    onSignedIn: () => {
      takePendingSave();
      onSignedIn();
    },
  });
}

/** Finishes a save that was interrupted by a sign-in redirect. */
export async function resumePendingSave() {
  const pending = takePendingSave();
  if (!pending || !state.signedIn) return;
  await loadSaved().catch(() => {});
  if (isSaved(pending.petId)) return;
  const pet = petCache.get(pending.petId) ?? (await api.pet(pending.petId).catch(() => null));
  if (pet) await commitSave(pet, pending.answers, () => {});
}

function openFull(petId: string, done: Done) {
  const pet = petCache.get(petId);
  if (!pet) return;
  const subject = encodeURIComponent(t('full.manySubject'));
  const mailBody = encodeURIComponent(`Hola, me interesa adoptar a ${pet.name} y a otros animales más.`);
  const body = html`
    <div class="full">
      <p class="muted">${t('full.body', { name: pet.name })}</p>
      <ul class="full__slots">
        ${state.saved.map(
          ({ pet: d }) => html`<li class="full__slot">
            ${miniFrame(d, 'sm')}
            <span class="full__slot-text"><strong>${d.name}</strong><span class="muted">${listerLabel(d)}</span></span>
            <button class="button button--outline button--small" type="button" data-release="${d.id}">${t('full.release')}</button>
          </li>`,
        )}
      </ul>
      <div class="many">
        <h3 class="many__title">${t('full.manyTitle')}</h3>
        <p>${t('full.manyBody')}</p>
        <a class="button button--ink" href="mailto:${CONTACT_EMAIL}?subject=${subject}&body=${mailBody}">${icon(Mail, 18)}${t('full.manyCta')}</a>
      </div>
    </div>`;
  let handedOff = false;
  const dialog = openSheet(t('full.title'), body, { onClose: () => !handedOff && done(false) });
  $$<HTMLButtonElement>('[data-release]', dialog).forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await removeSaved(b.dataset.release!);
      } catch {
        b.disabled = false;
        return toast(t('auth.err.network'));
      }
      handedOff = true;
      openReflect(petId, done);
    }),
  );
}

export async function removeFromList(petId: string) {
  try {
    await removeSaved(petId);
  } catch {
    toast(t('auth.err.network'));
  }
}

/** Re-render helper for any element showing the 3 slot pips. */
export function pips(withCount = false): Raw {
  return html`<span class="pips" aria-hidden="true">${Array.from({ length: MAX_SLOTS }, (_, i) => {
    const s = state.saved[i];
    return html`<span class="pip" ${s ? html`data-frame="${frameFor(s.pet.id)}"` : ''}></span>`;
  })}${withCount ? html`<span class="pips__count">${state.saved.length}/${MAX_SLOTS}</span>` : ''}</span>`;
}

export function mountPips(el: Element) {
  mount(el, pips(el.hasAttribute('data-pips-count')));
}
