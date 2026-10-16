// The product's name and its public contact address: the one place to change for a rename (docs/rename.md).
// Read by the app's text ({app} and {contact} in i18n.ts), the build (the page title, link previews and the
// install manifest, vite.config.ts) and the API (emails and link previews). The domain itself lives in the
// Worker's config (APP_ORIGIN, EMAIL_FROM in api/wrangler.jsonc); the app uses whatever origin it runs on.

export const BRAND = {
  name: 'Patiamor',
  contactEmail: 'hola@patiamor.com',
  /** The page title and link-preview title. */
  tagline: 'Adopta cerca de ti',
  description: 'Perros y gatos en adopción de refugios y familias cerca de ti, en República Dominicana.',
} as const;
