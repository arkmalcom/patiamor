import type { Flow } from '../record.ts';

// A signed-in person asks to be approved as a shelter owner, the step before registering the shelter.

const flow: Flow = {
  title: 'Cómo pedir acceso para tu refugio',
  subtitle: 'El primer paso para publicar como refugio',
  end: 'Cuando te aprobemos, verás **Registrar un refugio** en el portal.',
  signedInAs: 'marta',
  start: '/refugio',
  async run(t) {
    const page = t.page;
    const sheet = page.locator('dialog[open]');

    await t.say('Entra al portal de refugios con tu cuenta. Antes de registrar un refugio, pides acceso.');
    await t.say('Toca **Solicitar acceso**.');
    await t.tap(page.getByRole('button', { name: 'Solicitar acceso' }));

    await t.say('Escribe el nombre del refugio o rescate, y la zona donde está.');
    await t.type(sheet.locator('input[name=shelterName]'), 'Huellitas del Este');
    await t.type(sheet.locator('input[name=zone]'), 'Los Mina, Santo Domingo Este');
    await t.say('Tu WhatsApp: por ahí te escribimos para conocerte.');
    await t.type(sheet.locator('input[name=phone]'), '809-555-0188', 90);
    await t.say('Si el refugio tiene Instagram o Facebook, pega el enlace. Es opcional.');
    await t.type(sheet.locator('input[name=link]'), 'https://instagram.com/huellitasdeleste', 35);

    await t.say('Cuéntanos quién eres, desde cuándo rescatan y cómo trabajan.');
    await t.type(
      sheet.locator('textarea[name=about]'),
      'Soy Marta, fundadora de Huellitas del Este. Rescatamos perros y gatos en Los Mina desde 2021, con cinco hogares temporales y una veterinaria del barrio.',
      18,
    );

    await t.say('Lee la casilla y márcala. Luego toca **Enviar solicitud**.');
    await t.tap(sheet.locator('label.consent'));
    await t.tap(sheet.getByRole('button', { name: 'Enviar solicitud' }));

    await page.getByText('Solicitud enviada').waitFor();
    await t.say('Listo. Te escribiremos por WhatsApp para conocerte y confirmar los datos del refugio.');
    await t.tap(page.locator('dialog[open] [data-done]'));
    await t.say('En el portal verás cómo va tu solicitud.');
    await t.show(page.locator('#owner-card-title'));
    await t.wait(1500);
  },
};

export default flow;
