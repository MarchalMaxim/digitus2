# Real phone photos

Eleven photographs of printed piano music, taken by the owner with a phone and sent as WhatsApp-compressed JPEGs (1200×1600, about 0.2 MB each): a realistic worst case for phone input.

**Licence: public domain**, per the owner. The music is public domain, and the photographs were taken for this project and given to it.

| File | Page | Condition |
| --- | --- | --- |
| `boellmann-op28-page1-hand-shadow.jpeg` | Boëllmann, Improvisations Op. 28, No. I, p. 1 | hand shadow at the lower left, slight perspective |
| `boellmann-op28-page2-shadow-cut-off.jpeg` | No. I, p. 2 | shadow, show-through, last system's lower staff cut off |
| `boellmann-op28-page2-flat.jpeg` | No. I, p. 2 | flat, evenly lit, burnt corner |
| `boellmann-op28-page3-upside-down.jpeg` | No. I, p. 3 | upside down, flat |
| `boellmann-op28-page3-perspective.jpeg` | No. I, p. 3 | keystone perspective, burnt corner |
| `boellmann-op28-page4-perspective-cut-off.jpeg` | No. II, p. 4 | strong perspective and curvature, last system cut off |
| `boellmann-op28-page4-upside-down.jpeg` | No. II, p. 4 | upside down, flat |
| `boellmann-op28-page5-shadow-torn.jpeg` | No. II, p. 5 | shadow, burnt and torn corner touching the last system |
| `boellmann-op28-page5-flat.jpeg` | No. II, p. 5 | flat, burnt corner |
| `continuation-page25-book-warm-light.jpeg` | unidentified piece in C, p. 25 of a bound book | warm light, curvature, ossia staves, footnote |
| `continuation-page25-book-dim.jpeg` | the same page | dim light, closer |

None of these pieces is in the library, so there is no MusicXML ground truth. `manifest.json` holds what was read off each page by eye (main bars, staves, key and time signature). The scanning gate (`research/omr/acceptance.mjs`, route `photos`) recognises every photo as taken, and the upside-down ones also turned upright as Rotate does, then checks those facts exactly against `photoFloors` in `../acceptance/floor.json`. The results are in `docs/research/omr.md`.
