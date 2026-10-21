import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Flow } from '../record.ts';

// A verified shelter (Patitas de Gazcue, sample data) publishes its first animal.

const PHOTO = fileURLToPath(new URL('../../web/public/perros/miel.jpg', import.meta.url));
const CLOSEUP = fileURLToPath(new URL('../.state/nube-cara.jpg', import.meta.url));

const flow: Flow = {
  title: 'Cómo publicar un animal',
  subtitle: 'Para refugios verificados',
  end: 'Para cambiar algo después, tócalo en **Tus animales**.',
  music: 'Enchanted Valley',
  signedInAs: 'carla',
  start: '/refugio',
  async run(t) {
    // A second photo of the same dog: a close-up of the face.
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', PHOTO, '-vf', 'crop=700:700:100:150', CLOSEUP]);
    const page = t.page;
    const question = (legend: string) => page.locator('fieldset.question', { has: page.locator('legend', { hasText: legend }) });
    const choose = (legend: string, option: string) => t.tap(question(legend).locator('label', { hasText: option }));

    await t.say('Entra a patiamor.com/refugio con tu cuenta. Ahí está la tarjeta de tu refugio.');
    await t.say('Toca **Tus animales**.');
    await t.tap(page.getByRole('link', { name: 'Tus animales' }));

    await t.say('Aquí verás a todos tus animales. Toca **Añadir un animal**.');
    await t.tap(page.getByRole('link', { name: 'Añadir un animal' }));

    await t.say('La primera vez te mostramos las reglas para publicar. Léelas con calma.');
    await t.scroll(700, 4000);
    await t.say('Cuando termines, toca **Entendido, seguir**.');
    await t.tap(page.getByRole('button', { name: 'Entendido, seguir' }));

    await t.say('Empieza por las fotos: toca **Añadir fotos** y elige hasta 5.');
    await t.pick(page.locator('[data-photo-add]'), [PHOTO, CLOSEUP]);
    await t.say('La primera es la **Principal**: la que verán en su tarjeta.');
    await t.tap(page.locator('[data-photos] [data-pick="0"]'));
    await t.say('Toca su cara en la foto, para que la tarjeta la muestre bien.');
    await t.tap(page.locator('[data-focus-frame] img'), { x: 0.5, y: 0.36 });

    await t.say('Ahora lo básico: ¿perro o gato?, su nombre y su sexo.');
    await choose('¿Es perro o gato?', 'Perro');
    await t.type(page.locator('input[name=name]'), 'Nube');
    await choose('Sexo', 'Hembra');
    await t.say('Si no sabes su fecha de nacimiento, pon la **edad aproximada**.');
    await t.type(page.locator('input[name=years]'), '1');
    await t.type(page.locator('input[name=months]'), '6');
    await t.say('Elige su tamaño y su energía.');
    await choose('Tamaño', 'Mediano');
    await choose('Energía', 'Alta');

    await t.say('¿Con quién convive? Si todavía no lo han probado, elige **Por confirmar**.');
    await choose('¿Se lleva bien con niños?', 'Sí');
    await choose('¿Se lleva bien con otros perros?', 'Sí');
    await choose('¿Se lleva bien con gatos?', 'Por confirmar');

    await t.say('Marca los cuidados que ya tiene.');
    await t.tap(page.locator('label.check', { hasText: 'Vacunas al día' }));
    await t.tap(page.locator('label.check', { hasText: 'Desparasitación hecha' }));

    await t.say('Cuenta su historia en un par de frases. Sin precios ni teléfonos.');
    await t.type(page.locator('textarea[name=story]'), 'La rescatamos en un parque de Gazcue. Es juguetona y cariñosa, y le encanta revolcarse en la grama.', 22);
    await t.say('Lo que necesita, uno por línea. Es opcional.');
    await t.type(page.locator('textarea[name=needs]'), 'Paseos todos los días\nPatio o parque cerca', 40);

    await t.say('Si cobran una cuota para vacunas o esterilización, ponla aquí. Si no, déjala vacía.');
    await t.type(page.locator('input[name=fee]'), '1500', 120);

    await t.say('Más abajo ves cómo la verán las familias.');
    await t.show(page.locator('.listing-preview'), 'start');
    await t.wait(1500);

    await t.say('Cuando esté lista, toca **Publicar**. ¿Aún no? Toca **Guardar borrador**.');
    await t.tap(page.getByRole('button', { name: 'Publicar', exact: true }));
    await page.getByText('Publicamos a Nube').waitFor();
    await t.say('Nube ya aparece a las familias que viven cerca.');
  },
};

export default flow;
