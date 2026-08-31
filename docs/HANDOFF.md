# dcl/place — Session Handoff

> Read this first when starting a new session. Full design lives in [DESIGN.md](./DESIGN.md).

**Repo:** https://github.com/iillee/scenes/dcl-place (origin: `iillee/dcl-place`)
**Branch:** `main`
**Last committed session:** e8756ea — "docs: refresh HANDOFF for Day 3-8 progress"
**This session:** Day 5 (leaderboard UI), Day 7 (mobile/UX polish) + a real palette-seeding bug fix
**Deadline:** September 7, 2026

---

## ✅ Working end-to-end

Player walks to a tile → feet-based system resolves the cellId under the
avatar → colored highlight cube previews the pending placement in the
selected color → tap the **paint button** (or press **F**) → client sends
`placePixel` → server enforces **1s** cooldown → applies paint → CRDT
`PaintCell.index` broadcasts to every connected client → tile recolors.
Server persists the canvas to Storage every 30s; on next boot every pixel
is restored before the first client connects.

Concretely working:
- 20×20 parcel scene (320m × 320m) with authoritative multiplayer server
- **8-color palette** matching `assets/images/pallete.png` (blue, red, yellow, green, purple, orange, white, black)
- Server-side **1s** cooldown per wallet address (was 3s, tuned down this session)
- **Feet-based placement** with airborne gate (jump/glide hides the preview and blocks placement)
- **Highlight cube** sitting flush with the tile plane, full-color face + black wireframe edges
- Sparse `PaintCell` CRDT (only painted cells cost anything)
- **Canvas persistence to `Storage`** — 30s dirty-flush, single compact blob, hydrated at boot before any client connects
- **Live leaderboard** — server publishes top-20 on a throttled 1s dirty tick (~150 KB/s at 100 concurrent players, cap-safe)
- **Blank tiles render as `#EAEAEA` light grey** so palette-white is visually distinct

### HUD (bottom)
Single row at bottom-center: 8 swatches + inline **paint button**.
- Paint button is 96×76, white-bordered, snowdrift torch-fuel pattern (framed outer + inset inner bar that grows L→R).
- Fill color = selected palette color; "fully filled" = ready to paint; partial fill IS the cooldown.
- Desktop shows a small centered `F` glyph on the button (flips to black when white is selected). Hidden on mobile.
- White-swatch selection ring is opaque black (all others white) so it's visible against its own fill.

### HUD (top)
Four white-bordered buttons in a row: **Spectator** · **Mute** · **★ Leaderboard** · **? Help**.
Active state = warm gold accent. Leaderboard and Help slide down from the top-center; opening one auto-hides the other (they share the slot).

### Desktop hotkeys
- **F** → paint (`IA_SECONDARY`)
- **E** → cycle to next palette color, wrap 8→1 (`IA_PRIMARY`) — plays pop SFX
- **3** → toggle help panel (`IA_ACTION_5`)
- **4** → toggle leaderboard (`IA_ACTION_6`)

---

## 🆕 This session's work (all in the two commits below `main`)

### Commit 1 — `fix(palette): light-grey unpainted tiles + palette-seed collision`
The important fix. Traced the bug where painting white rendered as black on clients:
- Server's `internColor()` dedupes by exact color. `TEAM_COLORS[None]` was `Color4(1,1,1,1)` and interned at index 0, so when `seedPlacePalette` tried to intern `PLACE_PALETTE[6]` (also pure white) at index 7, it got aliased back to index 0. `PaletteEntry[7]` never received a valid color → clients had a stale/black replica overriding their local white seed.
- Fix: made `TEAM_COLORS[None]` a light grey (`#EAEAEA`). Now white is a unique color, gets its own PaletteEntry, syncs cleanly.
- Bonus UX win: unpainted tiles now visually differ from painted white, so players can see their placements.
- Client `NONE_MAT` fallback kept in sync with `TEAM_COLORS[None]`.
- No data migration needed — pixels already stored with `paletteIndex: 7` will now render correctly white.

### Commit 2 — `feat(ui): leaderboard panel, inline paint button, hotkeys, 1s cooldown, mobile polish`
The UX iteration:
- **Leaderboard layer** (`src/client/ui/layers/layer.leaderboard.tsx`) — slides down from top-center (same slot as help panel), reads `LeaderboardState` CRDT, renders top-12 with gold/silver/bronze rank tints. Sends one `requestLeaderboard` on open for immediate freshness.
- **Throttled server publish** — added `leaderboardDirty` flag in `src/server/leaderboard.ts` set by `incrementPaint` / `updateName`; new 1s tick in `src/server/server.ts` republishes if dirty. Constant ~1 write/s regardless of paint rate. Numbers: ~150 KB/s at 100 clients (12× cheaper than client polling).
- **Panel mutual exclusion** — opening leaderboard hides help panel and vice versa (both share TopCenter slot).
- **Paint button folded into color picker** — deleted standalone bottom-center cooldown pill; the picker layer now renders swatches + inline button in one row. Snowdrift `TorchButton` fuel-fill pattern ported (framed outer + inset percentage-sized inner bar), fill grows L→R with `flexDirection: row + justifyContent: flex-start`. Fill uses selected palette color.
- **F desktop hotkey** for paint, **E** to cycle color (wraps 8→1, plays UI click).
- **1s cooldown** (was 3s) — `PAINT_COOLDOWN_MS` in `src/shared/settings.ts`. Help panel copy updated.
- **Top-bar redesign** — added trophy button, added 2px white borders, gave `★`/`?` glyphs a small upward optical nudge, bumped mobile top margin 4→28 (buttons + both slide-down panels move together).
- **Mobile color picker + paint button** bottom margin raised 16→48 to clear on-screen controls.
- **Dead code removed** — `src/client/ui/layers/layer.cooldown.tsx` deleted.

---

## ⚠️ Known gaps

- **No snapshot / JPG export yet** — Day 6 still open.
- **Yellow palette color + white F glyph** = low contrast. Only white is special-cased to flip the F to black; yellow will look faint. Fix (if bothersome): compute perceived luminance from fill color and pick black/white automatically.
- **Legacy compat shims** (`team.ts`, `roundTiming.ts`, `Team.Red/Blue`) still present but inert. `TEAM_COLORS[Red]/[Blue]` alias `PLACE_PALETTE[0]/[1]` (blue/red — yes, backwards) — harmless since teams are unused.
- **`initPaintingSystem` is a no-op** — legacy walk-to-paint disabled.
- **Persistence is single-blob**, not chunked. Fine up to ~100k cells; watch for `[CanvasStorage] Storage.set returned false` if we scale past that.
- **Up to 30s of pixels lost on server crash** between flushes. No graceful-shutdown save hook.
- **`BAR_TOP_MB` is duplicated** across topBar, helpPanel, and leaderboard layers. Should extract to `src/client/ui/theme/settings.ts` next time we're in there.
- **Legacy `layer.version.tsx`** still renders — content review pending.

---

## 🧭 Architecture cheatsheet

```
src/index.ts             async isServer() branch (do NOT use sync isServer)
src/shared/
  messages.ts            placePixel, cooldownAck, joinRoster, updateName, requestLeaderboard
  palette.ts             8-color PLACE_PALETTE. TEAM_COLORS[None] = #EAEAEA (see fix above)
  settings.ts            PAINT_COOLDOWN_MS = 1000
  paintGrid.ts           cellId <-> cellKey (uint32) math
  paintSync.ts           syncEntity wiring (server-only writes)
  components.ts          PaintCell, PaletteEntry, PaintCoverage, LeaderboardState
  maze/                  tile/level generation
src/server/
  server.ts              handlers + cooldown map + 30s canvas flush + 1s leaderboard tick
  paintState.ts          applyPaintIndex, hydratePaintCell, allPaintedCells
  canvasStorage.ts       Storage.get/set for the eternal canvas
  leaderboard.ts         top-100 all-time + dirty flag + markLeaderboardDirty()
src/client/
  index.ts               boot orchestration + hotkey wiring
  clientHandler.ts       joinRoster, updateName, cooldownAck receiver
  placeState.ts          selectedPaletteIndex + cooldown observable
  placeInput.ts          feet-tracker + highlight cube + placeAtFeet + F/E hotkeys
  paint.ts               flat tile renderer, CRDT observer, worldToCellId
  maze/rebuild.ts        tile GLB spawning
  topDownCamera.ts       spectator + pan camera
  ui/
    index.tsx            DUCK SetupUiComponentKit registration
    layers/
      layer.colorPicker  swatches + inline paint button (fuel-fill pattern)
      layer.leaderboard  slide-down top-12 panel
      layer.topBar       4 white-bordered buttons: spec, mute, ★, ?
      layer.helpPanel    slide-down 3-line rules
      layer.topDownPan   spectator drag catcher
      layer.version      version chip
    utils/
      leaderboard.ts     readLeaderboard() — CRDT reader used by the layer
```

### Key contracts
- **Client → Server:** `placePixel { cellId, paletteIndex: 1..8 }`, `requestLeaderboard {}` (fired once on panel open), `updateName { name }`, `joinRoster { userId }`
- **Server → Client (addressed):** `cooldownAck { accepted, nextAllowedAt, serverNow }`
- **Sync (CRDT, server-owned):** `PaintCell.index` (byte), `PaletteEntry.color`, `PaintCoverage`, `LeaderboardState.json`
- **Server clock trust:** client stores `serverSkewMs = serverNow - Date.now()` from every ack.

---

## 🎯 Full roadmap (updated)

| Day | Milestone | Status |
|---|---|---|
| 1 | Scaffold + port canvas systems + palette + placePixel + cooldown | ✅ done |
| 2 | Client tap-to-place → placePixel end-to-end | ✅ done |
| 3 | Color picker + cooldown ring + DUCK UI + feet-based paint + palette v2 | ✅ done |
| 4 | Spectator / top-down camera + touch-control polish | ✅ camera done, mobile polish this session |
| 5 | Leaderboard UI + persistence tuning | ✅ done (this session) |
| 6 | Snapshot pipeline (JPG → in-world board + web endpoint) | ⏳ |
| 7 | First mobile playtest, tune cooldown/palette | 🟡 partial — cooldown tuned to 1s, mobile margins verified, real playtest still open |
| 8 | Chunked canvas persistence | 🟡 single-blob live; chunked only needed past ~100k cells |
| 9 | Deploy to World, playtest, polish | ⏳ |
| 10 | README, DoraHacks submission, demo video | ⏳ |

---

## 📋 Next up (suggested)

Pick one:

1. **Snapshot / JPG export (Day 6).** Biggest remaining external dependency. Needs a design decision first: where do JPGs live? Own signed endpoint? World-hosted static? IPFS? Once decided, implementation is: read paint state → render to canvas → post/upload → in-world display board.
2. **Real mobile playtest.** UI is now mobile-adjusted but nobody's touched it on an actual phone. Look for tap-target issues, safe-area problems, picker overflow on narrow portrait viewports.
3. **Chunked persistence.** Only necessary if we're worried about the demo overflowing single-blob storage. At current growth rate, we're not close.
4. **Deploy to a World (Day 9).** Would give us a shareable URL for playtesting and demo purposes without waiting for Day 10.
5. **Yellow-swatch F contrast fix.** Small polish — compute luminance in `renderPaintButton` and auto-pick black/white for the F glyph.

---

## 🛠️ How to run

```bash
cd C:/Users/luke/appdata/roaming/creator-hub/scenes/dcl-place
npx sdk-commands build    # verify clean before making changes
npx sdk-commands start    # local preview (starts local Multiplayer Server automatically)
```

Server logs prefix with `[Server]`, client with `[Client]` / `[Place]`, persistence with `[CanvasStorage]`.

**Multiplayer testing locally:** open a second explorer window with
`decentraland://realm=http://127.0.0.1:8000&local-scene=true&debug=true&multi-instance=true`
and sign in with a different address.

---

## 🧠 Design decisions to remember

- **Permanence is the pitch.** No round resets, no daily wipes.
- **Server owns the clock.** Client never trusts `Date.now()` for cooldown.
- **Sparse CRDT.** Only painted cells cost anything.
- **Palette interned once.** All 8 colors seeded at boot into fixed indexes 1..8 so `PaintCell.index` is a single byte. **Never make the "unpainted" color equal any palette color** — internColor dedup will collide (this was the bug we just fixed).
- **Feet, not cursor.** Placement follows the avatar. Airborne is a no-op so nobody sky-paints.
- **Paint button IS the cooldown indicator.** "Button fully filled with your color = ready to paint." One visual, three signals (color, cooldown, action target).
- **Leaderboard publishes on a throttle, not per-paint.** Constant broadcast cost regardless of activity. Never publish on every `incrementPaint` — that scales badly with painter count.

---

## 📖 Read next in a new session

1. This file (you're here)
2. `docs/DESIGN.md` — concept, architecture, decisions
3. `src/client/ui/layers/layer.colorPicker.tsx` — the fused swatches + paint button layer
4. `src/client/ui/layers/layer.leaderboard.tsx` + `src/server/leaderboard.ts` — the leaderboard end-to-end pattern (dirty flag + throttled tick)
5. `src/shared/palette.ts` — the "unpainted color must be distinct" invariant

Good luck. 🎨
