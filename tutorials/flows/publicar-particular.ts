import type { Flow } from '../record.ts';

// A person outside any shelter (a family with a litter) asks to list as a "Particular".

const flow: Flow = {
  title: 'Cómo publicar como particular',
  subtitle: 'Si no eres un refugio',
  end: 'Cuando te aprobemos, publicas igual que un refugio, pero **sin cuota**.',
  signedInAs: 'marta',
  start: '/refugio',
  async run(t) {
    const page = t.page;
    const sheet = page.locator('dialog[open]');

    await t.say('¿Tienes animales que dar en adopción y no eres un refugio? Entra al portal con tu cuenta.');
    await t.show(page.locator('#lister-card-title'), 'start');
    await t.say('Toca **Quiero publicar como particular**.');
    await t.tap(page.getByRole('button', { name: 'Quiero publicar como particular' }));

    await t.say('Busca tu barrio o sector y elígelo. Las familias solo verán tu zona, nunca tu dirección.');
    await t.type(sheet.locator('[data-place-query]'), 'Naco', 110);
    await t.tap(sheet.locator('[data-place-results] button', { hasText: 'Naco' }).first());
    await t.say('Tu WhatsApp: solo lo ve el equipo de Patiamor, para conocerte.');
    await t.type(sheet.locator('input[name=phone]'), '809-555-0177', 90);

    await t.say('Cuéntanos de ti y de tus animales: cuántos son y por qué buscas familia para ellos.');
    await t.type(
      sheet.locator('textarea[name=about]'),
      'Mi perra Luna tuvo cuatro cachorros hace dos meses. Ya comen solos y buscamos familias cerca que los cuiden bien.',
      18,
    );

    await t.say('Lee lo que debes saber: los particulares no cobran nada, y publican hasta 10 animales a la vez.');
    await t.show(sheet.locator('.mind'));
    await t.wait(1200);
    await t.say('Marca la casilla y toca **Enviar solicitud**.');
    await t.tap(sheet.locator('label.consent'));
    await t.tap(sheet.getByRole('button', { name: 'Enviar solicitud' }));

    await page.getByText('Solicitud enviada').waitFor();
    await t.say('Listo. Te escribiremos por WhatsApp para conocerte.');
    await t.tap(page.locator('dialog[open] [data-done]'));
    await t.say('En el portal verás cómo va tu solicitud.');
    await t.show(page.locator('#lister-card-title'));
    await t.wait(1500);
  },
};

export default flow;
