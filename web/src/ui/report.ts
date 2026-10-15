import { Flag } from 'lucide';
import { ApiError, api, type ReportReason } from '../api';
import { $, html, icon } from '../dom';
import { failText, t } from '../i18n';
import { here } from '../nav';
import { state } from '../store';
import { renderAuth } from './auth';
import { closeSheet, openSheet } from './sheet';
import { toast } from './toast';

// "Reportar esta publicación" on a profile (PAT-15): selling, a scam, mistreatment, false information or
// something else. One per person per animal; when three people report it, Patiamor hides it to review.
// The person reporting isn't told how many others did.

const REASONS: ReportReason[] = ['venta', 'estafa', 'maltrato', 'datos_falsos', 'otro'];

export const reportButton = () => html`<button class="text-button profile__report" type="button" data-report>${icon(Flag, 16)}${t('report.open')}</button>`;

export function openReport(pet: { id: string; name: string }) {
  if (!state.signedIn) {
    const dialog = openSheet(t('report.title', { name: pet.name }), html`<p class="muted auth__intro">${t('report.authBody')}</p><div data-auth></div>`);
    renderAuth($('[data-auth]', dialog), { next: here(), onSignedIn: () => openReport(pet) });
    return;
  }
  const dialog = openSheet(
    t('report.title', { name: pet.name }),
    html`<form class="outcome__form" id="report-form" novalidate>
      <p>${t('report.lede')}</p>
      <fieldset class="question">
        <legend>${t('report.why')}</legend>
        <div class="segmented segmented--wrap">
          ${REASONS.map((r) => html`<label><input type="radio" name="reason" value="${r}" /><span>${t(`report.reason.${r}`)}</span></label>`)}
        </div>
      </fieldset>
      <label class="field">
        <span class="field__label">${t('report.details')} <span class="muted" data-optional>(${t('request.optional')})</span></span>
        <textarea class="field__input field__input--area" name="details" rows="4" maxlength="500"></textarea>
        <span class="field__hint">${t('report.detailsHint')}</span>
      </label>
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`,
    {
      footer: html`<button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
        <button class="button button--primary" type="submit" form="report-form" data-send>${t('report.send')}</button>`,
    },
  );
  const form = $<HTMLFormElement>('#report-form', dialog);
  const error = $('[data-error]', dialog);
  const send = $<HTMLButtonElement>('[data-send]', dialog);
  // "Otro" needs a few words; the others don't.
  form.addEventListener('change', () => ($('[data-optional]', dialog).hidden = new FormData(form).get('reason') === 'otro'));
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const reason = f.get('reason') as ReportReason | null;
    const details = String(f.get('details') ?? '').trim();
    const fail = (text: string) => ((error.textContent = text), (error.hidden = false));
    if (!reason) return fail(t('report.err.pick'));
    if (reason === 'otro' && details.length < 10) return fail(t('report.err.details_required'));
    send.disabled = true;
    try {
      await api.reportPet(pet.id, reason, details || undefined);
      closeSheet();
      toast(t('report.sent'));
    } catch (err) {
      send.disabled = false;
      const code = err instanceof ApiError ? err.code : '';
      fail(['already_reported', 'own_listing', 'too_many_reports', 'details_required'].includes(code) ? t(`report.err.${code as 'already_reported'}`) : failText(err));
    }
  });
}
