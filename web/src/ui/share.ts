import { t } from '../i18n';
import { toast } from './toast';

// "Compartir" on a pet's profile (PAT-32): the phone's share sheet where there is one, otherwise the
// link is copied. The link is the pet's own path, so WhatsApp and Facebook preview it with its photo.

export async function sharePet(pet: { id: string; name: string }) {
  const url = `${location.origin}/mascota/${encodeURIComponent(pet.id)}`;
  const data = { title: pet.name, text: t('share.text', { name: pet.name }), url };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return; // they closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('share.copied'));
  } catch {
    toast(t('share.failed', { url }));
  }
}
