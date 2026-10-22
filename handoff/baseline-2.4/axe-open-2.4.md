# axe-core in open interactive states: Checkpoint 2.4 (e69095e), pristine git archive

Measured 2026-10-17T01:43:26.808Z against http://127.0.0.1:3124. axe-core 4.14.0, Playwright 1.56.1, Chromium 141.0.7390.37, Node v24.22.0.
runOnly tags: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice. Context: viewport width x 900, reducedMotion 'reduce' (except 7b), bypassCSP. Member: lina@demo.checkpoint.local.

"Violations" counts axe rules that failed; the node count is in brackets. "Not in the closed page" compares with the same page, role and width with nothing open (rules added, rules with more nodes, rules that went away).

| State | Width | Role | Page | Status | Violations | Rule ids (impact, nodes) | Not in the closed page |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1-palette-empty | 1440 | guest | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 2-palette-souls-arrowdown | 1440 | guest | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 3-palette-no-match | 1440 | guest | / | measured | 3 (3 nodes) | aria-required-children (critical, 1 node); aria-valid-attr-value (critical, 1 node); label-content-name-mismatch (serious, 1 node) | aria-required-children; aria-valid-attr-value; label-content-name-mismatch |
| 1-palette-empty | 1440 | member | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 2-palette-souls-arrowdown | 1440 | member | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 3-palette-no-match | 1440 | member | / | measured | 3 (3 nodes) | aria-required-children (critical, 1 node); aria-valid-attr-value (critical, 1 node); label-content-name-mismatch (serious, 1 node) | aria-required-children; aria-valid-attr-value; label-content-name-mismatch |
| 4-account-menu | 1440 | member | / | measured | 0 (0 nodes) | none | none |
| 5-report-menu | 1440 | member | /games/elden-ring | measured | 0 (0 nodes) | none | none |
| 6-board-card-menu | 1440 | member | /library | measured | 0 (0 nodes) | none | none |
| 7-picker-landed | 1440 | member | / | measured | 0 (0 nodes) | none | none |
| 8-tabbar | 1440 | guest | / | not-applicable: tab bar hidden at 1440 px (display: none) | - | - | - |
| 8-tabbar | 1440 | member | / | not-applicable: tab bar hidden at 1440 px (display: none) | - | - | - |
| 7b-picker-spinning | 1440 | member | / | measured | 0 (0 nodes) | none | none |
| 1-palette-empty | 390 | guest | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 2-palette-souls-arrowdown | 390 | guest | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 3-palette-no-match | 390 | guest | / | measured | 3 (3 nodes) | aria-required-children (critical, 1 node); aria-valid-attr-value (critical, 1 node); label-content-name-mismatch (serious, 1 node) | aria-required-children; aria-valid-attr-value; label-content-name-mismatch |
| 1-palette-empty | 390 | member | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 2-palette-souls-arrowdown | 390 | member | / | measured | 1 (1 node) | label-content-name-mismatch (serious, 1 node) | label-content-name-mismatch |
| 3-palette-no-match | 390 | member | / | measured | 3 (3 nodes) | aria-required-children (critical, 1 node); aria-valid-attr-value (critical, 1 node); label-content-name-mismatch (serious, 1 node) | aria-required-children; aria-valid-attr-value; label-content-name-mismatch |
| 4-account-menu | 390 | member | / | measured | 0 (0 nodes) | none | none |
| 5-report-menu | 390 | member | /games/elden-ring | measured | 0 (0 nodes) | none | none |
| 6-board-card-menu | 390 | member | /library | measured | 0 (0 nodes) | none | none |
| 7-picker-landed | 390 | member | / | measured | 0 (0 nodes) | none | none |
| 8-tabbar | 390 | guest | / | measured | 0 (0 nodes) | none | n/a (scoped run) |
| 8-tabbar | 390 | member | / | measured | 0 (0 nodes) | none | n/a (scoped run) |
| 7b-picker-spinning | 390 | member | / | measured | 0 (0 nodes) | none | none |

## Closed controls (same pages, nothing opened)

| Page | Width | Role | Violations | Rule ids (impact, nodes) |
| --- | --- | --- | --- | --- |
| / | 1440 | guest | 0 | none |
| / | 1440 | member | 0 | none |
| /library | 1440 | member | 0 | none |
| /games/elden-ring | 1440 | member | 0 | none |
| / | 390 | guest | 0 | none |
| / | 390 | member | 0 | none |
| /library | 390 | member | 0 | none |
| /games/elden-ring | 390 | member | 0 | none |

## WCAG 2.1.4: the bare "/" shortcut

| Role | Page | Focus | Palette opened |
| --- | --- | --- | --- |
| guest | /games | nothing focused (body) | yes |
| guest | /games | a link in main ("All platforms") | yes |
| guest | /games | a text field in main | no (field value after: "/") |
| guest | / | nothing focused (body) | yes |
| guest | / | a link in main ("Create a free account") | yes |
| member | / | nothing focused (body) | yes |

Setting search (labels, legends, headings and paragraphs matching shortcut/keyboard on the member's settings pages): /account 0 match(es); /profile/edit 0 match(es).

Footer hint: "Press Ctrl K or / to search".

## Library page text about dragging

| Width | Touch emulation | Text | Visible |
| --- | --- | --- | --- |
| 1440 | no | Drag games between columns to update their status. The heart marks up to four profile favorites. | yes |
| 1440 | no | [icon: grip]Drag a card to another column, or use [icon: more] to move it. | yes |
| 390 | no | Drag games between columns to update their status. The heart marks up to four profile favorites. | yes |
| 390 | no | [icon: grip]Drag a card to another column, or use [icon: more] to move it. | no |
| 390 | yes | Drag games between columns to update their status. The heart marks up to four profile favorites. | yes |
| 390 | yes | [icon: grip]Drag a card to another column, or use [icon: more] to move it. | no |
## Notes (written by hand from the 2.4 source; everything above is generated by axe-open.js)

How it was run. A `git archive e69095e` copy in `scratchpad/v25/b24-web` (never the repository), `npm ci`, a fresh `seed-demo.js` database at `scratchpad/v25/tmp/b24-web.db`, `PORT=3124`, `NODE_ENV` unset. Three full runs against seeded data gave identical per-state rule ids and node counts (the first two were compared programmatically, with 0 differences; the third, saved here, ran on a re-seeded database and printed the same rule ids and node counts).

Which states exist in 2.4. All eight exist. Exceptions: the tab bar is `display: none` above 900 px (`public/css/layout.css:584`, shown in the `max-width: 900px` block at :842), so state 8 is measured at 390 px only. The picker exists on the dashboard, the library and For You. It was measured on the dashboard in two moments: 7 after the reel lands (reduced motion, as in the page-load audits) and 7b while the reel spins (normal motion; the run was checked to finish before the result appeared). The report menu was opened under Khalid's review on `/games/elden-ring`; the script found it by its "Report this review" text.

The violations, all inside the search palette (every failing node is inside `dialog[data-palette]`; none of them shows on the closed page):
- `label-content-name-mismatch` (serious, WCAG 2.5.3) in every palette state: the close button has `aria-label="Close search"` and the visible text `Esc` (`views/partials/footer.ejs:73`).
- `aria-required-children` (critical, WCAG 1.3.1) when nothing matches: the `role="listbox"` container (`footer.ejs:75`) then holds only `<p class="palette-empty">` (`public/js/main.js:294`) and no option.
- `aria-valid-attr-value` (critical, WCAG 4.1.2) when nothing matches: the input keeps `aria-activedescendant="palette-page-0"`, which points at an element that no longer exists. `setActive` returns early when the list is empty (`main.js:243`) and nothing in main.js removes the attribute after it is set (`main.js:250`).
- Per palette state: 1 rule (1 node) empty and after ArrowDown; 3 rules (3 nodes: 2 critical, 1 serious) with no match. The same at 1440 and 390 px and for guest and member.

axe "incomplete" (needs review) results are not violations and are not counted above. Every run has some `color-contrast` incomplete nodes (text over images and gradients); they are kept in full in the JSON.

WCAG 2.1.4. The bare `/` opens the palette whenever focus is not in an input, textarea, select or contenteditable (`main.js:340-349`). That includes nothing focused and a focused link, so the "active only on focus" exception does not apply. No setting turns it off or remaps it: the member's `/account` and `/profile/edit` pages have no shortcut or keyboard control. A source search finds "shortcut" only in the two hint labels (`views/partials/header.ejs:52`, `footer.ejs:42`) and the main.js handler. Ctrl/⌘+K uses a modifier, so 2.1.4 does not cover it.

Library text. `views/library.ejs:8` says "Drag games between columns to update their status." It is visible at every width, including 390 px with touch emulation. Cards only use HTML5 drag events (`main.js:601`, `:626`), which a touch screen does not fire. `library.ejs:32` ("Drag a card to another column, or use ⋯ to move it.") is hidden at 700 px and below (`public/css/pages.css:2923`). The empty-library text at `library.ejs:93` ("…you can drag them across the board from here.") was not shown, because Lina's library is not empty. It is quoted from the source.
