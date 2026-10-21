import type { Flow } from '../record.ts';

// A person who has never signed in finds the shelter portal and creates their account with an email code.

const EMAIL = 'julia.mateo@ejemplo.do';

const flow: Flow = {
  title: 'Cómo entrar al portal',
  subtitle: 'Para refugios y particulares',
  end: 'La próxima vez, entra con el **mismo correo**.',
  start: '/',
  async run(t) {
    const page = t.page;
    await t.say('Abre patiamor.com en tu teléfono y toca **Cuenta**, abajo a la derecha.');
    await t.tap(page.locator('a[href="/cuenta"]').last());

    await t.say('Si diriges un refugio o tienes animales que dar en adopción, toca **Quiero publicar en Patiamor**.');
    await t.tap(page.getByRole('link', { name: 'Quiero publicar en Patiamor' }));

    await t.say('Este es el portal de refugios. Puedes entrar con tu cuenta de Google o con tu correo.');
    await t.show(page.locator('[data-auth]'), 'start');
    await t.say('Escribe tu correo y toca **Enviarme un código**.');
    await t.type(page.locator('input[name=email]'), EMAIL);
    await t.tap(page.getByRole('button', { name: 'Enviarme un código' }));

    await t.say('Te llega un correo con un código de 6 números. Escríbelo aquí.');
    await t.type(page.locator('input[name=code]'), await t.emailCode(EMAIL), 180);

    await t.say('La primera vez te preguntamos tu nombre. Escríbelo y toca **Continuar**.');
    await t.type(page.locator('input[name=name]'), 'Julia Mateo');
    await t.tap(page.getByRole('button', { name: 'Continuar' }));

    await page.locator('.portal__who', { hasText: 'Julia Mateo' }).waitFor();
    await t.say('¡Ya entraste! Desde aquí pides acceso para tu refugio o para publicar como particular.');
    await t.scroll(500, 2500);
  },
};

export default flow;
