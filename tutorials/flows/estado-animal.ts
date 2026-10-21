import type { Flow } from '../record.ts';

// A shelter keeps its animals up to date: "En proceso" for one, "Se fue a casa" (with which family) for another.

const flow: Flow = {
  title: 'Cómo marcar en proceso o adoptado',
  subtitle: 'Para refugios y particulares',
  end: '¿Te equivocaste? Abre la pestaña y toca **Volver a publicar**.',
  signedInAs: 'carla',
  start: '/refugio',
  async run(t) {
    const page = t.page;
    const row = (name: string) => page.locator('.listing-item', { hasText: name });

    await t.say('Mantén a tus animales al día desde **Tus animales**.');
    await t.tap(page.getByRole('link', { name: 'Tus animales' }));

    await t.say('¿Ya hablan con una familia? Toca **En proceso**: las solicitudes nuevas quedan en pausa.');
    await t.tap(row('Morena').locator('[data-quick]'));
    await t.say('Si no sigue, toca **Disponible otra vez** y vuelve a recibir solicitudes.');
    await t.point(row('Morena').locator('[data-quick]'));
    await t.wait(800);

    await t.say('Cuando un animal se va a su hogar, toca **Se fue a casa o retirar**.');
    await t.tap(row('Canela').locator('[data-outcome]'));
    await t.say('Toca **Se fue a casa**. Si deja de buscar familia por otro motivo, elige **Retirar**.');
    await t.tap(page.locator('dialog[open] [data-go=adopted]'));

    await t.say('Elige con qué familia se fue. Las otras solicitudes se cierran y esas familias se enteran.');
    await t.tap(page.locator('dialog[open] label', { hasText: 'Laura Gómez' }));
    await t.say('Toca **Sí, se fue a casa**.');
    await t.tap(page.locator('dialog[open]').getByRole('button', { name: 'Sí, se fue a casa' }));

    await page.getByText('ya tiene hogar').waitFor();
    await t.say('¡Qué alegría! Canela pasa a la pestaña **Adoptados** y deja de aparecer en Explorar.');
    await t.wait(1000);
  },
};

export default flow;
