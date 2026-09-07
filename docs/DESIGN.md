# dcl/place — Design Doc

> The eternal collaborative pixel canvas of Decentraland.
> Place one pixel every second. Nothing ever resets.

**Live World:** [`dclplace.dcl.eth`](https://decentraland.org/play/?realm=dclplace.dcl.eth)
**Repo:** https://github.com/iillee/dcl-place
**Origin:** Friendzone Mobile Buildathon (Sep 7, 2026)

> Session-by-session engineering notes live in [`HANDOFF.md`](./HANDOFF.md).
> This doc captures the durable design — concept, contracts, invariants,
> and the reasons behind them.

---

## 1. Concept

A mobile-first Decentraland re-imagining of Reddit's r/place: a single
giant walkable pixel canvas that lives in a Decentraland World, is shared
by every visitor, and **persists forever**. Pixels placed today may still
be there in a year. Tribes form, defend territory, alliances rise and
fall — the whole social drama of r/place, native to a 3D social world.

### Why it works on mobile

| Property | Why it matters on touch |
|---|---|
| **Tap-to-place** | One gesture, no drag, no precision. Better on thumbs than mouse. |
| **8-color palette** | Fits comfortably in a one-row bottom bar. No submenus. |
| **1-second cooldown** | Every input is deliberate; no scroll-past-and-scribble. |
| **Feet-based placement** | Player positions the pixel by walking. No cursor. |
| **Zero content without others** | Social by construction — the canvas grows because people show up. |

### The permanence pitch

- No rounds, no daily wipes, no scheduled events.
- Canvas state is Storage-persisted on the server; it survives sleep and restarts.
- Discord snapshot pipeline turns the canvas's history into a public,
  self-updating archive independent of any in-scene UI.

---

## 2. Scene

| | |
|---|---|
| **Parcels** | 20 × 20 = 400 |
| **Footprint** | 320 m × 320 m |
| **Base parcel** | `0,0` |
| **Spawn** | `(160, 2, 160)` — dead center, ~2s after load |
| **Canvas resolution** | 320 × 320 pixels (1 m per pixel), minus perimeter trim |
| **Painted-cell capacity** | ~25,444 cells (interior filled; outer arms trimmed to fit the floor GLB) |
| **Palette** | 8 colors (blue, red, yellow, green, purple, orange, white, black) |
| **Cooldown** | 1 second per wallet, server-enforced |
| **SDK** | `@dcl/sdk@auth-server` (authoritative Multiplayer Server) |

The scene is a single `assets/models/tile_floor.glb` at world origin —
one draw call for the entire canvas floor. Paint cells are individual
plane entities spawned in **two sequential phases** at boot: painted
cells first (from CRDT hydration), then grey unpainted cells to fill
out the grid. Both phases share a strict 300 addEntity/frame ceiling.
See §5 for the reasoning.

---

## 3. Core gameplay loop

1. Player enters the World → splash overlay while the canvas hydrates.
2. Splash clears → welcome flow places the player in spectator/overhead
   view with the help panel open. One tap dismisses.
3. Player walks onto the canvas. A colored highlight cube pops up under
   the avatar's feet, previewing the pending placement.
4. Player picks a color from the 8-swatch palette at the bottom.
5. Player taps the **paint button** (or presses **F**) → client sends
   `placePixel { cellId, paletteIndex }`.
6. Server validates the cooldown → writes the palette-index byte into
   the containing `PaintTile`'s cell buffer → replies `cooldownAck`.
7. Next server tick republishes the dirty `PaintTile` bytes via CRDT →
   every client diffs vs. its per-tile shadow and recolors only the
   changed cells.
8. Server flushes the canvas to Storage every 30s. On next boot the
   canvas is fully hydrated before the first client connects.

---

## 4. UI

Mobile-first from frame one. Desktop is a superset that adds keyboard
hotkeys and a top-bar; mobile relies on the native on-screen buttons +
the bottom color picker.

### Bottom bar (both platforms)

Single row: **8 swatches + inline paint button**.

- Paint button is 96×76 desktop / 192×76 mobile, white-bordered, with a
  snowdrift-style fuel-fill pattern. Fill color = selected palette color;
  fill width = cooldown progress. "Fully filled" = ready.
- Selection ring on the active swatch (black on white/eraser, white on
  every other color) so it always contrasts against its own fill.
- F/E/click hint glyphs flip to black on light-fill swatches (white,
  yellow) via a shared `LIGHT_FILL_INDEXES` set.

### Top bar (desktop only)

Four white-bordered buttons: **Spectator · Mute · ★ Leaderboard · ? Help**.
Active state = warm gold accent. Leaderboard and Help slide down from
top-center; opening one auto-hides the other.

### Mobile native buttons

The four native touch action buttons are re-skinned via
`TouchScreenControls`:

| Slot | Bound to |
|---|---|
| Center | Jump (native) |
| Eye icon | Spectator toggle (`IA_ACTION_3`) |
| E slot | Mute (`IA_ACTION_4`) |
| F slot | Leaderboard (`IA_ACTION_5`, star) |
| `?` slot | Help (`IA_ACTION_6`) |

`IA_POINTER` is hidden entirely: binding a global action to it back-fires
because ANY mobile UI tap fires `IA_POINTER`.

### Desktop hotkeys

| Key | Action |
|---|---|
| `F` | Place pixel |
| `E` | Cycle to next palette color |
| `1` | Toggle spectator camera |
| `2` | Toggle mute |
| `3` | Toggle leaderboard |
| `4` | Toggle help |

---

## 5. Architecture

Single codebase, branched at the entry point via the **async** `isServer()`
from `~system/EngineApi`. Never use the sync helper from `@dcl/sdk/network` —
it starts `false` until an async EngineApi call resolves, and racing it
crashes the server.

```
src/
├── index.ts                    # async isServer() branch
├── shared/                     # loaded by BOTH sides
│   ├── messages.ts             # placePixel, cooldownAck, joinRoster, updateName,
│   │                           # requestLeaderboard, requestSnapshotPost, debugStorm
│   ├── components.ts           # PaintTile, PaletteEntry, PaintCoverage, LeaderboardState
│   ├── palette.ts              # 8-color PLACE_PALETTE + UNPAINTED_COLOR (#EAEAEA)
│   ├── settings.ts             # PAINT_COOLDOWN_MS + geometry constants
│   ├── paintGrid.ts            # cellId ↔ cellKey (uint32) math + tile network ids
│   └── paintSync.ts            # syncEntity wiring (server-only writes)
├── server/                     # isServer() === true
│   ├── server.ts               # handlers + cooldown map + 30s canvas flush + 1s LB tick
│   ├── paintState.ts           # authoritative cell map + palette interning
│   ├── canvasStorage.ts        # Storage.get/set for the eternal canvas
│   ├── leaderboard.ts          # top-100 all-time + dirty-tick publish
│   ├── snapshotDiscord.ts      # PNG encoder + Discord webhook multipart upload
│   ├── discord.ts              # optional player-join notifications
│   ├── serverStats.ts          # heartbeat + component-change metrics
│   └── debugStorm.ts           # paint-storm stress harness (env-gated, off in prod)
└── client/                     # isServer() === false
    ├── index.ts                # boot orchestrator + hotkey wiring
    ├── clientHandler.ts        # room.on / room.send network boundary
    ├── placeInput.ts           # feet tracker + highlight cube + F hotkey
    ├── placeState.ts           # selected color + cooldown + denied signal
    ├── paint.ts                # lazy cell spawn, CRDT observer, hydration drain
    ├── topDownCamera.ts        # spectator VirtualCamera + pan/zoom
    ├── touchControls.ts        # mobile on-screen button remapping (SDK 7.26+)
    ├── audio.ts                # music + SFX
    ├── player.ts               # initial spawn teleport
    └── ui/                     # React-ECS HUD via DUCK
        ├── theme/settings.ts   # colors, spacing, top-bar margins
        ├── utils/{atlas,colors,leaderboard}.ts
        └── layers/
            ├── layer.colorPicker    # swatches + inline paint button
            ├── layer.topBar         # spectator · mute · ★ · ?
            ├── layer.leaderboard    # slide-down top-10 panel
            ├── layer.helpPanel      # slide-down 3-line rules
            ├── layer.topDownPan     # spectator drag catcher + zoom cluster
            └── layer.loadingSplash  # cold-open splash + hydration gate
```

### Client / server contract

**Client → Server** (`src/shared/messages.ts`):
- `joinRoster { userId }` — client boot handshake.
- `placePixel { cellId, paletteIndex: 1..8 }` — the whole game.
- `updateName { name }` — for leaderboard display.
- `requestLeaderboard {}` — fired once when the leaderboard panel opens.
- `requestSnapshotPost {}` — currently unused client-side (auto-posts server-side).
- `debugStorm { target, mode }` — env-gated stress-test trigger.

**Server → Client (addressed):**
- `cooldownAck { accepted, nextAllowedAt, serverNow }` — sent on every
  `placePixel` (accepted or rejected). Clients EMA-smooth
  `serverSkewMs = serverNow − Date.now()` for jitter-free cooldown UI.

**CRDT sync (server-owned writes):**
- `PaintTile.cells` — 256-byte array per tile, one palette-index byte
  per cell. Dirty tiles flush once per server tick.
- `PaletteEntry.color` — 9 pre-bound slots (index 0 = unpainted grey,
  1..8 = palette colors).
- `PaintCoverage` — total painted-count, throttled to 5 Hz.
- `LeaderboardState.json` — top-20 published on a 1s dirty tick.

### Cell coordinate system

- The 20 × 20 parcel scene is subdivided into a 20 × 20 grid of
  16 m × 16 m tiles (`MAZE_TILE_WORLD_METERS = 16`).
- Each tile is subdivided into a 16 × 16 grid of 1 m × 1 m paint cells
  (`PAINT_CELLS_PER_TILE_AXIS = 16`).
- `cellId` string format: `tx,tz,ty:col,row` (ty is always 0 — the
  canvas is flat).
- `paintGrid.ts` packs cellIds to/from uint32 keys for the CRDT byte
  arrays.

### Paint hot path

Cell entities are spawned in **two sequential phases** at boot, with a
strict 300 addEntity/frame ceiling throughout. Mobile's entity allocator
drops cells (blank-canvas regression) if sustained allocation exceeds
this rate while CRDT replay is in flight.

**Phase 1 — CRDT hydration:**
Every diff pushes changed bytes to `applyQueue`; `drainApplyQueue`
drains at 300/frame. Each drain lazy-spawns a coloured cell entity via
`applyPaintIndex`. During this phase, unpainted areas show the floor
GLB.

**Phase 2 — grey-fill:**
`spawnQueue` (populated at boot with every interior cell id) is GATED
off until `paintHydrated && applyQueue.length === 0`. Once hydration
is quiescent, `drainSpawnQueue` starts spawning any cell that still
has no entity at `PALETTE_NONE` (light grey), also at 300/frame.

**Live paints (post-hydration):**
A new paint enqueues one item to `applyQueue`, drained next frame. If
the target cell already has an entity (grey-fill done, or hydrated),
`applyPaintIndex` just recolours; otherwise it lazy-spawns.

Splash gate holds through both phases via
`isSpawningCanvas() || isApplyingHydration() || !paintHydrated`. Peak
allocation is bounded to 300/frame at all times.

---

## 6. Persistence

### Canvas (`canvasStorage.ts`)

- Key: `dcl-place:canvas:v1`
- Format: single compact blob of `(cellId, paletteIndex)` pairs
- Dirty-flush interval: 30 s
- On boot: `loadCanvas()` hydrates every pixel before the first client
  connects, so nobody sees a blank canvas after a server restart.
- Single-blob is fine to ~100k cells; chunked storage is a future
  upgrade if we ever expand the canvas.

### Leaderboard

- Storage-persisted top 100 all-time paint counts.
- Publish is dirty-flagged and throttled to 1 Hz. At 100 concurrent
  clients this is ~150 KB/s over CRDT — 12× cheaper than client-polled.

### Discord snapshot pipeline

- Server encodes the canvas as PNG (2× upscale → 640×640) and posts to
  a Discord webhook every 5 min if `snapshotDirty`.
- Runtime is sandboxed QuickJS — no `TextEncoder`; multipart body
  assembled as `Uint8Array` via `asciiBytes()` (captions kept ASCII).
- The webhook URL is loaded from the `DISCORD_SNAPSHOT_WEBHOOK` EnvVar.
  Unset = silently disabled (safe for local preview).
- Discord attachment CDN URLs are signed and expire in ~24h. Fine as an
  archive (Discord re-signs on read via `GET /channels/{id}/messages`),
  but rules out using one URL as a live in-world texture.
- `scripts/download-timelapse.mjs` scrapes the channel and stitches
  frames into an MP4 with ffmpeg.

---

## 7. Design invariants (do not violate)

These are load-bearing decisions with sharp edges. Break one, break the
scene.

1. **Async `isServer()` at the entry point.** The sync helper races.
2. **Server owns the clock.** Client never trusts `Date.now()` for
   cooldown — always `serverNowMs()` from the EMA-smoothed skew.
3. **`UNPAINTED_COLOR` MUST be distinct from every palette color.** The
   server's `internColor()` dedupes by exact color. If unpainted equals
   palette-white, both alias index 0 and clients render white as grey
   (or worse, black).
4. **300 addEntity/frame ceiling.** Mobile's entity allocator drops
   cells (blank-canvas regression) above ~300 allocations/frame under
   sustained load with CRDT replay in flight. Cell-spawn and CRDT-apply
   paths BOTH respect this and are gated to run sequentially (grey-fill
   waits until CRDT applyQueue is empty), so combined peak stays at
   300/frame. Never let two allocation sources overlap.
5. **Fresh `MaterialInfo` per `setPbrMaterial` call.** Do NOT cache and
   share the object. Mobile silently blanks the canvas if you do —
   the SDK/renderer references or mutates it internally.
6. **`applyQueue` cap = 300/frame + drainSpawnQueue gate.** Hydration
   bursts arrive as 100 tiles × up to 256 changed bytes each. Applying
   inline stalls mobile; the drain queue keeps per-frame allocation
   bounded. The grey-fill spawnQueue drain checks
   `paintHydrated && applyQueue.length === 0` before spawning anything
   — do not remove this gate.
7. **Splash sticky-settle uses a `hydrationFullySettled` latch.** The
   settle window only applies during initial hydration. After it
   drains once, live paints only gate on raw queue length — otherwise
   every pixel placed would re-open the splash for 2s.
8. **UI layers gate on `isSplashActive()`.** Otherwise UI bleeds
   through the splash on mobile before hydration completes.
9. **Feet, not cursor.** Placement follows the avatar; airborne is a
   no-op. The highlight cube IS the source of truth for `placeAtFeet()`
   — never re-resolve independently.
10. **Leaderboard publishes on a throttle, not per-paint.** Publishing
    on every `incrementPaint` scales badly with painter count.
11. **Never use `IA_POINTER` for a global action on mobile.** Every UI
    tap fires it — the bound action fires on every unrelated interaction.

---

## 8. Known future work

None of these are blocking; all are documented so the next session
knows what's shelved.

- **Graceful-shutdown save hook.** Up to 30s of pixels can be lost on
  server crash between flushes. Cheap fix if we care.
- **Chunked persistence.** Single blob works to ~100k cells. If we ever
  push past 32×32 pixels per tile (~100k+ total), migrate to per-tile
  Storage keys.
- **Pixel attribution.** Tap a pixel → "placed by Alice, 3 days ago".
  Requires per-cell metadata; would inflate CRDT payload significantly.
- **In-world snapshot display board.** Blocked on stable-URL hosting
  (Discord signs+expires). Needs a Cloudflare R2 / Vercel Blob decision.
- **Larger canvas.** Would require chunked persistence, an LOD
  strategy (texture-baked mip levels rather than per-cell planes at
  distance), and probably a paint-storm re-validation via
  `debugStorm.ts` (currently dormant but kept in the tree for exactly
  this use case).

---

## 9. Success criteria (met)

- ✅ Deployed to `dclplace.dcl.eth`, loads reliably on mobile
- ✅ 8-color canvas paints reliably with 1s server cooldown
- ✅ Bottom UI reachable one-handed
- ✅ Spectator top-down view works on touch
- ✅ Canvas persists across server restarts (single-blob Storage)
- ✅ Discord snapshot archive + timelapse video pipeline
- ✅ Top-20 leaderboard, all-time, throttle-published
- ✅ Splash + hydration gate that survives mobile network jitter
