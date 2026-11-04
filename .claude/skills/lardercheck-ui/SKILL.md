---
name: lardercheck-ui
description: LarderCheck's design system and UI rules: a Mac desktop-app look with a translucent window, frosted sidebar, system type and gentle motion. Use whenever adding or changing anything in app/public/ (pages, components, styles, copy) so new work matches in light and dark mode and on phones. For a brand-new visual direction, use frontend-design instead and agree it with the team first.
---

# LarderCheck UI

The UI is plain HTML, CSS and JS in `app/public/`, with no framework or build step. `styles.css` is shared by `index.html` (the dashboard) and `inbox.html` (the fictional supplier inbox, laid out like a three-pane mail app). Shared helpers live in `common.js`: `esc()`, `gbp()`, `qty()`, `shortDate()`, `longDate()`, `api()`, `colourFor()`, `storageColour()`, `reduceMotion`, and the `BroadcastChannel` that keeps the tabs in sync.

## The look
- **Desktop app, not a website.** Each page is a `.window` with a `.titlebar` (decorative window dots, centred title with an `.app-icon`, toolbar on the right) floating on a soft gradient wallpaper. The window is translucent with `backdrop-filter`.
- **Frosted `.sidebar`** on the left for navigation and filters, with `.side-item` rows, `.count` badges and coloured dots. On phones it becomes a horizontal strip.
- **System font and sentence case.** No all-caps labels, no monospace, no tracking-heavy eyebrows.
- **Finder-style lists.** `.list` holds a table with zebra rows. Grouped content goes in `.group` with `.rows`.
- **Plain, friendly wording.** Say "Likely to go to waste", "Use a day", "Gone off", "On its way", not "Projected waste", "dailyUse", "Expired", "In transit". The top of the dashboard gives the state in one plain sentence (`#lede`).

## Tokens: never hard-code colours
Use the variables on `:root`; each one is redefined for dark mode.
- Surfaces: `--window`, `--sidebar`, `--pane`, `--raised`, `--fill`, `--fill-2`, `--zebra`, `--sep`
- Text: `--text`, `--muted`, `--faint`
- Interactive colour: `--accent`, `--accent-soft`, `--on-accent` (system blue)
- Status: `--good` / `--good-bg` / `--good-fill`, and the same three for `--warn`, `--bad` and `--info`
- Motion: `--ease`, `--spring`
- Storage colours come from `storageColour(name)`: dairy blue, meat red, fish teal, produce green, freezer indigo, dry store brown.

## Status meanings (keep consistent)
| Meaning | Style |
|---|---|
| Matches email / in stock / ≥90% used in time | `good` |
| Needs checking / 60–89% used | `warn` |
| No email found / gone off / <60% used / waste £ | `bad` |
| On its way / informational | `info` |

Pills (`.pill good|warn|bad|info`) always carry text, so colour is never the only signal.

## Motion
Motion is part of the identity, but every piece is either a single page-load moment or a direct response to something the user did:
- **On load:** the window opens (`window-open`), the tile numbers count up (`countTo()`), and the usage bars grow with a slight stagger.
- **On change:** bars animate from their previous width (`shownPct`). New receipt cards spring in (`.enter`) and removed ones shrink out (`.leave`). Results appear as toasts (`toast()`). The drop zone springs on drag-over and bobs while Claude is reading. Inbox rows flash when their match status changes, and the reading pane fades in.
- **Rules:** don't add looping or decorative animation. The `prefers-reduced-motion` block switches everything off; keep it working, and check `reduceMotion` in JS before starting any animation.

## Rules
- **Escape all data.** Everything Claude extracts and every email field is untrusted: pass it through `esc()` before putting it in `innerHTML`.
- **Phone width.** Check at 375px. The page must never scroll sideways; only `.table-wrap`, `.segmented` and the phone sidebar strip may.
- **Desktop width.** Check at 1440px that the stock table fits without scrolling.
- **Accessibility.** Inputs without visible labels get `aria-label`. Use real `<button>`s and keep the focus ring. The inbox supports the arrow keys.
- **Honest AI labelling.** Anything AI-derived says so ("Read by Claude (model)" or "Sample: pre-read result"), and estimates say "est.".

## Checking your change
Run `cd app && npm start`, then look at both pages in light and dark mode, at 1440px and at 375px. For headless screenshots:

```bash
/Applications/Chromium.app/Contents/MacOS/Chromium --headless=new --force-prefers-reduced-motion \
  --window-size=1440,2000 --virtual-time-budget=4000 --screenshot=out.png http://localhost:3000/
```

- Add `--force-prefers-reduced-motion`, or the screenshot catches animations halfway through.
- Add `--blink-settings=preferredColorScheme=0` to see dark mode.
- To check 375px, load the page in a 375px `<iframe>`; Chromium's minimum window is wider than a phone.
