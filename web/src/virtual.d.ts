// The legal texts, read from docs/legal/ at build time (vite.config.ts).
declare module 'virtual:legal' {
  const legal: { privacidad: string; terminos: string; privacy: string; terms: string };
  export default legal;
}
