# dcl/place — Session Handoff

> Read this first when starting a new session. Full design lives in [DESIGN.md](./DESIGN.md).

**Repo:** https://github.com/iillee/scenes/dcl-place (origin: `iillee/dcl-place`)
**Branch:** `main`
**Last commit:** `85cc037` — "Day 2 pt 2: cursor-driven tap-to-place with flat cell highlight"
**Elapsed:** Days 1–2 of 10-day hackathon build
**Deadline:** September 7, 2026

---

## ✅ Working end-to-end

Player taps a tile → cursor-driven raycast resolves the 1m cellId → client
sends `placePixel` → server enforces 10s cooldown → applies paint →
broadcasts CRDT `PaintCell` → all clients rerender the cell in the placed
color. `cooldownAck` returns to the sender with `nextAllowedAt` + `serverNow`
so the UI has a truthful clock.

Concretely working:
- 10×10 parcel scene (160m × 160m) with authoritative multiplayer server
- 16-color r/place palette seeded at boot (palette indexes 1..16)
- Server-side 10s cooldown per wallet address (in-memory map)
- Tap-to-place with `PrimaryPointerInfo`-driven cursor raycast
- Flat cell-sized highlight in the currently selected color
- Sparse `PaintCell` CRDT (only painted cells cost anything)
- Full canvas maze/tile system ported from `dcl-canvas`
- Server heartbeat + placePixel summary logs every 5s

---

## ⚠️ Known gaps (all expected, not bugs)

- **No color picker UI** — selected color hardcoded to red (index 1). See [Day 3](#day-3-next-up) below.
- **No cooldown ring UI** — `placeState.cooldownRemainingMs()` is ready to power one.
- **Legacy UI layers** (brush size, coverage HUD from canvas/snowdrift) still render but reference dead concepts. Safe to delete or hide.
- **Canvas is in-memory only** — resets when server sleeps (~2 min after last player). Chunked Storage persistence is Day 8.
- **No snapshot/JPG export yet** — Day 6.
- **Legacy compat shims** (`team.ts`, `roundTiming.ts`, `Team.Red`, `Team.Blue`, `paletteIndex=1/2`) present but inert — kept so old imports compile.
- **`initPaintingSystem` is a no-op** — old walk-to-paint disabled. Fine to remove on cleanup.

---

## 🧭 Architecture cheatsheet

```
src/index.ts             async isServer() branch (do NOT use sync isServer)
src/shared/
  messages.ts            placePixel, cooldownAck, joinRoster, updateName
  palette.ts             16-color PLACE_PALETTE, placeColor(idx), Team compat
  settings.ts            SCENE_WORLD_SIZE_*, PAINT_COOLDOWN_MS=10000
  paintGrid.ts           cellId <-> world coord math
  paintSync.ts           syncEntity wiring (server-only writes)
  components.ts          PaintCell, PaletteEntry, PaintCoverage
  maze/                  tile/level generation (verbatim from canvas)
src/server/
  server.ts              handlers + cooldown map (nextAllowedAt)
  paintState.ts          applyPaintIndex, seedPlacePalette
  leaderboard.ts         top-100 all-time (persisted every 30s)
src/client/
  index.ts               boot orchestration
  clientHandler.ts       joinRoster, updateName, cooldownAck receiver
  placeState.ts          selectedPaletteIndex + cooldown observable
  placeInput.ts          tap-to-place + cursor highlight (raycast/frame)
  paint.ts               flat tile renderer, CRDT observer, worldToCellId
  maze/rebuild.ts        tile GLB spawning + pointerEventsSystem hook
  ui/                    React-ECS layers (theme + snowdrift patterns)
```

### Key contracts
- **Client → Server:** `placePixel { cellId: string, paletteIndex: 1..16 }`
- **Server → Client (addressed):** `cooldownAck { accepted, nextAllowedAt, serverNow }`
- **Sync (CRDT):** `PaintCell.index` (byte, palette slot)
- **Server clock trust:** client stores `serverSkewMs = serverNow - Date.now()` from every ack; UI reads `serverNowMs()` for the ring.

---

## 📋 Day 3 (next up)

**Goal:** color picker UI + cooldown ring so the player can pick from all 16 colors and see when they can paint again.

**Pattern reference:** `C:/Users/luke/AppData/Roaming/creator-hub/Scenes/dcl-snowdrift/src/client/ui/` — bottom-UI button layout, tap target sizing, modal patterns.

**Concrete steps:**

1. **New layer** `src/client/ui/layers/layer.colorPicker.tsx`:
   - A bottom-of-screen swatch bar (or a picker button that opens a 4×4 modal)
   - Reads `PLACE_PALETTE` from `src/shared/palette.ts`
   - On tap → `setSelectedPaletteIndex(i)` from `src/client/placeState.ts`
   - Subscribes via `subscribePlaceState()` to reflect the current selection
   - Follow snowdrift's `buttonImage.tsx` / theme sizing conventions

2. **New layer** `src/client/ui/layers/layer.cooldown.tsx`:
   - A center-bottom paint button with a radial or linear fill
   - Reads `cooldownRemainingMs()` and `PAINT_COOLDOWN_MS`
   - Progress = `1 - remaining / PAINT_COOLDOWN_MS`
   - When `canPlaceNow()` → shows "READY" state
   - Optionally: tapping this button places a pixel at the current highlight target (nice-to-have; the tile-tap path already works)

3. **Wire into `src/client/ui/index.tsx`**:
   - Add both new layers to the render tree
   - Consider hiding/removing the legacy brush-size / coverage layers that no longer apply
   - Test both landscape and portrait mobile viewports

4. **Testing:**
   - `/preview` to run locally
   - Verify color selection persists across taps
   - Verify cooldown ring reflects server time (kill your local server for a moment, ring should stop advancing)

**Estimated scope:** ~1 focused session.

---

## 🛠️ How to run

```bash
cd C:/Users/luke/appdata/roaming/creator-hub/scenes/dcl-place
npx sdk-commands build    # verify clean before making changes
npx sdk-commands start    # local preview (starts local Multiplayer Server automatically)
```

Server logs prefix with `[Server]`, client with `[Client]` / `[Place]`.

**Multiplayer testing locally:** open a second explorer window with
`decentraland://realm=http://127.0.0.1:8000&local-scene=true&debug=true&multi-instance=true`
and sign in with a different address.

---

## 🎯 Full roadmap (from DESIGN.md §8)

| Day | Milestone | Status |
|---|---|---|
| 1 | Scaffold + port canvas systems + expand palette + placePixel + cooldown | ✅ done |
| 2 | Client tap-to-place → placePixel end-to-end | ✅ done |
| 3 | Color picker UI + cooldown ring UI | ⏭️ next |
| 4 | Spectator cam / help / music from snowdrift, touch-control polish | ⏳ |
| 5 | Leaderboard + Storage persistence | ⏳ |
| 6 | Snapshot pipeline (JPG → in-world board + web endpoint) | ⏳ |
| 7 | First mobile playtest, tune cooldown/palette | ⏳ |
| 8 | Chunked canvas persistence (eternal canvas) | ⏳ |
| 9 | Deploy to World, playtest, polish | ⏳ |
| 10 | README, DoraHacks submission, demo video | ⏳ |

---

## 🧠 Design decisions to remember

- **Permanence is the pitch.** Everything reinforces "this canvas is forever." No round resets, no daily wipes, no seasons — just accumulating pixels.
- **Server owns the clock.** Client never trusts `Date.now()` for cooldown; always uses `serverSkewMs`-corrected timestamps from `cooldownAck`.
- **Sparse CRDT.** Only painted cells cost anything. Unpainted floor is free.
- **Palette interned once.** All 16 colors seeded at boot into fixed indexes 1..16 so `PaintCell.index` is a single byte.
- **Tap = 1 pixel.** `PAINT_TICK_MAX_CELLS = 1`. No brush-streaming from the walking-paint canvas legacy.
- **Legacy compat matters.** Don't rip out `Team` / `roundTiming` / `roster` unless you're prepared to touch a lot of UI/paint imports at once. They compile as inert shims for now.

---

## 📖 Read next in a new session

1. This file (you're here)
2. `docs/DESIGN.md` — concept, architecture, decisions
3. `src/server/server.ts` — see how cooldown + handlers wire up
4. `src/client/placeInput.ts` + `src/client/placeState.ts` — the newest pieces, small and clean

Good luck. 🎨
