# Fonts

Both faces are installed from npm and bundled by Vite. No font file is committed
to this repository, and nothing is fetched from a font CDN at runtime.

| Face     | Package                          | Version | Licence                  | Used for                         |
| -------- | -------------------------------- | ------- | ------------------------ | -------------------------------- |
| Fraunces | `@fontsource-variable/fraunces`  | 5.3.0   | SIL Open Font Licence 1.1 | Display, numerals, number tokens |
| Inter    | `@fontsource-variable/inter`     | 5.3.0   | SIL Open Font Licence 1.1 | Interface text                   |

The full licence text ships inside each package as `LICENSE`. Fraunces is by
Undercase Type (Phaedra Charles, Flavia Zimbardi); Inter is by Rasmus Andersson.

Number tokens and harbour signs are painted to canvas with Fraunces once the face
has loaded (`three/textures.ts`), so the board and the interface share one voice.
