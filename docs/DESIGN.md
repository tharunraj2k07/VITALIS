# VITALIS visual design plan

## Direction and review

The interface will feel like an observatory at twilight: composed editorial typography, deep indigo atmosphere, quiet surfaces, and restrained antique-gold detailing. The mission dashboard is an instrument, not a generic dark card grid. Its distinctive focal point is the readiness orbit: five score-scaled concentric rings around the overall score, each keyboard-selectable and labeled with both status icon and text.

Review against the brief: a first pass using dark panels, blue accents, and rounded metric cards would read as a generic dark dashboard. This plan rejects that default: the public story uses a spacious editorial layout and generated starfield; the mission overview gives the orbit the primary visual weight; secondary information uses thin gold rules, varied surface depths, and compact specification tables instead of repeated cards. Gold is reserved for framing and watch states, not used as a broad glow.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--night` | `#0B1433` | Page background |
| `--ultramarine` | `#1B2A6B` | Raised instrument surfaces |
| `--royal` | `#3B52D9` | Interactive focus and primary actions |
| `--gold` | `#C9A24B` | Hairlines, selected details, small accents |
| `--pearl` | `#EEF1F8` | Primary text |
| `--aurora` | `#35D0BA` | Healthy / stable status |
| `--watch` | `#F0B24B` | Amber attention state |
| `--escalate` | `#E5586B` | Red / escalate state |

Use Fraunces for display headings and headline figures; use Manrope for body copy, controls, and data labels. Both font families are self-hosted through package assets. Type scale: 12 / 14 / 16 / 20 / 28 / 40 / 56 px, with responsive display sizing and readable line-height. Keep prose measure below 80 characters.

Mission-phase atmosphere shifts subtly among preflight blue, adaptation violet, mid-mission indigo, and return dusk. Starfield art is a small generated canvas layer with a fixed particle cap, gentle pointer parallax, visibility pause, and a still frame for reduced motion.

## Layout sketches

Story, desktop:

```text
+------------------------------------------------------------------+
| VITALIS / OBSERVATORY                         Explore   Enter    |
|                                                                  |
| Far from Earth, crews monitor themselves.   [readiness orbit]    |
| Personal signals. Individual baselines.       5 nested rings    |
| [Explore the mission]                           score / status   |
+------------------------------------------------------------------+
| Communication delay      | no real-time ground doctor           |
|       pinned four-step sequence: baseline -> drift -> why ->     |
|                                      guided response             |
| Offline first / safety    | simulated data / draft protocols    |
|                           | [Enter mission control]              |
+------------------------------------------------------------------+
```

Story, mobile:

```text
+------------------------------+
| VITALIS                 Menu |
| Far from Earth,              |
| crews monitor themselves.    |
|       [orbit, 280px]          |
| [Enter mission control]       |
| 01 / Communication delay     |
| 02 / Personal baseline       |
| 03 / Drift and explanation   |
| 04 / Offline and safety      |
+------------------------------+
```

Mission, desktop:

```text
+------------------------------------------------------------------+
| VITALIS / crew and mission day         Ground link / queue / sync |
| Overview   Metrics   Alerts   Check-in   Timeline   Demo          |
|                                                                  |
| [readiness orbit and domain key] | [phase / day / attention]      |
|                                  | [quiet trend and latest flags] |
|                                                                  |
| Mission journey: launch --- adaptation --- mid-mission --- return|
+------------------------------------------------------------------+
```

Mission, mobile:

```text
+------------------------------+
| VITALIS      Link / queue    |
| Overview | Metrics | Alerts |
| Check-in | Timeline | Demo  |
|       [orbit]                |
|      Overall score           |
| Domain status list           |
| Mission journey (scroll)     |
+------------------------------+
```

## Motion rules

- Use Motion for route/tab continuity, orbit score transitions, alert-panel transitions, event toasts, and meaningful number changes. Keep page/route transitions below 400 ms.
- Use one skippable launch sequence per browser session, under three seconds. It resolves the starfield, draws the orbit, then settles the score; never block access to controls.
- Story scenes use a pinned sequence, not unrelated entrance fades. No hover animation on every card.
- A new alert gets one soft pulse and a priority toast. Scenario, action, check-in, link-loss, reconnection, and sync changes receive explicit text feedback.
- Centralize duration/easing tokens. Respect `prefers-reduced-motion` by removing nonessential transforms, parallax, counting, and looping; retain state changes and focus cues.
- The canvas is capped, uses requestAnimationFrame only while visible, and stops when the document is hidden. No external image/font requests or WebGL.
