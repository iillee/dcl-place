# dclplace 🎨

*Work in progress · grown from `gdd-template.md`*
*Doc: ▓▓▓▓▓▓▓▓▓▓ · all sections drafted · pending audit + `[agent-decided]` sign-off*

## 0. TL;DR

| | |
|---|---|
| **Player promise** | You are one painter in a shared canvas. You place one pixel per second toward what you or your tribe are building — nothing ever resets. |
| **Primary player** | Artists who already enjoy pixel art, r/place-style canvas events, or leaving persistent marks in shared spaces — arriving alone or via a friend's shared screenshot, looking for a place where their art lives permanently and gets seen. |
| **Current status** | Playable vertical slice in a World — shipped v1 live at [`dclplace.dcl.eth`](https://decentraland.org/play/?realm=dclplace.dcl.eth) and at Genesis Plaza South ([`-9,-91`](https://play.decentraland.org/?NETWORK=mainnet&position=-9,-91)) since Sep 2026 (Friendzone Mobile Buildathon). |
| **v1 measured (first 10 days after launch)** | **D7 retention 62.5%** (rolling avg; Aug 31 cohort 34.29% on small sample) · desktop 64.29%, mobile 50% · avg playtime 19.2 min · AFK 0.34 min · social interactions 74.29% weekly · **184 unique visits in 10 days**, peak 10 concurrent, driven by organic posts on Discord and Twitter (from the creator and from users — no paid marketing). **Both platforms clear the >20% program-level D7 target.** Source: `assets/images/analytics_01.jpg`. |
| **Requested round** | v2 — 4-week scope, building on shipped v1 |
| **Live at end of the round** | A player can toggle between the shared public canvas and their own private board, expand beyond the 8-colour palette, and export a one-tap PNG of their work to share on Discord or Twitter. |

---

| | |
|---|---|
| Public experience title | dclplace — IP & Content Policy self-check: **clear** (concept references Reddit r/place and Minecraft creative-mode / private-server culture as genre precedents, not owned IP; all code, assets, and palette are original) |
| Deployment target | Dual-realm: World `dclplace.dcl.eth` + **Genesis Plaza South** (base parcel `-9,-91`, 400 parcels, 20×20 estate that fits the canvas exactly) |
| Studio / team name | ile |
| Date | 2026-09-08 |
| Contact (Discord + email) | Discord: `ile9466` · email: `TBD:` |

---

## 1. Player Promise

> You are one painter in a shared canvas. You place one pixel per second toward what you or your tribe are building — nothing ever resets. [agent-decided · accepted]

**One familiar comparison.**

> It's like Reddit's r/place, but you walk through it in Decentraland, on your phone, and it never wipes. [agent-decided]

**Why this game.** `TBD: not discussed yet`

---

## 2. First Minutes & How to Play

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You spawn in the dead centre of a giant flat canvas. A splash overlay is still fading — behind it you can already see coloured pixels forming shapes. The 8-swatch palette at the bottom of the screen tells you the whole game in one glance. |
| **5–10 seconds** | The splash clears; you're in overhead spectator view with a short help panel. One tap dismisses it. You now see the whole canvas from above. |
| **10–60 seconds** | You drop to first-person, walk onto the canvas, and a coloured highlight cube pops up under your feet — the cell you're standing on. You tap a swatch, then the paint button. That cell turns your colour. The paint button starts refilling (1-second cooldown). |
| **1–3 minutes** | You paint five or ten pixels in a row. You notice pixels appearing next to yours that you didn't place — someone else is painting. You either respond (paint over, paint alongside) or move to a quieter area. |
| **3–10 minutes** | `[HYPOTHESIS]` You spot a shape someone started and either help it or start your own. First social decision. `TBD: measuring at the first playtest` |
| **Natural stopping point** | The canvas persists — anything you painted is still there when you return. Leaving is symmetrical to arriving. |

**Player-facing How to Play** *(exactly 3 bullets, max 8 words each)*

- Walk onto the canvas to aim [agent-decided]
- Tap a colour, then paint [agent-decided]
- Wait one second, paint again [agent-decided]

---

## 3. Core Loop

| # | Step (verb) | What the player does | Why do it again? |
|---|---|---|---|
| 1 | **Walk** | Position your avatar over a paint cell; a highlight cube shows the target under your feet | You want the *next* cell |
| 2 | **Pick** | Tap a swatch (mobile) or press E to cycle (desktop) — 8 colours + eraser | The colour depends on what you're building |
| 3 | **Paint** | Tap the paint button (mobile) or press F (desktop); the cell fills, cooldown starts | The action itself is the reward — a visible mark you made |
| 4 | **Wait** | 1s cooldown; paint button refills like a snowdrift fuel gauge | Enforced pacing — every input is deliberate |

| | |
|---|---|
| **One complete loop takes** | ~2 seconds (walk + paint + 1s cooldown). Marker of completion: the cell recolours; outcome: your paint count increments, leaderboard eventually updates. Earlier payoff: the cell visibly changes on the same frame the server acks. |
| **Decision, challenge, or expression** | Which cell, which colour, in response to whose earlier pixel. `[HYPOTHESIS]` Emergent tribe coordination is the real decision layer. |
| **Shortest satisfying visit / typical session** | 30 seconds / `TBD: measuring at the first playtest` |
| **Why repetition 10 differs from repetition 1** | Other painters have moved. The canvas around your target has changed. `[HYPOTHESIS]` — this is the whole return premise; needs a playtest to settle. |

**Pillars**

1. **Permanence.** Pixels persist forever; the canvas is state, not a round.
2. **Tap-to-place simplicity.** One gesture, no drag, no cursor, no precision required — works the same on touch and mouse. [agent-decided]
3. **A public square and a private studio.** Every artist gets their own persistent space *and* a shared canvas everyone paints on — practice, ambition, and audience in the same scene. [agent-decided · accepted]

---

## 4. Why Players Come Back

*v1 baseline (first 10 days after launch, dashboard-rolling): **D7 retention 62.5%** across platforms (desktop 64.29% / mobile 50%). Both clear the program's >20% target. Latest single-cohort D7 (Aug 31) 34.29% on a small sample — still above target. Sample is small and early; growth so far has been driven by organic posts on Discord and Twitter, from the creator and from users themselves — which is the same channel v2's image exporter is designed to amplify (see §5, H2-02). v2 is designed to lift the floor further via the private-board hook.*

### 4.1 The next-day (D1) sentence

> "A player who enjoyed their first session returns the next day because **their private board is still exactly as they left it, waiting to be finished** — and their painted territory on the public canvas may have been painted over." [agent-decided]

*The private board (v2 feature) is the active hook — an owned space that persists. The public-canvas territory adds passive tension. Both are `[HYPOTHESIS]` until measured.*

### 4.2 The progression chain

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | 20–100 pixels placed; name appears somewhere in the all-time top-100 if you painted enough | Return tomorrow and see whether your patch is still yours | Painted cells carry no attribution today; only the leaderboard rank is public |
| **End of first week** | A visible region shaped by you (or your tribe); top-50 rank plausible | Defend the region, extend it, or start another | Overhead spectator view; leaderboard name |
| **Week 3+** | `[HYPOTHESIS]` A recognizable tribe territory, a personal signature area, or a claimed corner | `TBD: measuring at the first playtest` | `TBD` |

**End-of-week scene (in-fiction):**

> You open the app on Sunday. Spectator view: the 320×320 canvas from above. Your logo in the northwest corner is mostly intact — but a purple stripe now cuts through the top of the ‘L’. You drop to ground, walk over, and start repairing it. You notice a friendly-looking green flag two cells away that wasn't there last week. [agent-decided]

*No currency, no tradable rewards — pixels are placed, not owned.*

### 4.3 Two return hooks

| Selected hook | Exact trigger or timing | What the player anticipates | Reminder channel + no-reminder fallback |
|---|---|---|---|
| **1. Private board (v2) — an owned space** | Anytime — the private board is exactly as the player left it | "My studio is waiting; I want to finish that piece." | Reminder: none. Fallback: the board itself is the memory — zero decay, no timer pressure. |
| **2. Async traces on the public canvas** | Anytime — the painted region may have been overwritten | "Is my mark still standing, or did someone paint over it?" | Reminder: none. Fallback: canvas visible immediately on next visit. |

*Both hooks are `[HYPOTHESIS]` — parked as H1-01 and H2-04 in the log. The leaderboard remains as a supporting mechanism, demoted from a primary hook.*

---

## 5. Social by Design

| | |
|---|---|
| **The repeatable social loop** | Two loops in v2: **(public)** `Player A paints a shape → Player B sees it and paints over, alongside, or extends → together or competitively they build/defend a region → the visible canvas state is the shared consequence.` **(private-to-social)** `Player A builds ambitious art on their private board → shares a view-only link → Player B loads the board, is inspired, screenshots it → posts to Discord/Twitter → external audience discovers the scene.` [agent-decided] |
| **The disappearance test** | If every other player vanished, the canvas keeps all their marks. Solo painting still works. What breaks: the tension between painters, tribe formation, defence. Honest answer — this is a solo game with strong social evidence around it. |
| **From strangers to a group** | `[HYPOTHESIS]` A newcomer sees a coherent shape, walks toward it, and either helps or attacks. No voice needed — the canvas is the shared language. |
| **Recognition & continuity** | Leaderboard shows names; painted regions serve as territory markers. `TBD: not discussed yet` — nickname/passport plumbing beyond leaderboard. |
| **Quiet hours & player counts** | Solo: paint your own patch. Social threshold: `[HYPOTHESIS] ~3 painters visible at once`. Ideal group: `TBD`. v1 tested max: `TBD`. |
| **Drop-in / drop-out** | Perfect — any pixel placed persists; no rounds, no timers, nothing to spoil. |
| **Visible play (bystander test)** | A watcher sees painters walking a grid and cells changing colour under them. The activity is legible in one glance. |
| **Shareable play (memorable moment)** | **Measured (v1):** 74.29% of weekly visitors chat or emote at least once (dashboard “Social Interactions”). **Playtest evidence:** users already screenshot the canvas and post to Discord and Twitter; those posts perform well. v2 promotes the half-built server-side image exporter into a user-facing feature (one-tap export of the full canvas or a private board) to multiply this behaviour. |
| **Bring-a-friend** | `[HYPOTHESIS]` A player wants a friend when they want to build something larger than one painter can defend or complete. |

---

## 6. Cross-Platform Input

*Playable on both desktop and mobile — same core loop on either. Desktop adds keyboard hotkeys and a top-bar; mobile uses the native on-screen buttons and the bottom color picker. The mobile path was proven at the Friendzone Mobile Buildathon.*

**Every core-loop verb on touch.**

| Core-loop verb | How it works with touch controls |
|---|---|
| Walk | Native mobile joystick |
| Pick | Tap a swatch in the bottom bar |
| Paint | Tap the wide paint button in the bottom bar (192×76 px on mobile) |
| Wait | Cooldown visualised as fuel-fill on the paint button itself |

**UI plan.** Single-row bottom bar with 8 swatches + inline paint button; native mobile action buttons re-skinned for spectator/mute/leaderboard/help via `TouchScreenControls`. Desktop is a superset that adds hotkeys and a top bar. [agent-decided]

**Performance.** 60fps desktop / 30fps mobile targets. Strict 300 addEntity/frame ceiling to protect mobile's entity allocator. **Measured v1 D7 by platform (first 10 days):** desktop 64.29%, mobile 50% — both above the >20% program target. Mobile visits are ~33% of unique traffic (61 of 184 unique in 10 days). `TBD: named mobile device + client for v1 tested max` — currently only informally validated on iOS Explorer.

**Desktop-only dependencies.** None — the whole scene runs on mobile as the primary target. Confirmed live at `dclplace.dcl.eth`.

---

## 7. World, Look & Story

**Story / world.** There is no story — the canvas *is* the world, and the players write it. [agent-decided]

**Visual direction.** One 320m × 320m flat floor; the only "art" is the pixels players place. Screenshot signature: the whole canvas from above, from the spectator camera. [agent-decided]

---

## 8. Audience & Comparables

**Primary player + arrival context.**

> "For artists who already enjoy pixel art, r/place-style canvas events, or leaving persistent marks in shared spaces — arriving alone or via a friend's shared screenshot, looking for a place where their art lives permanently and gets seen." [agent-decided]

**How the first group arrives.** Existing players screenshot their work and post to Discord and Twitter (playtest evidence: v1 posts have measurable pickup). v2's user-facing image exporter is designed to multiply this. Secondary channel: Genesis Plaza South foot-traffic — the estate is public and passers-by can walk in.

**Deliberately not for.** Speed-run, PvP, or competitive audiences — this is a low-pressure creative game. [agent-decided]

### Comparables

| | Comparable A — Reddit r/place | Comparable B — Minecraft public creative servers (2b2t, Hypixel Creative) |
|---|---|---|
| What we observed works | Simple universal grammar (pixel + cooldown); emergent tribes; screenshot-worthy final state | Persistent world; drop-in / drop-out; tribe formation over territory; strong screenshot / clip culture |
| What does not fit our audience or context | 2D-only; time-limited event; 100M concurrent painters is out of scope; no walkable 3D layer | 3D building has high friction on mobile and steep learning curve; grief-vulnerable without moderation; no shared cooldown pacing |
| What we do differently | Walkable, cross-platform, permanent, Decentraland-native | 2D canvas is one-tap accessible; 1-second cooldown removes grief speed; mobile-supported; private board addresses the ambition ceiling |

---

## 9. 4 Week Plan (v2 scope)

*Frame: v1 shipped at the Friendzone Mobile Buildathon (Sep 2026) and is live on `dclplace.dcl.eth` and Genesis Plaza South (`-9,-91`). This section is the v2 plan proposed to the Decentraland Foundation or Regenesis Labs.*

| Week | What is playable / done |
|---|---|
| 1 — Private boards | Storage-per-wallet private-board layer; toggle in UI to load private over public; 30s dirty-flush like the public canvas. Playtest: one artist, one full session on the private board. |
| 2 — Expanded color picker | Replace the 8-swatch bar with a picker that supports the full palette. Keep the 8 as quick-select for coordination. Playtest: mixed-palette tribe formation. |
| 3 — User-facing image exporter | Promote the server-side snapshot pipeline into an in-scene export button. Player taps → gets a PNG of the current view (public or private) — downloadable and share-ready. Include a small watermark or attribution line. |
| 4 — View-only board sharing + polish | Generate a shareable code / URL per private board; recipients can load the board read-only. Mobile playtest of the full v2 loop. |

**What keeps the experience changing after launch**

- Without building a new level, private boards **are** the level — every artist creates their own space; the content rotates as they do.
- If an update is skipped, the public canvas still evolves from returning painters.
- If a power gap emerges (a player with a huge portfolio of private boards), returning players can still contribute meaningfully on the public canvas or start their own private board — the two spaces are independent.
- One player behaviour that would change what we build next: if private boards get shared publicly at high rates, v3 collaborative-shared boards move up.

**Not building in v2**

1. **Collaborative private boards** — view-only in v2; write-access is v3 (needs permissions + moderation).
2. **Pixel attribution** ("placed by Alice, 3 days ago") — inflates CRDT payload; parked in `DESIGN.md` future work.
3. **Larger public canvas** — the Genesis 20×20 estate is a hard boundary; private boards address the space demand instead.

**Top risk + fallback.** `[HYPOTHESIS]` Private boards may **reduce** social contact rather than increase it — if artists retreat to private space, the public canvas thins out. **Concrete floor v2 must not fall below:** the measured v1 baseline of D7 62.5% (rolling) and 74.29% weekly social-interaction rate. **Fallback:** if v2 playtests show either metric dropping >20% from baseline, gate private-board access behind a threshold of public-canvas pixels placed ("earn your studio"), turning the public canvas into onboarding for the private space.

---

## Hypothesis Log

Full log at `design/hypothesis-log.md` (not yet generated). Parked from this harvest:

**v1 (from harvest):**
- **H1-01** ~~Return via territory persistence produces D1 > 10%.~~ **Validated by proxy** — D7 measured at 62.5% (rolling) / 34.29% (Aug 31 cohort) over the first 10 days after launch, both above the program's 20% D7 target. Small sample; direction is unambiguous. Source: dashboard screenshot `assets/images/analytics_01.jpg`.
- **H1-02** Social threshold is ~3 visible painters. Kill: staged playtest at 2 / 3 / 5.
- **H1-03** Emergent tribe formation is the real return reason. Kill: interview 3 returning painters.
- **H1-04** The whole-canvas overhead screenshot is the shareable moment. Kill: count shares/mentions after a fixed observation window.

**v2 (from feature dump):**
- **H2-01** Private boards make the game *more* social (via ambition → sharing), not less. Kill: A/B v2 vs v1 on share-rate and D7 return.
- **H2-02** A user-facing image exporter multiplies organic marketing beyond what manual screenshotting already produces. Kill: measure share-rate before/after exporter release.
- **H2-03** An expanded color palette does not fragment tribe recognition on the public canvas. Kill: staged playtest — 8 vs 64 colors, count identifiable tribes.
- **H2-04** Private board as an owned space is a stronger D1 hook than async traces on the public canvas. Kill: cohort split — users who painted a private-board pixel vs public-only, measure D1.
- **H2-05** *(top risk)* Private boards reduce public-canvas activity by >30%. Kill: A/B or before/after on public-canvas pixels-per-day.
