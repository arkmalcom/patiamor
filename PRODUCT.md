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

- **Adopters (regular users):** people in the Dominican Republic looking for a dog or cat to adopt near them. They browse freely without an account; signing in is required to save dogs to their list and to act.
- **Shelter owners / maintainers:** upload pet profiles, edit them, and mark pets as adopted, through a restricted admin view scoped to their own shelter.
- **Private listers:** individuals outside any shelter rehoming pets (e.g. a family whose dog or cat had a litter). They manage only their own listings through a simpler "Mis publicaciones" view.
- **Admins (platform owner):** full access across shelters and users.

## Product Purpose

Connect local Dominican shelters with nearby adopters. Shelters publish dogs and cats; adopters discover them within a radius they choose, filter by what fits their life, and shortlist the few they are seriously considering. Success is dogs leaving shelters for homes that were a considered fit, not raw engagement.

## Positioning

Card-by-card browsing of real local dogs and cats within the distance the adopter is willing to travel, with a **deliberately small shortlist**. Adoption is not Tinder: a "yes" is a weighed decision, and most adopters should only ever save 2–3 dogs. The product rewards consideration over volume.

## Operating Context

- Dominican Republic; Spanish (Dominican usage) by default, English localization later.
- Mostly phones, often on mobile data; photos must load fast.
- Distances in kilometers; locations are DR cities/sectors/provinces (e.g. Santo Domingo, Santiago, La Romana, Punta Cana).
- Shelters are small, often volunteer-run organizations.

## Capabilities and Constraints

- **Dogs and cats.** A three-position switch (Perros | Ambos | Gatos) picks what to browse; "Ambos" mixes both. The data model calls them pets (`pets.species`).
- Browse pets one at a time (card/swipe style) and in a list; open a full profile.
- User-configurable search radius (km) from their location.
- Filters (e.g. size, age, sex, energy, good with kids/other pets): exact set to be confirmed with shelter data model.
- **Mi lista: three adoption requests.** There is no lower-commitment "save": every slot is a request in progress. "Quiero adoptar" (button or swipe right) opens the pet's full profile; the profile ends with "¿Listo para empezar?" (needs, compatibility warnings, the fee) and "Sí, quiero empezar el proceso", the only place to commit. One form follows: the reflection questions (space, time, budget), how to reach the adopter (WhatsApp, call or email, remembered after the first time), consent to share those details with that lister, and an optional "Cuéntale más" (home, other animals, kids, experience, visit times, a note). With 3 active requests, starting a 4th offers to withdraw one, or, for people truly able to take in many animals (e.g. a farm), a CTA to contact the platform, which connects them directly with shelters. "Ahora no" pets appear under "Dejaste pasar" in Mi lista for the rest of the visit and return to Explorar next visit (leaving that list).
- **Skipping** means "not now": skipped pets come back in a later session (fairer to hard-to-place animals).
- Role-based access: admins (platform-wide); shelter owners and maintainers (their shelter's pets); any signed-in user can adopt, and can list dogs as a private lister.
- **Listings** always belong to a person (`listed_by`) and optionally to a shelter. Location is a general area (sector/barrio) picked from a curated list, never a street address.
- **Private listing review:** a private lister's first listing waits for admin approval; once approved they post freely. Every listing has a report button.
- **Fees:** only shelters may show an optional adoption fee (in DOP, labeled as covering vaccines/sterilization). Private listers can't ask for money, so the platform never becomes a puppy marketplace.
- **Litters:** puppies are grouped as siblings ("Sus hermanos"); each puppy is still its own card and is adopted individually.
- **Who's listing:** pets from a shelter show the shelter's name, and only once an admin has verified the shelter: until then (and while suspended) its animals don't appear at all. Dogs from private listers show "Particular" plus the area, never the person's full name.
- **Shelter portal (#/refugio, decided):** a path on the same site, not a subdomain, so one sign-in covers adopting and listing. A signed-in person registers a shelter (public profile, plus a private application: contact person and WhatsApp, real address, RNC/ASFL if any, social links, rescue history, and a reference from a vet or another shelter, plus a rules confirmation) and becomes its owner; up to 3 shelters per account. Verification is human and staged: a short WhatsApp video call or tour, a look at their social media, and a call to the reference; the admin then verifies, asks for changes (with a reason the shelter sees and can fix and resend), or later suspends (with a reason). Every decision is logged and emailed to the owners. Roles: owner (everything) and maintainer (pets and requests, not settings).
- **Anti puppy-mill / anti-resale safeguards (adopted 2026-10-12):**
  1. Money language in a listing ("vendo", "precio", "RD$", "negociable", "depósito", "reservar", phone numbers in the text) automatically sends it back to review.
  2. Three reports automatically hide a listing pending admin review.
  3. No puppy can be listed before 8 weeks of age.
  4. A plain-Spanish rules page (no sales, no breeding services/"monta", no deposits or transport fees) is shown the first time someone lists.
  - Considered and **not adopted for now**: litter limits plus a mother-sterilization question; no breed field and flagging trendy-breed puppies; recording the adopter to catch resale, plus account bans; duplicate-photo detection. Revisit if abuse appears.
- **Requests (decided):** a request is the only thing a lister sees. One confirmation email; status lives in Mi lista, and requests that ended stay visible there for 30 days. Withdrawing should be rare and serious, never a way to trade up: the profile and form ask adopters to start only if they're sure (without advertising that they can withdraw), the 3-of-3 sheet offers no swap, and the withdraw sheet leads with a warning ("Cada perro merece una oportunidad…") and requires a reason. It frees the slot at once, has no cooldown, and the lister always sees it with the reason. Three withdrawals within 90 days pause new requests until Patiamor has checked in with the adopter (an admin clears it by setting users.requests_cleared_at). A slot frees on its own when the lister closes the request or the pet goes home with someone else. Requests never lock a pet: listers choose the best fit, mark a pet "en proceso" (reserved) to pause new requests, and requests pause on their own at 10 open ones. Adopters see a gentle "ya tiene varias solicitudes" from 3, never a count, and can ask "Avísame si vuelve a estar disponible". Listers contact adopters through their own channels (WhatsApp link, email); the inbox, digests and adopter updates come with the lister portal.
- **Open decisions:** the platform contact email (placeholder: hola@patiamor.com) for the multi-adoption CTA; phone verification (PAT-2).

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
