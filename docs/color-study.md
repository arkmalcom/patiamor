# Color study: does color drive engagement?

*For Patiamor (working name), a dog-adoption app for the Dominican Republic. Compiled 2026-10-12.*

**Short answer:** Mostly yes, but what drives engagement is **contrast, salience and photo quality**. Claims that a specific hue lifts engagement are **weak, depend on context, or are myths**. No study looks at color in pet-adoption interfaces directly, so the design advice below is inferred from neighboring research.

Evidence labels: **Strong** = replicated, large sample or meta-analytic. **Moderate** = one or a few peer-reviewed studies. **Weak** = single or small studies, or mixed results. **Myth** = popular claim the evidence doesn't support.

## 1. UI color and engagement or conversion

| Finding | Source | Strength |
|---|---|---|
| "Red buttons convert better" (+21%) was one test of about 2k visits. Red was the only red element on a mostly-green page, so it won by isolation, not by hue. Never replicated. | HubSpot/Performable 2011; commentary: https://www.poper.ai/blog/cta-button-color-conversion/ | **Myth** as a rule about hue |
| Isolation (von Restorff) effect and visual pop-out: an element that differs from its surroundings gets noticed and remembered. | Classic memory and visual-search research | **Strong** |
| At Bing, small changes to blue, green and black text colors paid off and replicated at large scale. The gain was specific to that product. | Kohavi & Thomke 2017, *HBR* 95(5). https://exp-platform.com/hbr-the-surprising-power-of-online-experiments/ (32M users and $10M come from secondary summaries) | **Moderate** that tuning helps; no general hue effect |
| Hue, saturation and lightness shift perceived brand personality and purchase intent. Results are best when the color fits the personality the brand wants. | Labrecque & Milne 2012, *J. Academy of Marketing Science* 40(5), DOI 10.1007/s11747-010-0245-y | **Moderate**, about brand perception, not clicks |
| How appealing users find a site's colors predicts trust and satisfaction, and the effect differs by culture. | Cyr, Head & Larios 2010, *IJHCS* 68(1–2), https://doi.org/10.1016/j.ijhcs.2009.08.005 | **Moderate** |
| Color effects depend on context. Many "red effect" findings shrank when retested; a meta-analysis found small effects with signs of bias. | Elliot & Maier 2014, *Annu. Rev. Psychol.* 65; Lehmann, Elliot & Calin-Jageman 2018, *Evol. Psychol.*, https://journals.sagepub.com/doi/10.1177/1474704918802412 | Hue changing behavior: **Weak** |

## 2. Pet adoption and visual factors

- **Black dog syndrome: Weak, mostly not supported for dogs.**
  - Brown, Davidson & Zuefle 2013 (*JAAWS* 16(1)): coat color had no effect on length of stay; age and size did.
  - Svoboda & Hoffman 2015 (*Animal Welfare* 24(4), about 16.7k dogs): black dogs were adopted slightly faster, and age and breed group mattered more.
  - Lepper, Kass & Hart 2002 (*JAAWS* 5(1)): the negative effect of black was clearest in **cats**.
  - Woodward et al. 2012 (*Society & Animals* 20(3)): no bias against black dogs in photo ratings.
- **Photo quality drives adoption speed: Moderate.**
  - Lampe & Witte 2015 (*JAAWS* 18(4), DOI 10.1080/10888705.2014.982796): overall photo quality had the largest effect. Eye contact, a standing dog, a sharp image and an outdoor setting also helped. Bandanas and cage backgrounds had **no effect**.
  - Nakamura et al. 2020 (*Animals* 10(1):152, 8.3k Australian listings) found kennel photos adopted faster. Specific photo traits depend on the market; overall quality is the robust factor.
- **Appearance is the top reason people pick a dog:** 27% of dog adopters named it (Weiss et al. 2012, *Animals* 2(2), https://pmc.ncbi.nlm.nih.gov/articles/PMC4494324/). **Moderate.**
- **UI color around photos:** no direct evidence. A dark coat on a dark UI loses figure-ground separation, but that is an inference from basic perception, not a measured effect.

## 3. Dominican Republic and Latin America

- No peer-reviewed study of color meaning or preference in the DR exists. "Latinos prefer warm, vivid palettes" is a **stereotype with no evidence behind it**.
- Color-emotion associations are largely universal (Jonauskaite et al. 2020, *Psych. Science* 31(10), 4.6k people in 30 nations, r = .88). **Strong.**
- Preferred colorfulness varies by country (Reinecke & Gajos 2014, CHI, 2.4M ratings). **Moderate.**
- The flag colors are an optional nod to identity, not an engagement lever.

## 4. Accessibility

- About 8% of men and 0.4–0.5% of women have red-green color-vision deficiency (Birch 2012, *JOSA A* 29(3)). **Strong.**
- WCAG 2.2:
  - 1.4.1: color must not be the only cue.
  - 1.4.3: text contrast of at least 4.5:1.
  - 1.4.11: icons and controls need at least 3:1.
- Skip and save must not rely on red vs green alone.

## Design implications for Patiamor

1. **Design for contrast and salience, not a "magic hue."** Use one accent for the primary action and keep it rare on screen. The hue itself is a brand decision.
2. **Photos matter more than palette.** Give shelters guidance in their upload flow: sharp, well lit, dog standing, eye contact.
3. **Put photos on light or mid-tone backgrounds,** and avoid near-black behind them. This is cheap insurance for dark-coated dogs.
4. **Don't market "black dog" features as evidence-based.** Age, size and breed matter more, and that suggests surfacing older and bigger dogs fairly.
5. **Skip and save use icon, label, position and gesture,** never color alone.
6. **A/B test hue yourself** once there is traffic. Treat any "color X converts better" claim as a hypothesis.

*Caveats: several primary papers were paywalled. These figures come from abstracts or secondary summaries: the Lepper dog result, Lampe & Witte's 14 vs 43 days, Bing's $10M, and the Madden and Reinecke country rankings.*
