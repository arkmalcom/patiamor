import type { Flow } from '../record.ts';

// A shelter answers its adoption requests: opens one, contacts the family, marks each step, closes another.

const flow: Flow = {
  title: 'Cómo responder las solicitudes',
  subtitle: 'Para refugios y particulares',
  end: 'Si llegan solicitudes nuevas, te avisamos **cada mañana** por correo.',
  signedInAs: 'carla',
  start: '/refugio',
  async run(t) {
    const page = t.page;
    const request = (who: string) => page.locator('details[data-request]', { has: page.locator('summary.request-card__head', { hasText: who }) });

    await t.say('Cuando una familia quiere adoptar, su solicitud llega al portal. Toca **Solicitudes**.');
    await t.tap(page.getByRole('link', { name: /^Solicitudes/ }));

    await t.say('Las nuevas están en **Nuevas**. Toca una para abrirla.');
    await t.tap(request('Laura Gómez').locator('summary.request-card__head'));

    await t.say('Ves su mensaje, cómo contestó las preguntas y lo que contó de su casa.');
    await t.show(request('Laura Gómez').locator('.request-card__message'), 'start');
    await t.scroll(380, 2800);

    await t.say('Escríbele con un toque, como ella prefiere. El mensaje ya viene escrito.');
    await t.point(request('Laura Gómez').locator('.request-card__contact .button'));
    await t.wait(1200);

    await t.say('Después de escribirle, toca **Ya lo contactamos**. La familia ve cada paso en su lista.');
    await t.tap(request('Laura Gómez').locator('[data-move=contacted]'));
    await t.say('Si acuerdan una visita, toca **Acordamos una visita**.');
    await t.tap(request('Laura Gómez').locator('[data-move=visit]'));

    await t.say('Si una solicitud no sigue, ciérrala. Abre la de Miguel, en **Nuevas**.');
    await t.tap(page.locator('[data-tab=nuevas]'));
    await t.tap(request('Miguel Santana').locator('summary.request-card__head'));
    await t.say('Toca **Cerrar esta solicitud** y elige el motivo.');
    await t.tap(request('Miguel Santana').locator('.request-card__close summary'));
    await t.tap(request('Miguel Santana').locator('label', { hasText: 'No es la mejor opción para este animal' }));
    await t.tap(request('Miguel Santana').getByRole('button', { name: 'Cerrar solicitud' }));
    await t.say('La familia ve que terminó, sin el motivo, y su espacio queda libre para otra solicitud.');
    await t.wait(1000);
  },
};

export default flow;
