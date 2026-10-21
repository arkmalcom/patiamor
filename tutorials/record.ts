// Tutorial videos, recorded from the real app: `npm run record -- <flow>` writes out/<flow>.mp4.
// Each flow (flows/<flow>.ts) drives a phone-sized browser through the app, on a fresh local database
// (every migration, the staging sample data, then seed.sql), and says in a caption what to tap. When
// the UI changes, record again: nothing here is drawn by hand.
//
// Frames are screenshots taken back to back (about 30 a second, at 2x, so text stays sharp; the
// browser's own video recorder only captures at 1x). Captions, the title and the end card are HTML
// pages in the app's fonts, rendered to PNG and laid over the frames with ffmpeg.

import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..');
const STATE = join(HERE, '.state');
const FRAMES = join(STATE, 'frames');
const OUT = join(HERE, 'out');
const CF = join(REPO, '.claude/skills/cloudflare/scripts/cf');
const PORT = 8790; // not 8788, so a `npm run dev` Worker can keep running
export const BASE = `http://localhost:${PORT}`;

/** A phone's visible page (the browser's bars taken off), captured at 2x. */
const VIEW = { width: 390, height: 720 };
const FPS = 30;
const TITLE_S = 3;
const END_S = 4;

// The 1080×1920 canvas: the phone's screen, and the captions under it.
const SCREEN = { x: 126, y: 60, w: 828, h: 1529 };
const CAPTION = { x: 70, y: 1615, w: 940, h: 280 };

const SESSIONS = { carla: 'tutorial-session-carla', marta: 'tutorial-session-marta', luis: 'tutorial-session-luis' } as const; // seed.sql
const WORKER_LOG = join(STATE, 'worker.log');

export interface Flow {
  title: string;
  subtitle: string;
  /** The end card's line, above the contact address. */
  end: string;
  signedInAs?: keyof typeof SESSIONS;
  start: string;
  run(t: Tutor): Promise<void>;
}

type Caption = { text: string; at: number };

/** What a flow can do: say a caption, then tap, type and scroll like a person would. */
export class Tutor {
  captions: Caption[] = [];
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  /** Shows a caption (it stays until the next one) and gives it most of its reading time before acting,
   *  so the screen doesn't move on while an old caption is still up. */
  async say(text: string) {
    const last = this.captions.at(-1);
    if (last) {
      const left = last.at + readingMs(last.text) - Date.now();
      if (left > 0) await this.wait(left);
    }
    this.captions.push({ text, at: Date.now() });
    await this.wait(Math.max(900, readingMs(text) * 0.7));
  }

  wait(ms: number) {
    return this.page.waitForTimeout(ms);
  }

  /** Scrolls smoothly until `target` is comfortably in view (clear of the tab bar and sticky buttons). */
  async show(target: Locator, block: 'center' | 'start' = 'center') {
    await target.waitFor();
    const out = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < 80 || r.bottom > innerHeight - 150;
    });
    if (!out) return;
    await target.evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
    await this.wait(900);
  }

  /** A finger mark on the target, then the tap. */
  async tap(target: Locator, at?: { x: number; y: number }) {
    const { x, y, box } = await this.point(target, at);
    await target.click({ position: { x: x - box.x, y: y - box.y } });
    await this.wait(650);
  }

  /** The finger mark alone, for a button the video shouldn't press (one that leaves the app, like WhatsApp). */
  async point(target: Locator, at?: { x: number; y: number }) {
    await this.show(target);
    const box = (await target.boundingBox())!;
    const x = box.x + (at ? at.x * box.width : box.width / 2);
    const y = box.y + (at ? at.y * box.height : box.height / 2);
    await this.page.evaluate(([x, y]) => (window as any).__touch(x, y), [x, y]);
    await this.wait(320);
    return { x, y, box };
  }

  async type(target: Locator, text: string, delay = 60) {
    await this.tap(target);
    await target.pressSequentially(text, { delay });
    await this.wait(450);
  }

  /** Taps a button that opens the photo picker, and picks `files` in it. */
  async pick(target: Locator, files: string[]) {
    const chooser = this.page.waitForEvent('filechooser');
    await this.tap(target);
    await (await chooser).setFiles(files);
    await this.wait(900);
  }

  /** The sign-in code just sent to `email`: sample addresses are never emailed, so the Worker logs it. */
  async emailCode(email: string) {
    for (let i = 0; i < 50; i++) {
      const code = [...readFileSync(WORKER_LOG, 'utf8').matchAll(/kind=signin to=(\S+) code=(\d{6})/g)].findLast((m) => m[1] === email)?.[2];
      if (code) return code;
      await this.wait(200);
    }
    throw new Error(`no sign-in code for ${email}`);
  }

  /** Slow scroll by `px`, for reading a page along with the caption. */
  async scroll(px: number, ms = 1600) {
    await this.page.evaluate(([px, ms]) => {
      const from = scrollY;
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        scrollTo(0, from + px * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, [px, ms]);
    await this.wait(ms + 300);
  }
}

/** Long enough to read the caption comfortably. */
const readingMs = (text: string) => 1400 + 65 * text.replace(/\*\*/g, '').length;

// A dot where the finger lands, shrinking as it presses and fading after. A popover, so it shows above
// the app's sheets (modal dialogs sit in the top layer, over any z-index).
const TOUCH = `window.__touch = (x, y) => {
  const d = document.createElement('div');
  d.popover = 'manual';
  d.style.cssText = 'position:fixed;inset:auto;padding:0;overflow:visible;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;' +
    'background:rgba(200,40,95,.28);border:3px solid rgba(200,40,95,.85);box-shadow:0 0 0 2px rgba(255,255,255,.8);left:' + x + 'px;top:' + y + 'px';
  document.body.append(d);
  d.showPopover();
  d.animate([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: .35 }, { transform: 'scale(.85)', opacity: 1, offset: .6 }, { transform: 'scale(1.2)', opacity: 0 }], { duration: 1100, easing: 'ease-out' }).finished.then(() => d.remove());
};`;

function cf(args: string[]) {
  execFileSync(CF, args, { cwd: join(REPO, 'api'), stdio: ['ignore', 'ignore', 'inherit'] });
}

/** A fresh database and a Worker serving the current build of the app. */
async function startApp() {
  execFileSync('npm', ['run', 'build'], { cwd: join(REPO, 'web'), stdio: ['ignore', 'ignore', 'inherit'] });
  const db = join(STATE, 'db');
  rmSync(db, { recursive: true, force: true });
  cf(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', db]);
  cf(['d1', 'execute', 'DB', '--local', '--persist-to', db, '--file', 'seeds/staging.sql']);
  cf(['d1', 'execute', 'DB', '--local', '--persist-to', db, '--file', join(HERE, 'seed.sql')]);
  // Local values only: Cloudflare's Turnstile test keys pass everyone.
  const vars = ['ENVIRONMENT:development', `APP_ORIGIN:${BASE}`, 'TURNSTILE_SITE_KEY:1x00000000000000000000AA', 'TURNSTILE_SECRET:1x0000000000000000000000000000000AA'];
  const log = openSync(WORKER_LOG, 'w');
  const worker = spawn(CF, ['dev', '--port', String(PORT), '--persist-to', db, '--show-interactive-dev-session=false', ...vars.flatMap((v) => ['--var', v])], {
    cwd: join(REPO, 'api'),
    stdio: ['ignore', log, log],
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${BASE}/api/auth/config`).then((r) => r.ok, () => false)) return () => process.kill(-worker.pid!);
    await new Promise((r) => setTimeout(r, 500));
  }
  process.kill(-worker.pid!);
  throw new Error('the Worker did not start');
}

async function record(browser: Browser, flow: Flow) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
  await context.addInitScript(TOUCH);
  const page = await context.newPage();
  if (flow.signedInAs) {
    // Set from the page: Playwright's cookie API refuses __Host- cookies on http://localhost.
    await page.goto(`${BASE}/robots.txt`);
    await page.evaluate((token) => (document.cookie = `__Host-patiamor_session=${token}; Secure; Path=/; SameSite=Lax`), SESSIONS[flow.signedInAs]);
  }
  await page.goto(BASE + flow.start);
  await page.waitForLoadState('networkidle');

  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const frames: number[] = [];
  let capturing = true;
  const capture = (async () => {
    while (capturing) {
      const asked = Date.now();
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 90, animations: 'allow', caret: 'initial' }).catch(() => null);
      if (!jpeg) continue;
      writeFileSync(join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`), jpeg);
      frames.push((asked + Date.now()) / 2);
    }
  })();
  while (!frames.length) await page.waitForTimeout(20);

  const tutor = new Tutor(page);
  try {
    await flow.run(tutor);
  } catch (err) {
    capturing = false;
    await capture;
    await page.screenshot({ path: join(STATE, 'failed.png') });
    console.error(`The flow failed; the screen at that moment is in ${join(STATE, 'failed.png')}`);
    throw err;
  }
  const last = tutor.captions.at(-1);
  await tutor.wait(Math.max(1500, last ? last.at + readingMs(last.text) - Date.now() : 0));
  capturing = false;
  await capture;
  await context.close();
  return { frames, captions: tutor.captions };
}

// ---------- The canvas around the recording ----------

const fontUrl = (path: string) => pathToFileURL(join(REPO, 'web/node_modules', path)).href;
const PAGE = (body: string) => `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: 'Atkinson'; src: url('${fontUrl('@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2')}'); font-weight: 200 800; }
  @font-face { font-family: 'Shrikhand'; src: url('${fontUrl('@fontsource/shrikhand/files/shrikhand-latin-400-normal.woff2')}'); }
  html, body { margin: 0; width: 1080px; height: 1920px; background: transparent; overflow: hidden; }
  body { font-family: 'Atkinson', sans-serif; color: #1d2340; }
  b { color: #c8285f; font-weight: 800; }
  .card { position: absolute; inset: 0; background: #e3f1f4; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 110px; box-sizing: border-box; }
  .card img { width: 170px; height: 170px; margin-bottom: 56px; }
  .kicker { font-size: 38px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #1e7f49; margin: 0 0 28px; }
  h1 { font-family: 'Shrikhand', serif; font-weight: 400; font-size: 104px; line-height: 1.08; margin: 0 0 40px; }
  .sub { font-size: 48px; line-height: 1.3; color: #4a5275; margin: 0; }
  .contact { font-size: 46px; font-weight: 700; margin: 64px 0 0; }
</style><body>${body}</body>`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** `**Tus animales**` marks what to tap. */
const marked = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

const logo = () => pathToFileURL(join(REPO, 'web/public/favicon.svg')).href;

const frameSvg = () => {
  const { x, y, w, h } = SCREEN;
  return PAGE(`<svg width="1080" height="1920" style="position:absolute;inset:0">
    <defs>
      <mask id="m"><rect width="1080" height="1920" fill="#fff"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="40" fill="#000"/></mask>
      <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1d2340" flood-opacity=".35"/></filter>
    </defs>
    <g mask="url(#m)">
      <rect width="1080" height="1920" fill="#e3f1f4"/>
      <rect x="${x - 7}" y="${y - 7}" width="${w + 14}" height="${h + 14}" rx="47" fill="none" stroke="#1d2340" stroke-width="14" filter="url(#s)"/>
    </g>
  </svg>`);
};

const captionPage = (text: string) => PAGE(`<div id="c" style="position:absolute;left:${CAPTION.x}px;top:${CAPTION.y}px;width:${CAPTION.w}px;height:${CAPTION.h}px;
  display:flex;align-items:center;justify-content:center;text-align:center;font-size:50px;line-height:1.25;font-weight:600;text-wrap:balance"><p style="margin:0">${marked(text)}</p></div>`);

const titlePage = (f: Flow) => PAGE(`<div class="card"><img src="${logo()}" alt=""><p class="kicker">Patiamor · Guía</p><h1>${esc(f.title)}</h1><p class="sub">${esc(f.subtitle)}</p></div>`);
const endPage = (f: Flow) => PAGE(`<div class="card"><img src="${logo()}" alt=""><h1>¡Listo!</h1><p class="sub">${marked(f.end)}</p><p class="contact">¿Dudas? hola@patiamor.com</p></div>`);

async function png(browser: Browser, html: string, file: string) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const src = join(STATE, 'overlay.html');
  writeFileSync(src, html);
  await page.goto(pathToFileURL(src).href);
  await page.evaluate(() => document.fonts.ready);
  // A caption that doesn't fit shrinks until it does.
  await page.evaluate(() => {
    const c = document.getElementById('c');
    let size = 50;
    while (c && c.scrollHeight > c.clientHeight && size > 30) c.style.fontSize = `${(size -= 2)}px`;
  });
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
}

async function compose(browser: Browser, name: string, flow: Flow, frames: number[], captions: Caption[]) {
  const t0 = frames[0];
  const phoneS = (frames.at(-1)! - t0) / 1000 + 1 / FPS;
  const total = TITLE_S + phoneS + END_S;

  // The frames as they were taken: each one lasts until the next.
  const list = frames.map((t, i) => `file '${join(FRAMES, `${String(i).padStart(5, '0')}.jpg`)}'\nduration ${(((frames[i + 1] ?? t + 1000 / FPS) - t) / 1000).toFixed(4)}`);
  list.push(`file '${join(FRAMES, `${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
  writeFileSync(join(STATE, 'frames.txt'), list.join('\n'));

  await png(browser, frameSvg(), join(STATE, 'frame.png'));
  await png(browser, titlePage(flow), join(STATE, 'title.png'));
  await png(browser, endPage(flow), join(STATE, 'end.png'));
  for (const [i, c] of captions.entries()) await png(browser, captionPage(c.text), join(STATE, `caption-${i}.png`));

  const input = (file: string, seconds: number) => ['-loop', '1', '-framerate', String(FPS), '-t', seconds.toFixed(3), '-i', file];
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(STATE, 'frames.txt')];
  args.push(...input(join(STATE, 'frame.png'), total));
  const graph = [
    `color=c=0xe3f1f4:s=1080x1920:r=${FPS}:d=${total.toFixed(3)}[base]`,
    `[0:v]fps=${FPS},scale=${SCREEN.w}:${SCREEN.h}:flags=lanczos,setpts=PTS-STARTPTS+${TITLE_S}/TB[phone]`,
    `[base][phone]overlay=${SCREEN.x}:${SCREEN.y}:eof_action=pass[v0]`,
    `[v0][1:v]overlay=0:0[v1]`,
  ];
  let last = 'v1';
  let n = 2;
  const layer = (file: string, start: number, seconds: number, fade: string) => {
    args.push(...input(file, seconds));
    graph.push(`[${n}:v]format=rgba,${fade},setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[l${n}]`, `[${last}][l${n}]overlay=0:0:eof_action=pass[v${n}]`);
    last = `v${n}`;
    n++;
  };
  captions.forEach((c, i) => {
    const start = TITLE_S + (c.at - t0) / 1000;
    const end = i + 1 < captions.length ? TITLE_S + (captions[i + 1].at - t0) / 1000 : TITLE_S + phoneS;
    layer(join(STATE, `caption-${i}.png`), start, end - start, 'fade=in:st=0:d=0.25:alpha=1');
  });
  layer(join(STATE, 'title.png'), 0, TITLE_S + 0.5, `fade=out:st=${TITLE_S}:d=0.5:alpha=1`);
  layer(join(STATE, 'end.png'), TITLE_S + phoneS, END_S, 'fade=in:st=0:d=0.5:alpha=1');

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name}.mp4`);
  // A silent audio track: some apps won't post a video without one.
  args.push('-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo');
  args.push('-filter_complex', graph.join(';'), '-map', `[${last}]`, '-map', `${n}:a`, '-t', total.toFixed(3));
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', file);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  return { file, total };
}

const name = process.argv[2];
if (!name) {
  console.error('Usage: npm run record -- <flow>   (a file in flows/, without .ts)');
  process.exit(1);
}
const flow: Flow = (await import(`./flows/${name}.ts`)).default;
mkdirSync(STATE, { recursive: true });
const stop = await startApp();
const browser = await chromium.launch();
try {
  const { frames, captions } = await record(browser, flow);
  const { file, total } = await compose(browser, name, flow, frames, captions);
  console.log(`${file} (${total.toFixed(1)} s, ${frames.length} frames, ${captions.length} captions)`);
} finally {
  await browser.close();
  stop();
}
