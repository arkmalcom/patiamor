import { describe, expect, it } from 'vitest';
import { BRAND } from '../../web/src/brand';
import { es, t } from '../../web/src/i18n';

// The product's name and contact address live in one place (web/src/brand.ts) so a rename is one edit.
// App text says {app} and {contact}; this keeps a new string from spelling the name out again.

describe('the brand in one place', () => {
  it('no app text names the product or its email directly', () => {
    const literal = Object.entries(es).filter(([, v]) => v.includes(BRAND.name) || v.includes(BRAND.contactEmail));
    expect(literal.map(([k]) => k)).toEqual([]);
  });

  it('{app} and {contact} fill in by themselves, and a call can still pass its own values', () => {
    expect(t('app.name')).toBe(BRAND.name);
    expect(t('request.restrictedBody')).toContain(BRAND.contactEmail);
    expect(t('auth.welcome', { name: 'Ana' })).not.toContain('{');
  });
});
