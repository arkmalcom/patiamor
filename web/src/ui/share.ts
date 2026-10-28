import { t } from '../i18n';
import { toast } from './toast';

// "Compartir" on a pet's profile (PAT-32): the phone's share sheet where there is one, otherwise the
// link is copied. The link is the pet's own path, so WhatsApp and Facebook preview it with its photo.

export const sharePet = (pet: { id: string; name: string }) =>
  shareLink({ title: pet.name, text: t('share.text', { name: pet.name }), url: `${location.origin}/mascota/${encodeURIComponent(pet.id)}` });

/** A help case: its own path, previewed with its photo (share.ts in the API). */
export const shareCase = (k: { id: string; name: string }) =>
  shareLink({ title: k.name, text: t('help.shareText', { name: k.name }), url: `${location.origin}/caso/${encodeURIComponent(k.id)}` });

/** Patiamor itself, for telling a shelter or rescuer about it (the empty states ask people to). */
export const shareSite = () => shareLink({ title: t('app.name'), text: t('share.siteText'), url: location.origin });

async function shareLink(data: { title: string; text: string; url: string }) {
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return; // they closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    toast(t('share.copied'));
  } catch {
    toast(t('share.failed', { url: data.url }));
  }
}
