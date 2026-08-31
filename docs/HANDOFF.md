# dcl/place — Session Handoff

> Read this first when starting a new session. Full design lives in [DESIGN.md](./DESIGN.md).

**Repo:** https://github.com/iillee/scenes/dcl-place (origin: `iillee/dcl-place`)
**Branch:** `main`
**Last commit:** `46d116e` — "docs: handoff notes for new session" (Day 2 EOD)
**Elapsed:** Days 1–3 of 10-day hackathon build (Day 3 folded in early Day 4/5/8 work — see below)
**Deadline:** September 7, 2026

---

## ✅ Working end-to-end

Player walks to a tile → feet-based system resolves the cellId under the
avatar → colored highlight cube (with black wireframe) previews the pending
placement in the currently selected color → tap **READY** pill → client
sends `placePixel` → server enforces 3s cooldown → applies paint → CRDT
`PaintCell.index` broadcasts to every connected client → tile recolors.
Server persists the canvas to Storage every 30s; on next boot every pixel
is restored before the first client connects.

Concretely working:
- 20×20 parcel scene (320m × 320m) with authoritative multiplayer server
- **8-color palette** matching `assets/images/pallete.png` (was 16, was r/place default)
- Server-side **3s** cooldown per wallet address (was 10s during Day 1–2)
- **Feet-based placement** with airborne gate (`GROUND_TOLERANCE = 0.4m`, matches dcl-canvas): jumping / gliding hides the preview and blocks placement
- **Highlight cube** sitting flush with the tile plane (bottom at slab Y, top +0.1m), full-color face, black wireframe edges (8 boxes, ported from dcl-canvas pattern)
- Sparse `PaintCell` CRDT (only painted cells cost anything)
- Full canvas maze/tile system ported from `dcl-canvas`
- **Canvas persistence to `Storage`** — 30s dirty-flush, single compact blob (`key_b36:idx_b36,…`), hydrated at boot before any client connects
- Server heartbeat + placePixel summary logs every 5s

---

## 🆕 Since last handoff (Day 3+ work, uncommitted)

Big batch of changes on `main` working tree — all build-clean, none committed yet:

**UI framework migration**
- Adopted `@stom66/dcl-ui-component-kit` (DUCK) — `setupUi()` now registers layers via `SetupUiComponentKit({ layers })`.
- Deleted 5 legacy layers: `brushSize`, `cameraToggle`, `leaderboard`, `serverStats`, `snapshot`.
- Added 5 new layers: `layer.colorPicker`, `layer.cooldown`, `layer.helpPanel`, `layer.topBar`, `layer.topDownPan`.

**Placement UX (Day 3 goal — done + reworked)**
- Color picker renders directly from `PLACE_PALETTE` (no hardcoded index remap).
- Cooldown pill: bottom-center, fills L→R, shows "READY" or `Ns` countdown, `onMouseDown → placeAtFeet()`.
- Feet-based paint replaced tap-to-place raycast: highlight follows the avatar, tapping READY paints the cell under their feet.
- Highlight is now a 0.1m-tall colored box + 8 thin black edge boxes (dcl-canvas wireframe pattern).
- Airborne gate: `player.y - cell.groundY > 0.4m` → hide highlight + block `placeAtFeet`.

**Camera / traversal (Day 4 goal — landed early)**
- `topDownCamera.ts` massively rewritten (+308 lines) — full spectator / pan mode.
- `layer.topDownPan.tsx` provides the on-screen pan controls; sits below chrome so it doesn't swallow taps.

**Scene expansion**
- Parcel count 10×10 → **20×20** (320m × 320m). `scene.json` + `src/shared/settings.ts` updated.

**Palette**
- Trimmed 16 → 8 colors matching `pallete.png` (blue, red, yellow, green, purple, orange, white, black).
- `PLACE_PALETTE_SIZE` and picker auto-derive; server rejects `paletteIndex > 8`.

**Persistence (Day 8 goal — landed early)**
- New `src/server/canvasStorage.ts` with `loadCanvas()` + `saveCanvas()`.
- `paintState.ts` gained `canvasDirty` flag, `allPaintedCells()` iterator, `hydratePaintCell()` load-time writer.
- 30s dirty-flush tick in `server.ts`.
- Compact encoding: `<cellKey_b36>:<paletteIndex_b36>` pairs joined by `,`. ~9 B/cell, single blob (chunked storage is still deferred to Day 8 proper if we outgrow single-blob limits).

**Cleanup**
- `seedStartingArea()` removed — the persistent canvas is the source of truth now.
- Cooldown constant lowered `10_000 → 3_000` ms.

---

## ⚠️ Known gaps

- **No snapshot / JPG export yet** — Day 6.
- **Legacy compat shims** (`team.ts`, `roundTiming.ts`, `Team.Red`, `Team.Blue`) still present but inert. Safe to rip out once no imports remain. `TEAM_COLORS[Red]/[Blue]` now silently alias `PLACE_PALETTE[0]/[1]` (blue/red) — harmless since teams are unused.
- **`initPaintingSystem` is a no-op** — legacy walk-to-paint disabled.
- **Persistence is single-blob**, not chunked. Fine up to ~100k cells; watch for `[CanvasStorage] Storage.set returned false` if we scale past that. Chunked storage is the real Day 8 milestone.
- **Up to 30s of pixels lost on server crash** between flushes. No graceful-shutdown save hook.
- **Legacy layer.version.tsx** still renders — DUCK-migrated but content review pending.

---

## 🧭 Architecture cheatsheet

```
src/index.ts             async isServer() branch (do NOT use sync isServer)
src/shared/
  messages.ts            placePixel, cooldownAck, joinRoster, updateName
  palette.ts             8-color PLACE_PALETTE (matches pallete.png), Team compat
  settings.ts            SCENE_WORLD_SIZE_*, PAINT_COOLDOWN_MS=3000
  paintGrid.ts           cellId <-> cellKey (uint32) math
  paintSync.ts           syncEntity wiring (server-only writes)
  components.ts          PaintCell, PaletteEntry, PaintCoverage
  maze/                  tile/level generation (verbatim from canvas)
src/server/
  server.ts              handlers + cooldown map + 30s persistence tick
  paintState.ts          applyPaintIndex, hydratePaintCell, allPaintedCells, canvasDirty
  canvasStorage.ts       Storage.get/set for the eternal canvas   ← NEW
  leaderboard.ts         top-100 all-time (persisted every 30s)
src/client/
  index.ts               boot orchestration
  clientHandler.ts       joinRoster, updateName, cooldownAck receiver
  placeState.ts          selectedPaletteIndex + cooldown observable
  placeInput.ts          feet-tracker + highlight cube + wireframe + airborne gate
  paint.ts               flat tile renderer, CRDT observer, worldToCellId
  maze/rebuild.ts        tile GLB spawning
  topDownCamera.ts       spectator + pan camera (Day-4 work, early)
  ui/
    index.tsx            DUCK SetupUiComponentKit registration
    layers/              colorPicker, cooldown, helpPanel, topBar, topDownPan, version
```

### Key contracts (unchanged since Day 2)
- **Client → Server:** `placePixel { cellId: string, paletteIndex: 1..8 }`
- **Server → Client (addressed):** `cooldownAck { accepted, nextAllowedAt, serverNow }`
- **Sync (CRDT):** `PaintCell.index` (byte, palette slot)
- **Server clock trust:** client stores `serverSkewMs = serverNow - Date.now()` from every ack; UI reads corrected clock for the ring/pill.

---

## 🎯 Full roadmap (updated)

| Day | Milestone | Status |
|---|---|---|
| 1 | Scaffold + port canvas systems + palette + placePixel + cooldown | ✅ done |
| 2 | Client tap-to-place → placePixel end-to-end | ✅ done |
| 3 | Color picker + cooldown ring + **DUCK UI migration** + **feet-based paint** + **palette v2** | ✅ done |
| 4 | Spectator / top-down camera + touch-control polish | ✅ camera done, mobile polish TBD |
| 5 | Leaderboard UI + persistence tuning | ⏳ leaderboard backend exists, UI removed |
| 6 | Snapshot pipeline (JPG → in-world board + web endpoint) | ⏳ |
| 7 | First mobile playtest, tune cooldown/palette | ⏳ (cooldown pre-tuned to 3s) |
| 8 | **Chunked** canvas persistence (single-blob variant already shipping) | 🟡 partial — single-blob live |
| 9 | Deploy to World, playtest, polish | ⏳ |
| 10 | README, DoraHacks submission, demo video | ⏳ |

**Net effect:** ~1.5 days ahead of the original plan on infra (DUCK, camera, persistence),
neutral on player-facing polish (mobile UX, leaderboard UI, snapshots still open).

---

## 📋 Next up (suggested)

Pick one:

1. **Commit the pile.** Split into logical commits: (a) DUCK migration + layer swap, (b) 20×20 scene bump, (c) top-down camera, (d) palette v2 + cooldown tuning, (e) feet-based paint + highlight cube, (f) canvas persistence. Roughly one commit per session goal.
2. **Rebuild the leaderboard layer** on DUCK — backend already writes CRDT; just needs the UI.
3. **Snapshot / JPG export** (Day 6) — read paint state → paint into a canvas → post to signed endpoint.
4. **Mobile polish** — verify color picker + cooldown pill tap targets at portrait viewport, tune spectator pan controls.

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

- **Permanence is the pitch.** No round resets, no daily wipes — just accumulating pixels. Persistence is now real (Storage flush every 30s), not just a promise.
- **Server owns the clock.** Client never trusts `Date.now()` for cooldown; always uses `serverSkewMs`-corrected timestamps from `cooldownAck`.
- **Sparse CRDT.** Only painted cells cost anything. Unpainted floor is free.
- **Palette interned once.** All 8 colors seeded at boot into fixed indexes 1..8 so `PaintCell.index` is a single byte and remains stable across restarts (persisted keys reference these indexes).
- **Feet, not cursor.** Placement follows the avatar, not the pointer — encourages movement, social bumping, "hunting for empty pixels." Airborne is a no-op so nobody sky-paints.
- **Legacy compat matters.** Don't rip out `Team` / `roundTiming` unless you're touching every dependent import at once. They compile as inert shims.

---

## 📖 Read next in a new session

1. This file (you're here)
2. `docs/DESIGN.md` — concept, architecture, decisions
3. `src/server/server.ts` — cooldown, handlers, persistence tick
4. `src/server/canvasStorage.ts` — persistence format + load/save
5. `src/client/placeInput.ts` — feet tracker, highlight cube, airborne gate
6. `src/client/ui/layers/layer.colorPicker.tsx` + `layer.cooldown.tsx` — the DUCK layer pattern

Good luck. 🎨
