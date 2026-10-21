import type { Flow } from '../record.ts';

// A person approved as a shelter owner registers the shelter, which then waits for verification.

const flow: Flow = {
  title: 'Cómo registrar tu refugio',
  subtitle: 'Después de que aprobemos tu acceso',
  end: 'Cuando lo verifiquemos, tus animales aparecerán a las familias que viven cerca.',
  signedInAs: 'luis',
  start: '/refugio',
  async run(t) {
    const page = t.page;
    await t.say('Cuando aprobemos tu acceso, verás **Registrar un refugio** en el portal. Tócalo.');
    await t.tap(page.getByRole('link', { name: 'Registrar un refugio' }));

    await t.say('Primero, lo que verán las familias: el nombre del refugio y su zona.');
    await t.type(page.locator('input[name=name]'), 'Huellitas del Este');
    await t.say('Busca el barrio o sector del refugio y elígelo de la lista. Nunca mostramos la dirección.');
    await t.type(page.locator('[data-place-query]'), 'Los Mina', 90);
    await t.tap(page.locator('[data-place-results] button', { hasText: 'Los Mina Sur' }).first());

    await t.say('Cuéntales quiénes son y cuándo pueden visitar. Esto es opcional.');
    await t.type(page.locator('textarea[name=description]'), 'Rescate de voluntarios en Los Mina, con hogares temporales.', 25);
    await t.type(page.locator('input[name=visitHours]'), 'Sábados de 9:00 a 1:00', 40);
    await t.say('El teléfono, el correo y la web públicos también son opcionales.');
    await t.type(page.locator('input[name=publicPhone]'), '809-555-0188', 70);

    await t.say('Esta parte solo la ve el equipo de Patiamor, para verificarte. Nunca se publica.');
    await t.show(page.locator('.form-section--private'), 'start');
    await t.type(page.locator('input[name=contactName]'), 'Luis Féliz');
    await t.type(page.locator('input[name=contactPhone]'), '809-555-0188', 70);
    await t.type(page.locator('input[name=address]'), 'Calle Respaldo 5, #12, Los Mina Sur', 30);
    await t.say('Pega las redes del refugio y cuenta su historia rescatando.');
    await t.type(page.locator('textarea[name=social]'), 'https://instagram.com/huellitasdeleste', 30);
    await t.type(
      page.locator('textarea[name=history]'),
      'Rescatamos desde 2021, unos 40 animales al año. Tenemos cinco hogares temporales y cubrimos los gastos con donaciones de vecinos.',
      16,
    );

    await t.say('Una referencia: una veterinaria u otro refugio que los conozca. La contactaremos.');
    await t.type(page.locator('input[name=ref-name-0]'), 'Clínica Veterinaria Los Mina', 30);
    await t.type(page.locator('input[name=ref-contact-0]'), '809-555-0190', 70);
    await t.tap(page.locator('fieldset.question', { hasText: '¿Quién es?' }).locator('label', { hasText: 'Veterinaria' }));

    await t.say('Lee la casilla y márcala. Luego toca **Enviar solicitud**.');
    await t.tap(page.locator('label.consent'));
    await t.tap(page.getByRole('button', { name: 'Enviar solicitud' }));

    await page.getByText('Huellitas del Este').first().waitFor();
    await t.say('Tu refugio queda **En revisión**. Te escribiremos por WhatsApp para una videollamada corta.');
    await t.say('Mientras esperas, ya puedes preparar a tus animales como borradores.');
    await t.point(page.getByRole('link', { name: 'Prepara a tus animales' }));
    await t.wait(1200);
  },
};

export default flow;
