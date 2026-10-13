---
name: Patiamor
description: Nearby shelter dogs and cats, one painted market canvas at a time, with a deliberately small shortlist.
colors:
  sky: "#e3f1f4"
  sky-tint: "#eef7f9"
  hill-far: "#d2eacf"
  hill-near: "#bfe0bf"
  paper: "#ffffff"
  ink: "#1d2340"
  ink-2: "#4a5275"
  ink-lift: "#2b335a"
  rule: "rgba(29, 35, 64, 0.12)"
  rule-strong: "rgba(29, 35, 64, 0.28)"
  disabled-fill: "#d5d8e2"
  hibiscus: "#c8285f"
  hibiscus-press: "#a81f4f"
  hoja: "#1e7f49"
  hoja-deep: "#145c35"
  mango: "#f2a21b"
  mango-tint: "#fdf0d3"
  anil: "#2d4fc9"
  turquesa: "#3fc1c0"
  toast-link: "#ffd27a"
typography:
  display:
    fontFamily: "Shrikhand, 'Atkinson Hyperlegible Next Variable', serif"
    fontSize: "clamp(2rem, 9vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Shrikhand, 'Atkinson Hyperlegible Next Variable', serif"
    fontSize: "clamp(2.2rem, 8vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.05
  title:
    fontFamily: "Shrikhand, 'Atkinson Hyperlegible Next Variable', serif"
    fontSize: "1.6rem"
    fontWeight: 400
    lineHeight: 1.1
  title-sm:
    fontFamily: "Shrikhand, 'Atkinson Hyperlegible Next Variable', serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.15
  numeral:
    fontFamily: "Shrikhand, 'Atkinson Hyperlegible Next Variable', serif"
    fontSize: "2.6rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum' 1"
  body:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-long:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 400
    lineHeight: 1.65
  ui-strong:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 800
    lineHeight: 1.1
  label:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 800
    letterSpacing: "0.09em"
  caption:
    fontFamily: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  hairline: "2px"
  picture: "3px"
  strip: "4px"
  mini-frame: "5px"
  stamp: "8px"
  field: "12px"
  panel: "14px"
  card: "16px"
  sheet: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gutter: "20px"
  gutter-wide: "28px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.hibiscus}"
    textColor: "{colors.paper}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.hibiscus-press}"
    textColor: "{colors.paper}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-fill}"
    textColor: "{colors.ink-2}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "52px"
  button-outline-hover:
    backgroundColor: "{colors.sky-tint}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.ui-strong}"
    padding: "0 12px"
    height: "52px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "52px"
  button-ink-hover:
    backgroundColor: "{colors.ink-lift}"
  button-small:
    padding: "0 14px"
    height: "40px"
  text-button:
    textColor: "{colors.anil}"
    padding: "6px 2px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "42px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  radius-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 12px"
    height: "44px"
  icon-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "44px"
  segmented-option:
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "6px 12px"
    height: "48px"
  segmented-option-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  facts-strip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.strip}"
    padding: "8px 10px 9px"
  slot-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  side-panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "22px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  tabbar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    height: "64px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "12px 16px"
  note-mind:
    backgroundColor: "{colors.sky-tint}"
    rounded: "{rounded.panel}"
    padding: "14px 16px"
  note-unsure:
    backgroundColor: "{colors.mango-tint}"
    rounded: "{rounded.panel}"
    padding: "12px 16px"
---

# Design System: Patiamor

## Overview

**Creative North Star: "Cuadro de Mercado"**

Every pet is a portrait in a hand-painted naïf frame, set against a painted street of Dominican houses of the kind sold on the street in El Conde and at the Mercado Modelo. The build shows one framed canvas at a time on a pale painted sky, set above two flat green hills. The frame is a two-tone gouache band whose edge is slightly wobbly, as if cut by hand, with faint brush strokes. The frame is arched on top like the street's colonial doors, the name sits on a die-cut sticker slapped slightly askew across the frame, and convivencia badges sit at the photo's corner. The dog's name is painted on the lower band in a heavy brush script, and the dog's facts sit beneath it in a white strip divided into cells. Everything around the canvas (the top bar, the thumb row, the sheets) stays quiet. It uses paper-white, night-blue ink and pill shapes, so the painting carries the color and the interface stays out of the way.

Density is low and deliberate. The stated aim is one painting, looked at carefully, with only a few taken home. Color works by strict division of labor. The frame paints (leaf green, mango, ultramarine, turquoise) belong to the dogs and the painted world. A single hibiscus pink belongs to the act of pressing. Ink belongs to text and to the selected state. The fills are flat: no smooth gradients, no glass, no blur. Depth comes from soft, cool, ink-tinted drop shadows under paper objects and under the canvas, which reads like a painting leaning off a wall.

The world explicitly rejects the dating-app stack: rounded photo cards with a red X and a green heart. Skipping is "Ahora no" (outline, a clock icon, on the left); saving is "Guardar" (hibiscus, a heart icon, on the right), and a save opens a reflection sheet rather than committing at once.

**Key Characteristics:**
- One framed canvas per view; the photo fills about two thirds of the phone viewport.
- Two-tone painted frame bands chosen per dog from a four-paint set, with a hand-cut edge mask and stroke texture.
- Hibiscus is the only action color, and only on pressable things.
- Shrikhand for dog names, titles and big numbers; Atkinson Hyperlegible Next for everything else.
- Flat gouache fields: sky ground over a painted street of Dominican colonial houses (Zona Colonial parapets, Puerto Plata gingerbread roofs with fretwork, arched doors, slatted window shutters) in pale wall tints of the frame paints, with strong-paint doors and shutters. The street never stretches; it crops.
- Paper-white controls with pill shapes and ink outlines; ink fill marks the selected state.
- Tabular figures wherever a number is read: km, counts, facts, slot pips.

## Colors

The palette is a pale painted sky with night-blue ink, four flat frame paints, and one hibiscus accent kept rare enough to stand out.

### Primary
- **Hibiscus** ({colors.hibiscus}): the fill of the primary button ("Guardar", "Ampliar a N km", the reflection's submit, "Aplicar"). It also colors the drag stamp that labels the save gesture on the draggable card, and the text caret. White on hibiscus measures 5.35:1. **Hibiscus Press** ({colors.hibiscus-press}) is its hover and pressed fill (7.06:1 with white).

### Secondary
These are the frame paints. They belong to the dogs and the painted world, never to actions.
- **Hoja (Leaf Green)** ({colors.hoja}): a frame paint; the radius disk's stroke and the slider fill; the paw bullet in a pet's needs list; `accent-color` for native controls. White text on hoja measures 5.02:1.
- **Hoja Deep** ({colors.hoja-deep}): the "yes" status text and the "saved" tag (8.04:1 on paper).
- **Mango** ({colors.mango}): a frame paint; the active-tab indicator bar; the DEMO tag behind the wordmark; text selection. Ink on mango measures 7.29:1.
- **Añil (Ultramarine)** ({colors.anil}): a frame paint; the focus ring on every focusable element; text links (6.83:1 on paper); the shelter mark tile.
- **Turquesa** ({colors.turquesa}): a frame paint and the inner fillet of the añil frame. Ink on turquesa measures 7.02:1.

Each frame is a two-tone pair (outer band, then inner fillet around the photo, then band text). The four pairs are hoja/mango/white, mango/añil/ink, añil/turquesa/white and turquesa/hoja/ink. The direction contract also listed flamboyán orange, but the build never shipped it, and the set stays at four.

### Neutral
- **Sky** ({colors.sky}): the page ground, also used as `theme-color`. It sits behind the canvas and the answer pills.
- **Sky Tint** ({colors.sky-tint}): quiet note panels (the "keep in mind" box and the next-step rows), compact slot rows, and the outline-button hover.
- **Hill Far / Hill Near** ({colors.hill-far}, {colors.hill-near}): the two flat painted hills fixed to the bottom 34vh of the viewport. Hill Far also fills the radius disk.
- **Paper** ({colors.paper}): every control surface (buttons, chips, icon buttons, the tab bar, sheets, side panels, slot cards, the facts strip, the photo mat).
- **Ink** ({colors.ink}): all primary text (13.28:1 on sky), outlines, selected chip and segmented fills, toasts, badges, and the ink button. Its lifted hover is **Ink Lift** ({colors.ink-lift}).
- **Ink 2** ({colors.ink-2}): secondary text, captions, field labels, idle tab labels (6.59:1 on sky, 5.31:1 on hill near).
- **Rule / Rule Strong** ({colors.rule}, {colors.rule-strong}): hairline dividers; borders on idle chips, the radius chip and icon buttons; dashed empty slots.
- **Mango Tint** ({colors.mango-tint}): the "unsure" note and the "pensando" answer pill.
- **Disabled Fill** ({colors.disabled-fill}): the disabled primary button (ink 2 text at 5.35:1).
- **Toast Link** ({colors.toast-link}): the undo action inside the ink toast (10.79:1).

### Named Rules
**The One Pink Rule.** Hibiscus marks only things that act when pressed or dragged: the primary button, the save stamp on the draggable card, and the caret in a field. It never colors a heading, an illustration, a frame, a badge or a status. The color study found that the button-color effect comes from isolation, not hue (docs/color-study.md §1, "Red buttons convert better" is a Myth; the von Restorff effect is Strong). The pink works because it is the only one on screen.

**The Paint Belongs To The Dog Rule.** Each dog carries one frame paint pair (`data-frame`). That pair repeats wherever the dog appears: the canvas, the mini frame, its radar dot and its filled slot pip. A paint never becomes a UI state color.

**The Light Ground Rule.** Photos sit only on light grounds: the sky page, a white mat inside the frame, and mid-tone frame paints. Nothing near black ever goes behind a photo. This is cheap insurance for dark-coated dogs (docs/color-study.md, implication 3).

**The Never Color Alone Rule.** Skip and save are told apart by label, icon (clock or heart), position (left or right), fill (outline or hibiscus) and gesture direction. They are never told apart by red against green, and never by color alone (docs/color-study.md §4; WCAG 1.4.1).

## Typography

**Display Font:** Shrikhand (with Atkinson Hyperlegible Next, serif)
**Body Font:** Atkinson Hyperlegible Next Variable (with system-ui, sans-serif)

**Character:** Shrikhand is the hand-painted sign-writer's title: fat, upright and joyful. It is kept to names, titles and big numbers, so it reads as the painting's own lettering. Atkinson Hyperlegible Next carries every word you have to read or act on, built for legibility in bright daylight on a phone.

### Hierarchy
- **Display** (Shrikhand 400, clamp(2rem, 9vw, 2.75rem), 1, -0.01em): the dog's name painted on the canvas band. It drops to 1.8rem on short phones (under 640px tall).
- **Headline** (Shrikhand 400, clamp(2.2rem, 8vw, 3rem), 1.05): page titles (Mi lista, Cuenta). The empty-deck title uses 2rem.
- **Title** (Shrikhand 400, 1.4–1.6rem, 1.1–1.15): sheet titles, profile section titles, slot dog names, the shelter CTA title, and the radius value.
- **Title Small** (Shrikhand 400, 1.3rem, 1.15): sub-panel titles (filters, the multi-adoption block) and the drag stamps.
- **Numeral** (Shrikhand 400, 2.6rem, 1): the rolling dog count under the radar. Each digit column is as wide as the digit it shows (Shrikhand's own advances) and clips only vertically, so the slanted glyphs never lose their right edge and "11" doesn't read as "1 1".
- **Body** (Atkinson 400, 1rem, 1.5): default UI text.
- **Body Long** (Atkinson 400, 1.1rem, 1.65, max 62ch, `text-wrap: pretty`): the dog's story on the profile and the list lede (52ch).
- **UI Strong** (Atkinson 800, 1rem, 1.1): button labels. Chips and the radius chip use 700 at 0.95rem; reflection questions use 700 at 1.05rem.
- **Label** (Atkinson 800, 0.68–0.75rem, 0.09em, uppercase): field labels only. These are the `dt` captions of the facts strip and the chip-group legends.
- **Caption** (Atkinson 400–600, 0.82–0.9rem, 1.4): sample-data notes, dates, the deck position line.

### Named Rules
**The Painted Title Rule.** Shrikhand is always set at weight 400 and only at title sizes (1.3rem and up). It never sets body copy, button labels or field labels.

**The Counted Figures Rule.** Every number a person compares (km, counts, ages, slot tallies, ring labels) uses `font-variant-numeric: tabular-nums`.

## Layout

The layout is mobile-first and built from a three-row grid: top bar, view, tab bar. The deck route locks to `100dvh` so the canvas, the thumb row and the tab bar all fit in one viewport with no scrolling. The deck column is capped at 480px with 20px side gutters, and the canvas takes the flexible row (about 68% of the height). The thumb row is a 1fr / auto / 1fr grid: "Ahora no", "Ver perfil", "Guardar". List and account views are capped at 720px with 20px gutters and an 18px gap between blocks. The profile body is capped at 720px with 28px section gaps. A fixed paper action bar sits at the bottom of the profile, and the tab bar hides there. Landscape windows up to 620px tall and 1099px wide (phones on their side, small tablets) slim both bars to 48px and move the species switch, the three actions and the position line into a 190–250px column beside the card; there the switch shows icons and counts only, with the words kept for screen readers.

- **420px and up:** the radius chip shows its place name ("Gazcue · 25 km").
- **720px and up:** sheets become centered dialogs, min(560px, 100% − 32px) wide. From 720px up the card narrows to keep the photo portrait. The profile's status lists pair into two columns. The deck gutters grow to 28px.
- **1100px and up:** the app becomes three columns: a 360px filters panel, the canvas column (500px max), and a 340px Mi lista panel, both panels as paper cards with 28px outer gutters. The tab bar is replaced by pill navigation in the top bar. The deck position line moves above the canvas. The profile splits into a sticky canvas on the left and the story on the right, within a 1180px max.
- **Short phones (under 640px tall):** the name, band padding, deck gap and button height all tighten.

Safe-area insets pad the top bar, the tab bar, sheet footers and the profile bar. All touch targets are at least 42–44px; primary buttons are 52px.

## Elevation & Depth

Depth comes from soft, cool, ink-tinted shadows with negative spread, which reads as objects resting just off a painted wall. There are no hard offset shadows and no glass or blur. The canvas uses a two-layer `drop-shadow` filter, so the shadow follows the frame's hand-cut edge rather than a rectangle. The cards behind it in the stack fan out with small rotations (−2.6deg, 2.8deg) and lighter shadows. Paper surfaces (side panels, slot cards, the floating back button, the active top-nav pill, the drag stamps) share one soft shadow. Flat painted fields (sky, hills, leaves, frame paints) carry no shadow at all.

### Shadow Vocabulary
- **Canvas lean** (`filter: drop-shadow(0 18px 18px rgba(29,35,64,.28)) drop-shadow(0 3px 4px rgba(29,35,64,.22))`): the top canvas on the deck and on the profile.
- **Canvas** (`box-shadow: 0 26px 40px -26px rgba(29,35,64,.6), 0 4px 10px -6px rgba(29,35,64,.3)`): the empty-deck frame.
- **Soft** (`box-shadow: 0 10px 24px -18px rgba(29,35,64,.45)`): paper cards, side panels, stamps, the floating icon button, the active top-nav pill.
- **Sheet rise** (`box-shadow: 0 -20px 40px -20px rgba(29,35,64,.4)`) over an ink scrim at 50%: the bottom sheet or dialog.
- **Toast** (`box-shadow: 0 16px 30px -18px rgba(29,35,64,.8)`): the ink toast.

### Named Rules
**The Flat Paint Rule.** Painted fields (sky, street, houses, shutters, frame bands) are flat single fills. They take no gradients, no shading, and no shadows of their own. Only objects (the canvas and paper surfaces) cast shadows.

## Shapes

There are two shape families. The **painted** family is the canvas frame: a near-rectangle whose hand-cut, slightly wobbly edge comes from an SVG mask (`frame-edge.svg`), overlaid with faint white brush strokes (`frame-strokes.svg`). Inside it, the photo is mounted with a 3px corner and a 4px inner fillet in the frame's second paint, then comes the band, then the 4px-cornered facts strip. The frame's hand-cut edge mask and stroke overlay sit on a ::before layer under the content. The needs-list bullet is a 12px leaf (`border-radius: 0 80% 0 80%`) in hoja. Slot pips are tiny 2px-cornered frames, dashed when empty and filled with the dog's paint when saved.

The **control** family is soft and round. Buttons, chips, the radius chip, badges and answer pills are full pills (999px). Icon buttons are circles. Segmented options use 12px corners, note panels 14px, cards and side panels 16px, and the mobile sheet 18px on its top corners (16px all round as a dialog). Borders are 1.5px `rule-strong` on idle controls and 2px ink on the outline button. Empty slots use a 2px dashed `rule-strong` border.

## Components

### Buttons
Tactile, rounded and plainly worded. Each one presses down slightly under the thumb.
- **Shape:** full pill (999px), 52px tall (46px on short phones), 22px side padding, Atkinson 800 at 1rem, with a lucide icon at 18–20px.
- **Primary:** hibiscus fill with white text. Hover and press go to hibiscus press. Disabled uses disabled fill with ink-2 text and a not-allowed cursor; the save in the reflection stays disabled until every question is answered.
- **Outline:** paper fill, 2px ink border, ink text; hover fills with sky tint. Used for "Ahora no", sign-in options and secondary choices.
- **Ghost:** transparent, ink text with a 2px underline at 0.25em offset; on hover the underline turns mango. Used for "Ver perfil", "Cancelar" and "Liberar".
- **Ink:** ink fill with white text, lifting to ink lift on hover. Used for outbound mailto CTAs (multi-adoption, shelter contact).
- **Small:** 40px tall, 14px padding, 0.9rem. Used for in-row slot actions.
- **Text button:** añil, 700, underlined. Used for inline utilities ("Usar mi ubicación", "Limpiar").
- **States:** `:active` scales to 0.97 over 180ms on the ease-out-expo curve. Focus is the global 3px añil outline at 3px offset.

### Chips
- **Style:** a paper pill 42px tall with a 1.5px rule-strong border, 700 at 0.95rem. On hover the border turns ink; on press it scales to 0.96.
- **State:** a selected (`aria-pressed`) chip fills with ink, turns its text white and shows a leading check icon. The selected state is never conveyed by color alone.
- **Radius chip:** the top-bar pill (44px), showing a map pin, the place name (420px and up) and the km in tabular figures. It opens the radius sheet.

### Cards / Containers
- **Slot card:** a paper card with a 16px corner, 16px padding and the soft shadow. It holds a mini frame, the dog's name in Shrikhand, a date, answer pills and small actions. An empty slot is transparent with a 2px dashed border. The compact variant (side panel and sheets) uses a sky-tint fill, a 14px corner and no shadow.
- **Side panel (desktop):** paper, 16px corner, 22px padding, soft shadow, scrolling internally.
- **Profile body:** the same paper panel behind all the profile text (story, needs, convivencia, health, lister), so the street never runs through it; the lister card inside it turns sky-tint instead of raised.
- **Notes:** sky tint ("keep in mind", next step) or mango tint ("unsure"), with 12–14px corners. The multi-adoption block uses sky with a 16px corner.
- **Shelter card:** paper, 16px corner, soft shadow, with a 46px añil mark tile (12px corner) holding a house icon. The account variant fills with the frame paint instead.

### Inputs / Fields
- **Slider:** 44px hit area, a 10px pill track at ink 14% with a hoja fill drawn as a hard stop, and a 30px paper thumb with a 3px ink ring and a small shadow. Focus adds the añil outline at 4px offset.
- **Segmented answers:** a two-column grid of 48px options with a 1.5px rule-strong border and a 12px corner, 700 weight. Hover turns the border ink. Checked fills with ink and turns the text white. Focus shows the añil outline on the visible option.
- **Focus (global):** 3px solid añil outline, 3px offset, 6px corner.

### Navigation
- **Mobile tab bar:** a sticky paper bar 64px tall with a top hairline. It has three tabs (Explorar, Mi lista, Cuenta), each with an icon and a 0.8rem label in ink-2 at 600. The active tab switches to ink at 800 and gets a 32×4px mango bar hanging from the top edge. Mi lista shows three slot pips with an "n/3" count in place of an icon.
- **Desktop top nav (1100px and up):** pill links (10px 14px) in ink-2 at 700. Hover gives a 60% white wash. The active link is paper with the soft shadow.
- **Wordmark:** "Patiamor" in Shrikhand, at clamp(1.55rem, 6.4vw, 1.85rem), with a small uppercase DEMO tag on mango marking sample data.

### Portrait (signature)
The pet card. Its frame and photo are arched on top (an exact semicircle, radius = half the photo width, computed with container units), so only the photo's top corners are trimmed. The name, distance and lister sit on a sticker in the frame's second paint (text color per pairing, all AA): a 3px white die-cut edge, 10px corners, rotated -1.2°, overhanging the frame slightly, with the bottom-right corner lifting to show its paper back. Three convivencia badges (child, dog, cat: 36px paper circles ringed in the second paint) sit across the photo's bottom-right edge, each with a status seal: a check on hoja (yes), a cross on ink (no), or a question mark on paper (unknown), never color alone. On a cat's card the labels read Perros / Otros gatos. On phones the card uses the full width, letting the photo go as wide as about 1.25:1 on short screens (the original proportions). From 720px up it narrows to keep the photo portrait (about 1:1.2) so animals aren't cropped wide. The facts stay on one row; only cards under about 200px inside stack them 2×2. When the deck area is landscape and at most 512px tall (landscape phones, 1024×600 tablets, 720p/768p laptops, 1080p screens at 125% scaling) the card turns side-by-side. The painted frame wraps only the arched portrait (same arch, badges still on its corner), and the sticker and the facts break out of its right edge onto the street, overlapping the frame by about 18px: the sticker tilted -3°, the facts on their own paper card ringed in the second paint and tilted +1.5°, 2×2, the pair centred vertically. It has a painted frame band with the hand-cut mask and the stroke overlay, 12px internal padding, and a photo mat of white plus a 4px inner fillet in the second paint. The photo uses `object-fit: cover` with a per-dog focal point. Below it, the band carries the Shrikhand name and the "a N km · sector" line with a map pin, in the frame's ink. A four-cell facts strip follows (Edad, Tamaño, Energía, Sexo), with uppercase labels over 700 tabular values divided by hairlines. Two flat leaves tuck behind the frame (just their tips inside the phone gutter; whole leaves at 720px and up). On the deck the canvas has drag physics: tilt is 0.05deg per pixel, and the commit threshold is 96px. Dragging left fades in a paper stamp "Ahora no" with a clock in ink; dragging right fades in "Guardar" with a heart in hibiscus, and the card lifts 8px into "considering" while the reflection sheet opens. Skip exits with an ease-in over 320ms, and an aborted drag springs back over 420ms. The keyboard and the visible buttons do everything the gesture does.

### Radius Radar (signature)
A concentric dashed ring map (5/15/30/60/120 km labels, in ink at 16% with a 2 4 dash). The selected radius is a hill-far disk with a 2.5px hoja stroke, scaling over 460ms. Each privately listed pet is a dot at its real bearing and distance (several in one neighbourhood share a bubble), and each shelter is one little house (all its animals are at the shelter) with an ink count badge on its roof corner: paper at 60% opacity when outside the radius, filled with its frame paint and an ink stroke when inside, and 14% opacity when filtered out. Markers that would overlap nudge apart up to 9px; anything still overlapping merges into an ink bubble with the matching count (999+ past 999), so the map stays a readable set of counts at any density. Nothing sits closer than 22px to the person's dot. Markers are buttons: a house filters to that shelter, a neighbourhood bubble of private pets filters to them, a single dot opens its pet, and a mixed bubble zooms in until it splits. The chosen marker wears a 3px hibiscus ring and an ink chip ("Solo …" with ✕) appears under the map; choosing a shelter beyond the radius widens it to include it. Zoom (1–8×) comes from a slim + / − pill in the square's bottom-right corner (outside the disk), Ctrl/⌘ + wheel or a trackpad pinch, and a two-finger pinch on touch; a plain wheel or one-finger swipe still scrolls the panel until the map is zoomed, when a drag pans it and the map turns into a 16px-cornered window. The person's own position is an ink dot with a halo. Under it, the Shrikhand count rolls digit by digit over 560ms, centred against its label; the label balances across two lines when the panel is narrow.

### Tu casa (Mi lista)
One painted facade above the slots: a white cornice, a pale turquoise wall, three windows and an arched añil door. A saved pet shows its photo with open shutters in its frame paints; an empty slot is a closed window. The empty deck state is an empty arched frame, breathing gently while pets load. List and sheet thumbnails are arched too.

### Species Switch
Perros | Ambos | Gatos, at the top of the deck in every state (loading, empty, browsing). It's a radio group shaped like a toggle: a paper pill track (1.5px rule border) with an ink thumb that slides under the chosen option (translate, 340ms ease-out). The selected label turns white over the thumb. "Ambos" sits in the middle as the neutral position, so choosing both reads as naturally as choosing one. Each option carries a small tabular count of animals within the radius, in a sky-tinted pill. Selection uses ink like chips do, never hibiscus, because hibiscus is reserved for actions. Below 480px the Dog/PawPrint/Cat icons drop so the words never truncate.

### Sheet
A native `<dialog>`. On phones it is a bottom sheet (top corners 18px, 92dvh max, a 44×5px grabber). At 720px and up it becomes a centered 560px dialog with a 16px corner. It has a Shrikhand title, a close icon button, a scrolling body with contained overscroll, and a footer over a hairline where the primary button takes the remaining width. The scrim is ink at 50%.

### Toast
An ink pill-rectangle (14px corner) above the tab bar, with the undo action in toast link, underlined. It enters with a 12px rise over 360ms.

## Do's and Don'ts

### Do:
- **Do** keep hibiscus ({colors.hibiscus}) for the single primary action in a view. Pair it with an outline or ghost alternative, so it stays the only pink on screen.
- **Do** give every new dog surface the dog's own frame pair via `data-frame` (hoja, mango, anil or turquesa), and repeat that paint in its pip, mini frame and radar dot.
- **Do** put dog photos on sky, paper or a frame paint, with a white mat and an inner fillet.
- **Do** set dog names, page titles and big counts in Shrikhand 400. Set everything else in Atkinson Hyperlegible Next, with tabular figures for numbers.
- **Do** keep a visible, labeled button with an icon for every swipe gesture, with skip on the left and save on the right.
- **Do** use the ease-out-expo curve (cubic-bezier(0.16, 1, 0.3, 1)) for state changes at 140–260ms and for larger moves at 420–560ms, and drop every duration to 0ms under reduced motion.
- **Do** show selection with an ink fill plus a check or label change, never with a color shift alone.
- **Do** mark sample data visibly (the DEMO tag and sample notes in caption style).

### Don't:
- **Don't** use a red X or green heart, a red/green pair, or any color-only distinction between skip and save.
- **Don't** put hibiscus on headings, frames, illustrations, badges, statuses or decoration.
- **Don't** place a photo on near-black or dark ink grounds.
- **Don't** use smooth gradients, glass, backdrop blur or shading on painted fields; fills are flat (the slider's fill is a hard stop, not a blend).
- **Don't** use hard offset shadows; shadows are soft, ink-tinted and negative-spread.
- **Don't** add frame paints beyond the four in the set, or use a frame paint as a UI state color.
- **Don't** set Shrikhand below 1.3rem or above weight 400, or use it for buttons, labels or body copy.
- **Don't** shrink touch targets below 42px or primary buttons below 46px.
