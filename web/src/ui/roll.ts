import { reducedMotion } from '../dom';

// Numbers that change roll in place, digit by digit, so the effect of a control is felt.

const COLUMN = '0123456789'.split('').map((d) => `<span>${d}</span>`).join('');

export function rollTo(el: HTMLElement, value: number) {
  const text = String(value);
  const label = el.getAttribute('data-label') ?? '';
  el.setAttribute('aria-label', `${text}${label ? ' ' + label : ''}`);
  let digits = Array.from(el.querySelectorAll<HTMLElement>('.roll__digit'));
  if (digits.length !== text.length) {
    el.innerHTML = text
      .split('')
      .map(() => `<span class="roll__digit" aria-hidden="true"><span class="roll__col">${COLUMN}</span></span>`)
      .join('');
    digits = Array.from(el.querySelectorAll<HTMLElement>('.roll__digit'));
  }
  digits.forEach((d, i) => {
    const col = d.firstElementChild as HTMLElement;
    col.style.transitionDelay = reducedMotion() ? '0ms' : `${(digits.length - 1 - i) * 40}ms`;
    col.style.transform = `translateY(${-Number(text[i]) * 10}%)`;
  });
}
