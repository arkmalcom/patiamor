---
version: 1
slug: "src-main-ts"
primary_target: "src/main.ts"
related_targets: ["index.html"]
---

# Surface: adopter app (Explorar, Radio y filtros, Perfil, Mi lista)

Scope: the adopter-facing mobile-first web app (wrapped later as a mobile app). Mode: **Operate**. Desktop is a real three-column layout, not a stretched phone.

Audience/job: Dominican adults on phones, often outdoors in bright daylight or at home in the evening, browsing nearby shelter dogs within a radius they set, and shortlisting at most ~3 after reflection.

Constraints: Spanish (DR) copy; sample data must be labeled as samples; skip = "Ahora no" (dog returns later); save = reflection first, sign-in required, 3 slots; a 4th triggers replace-or-contact (multi-adoption CTA by email, address is a placeholder). Next step after shortlisting is an open decision; do not invent a contact flow.

Memorable moment: the radius "radar". Dogs sit as dots at their real distance and bearing, and moving the slider repaints the ring and rolls the count digit by digit.

## Direction contract

THESIS: Each dog is a market canvas (Mercado Modelo / El Conde naïf painting): one framed painting at a time, carefully looked at, and only a few taken home. Refuses the Tinder stack of rounded photo cards with a red X and a green heart.

OWN-WORLD: Pale naïf-sky ground (#E3F1F4), night-blue ink (#1D2340). Each dog wears a hand-painted two-tone frame band from a flat gouache set (leaf green, mango, ultramarine, turquoise, flamboyán orange), with flat leaf silhouettes tucked behind frame edges. Hibiscus is the ONLY action color, and only on tappable things. Shrikhand (painted-title display) is used for dog names and headings; Atkinson Hyperlegible Next is used for everything else. Facts sit in a segmented strip with tabular figures. No gradients, no glass.

STORY: The visitor sees one real nearby dog at painting scale, sees exactly how far away it is, and understands that saving means a considered, limited choice.

FIRST VIEWPORT: Top bar with the wordmark and a radius chip ("Gazcue · 15 km"), plus a filters button. The framed photo takes about 68% of the height, with the name painted on the lower frame band in Shrikhand and km and sector beside it, and the fact strip under the frame. Thumb row: "Ahora no" (outline), "Ver perfil", and the hibiscus "Guardar" opening the reflection. Bottom nav shows Mi lista with 3 slot pips.

FORM: Cuadro de Mercado. Candidate 6 of 7 on the ordered list; seed key 39e6b52b. Raises: action-only color (warm consumer); segmented facts (boarding pass); digit-roll numbers (split-flap); next dog preloaded (vertical feed).

SIGNATURE INTERACTION & MOTION: The canvas swipes with drag physics and tilt; leftward reads "Ahora no", rightward lifts into the reflection sheet rather than saving. Radius radar repaint plus digit roll. Ease-out-expo, 240–420ms, and reduced-motion falls back to crossfades.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
