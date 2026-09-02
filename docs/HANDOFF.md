# dcl/place — Session Handoff

> Read this first when starting a new session. Full design lives in [DESIGN.md](./DESIGN.md).

**Repo:** https://github.com/iillee/scenes/dcl-place (origin: `iillee/dcl-place`)
**Branch:** `main`
**Last committed session:** 4b714df — "chore(perf): remove temporary perf HUD, keep chunked-CRDT baseline"
**This session:** 🚨 **Load-scaling fix.** Migrated the paint CRDT layer from `PaintCell`
(one CRDT entity per painted pixel) to `PaintTile` (one CRDT entity per tile
carrying a packed byte array). Ported from dcl-snowdrift. Join hydration cost
dropped **76×** (5,634 entities → 74) and is now flat forever regardless of
saturation. Verified in production against the live 5,634 pixel canvas — "much
much faster" on desktop, smooth on mobile. Zero visual change, zero live-sync
latency change. Also shipped a dormant paint-storm harness gated by EnvVar for
future scaling tests, plus a canvas backup/restore workflow (see
`backups/RESTORE.md`).
**Deadline:** September 7, 2026
**Live World:** `dclplace.dcl.eth` — https://decentraland.org/play/?realm=dclplace.dcl.eth

---

## ✅ Working end-to-end

Player walks to a tile → feet-based system resolves the cellId under the
avatar → colored highlight cube previews the pending placement in the
selected color → tap the **paint button** (or press **F**) → client sends
`placePixel` → server enforces **1s** cooldown → applies paint → CRDT
the tile's `PaintTile.cells` byte array is republished on the next server tick
→ every connected client diffs vs. its shadow and recolors only the changed cells.
Server persists the canvas to Storage every 30s; on next boot every pixel
is restored before the first client connects.

Concretely working:
- 20×20 parcel scene (320m × 320m) with authoritative multiplayer server
- **8-color palette** matching `assets/images/pallete.png` (blue, red, yellow, green, purple, orange, white, black)
- Server-side **1s** cooldown per wallet address (was 3s, tuned down this session)
- **Feet-based placement** with airborne gate (jump/glide hides the preview and blocks placement)
- **Highlight cube** sitting flush with the tile plane, full-color face + black wireframe edges
- **Chunked `PaintTile` CRDT** (100 tile entities, one byte per cell, dirty-flush per tick). Migration completed 2026-09-02; see "Chunked PaintTile CRDT" session below.
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

## 🆕 Latest session — Chunked PaintTile CRDT (load-scaling fix)

### The problem
Original design used one `PaintCell` CRDT entity per painted pixel. At ~5,500
pixels this became the mobile load bottleneck; at 100% saturation (25,600
pixels) the model would have collapsed. The DESIGN doc's own Phase 8 plan
assumed chunked persistence was optional; it turns out chunked *runtime state*
is the actual bottleneck.

### The fix
One `PaintTile` CRDT entity per (tx, tz, level) tile. `cells: Schemas.Array(Schemas.Byte)`,
256 bytes per tile (16×16 grid), one palette-index byte per cell. Dirty tiles
flush once per server tick via `flushDirtyPaintTiles()`. Client keeps a per-tile
shadow byte buffer and diffs incoming CRDT payloads against it, dispatching
`applyPaintIndex` only on changed bytes. The whole hot path (per-pixel render
entities, feet preview, paint UX, Discord snapshot, cooldown) is unchanged —
only the network representation of paint state moved.

Canvas Storage blob format (`dcl-place:canvas:v1`) is unchanged; existing pixels
hydrate transparently into the new format via `hydratePaintCell` → `writeCellByte`.

### Files
- `src/shared/components.ts` — added `PaintTile`, kept `PaintCell` as deprecated shim for one deploy cycle
- `src/shared/paintGrid.ts` — added `PAINT_CELLS_PER_TILE`, `TILE_NETWORK_BASE`, `packTileKey`, `splitCellKey`, `joinCellKey`, `tileNetworkId`, `tileKeyFromNetworkId`
- `src/shared/paintSync.ts` — rewrote for chunked writes: `ensurePaintTileEntity`, `writeCellByte`, `flushDirtyPaintTiles`, `zeroAllPaintTiles`
- `src/server/paintState.ts` — `writeCellIndex` routes through `writeCellByte`; `cellIndex` Map preserved so Discord snapshot / canvasStorage still work unchanged
- `src/server/server.ts` — `flushDirtyPaintTiles()` runs once per engine tick; `[Perf]` log line replaces per-cell heartbeat
- `src/client/paint.ts` — `syncCellsFromCrdt` iterates `getEntitiesWith(PaintTile)`, diffs vs. per-tile shadow, dispatches only on byte flips
- `src/server/serverStats.ts` — reports `paintTileEntityCount` instead of `paintCellEntityCount`

### Paint-storm harness (dormant in prod, on-demand for stress tests)
- `src/server/debugStorm.ts` — gated by EnvVar `DCL_PLACE_ALLOW_STORM=="1"`. Fill/random/clear modes, amortized 500 cells/tick, progress + throughput logs.
- New `debugStorm { target, mode }` room message.
- To re-enable for a future scaling test: `npx sdk-commands storage env set DCL_PLACE_ALLOW_STORM --value "1"` on the target World. Delete when done.
- Client-side trigger is currently no-op (perf HUD deleted after validation). Re-add a temporary HUD from git history (commit `79c155d`) if you want interactive buttons again.

### Backup / restore workflow
- `backups/` dir gitignored; holds dated snapshots of `dcl-place:canvas:v1`.
- Pre-migration backup: `backups/canvas-20260902-162101.txt` (5,634 pixels, 33KB).
- Restore procedure: `backups/RESTORE.md`.
- Backup command: `npx sdk-commands storage scene get "dcl-place:canvas:v1" > backups/raw-XXXXX.log 2>&1`.

### Perf measurements (local, 100% saturation, 25,600 pixels)
- CRDT hydration: **274 ms** for a fully-saturated canvas
- CRDT total bytes over the wire: ~25 KB (100 tiles × 256 bytes)
- Server storm throughput: ~15,000 paints/sec (4 orders of magnitude over organic)
- Desktop FPS after hydration: 39.6 (25,600 mesh entities — unrelated to CRDT, this is the render ceiling)
- Storage blob size at 100%: 152 KB

### Production numbers (dclplace.dcl.eth, ~22% saturation)
- `hydrated 5634 cells (skipped 0), blob 33339B`
- 74 tile CRDT entities in memory (vs. 5,634 before)
- Subjective: "much much faster" (desktop), smooth on mobile
- Phase 3 (texture-bake LOD) is NOT needed for the current canvas

### Known caveat
Render-side cost is still linear in painted pixels (one plane entity per pixel).
At saturation that's 25,600 planes; desktop handles it, mobile handles it, but
if we ever move to a 32×32-per-tile canvas (102,400 pixels) we'd want to revisit
with Phase 3. For now this is documented and shelved.

---

## Previous session — Mobile HUD overhaul

### Native mobile on-screen buttons (`src/client/touchControls.ts` — new)
Reshapes DCL's fixed native button cluster via `TouchScreenControls`. Requires SDK 7.26.0+. No-op on desktop.
- **Priority stack** (fixed): `JUMP > POINTER > PRIMARY (E) > SECONDARY (F) > ACTION_3 > ACTION_4 > ACTION_5 > ACTION_6`. With ≤5 visible = no "+" overflow. We hide `IA_POINTER`, `IA_ACTION_5`, `IA_ACTION_6` → 5 visible: JUMP in center + 4 around it.
- **Mapping:** E → mute (icon tracks state, re-applied after each toggle); F → leaderboard (★ icon); slot 3 → spectator (eye icon, dispatch owned by `topDownCamera.ts` — don't double-handle); slot 4 → help ("?" icon).
- **The IA_POINTER trap:** binding a global action to `IA_POINTER` back-fires because ANY mobile UI tap (d-pad, zoom, swatches, paint) fires `IA_POINTER`. Learned by wiring spectator to it and having every UI interaction toggle the camera. Solution: hide the hand entirely, use `IA_ACTION_3` for spectator.
- **Star icon** (`assets/images/star3.png`) generated via PowerShell + `System.Drawing` (Segoe UI Symbol, 380pt, y=245). No stock trophy PNG existed in adjacent scenes. Renamed twice during dev (`leaderboard.png` → `star.png` → `star2.png` → `star3.png`) to bust the mobile texture cache — same-path replacement silently serves stale.
- **Top bar hidden on mobile** (`layer.topBar.tsx`): `if (isMobile()) return <UiEntity />`. Desktop bar unchanged.

### Spectator camera + input re-alignment (again)
Previous session rotated camera offset from `+X` to `-Z`; this changes what world axis is "up on screen" to **+Z up, +X right** (not +X up as originally computed). Realigned both input surfaces:
- **Drag** (`applyPanDelta`): `targetPos.x += dxPx * m; targetPos.z += -dyPx * m` (camera follows finger).
- **D-pad** (`layer.topDownPan.tsx`): up = `(0, +1)`, right = `(+1, 0)`, down = `(0, -1)`, left = `(-1, 0)`.

### Help panel mobile scaling
- Scale factor `s = 2` on mobile applied to width, padding, all child heights, all font sizes, and all margins (desktop `s = 1`).
- Mobile height explicitly tightened to 320 (raw `PANEL_H×2 = 400` left empty space).
- Vertically centered via `top = (720 - height) / 2` on mobile (top bar hidden so no offset needed).

### Leaderboard trim
- `MAX_ROWS: 12 → 10`; header "TOP PAINTERS" → "TOP 10 PAINTERS". Panel height auto-shrinks via the `HEADER_H + MAX_ROWS * ROW_H` formula. Server still tracks top 20.

### Mobile paint-button "click" ready hint
- When `ready === true` (cooldown fully drained) AND `isMobile()`, an absolutely-positioned centered `<b>click</b>` label overlays the paint button. Flips to black when the white swatch is selected (same contrast rule as the desktop `F` glyph). Nudged 6px up for optical center.

---

## Previous session — UX polish

### Spectator camera rotation (90° CCW)
Screen axes were inconsistent with world axes. Rotated the overhead view so **+X is up on screen, +Z is right**. Three touch-points:
- `src/client/topDownCamera.ts` — `applyPanDelta` sign flipped: `targetPos.x += -dyPx * m; targetPos.z += +dxPx * m` (camera-follows-finger).
- `src/client/topDownCamera.ts` — camera offset from directly-overhead moved from `+X` (`CAM_EAST_OFFSET = 3`) to `-Z` (`CAM_OFFSET_Z = -3`). Offset direction determines what world axis is "up" on screen; flipping to –Z produced the correct CCW rotation (initial +Z guess was CW, flipped).
- `src/client/ui/layers/layer.topDownPan.tsx` — d-pad up/down vectors flipped: up = `vx:+1`, down = `vx:-1`. Left/right unchanged (already matched +Z-right).
- **Discord snapshots unaffected** — server-side PNG encoder reads `paintState.cellIndex` directly, no camera dependency.

### Player spawn fixed
- `scene.json` spawn range updated to `x/z: [158, 162]` (center of the 320×320m scene).
- **The real bug:** `src/client/player.ts` was teleporting every player to `(32, 2, 56)` — hardcoded from the old 4×7 scene footprint. That teleport ran ~2s after load and overrode scene.json. Updated to `(160, 2, 160)` with camera target `(160, 2, 168)`.

### Snapshot ⬇ button removed
- Deleted `DownloadGlyph`, `onSnapshotClick`, the on-demand PanelButton, and the unused `room` import from `src/client/ui/layers/layer.topBar.tsx`.
- Top bar back to 4 buttons: spectator · mute · ★ leaderboard · ? help.
- Server-side auto-post to Discord every 5 min still runs; only the manual client trigger is gone.

### Cold-open loading splash
- New `src/client/ui/layers/layer.loadingSplash.tsx` — full-screen `assets/images/dclplace.png` overlay, ported from snowdrift's `layer.loadingSplash` (simplified: no cycle-rollover override since dcl/place has no rounds).
- Visible while `isRebuilding()` is true OR `<2500ms` since module load OR the tile cascade hasn't started yet (fast-client latch via `hasSeenRebuildStart`).
- Registered last in `src/client/ui/index.tsx` so it draws above everything.

### Hotkey + copy tweaks
- **E cycles palette backward** now (was forward). Wrap `1 → 8` instead of `8 → 1`. See `src/client/placeInput.ts`.
- **Help panel copy** rewritten in `src/client/ui/layers/layer.helpPanel.tsx`:
  - Title: "welcome to dclplace"
  - Subtitle: "a public drawing board"
  - 1. select a color form the pallete
  - 2. place 1 pixel every 1 second
  - 3. make art

---

## Previous session — Day 6 snapshot pipeline + first World deploy

### Discord snapshot pipeline (Day 6 ✅)
The canvas now backs itself up to a Discord channel automatically — the channel *is* the timelapse archive.

- **`src/server/snapshotDiscord.ts`** (new) — server-side PNG encoder + Discord webhook uploader.
  - Reads `paintState.cellIndex` directly (no CRDT round-trip), stamps into an RGB grid, 2× upscale → 640×640 PNG via the shared `pngEncoder`.
  - Multipart body assembled as `Uint8Array` — `TextEncoder` doesn't exist in the sandboxed server runtime, so `asciiBytes()` helper does ASCII-only encoding (captions kept ASCII on purpose).
  - Discord attachment CDN URLs are signed + expire in ~24h since late 2023 — that's fine for archive scraping (Discord API re-signs on `GET /messages`) but rules out using one URL as a long-lived in-world texture. Deferred for the in-world display board.
- **Auto-post every 5 min** if `snapshotDirty` — new flag in `paintState.ts` alongside `canvasDirty` (independent lifecycle: snapshot poster clears its own flag; canvas Storage flush clears the other). Idle canvas → zero posts.
- **Global 30s floor** + **per-user 60s floor** on manual posts prevent spam / rate-limit hits.
- **On-demand ⬇ button** in the top-bar → new `requestSnapshotPost` room message → server posts with `on-demand snapshot (by 0x…)` caption. Fire-and-forget, no ack; click sfx is the only feedback.
- Client's `src/client/paintSnapshot.ts` is now unused / dead code — was originally going to `openExternalUrl(dataUrl)` but DCL's sandbox strips `data:` URIs and redirects to the whitepaper. Kept the file in case we want per-client encode later.
- Webhook URL loaded from **`DISCORD_SNAPSHOT_WEBHOOK`** EnvVar. Unset = silently disabled (safe for local preview). Set via `npx sdk-commands storage env set DISCORD_SNAPSHOT_WEBHOOK --value "..."` — must be run **after** first deploy (Storage provisions per-World).

### First World deploy — `dclplace.dcl.eth`
- Added `worldConfiguration.name` to `scene.json`.
- Two case-sensitivity bugs hit deploy validation (Windows is case-insensitive, deploy server isn't): `assets/Images/dclplace.png` → `assets/images/dclplace.png` in both `scene.json` (`navmapThumbnail`) and `assets/scene/main.composite` (`thumbnail`).
- **First-deploy CDN warmup gotcha:** tile GLBs failed to load on first deploy (visible paint cells but no floor/collider). Reloading the World resolved it — CDN cache filled on second fetch. Design smell worth flagging: we're still using the canvas project's maze generator to place 400 tiles on a solid 20×20 grid; that's fragile. Future refactor: drop the maze machinery, spawn a plain grid of `tile-cross-full.glb` directly.

### Camera / mobile polish
- **Default spectator altitude** dropped 4 zoom-steps (40 m) closer so players open the top-down cam at pixel-scale, not whole-canvas: desktop `90 → 50`, mobile `70 → 30`. Both still above `CAM_ALTITUDE_MIN` (20).

### `.env` for local preview
- Added `.env` (gitignored already) with `DISCORD_SNAPSHOT_WEBHOOK` for local server. Same read path as the deployed server — `EnvVar.get(...)` transparently sources from either.

---

## 🆕 Previous session

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

## 🆕 Latest UI polish session

### Bottom bar
- **`E` glyph** centered on the currently-selected swatch (desktop only),
  white with black flip on the white swatch — mirrors the `F`-on-paint pattern.
- **Selection border** now includes `sel`/`unsel` in the swatch `key` so
  react-ecs remounts the entity on selection change; fixes a mobile bug
  where `borderWidth`/`borderColor` updates silently no-op'd on an
  already-mounted UiEntity.
- **Selection safety-net poll** — the cooldown system now also mirrors
  `getSelectedPaletteIndex()` into props every frame, so selection stays
  in sync even if the `subscribePlaceState` → `props.set` path fails.
- **Paint button fill overflow fix** — the absolute fill frame now uses
  explicit pixel `width/height = PAINT_BTN_W/H - PAINT_BORDER_W*2` at
  `position:{left:0,top:0}` instead of `100%`, which was measuring from
  the outer border-box and leaking past the bottom/right on mobile.
- **Mobile paint tap fix** — the absolute fill overlay was eating taps
  before they bubbled to the parent's `onMouseDown`. Duplicated the
  paint handler onto the fill frame so any tap inside the button fires.
- **Mobile paint button width** — 2× (96 → 192px) since there's no F key.

### Top bar
- **Hotkeys aligned left→right:** 1 spectator, 2 mute, 3 leaderboard, 4 help.
  Swapped leaderboard `IA_ACTION_6` → `IA_ACTION_5` and help `IA_ACTION_5`
  → `IA_ACTION_6`; mute (`IA_ACTION_4`) hotkey system registered inside
  `initAudio()`.
- **★ / ?** bumped larger (32/36 → 46/50) with 4px white border (matches
  the paint button frame). Desktop centers naturally; mobile applies
  `padBottom: 28` on the button parent to nudge the centered glyph up
  (compensates for the mobile UI DPI scale).

### Preview cursor
- **Pop-up-from-ground animation** — the preview cube grows from height 0
  to full over 180ms with an ease-out-back curve, bottom anchored at the
  tile plane so it rises out of the ground. `hideHighlight()` resets pop
  state so re-entering plays fresh. Wireframe edges scale with it.
- **Color match** — removed `emissiveColor` / `emissiveIntensity: 0.4`
  from the preview material. It was pushing the highlight brighter than
  the paint it was previewing (so the placed pixel looked "duller"). Now
  matches `paint.ts cellMaterialFromColor` exactly. Black wireframe
  still marks it as a preview.
- **Wireframe thickness** bumped 0.02m → 0.05m.

### Audio
- **Pop-on-any-paint** — `syncCellsFromCrdt()` now fires `playClaimSfx()`
  when any live paint arrives (yours or anyone else's). Gated by a
  `paintHydrated` flag so the initial persisted-canvas load stays silent,
  and coalesced to one pop per frame to avoid concurrent-painter spam.
- **Attack trim** — `playClaimSfx()` sets `currentTime: 0.05` to skip
  pop.mp3's leading silence so the transient hits at the moment of paint.

---

## ⚠️ Known gaps


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
  components.ts          PaintTile (packed byte array/tile), PaletteEntry, PaintCoverage, LeaderboardState
  maze/                  tile/level generation
src/server/
  server.ts              handlers + cooldown map + 30s canvas flush + 1s leaderboard tick + snapshot auto-tick
  paintState.ts          applyPaintIndex, hydratePaintCell, allPaintedCells, snapshotDirty
  canvasStorage.ts       Storage.get/set for the eternal canvas
  leaderboard.ts         top-100 all-time + dirty flag + markLeaderboardDirty()
  snapshotDiscord.ts     server-side PNG encode + Discord webhook multipart upload
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
- **Sync (CRDT, server-owned):** `PaintTile.cells` (byte-array, one per tile, dirty-flushed per tick), `PaletteEntry.color`, `PaintCoverage`, `LeaderboardState.json`
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
| 6 | Snapshot pipeline (PNG → Discord archive channel) | ✅ done this session (in-world board deferred — needs stable URL, Discord CDN signs+expires) |
| 7 | First mobile playtest, tune cooldown/palette | 🟡 partial — cooldown tuned to 1s, mobile margins verified, real playtest still open |
| 8 | Chunked canvas persistence | 🟡 single-blob live; chunked only needed past ~100k cells |
| 9 | Deploy to World, playtest, polish | 🟡 first deploy live at `dclplace.dcl.eth`, playtest + iterate remaining |
| 10 | README, DoraHacks submission, demo video | ⏳ (timelapse video from Discord archive is part of this) |

---

## 📋 Next up (suggested)

Pick one:

1. **Real mobile playtest on the deployed World.** UI is mobile-adjusted but nobody's touched it on an actual phone in-world. Look for tap-target issues, safe-area problems, picker overflow on narrow portrait viewports.
2. **Timelapse download script.** ~30-line Node/Python that pages Discord API (`GET /channels/{id}/messages`), downloads every attachment in order, runs `ffmpeg -framerate 24 -pattern_type glob -i 'snapshots/*.png' timelapse.mp4`. Needed for Day 10 demo video.
3. **Refactor maze → solid grid.** Rip the maze generator out entirely, spawn a plain 20×20 grid of `tile-cross-full.glb` directly. Faster, more reliable, no first-deploy GLB race. Small win.
4. **Chunked persistence.** Only necessary if we're worried about the demo overflowing single-blob storage. At current growth rate, we're not close.
5. **In-world snapshot display board.** Blocked on stable-URL hosting (Discord signs+expires). Needs Cloudflare R2 / Vercel Blob decision when we care.
6. **Yellow-swatch F contrast fix.** Small polish — compute luminance in `renderPaintButton` and auto-pick black/white for the F glyph.

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
