# MARGIN OS: 35-second promo reel (production package)

**Status:** this is a production-ready package for Canva or CapCut. **No MP4 has been created.** No video-generation tool was available.

## Specification

- **Format:** 1920×1080 (16:9). A 1080×1920 vertical cut is optional (see the editing notes).
- **Length:** 35 s at 30 fps.
- **Tone:** cinematic, warm kitchen light, then clean product UI.
- **Music:** a low pulse building to a lift at the dashboard reveal (0:12). Use royalty-free tracks from the CapCut or Canva library only.
- **Captions:** burned in, matching `margin_os_promo.srt`.
- **Brand colours (from the UI direction):**

| Colour | Hex |
|---|---|
| Navy | `#0F1B2D` |
| Charcoal | `#1E2430` |
| Warm off-white | `#F7F4EE` |
| Emerald | `#10B981` |
| Lime | `#C6F432` |

## Real screenshots to capture

Capture these with the backend running (`/api/...` live) once Codex has finished tasks C1–C3. Use a 1440 px wide browser window at 100% zoom.

| # | Screen | State | Used in scene |
|---|---|---|---|
| S1 | Dashboard | Default period (last 4 weeks) | 3 |
| S2 | Dashboard, price-change list | Date range **10 Aug – 1 Nov 2026**, showing cod +21.9% and lamb +23.7% | 2, 4 |
| S3 | Menu profitability table | Sorted by rank; Cod & Chips at 33.15% "watch" | 4 |
| S4 | Alerts panel | Cod purchasing-variance alert and cheaper-supplier alert | 4 |
| S5 | Advisor | Question "Why is my profit falling?", answer and the **"Demo advisor: not live AI" label visible** | 5 |
| S6 | Advisor | "What if I raise fish and chips to £17.50?" → +£244/week | 6 |
| S7 | Invoice review | Draft with the flagged cod line (+6.35%) | optional |

If live Claude is configured on the day, S5 may show the "Live Claude API" label instead. **Never show a live label on a demo answer.**

## Storyboard, scene prompts and voiceover

| # | Time | Visual (scene prompt for stock footage or AI image tools) | On-screen text | Voiceover |
|---|---|---|---|---|
| 1 | 0:00–0:06 | *Close-up of a restaurant owner's hands sorting a stack of crumpled supplier invoices on a stainless steel pass, warm tungsten light, a busy kitchen out of focus behind, shallow depth of field, cinematic.* | — | "Every week, the invoices pile up." |
| 2 | 0:06–0:12 | *Macro shot of a printed invoice; price figures animate upward. Cut to a red line chart sloping down.* Overlay crop of **S2**. | Cod **+22%** · Lamb **+24%** | "Cod up twenty-two percent. Lamb up twenty-four. And no one tells you what it costs." |
| 3 | 0:12–0:18 | Dark navy screen; the MARGIN OS logo resolves in lime. Then a slow push-in on **S1** (real screenshot) with KPI cards animating in. | MARGIN OS | "MARGIN OS turns your invoices, recipes and sales into one clear picture." |
| 4 | 0:18–0:25 | Split screen: **S4** alerts slide in from the right, **S3** menu table on the left, highlight on Cod & Chips at 33%. | "£18k a year leaking" *(fictional demo data)* | "It flags every price rise, shows which dishes it hits, and what each plate really earns." |
| 5 | 0:25–0:31 | **S5** advisor answer typing out; the demo label stays visible. | "Ask in plain English" | "Ask why profit is falling, and get a straight answer and a plan." |
| 6 | 0:31–0:35 | *Owner, now calm, chalks a new price (£17.50) on a specials board and picks up the phone to a supplier; morning light.* Inset **S6** (+£244/week). End card: logo, tagline. | **Know your costs. Protect your margins.** | "Know your costs. Protect your margins. MARGIN OS." |

**Mandatory small print** (bottom-left, from 0:18 to the end): "Fictional demo restaurant and data. Advisor shown in demo mode."

## Full voiceover script (about 75 words, 35 s at a calm pace)

> Every week, the invoices pile up. Cod up twenty-two percent. Lamb up twenty-four. And no one tells you what it costs. MARGIN OS turns your invoices, recipes and sales into one clear picture. It flags every price rise, shows which dishes it hits, and what each plate really earns. Ask why profit is falling, and get a straight answer and a plan. Know your costs. Protect your margins. MARGIN OS.

**Voice:** warm, North East English accent preferred. Record it yourself, or use a text-to-speech voice you are licensed to use.

## Editing instructions (CapCut or Canva)

1. Create a 16:9, 30 fps project. Import the music, the VO WAV, screenshots S1–S7, the stock clips for scenes 1, 2 and 6, and the logo.
2. Lay the VO on track 1 and cut the scenes to the VO timings in the table above.
3. **Screenshots:**
   - Apply a 105%→112% slow zoom (Ken Burns) over each shot.
   - Use a 6 px rounded-corner mask and a soft shadow, on a `#0F1B2D` background.
   - For highlight boxes, use a 2 px `#C6F432` stroke with a quick fade-in.
4. **Transitions:**
   - 6-frame cross-dissolves between live-action shots.
   - A hard cut on the beat at 0:12 (the reveal).
   - Slide-left for the split screen at 0:18.
5. **Typography:** Inter or Plus Jakarta Sans, bold. White on dark, navy on light. Keep captions in the lower third, never covering the UI figures.
6. **Colour grade:**
   - Scenes 1–2: cool and desaturated.
   - From scene 3: warmer, with brand greens.
   - Scene 6: warm morning light.
7. Import `margin_os_promo.srt` as captions and check the timing against the VO.
8. **Export:** MP4 H.264, 1080p, 30 fps, about 12 Mbps, AAC 320 kbps. File name `margin_os_promo_35s.mp4`.
9. **Vertical cut (optional):** reframe to 9:16, stack the split screen vertically, and enlarge the captions by 20%.
10. **Before publishing:** confirm the small print is visible and every figure matches the live app.
