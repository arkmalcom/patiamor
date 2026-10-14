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
- User-configurable search radius (km) from their location, from 1 km up to 150 km, plus a last stop "Todo el país" (chip: "Todo RD").
- **Sparse supply at launch (decided 2026-10-14):** with one or two shelters, most visitors are far from every animal (Punta Cana is 162 km from Santo Domingo). So: the pet list holds the nearest animals nationwide (cap 1,000, farthest drop first: PAT-28) with no distance limit; until someone picks a distance themselves, a visitor with nothing within the default 25 km sees the nearest animals anyway, with a note saying how far the first is (nothing is saved as a choice, so they get the near view as soon as shelters open nearby); the empty screens say what is true (seen them all / nothing near / nothing published yet / nothing with these filters), and the first two of those ask the visitor to tell a shelter or rescuer from their area about Patiamor. Cards and the profile show the distance; beyond 50 km the profile's "Ten en cuenta" says they would have to travel, and the request form asks "¿Puedes viajar?" (required), stored with the distance rounded to 5 km (never the adopter's place) and shown in the shelter's inbox. The Demo tag hides below 390 px so the top bar fits.
- Filters (e.g. size, age, sex, energy, good with kids/other pets): exact set to be confirmed with shelter data model.
- **Mi lista: three adoption requests.** There is no lower-commitment "save": every slot is a request in progress. Swiping right opens the pet's full profile, whose bar always shows "Quiero adoptar" (changed 2026-10-14: it used to scroll to a second confirmation button, which read as a bug). That button opens the one request form straight away, signing in first if needed. The profile still ends with "Antes de empezar" (needs, compatibility warnings, the fee, the slot warning), and the form opens with the same "Ten en cuenta" and fee, so everyone sees them however they got there. The form: the reflection questions (space, time, budget), how to reach the adopter (WhatsApp, call or email, remembered after the first time), consent to share those details with that lister, and an optional "Cuéntale más" (home, other animals, kids, experience, visit times, a note). With 3 active requests, starting a 4th says so, and offers the special request below.
- **Search (built 2026-10-14):** a "Buscar" tab (/buscar?q=…) for someone who saw an animal elsewhere, e.g. on Instagram, and wants to find it by name. It searches every animal Patiamor holds, whatever the person's filters, species switch or distance; every word typed must appear in the name, the shelter or the area (accents and capitals ignored), with exact names first, then names containing it, then shelter or area matches, nearest first, and "Nombres parecidos" (Pancha, Panchito for Pancho) when the spelling may differ. Each result shows the photo, species, sex, age, size, energy, shelter, area and distance, and what is known to be good (vaccines, sterilization, deworming, who it gets along with); tapping opens the profile, and back returns to the same results. It runs on the list the app already holds, so it costs no requests; that list is the nearest 1,000 animals nationwide (PAT-28), and it only holds animals open to requests, so one "en proceso" or already adopted is not found. When nothing matches, the screen says it may have been adopted, be in process, or not be published yet, and asks the person to tell the shelter to publish it (Compartir Patiamor, Registrar un refugio).
- **Adopting more than three (built 2026-10-14):** Mi lista ends its slots with "¿Quieres adoptar a más de tres?" (the same button is in the sheet shown when the three slots are full), which opens one sheet that explains the process and takes the form: how many (4 to 30), dogs/cats/both, anything in particular (optional), their home and experience, a phone (optional) and consent to share it with the shelters Patiamor contacts. It isn't about one animal and isn't sent to a shelter yet: an admin reviews it at /refugio/admin/grandes with the person's requests in progress, withdrawals in the last 90 days and animals already adopted through Patiamor, then approves (optional note) or declines (a reason the person reads). The person is emailed either way and sees the status in Mi lista for 30 days. If approved, Patiamor puts them in touch with the shelter or shelters that fit and the shelters choose which animals go with them: no in-app delivery to shelters, since it should be rare. Limits: one waiting at a time, three a month, and not for people whose new requests are paused for withdrawing too many. The admins get one email per new request, at most five a day, within the shared email budget. "Ahora no" pets appear under "Vistos antes" in Mi lista for the rest of the visit and return to Explorar next visit (leaving that list).
- **Skipping** means "not now": skipped pets come back in a later session (fairer to hard-to-place animals).
- Role-based access: admins (platform-wide); shelter owners and maintainers (their shelter's pets); any signed-in user can adopt, and can list dogs as a private lister.
- **Listings** always belong to a person (`listed_by`) and optionally to a shelter. Location is a general area (sector/barrio) picked from a curated list, never a street address.
- **Private listing review:** a private lister's first listing waits for admin approval; once approved they post freely. Every listing has a report button.
- **Fees:** only shelters may show an optional adoption fee (in DOP, labeled as covering vaccines/sterilization). Private listers can't ask for money, so the platform never becomes a puppy marketplace.
- **Litters:** puppies are grouped as siblings ("Sus hermanos"); each puppy is still its own card and is adopted individually.
- **Who's listing:** pets from a shelter show the shelter's name, and only once an admin has verified the shelter: until then (and while suspended) its animals don't appear at all. Dogs from private listers show "Particular" plus the area, never the person's full name.
- **Shelter portal (/refugio, decided):** a path on the same site, not a subdomain, so one sign-in covers adopting and listing. A signed-in person registers a shelter (public profile, plus a private application: contact person and WhatsApp, real address, RNC/ASFL if any, social links, rescue history, and a reference from a vet or another shelter, plus a rules confirmation) and becomes its owner; up to 3 shelters per account. Verification is human and staged: a short WhatsApp video call or tour, a look at their social media, and a call to the reference; the admin then verifies, asks for changes (with a reason the shelter sees and can fix and resend), or later suspends (with a reason). Every decision is logged and emailed to the owners. Roles: owner (everything) and maintainer (pets and requests, not settings).
- **Shelter listings (PAT-8, built):** owners and maintainers add and edit their shelter's animals at /refugio/<id>/animales, with a live preview of the adopter's card. Age is an estimate (years and months) or an exact birth date. Any shelter that isn't suspended can keep drafts; only a verified shelter publishes, and a published animal reaches adopters at once. Publishing needs the animal to be at least 8 weeks old and a short story; a live listing must keep meeting those rules when edited. A shelter's animals are at the shelter, so listings never ask for an area. Not yet: money-language checks (PAT-16), bulk actions and duplicating a profile (PAT-33), private listers.
- **Abuse limits (built):** the free plan stops serving for the day when D1's daily writes (100k) or requests (100k) run out, so floods must stop early. Every write is rate limited per account (per IP when signed out). D1 caps cover the slower cases: 2 shelter registrations a day per account, at most 30 shelters waiting for review, 300 animals per verified shelter (30 for one in review), 20 "Avísame" alerts per person, plus the photo and email budgets. Email sign-in sits behind Cloudflare Turnstile (free, invisible for almost everyone), so a script can't spend the day's email budget and lock people out. Still to come: the edge rate-limit rule on patiamor.com (PAT-30).
- **Sessions (decided, 2026-10-13):** 90 days, rolling: any visit pushes the end out again, so only 90 days away signs you out. "Salir" ends the session at once.
- **Shelter inbox and the morning email (PAT-5/PAT-4, built):** each verified shelter has Solicitudes at /refugio/<id>/solicitudes (Nuevas, En curso, Cerradas). Opening a new request marks it seen; shelters contact adopters through their own channels (wa.me link with a prefilled message, phone, email: the adopter's preferred one first), mark contacted or visit, or close with a reason. Adopters see each step in Mi lista. Contact details show only while a request is open. Per animal, "En proceso" (reserved) and a pause switch stop new requests; reopening triggers "Avísame". Zero email budget by design (owner decision, 2026-10-13): no email per request. One scheduled job a day (8:00 DR) sends each shelter one summary of unopened requests no summary has mentioned yet, and the "Avísame" notices, all within the shared daily email budget (sign-in codes keep their reserve; what doesn't fit goes the next day). Admins can run it now from the verification page. Mail to the sample data's @ejemplo.do and example.com addresses is never sent. Per-request emails can come back if the email budget grows.
- **Photos (PAT-9, built):** up to 5 per animal, the first is the cover, and the shelter taps the face to set the framing (CSS object-position) the card uses. Publishing needs at least one, and a live animal always keeps one. Photos are resized on the phone (about 1600 px WebP, JPEG where WebP can't be encoded, plus a 480 px thumbnail for small frames) and sent as base64 JSON, so the same-origin JSON check covers uploads. The Worker trusts only the bytes: real JPEG/WebP within size and dimension limits, no EXIF/XMP (so no GPS), keys from a content hash. Limits are 100 uploads per person per day (deleting doesn't refund), 1,000 a day overall, and an 8 GB storage ceiling (R2 free tier is 10 GB). Photos are served immutable for a year with nosniff and a sandboxing CSP. 90 days after an adoption, the morning job deletes every photo but the main one (from D1 and R2).
- **Shareable links (PAT-32, built 2026-10-14):** the app uses real paths (/mascota/<id>, /lista, /refugio/…), so links shared on WhatsApp, Facebook or Instagram preview properly; old /#/ links (emails, bookmarks) open the right page. For /mascota/<id> the Worker writes the pet's name, a line about it (species and sex, age, area, shelter) and its photo thumbnail into the page's preview tags; adopted and withdrawn pets preview as such. The profile has a "Compartir" button (the phone's share sheet, or copy the link).
- **How a listing ends (PAT-11, built 2026-10-14):** from Tus animales (tabs Activos, Adoptados, Retirados), the animal's page, or a request in the inbox. "Se fue a casa" marks it adopted with the family's request, or with a family from outside Patiamor; that request becomes "adopted" and the others close by themselves (reason `adoptado`), freeing those adopters' slots. "Retirar" takes it down with a reason for the shelter's records (back with its old family, health, died, other); its requests close (`retirado`) and adopters only see "Ya no está disponible". "Volver a publicar" undoes either under the publishing rules; undoing an adoption ends that family's request (`devuelto`), and "Avísame" hears about it. Both leave search at once. Old links (Mi lista, shared ones) show "¡Ya encontró hogar!" or "Ya no está disponible" with the name and main photo (the API answers 410). The sheet says how many requests will close before confirming.
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
