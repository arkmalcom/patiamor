# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Mobile-first. The mobile app will wrap this same Vite frontend (Capacitor or PWA), so the web UI must feel native on a phone: touch gestures, safe areas, thumb-reach actions.

## Stack

- Frontend: Vite + TypeScript, vanilla (no framework).
- Backend: TypeScript on Cloudflare Workers, with D1 (SQLite) as the database. Python was dropped (2026-10-12) because Django's admin, the main reason for it, can't run on Workers or D1.
- Admin/shelter tooling: a custom admin backed by role-checked API endpoints, so the same API serves the web admin and the mobile app.
- Domain: patiamor.com, registered through Cloudflare Registrar.
- Cloudflare operations follow the project skill at `.claude/skills/cloudflare/` (staging deploys are free; production, deletes, DNS and secrets need the owner's approval).

## Users

- **Adopters (regular users):** people in the Dominican Republic looking for a dog to adopt near them. They browse freely without an account; signing in is required to save dogs to their list and to act.
- **Shelter owners / maintainers:** upload dog profiles, edit them, and mark dogs as adopted, through a restricted admin view scoped to their own shelter.
- **Admins (platform owner):** full access across shelters and users.

## Product Purpose

Connect local Dominican shelters with nearby adopters. Shelters publish dogs; adopters discover dogs within a radius they choose, filter by what fits their life, and shortlist the few they are seriously considering. Success is dogs leaving shelters for homes that were a considered fit, not raw engagement.

## Positioning

Card-by-card browsing of real local dogs within the distance the adopter is willing to travel, with a **deliberately small shortlist**. Adoption is not Tinder: a "yes" is a weighed decision, and most adopters should only ever save 2–3 dogs. The product rewards consideration over volume.

## Operating Context

- Dominican Republic; Spanish (Dominican usage) by default, English localization later.
- Mostly phones, often on mobile data; photos must load fast.
- Distances in kilometers; locations are DR cities/sectors/provinces (e.g. Santo Domingo, Santiago, La Romana, Punta Cana).
- Shelters are small, often volunteer-run organizations.

## Capabilities and Constraints

- Browse dogs one at a time (card/swipe style) and in a list; open a full profile.
- User-configurable search radius (km) from their location.
- Filters (e.g. size, age, sex, energy, good with kids/other pets): exact set to be confirmed with shelter data model.
- **Shortlist ("Mi lista")**: 3 visible slots. Saving a dog first asks a short reflection (2–3 questions about space, time, budget, the dog's needs). When the list is full, adding a 4th offers two paths: replace an existing slot, or, for people truly able to take in many animals (e.g. a farm), a CTA to contact the platform (built-in contact email), which then connects them directly with shelters.
- **Skipping** means "not now": skipped dogs come back in a later session (fairer to hard-to-place dogs).
- Role-based access: admin / shelter / adopter.
- **Open decisions:** what happens after shortlisting (contact the shelter via WhatsApp, an adoption request form, or scheduling a visit); the platform contact email (placeholder: hola@patiamor.com) for the multi-adoption CTA.

## Brand Commitments

- Name: **Patiamor** ("pata" + "amor", paw + love), chosen by the owner on 2026-10-12. Domain target: patiamor.com, registered via Cloudflare (Cloudflare does not sell .do).
- Tone: playful yet professional. Warm and local, never cutesy enough to undermine trust in the shelters or the seriousness of adopting.

## Evidence on Hand

- No real dog photos, shelter data, testimonials, or stats yet. Mockups use clearly sample data; do not present invented shelters or adoption counts as real.
- Color study: `docs/color-study.md`. Bottom line: contrast/salience and photo quality are supported; specific hues are not. No DR-specific color data exists.

## Product Principles

1. **Consider, don't consume.** Every positive action should be weighed; the interface slows the user down at the moment of commitment.
2. **Close means real.** Distance and location are first-class; the radius is the user's choice and always visible.
3. **The dog leads.** Photos and the dog's story come first; UI recedes around them.
4. **Shelters are partners.** Present shelters credibly; their info must be accurate and easy to reach.
5. **Local by default.** Spanish first, Dominican places, km, phone-first.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast. Swipe actions always have visible button equivalents and keyboard support. Don't rely on red/green alone for pass/save.
- Respect reduced-motion preferences.
