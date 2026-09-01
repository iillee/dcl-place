# dcl/place — Session Handoff

> Read this first when starting a new session. Full design lives in [DESIGN.md](./DESIGN.md).

**Repo:** https://github.com/iillee/scenes/dcl-place (origin: `iillee/dcl-place`)
**Branch:** `main`
**Last committed session:** aebf2a4 — "feat(ui,fx): mobile paint fix, preview pop-up anim, palette match, sfx timing"
**This session:** Day 6 landed — Discord snapshot pipeline (server-side PNG encode + webhook upload, auto every 5min if dirty + on-demand ⬇ button), World deploy to `dclplace.dcl.eth`, closer default spectator zoom, case-sensitivity fixes for deploy.
**Deadline:** September 7, 2026
**Live World:** `dclplace.dcl.eth` — https://decentraland.org/play/?realm=dclplace.dcl.eth

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

## 🆕 Latest session — Day 6 snapshot pipeline + first World deploy

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
  components.ts          PaintCell, PaletteEntry, PaintCoverage, LeaderboardState
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
