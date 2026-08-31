# dcl/place — Design Doc

> The eternal collaborative pixel canvas of Decentraland.
> Place one pixel every 10 seconds. Nothing ever resets.

**Repo:** https://github.com/iillee/dcl-place
**Hackathon:** Friendzone Mobile Buildathon
**Submission deadline:** September 7, 2026 (~10 day build)
**World target:** `dcl-place.dcl.eth` (TBD)

---

## 1. Concept

A mobile-first Decentraland re-imagining of Reddit's r/place. A single, giant,
walkable pixel canvas that lives in a 10×10 parcel Decentraland World and
**never resets**. Every visitor can place one pixel every 10 seconds. Pixels
placed today may still be there in a year. Tribes form, defend territory,
alliances rise and fall — the whole social drama of r/place, but persistent
and native to a 3D social world.

### Why this fits the Friendzone brief

| Judging criterion | Why dcl/place wins on it |
|---|---|
| **Mobile-first** | Tap-to-place is *better* on touch than mouse. 16-color palette + one paint button = zero desktop-only affordances. |
| **Social value** | Cooperation and rivalry are the whole game. Zero content without other people. |
| **Retention** | 10-second cooldown = come back later, always. Permanent canvas = come back next month to see if your pixel survived. |
| **Invite friends** | "Help us defend our corner" is one of the most viral mechanics ever. |
| **Persistent standalone** | No host, no schedule, no scripted event needed. The canvas is the experience. |
| **Originality** | *"The permanent collaborative canvas of Decentraland."* Nothing like it exists in DCL. |
| **Discovery** | Auto-exported JPG snapshots turn the canvas into shareable off-platform content. |

---

## 2. Scale & world layout

### Physical

- **Scene:** 10 × 10 parcels = **160 m × 160 m** flat walkable floor
- **Base parcel:** `0,0`
- **Spawn:** center of the canvas, `(80, 1, 80)`
- **World deployment:** Decentraland World (not Genesis City)

### Canvas resolution

Using the ported `dcl-canvas` maze tile system:

| Setting | Value |
|---|---|
| `MAZE_TILE_WORLD_METERS` | 16 (one parcel per tile) |
| `MAZE_GRID_WIDTH` × `HEIGHT` | 10 × 10 tiles |
| `PAINT_CELLS_PER_TILE_AXIS` | 16 |
| `PAINT_CELL_SIZE_METERS` | **1 m** per pixel |
| **Total canvas** | **160 × 160 = 25,600 pixels** |
| `MAZE_MAX_STACK_Y_METERS` | 0 (flat — no ramps) |

Sparse CRDT: only painted cells cost anything.

---

## 3. Core gameplay loop

1. Player enters the World, sees the giant canvas + a small seed square at center
2. Player picks a color from a 16-swatch picker at the bottom of the screen
3. Player taps a pixel on the canvas floor
4. Server validates cooldown → paints the pixel → broadcasts via CRDT
5. Paint button locks with a **10-second radial cooldown ring**
6. Player wanders, chats, watches others paint, or opens spectator top-down cam
7. Ring empties → player places another pixel
8. Repeat forever. Nothing ever resets.

### Cooldown

- **v1:** 10 seconds (dev/playtest)
- **Launch:** likely 30s–60s once the crowd shows up
- Enforced **server-side** using `Date.now()` per wallet address (in-memory map)
- Client renders an optimistic ring from the last `cooldownAck.nextAllowedAt`

---

## 4. UI — mobile-first from frame one

Modeled on snowdrift's bottom UI row (proven touch-target sizing / thumb zone).

### Persistent bottom bar

| Slot | Control |
|---|---|
| Left | 🎨 Color picker (opens 4×4 swatch grid modal) |
| Center | Big **PAINT** button with radial cooldown fill |
| Right | 👁️ Spectator toggle · 🎵 Music · ❓ Help |

### Modals

- **Color picker:** 4×4 grid, 16 swatches, large tap targets, selected swatch highlighted
- **Help:** first-time onboarding + rules
- **Leaderboard:** top 100 pixel-placers all-time
- **Snapshot:** current canvas JPG preview + share/download

### Text & touch targets

- Minimum 44 px tap targets
- Body font ≥ 16 px
- Everything reachable with one thumb

---

## 5. The Twist(s)

Since **permanence itself** is the concept, twists amplify permanence rather
than fight it.

### v1 (in scope for hackathon)

- **Auto-snapshot pipeline** — canvas exports to JPG at intervals for:
  - In-world display board (a giant framed preview near spawn)
  - Web endpoint (linkable from social)
  - Shareable download from the snapshot modal
- **All-time leaderboard** — top 100 pixel placers, persisted, viral hook

### v2 (deferred, but designed for)

- **Pixel attribution** — tap any pixel → "placed by Alice, 3 days ago" → walk to Alice. Turns the canvas into a social discovery surface.
- **Milestone gallery** — the canvas's history displayed as a walk-through timeline of past snapshots.

---

## 6. Architecture

### Codebase branching

```
src/
├── index.ts              # isServer() branch (uses async ~system/EngineApi)
├── shared/               # loaded by BOTH sides
│   ├── messages.ts       # registerMessages() — schemas
│   ├── components.ts     # PaintCell, PaletteEntry, PaintCoverage, etc.
│   ├── palette.ts        # 16-color r/place palette
│   ├── settings.ts       # scene size, cooldown, resolution
│   ├── paintGrid.ts      # cellId <-> world coord math
│   ├── paintSync.ts      # syncEntity wiring (server-only writes)
│   ├── maze/             # tile/level generation (ported verbatim)
│   └── ...
├── server/               # isServer() === true
│   ├── server.ts         # entry, message handlers, cooldown map
│   ├── paintState.ts     # authoritative cell map + palette interning
│   ├── leaderboard.ts    # top-100 pixel counts, Storage-persisted
│   ├── serverStats.ts    # heartbeat + component-change metrics
│   └── discord.ts        # optional join notifications
└── client/               # isServer() === false
    ├── index.ts          # client boot orchestrator
    ├── maze/             # tile mesh rebuild
    ├── paint.ts          # tap-to-place handler → placePixel
    ├── paintSnapshot.ts  # JPG export
    ├── topDownCamera.ts  # spectator cam
    ├── ui/               # React-ECS UI
    └── ...
```

### Server / client contract

**Message set** (see `src/shared/messages.ts`):

Client → Server:
- `joinRoster { userId }` — boot handshake (team stubbed to None)
- `placePixel { cellId, paletteIndex }` — the whole game
- `updateName { name }` — for leaderboard display
- `requestLeaderboard {}` — refresh top-100

Server → Client:
- `teamAssigned { team }` — always Team.None in dcl/place (legacy shape)
- `cooldownAck { accepted, nextAllowedAt, serverNow }` — clock-truthful cooldown
- Leaderboard + coverage delivered via CRDT sync (not messages)

**State sync** (via `syncEntity`):
- `PaintCell` — one component per painted cell, sparse, index = palette slot
- `PaletteEntry` — 16 slots seeded at boot (indexes 1–16) + reserved 0 for None
- `PaintCoverage` — total painted-count, throttled to 5 Hz
- `LeaderboardState` — top 100, published on request

### Persistence

**v1 (scoped for hackathon):**
- Leaderboard persisted to `Storage` (world-level), flushed every 30 s
- Canvas cells **NOT** persisted — reset when server sleeps (~2 min after last player)

**v2 (Day 8 milestone if time allows):**
- Chunked canvas storage:
  - Key: `canvas_v1_chunk_{cx}_{cz}` (16×16 pixel region)
  - Value: base64-packed byte array of palette indexes (~256 bytes/chunk)
  - Total: ~100 chunks for full canvas, ~35 KB
- Dirty-set + retry pattern per official Multiplayer Server docs
- Meta key `canvas_v1_meta` — `{ version, width, height, totalPainted, lastFlush }`

### Anti-cheat

- All paint writes routed through `placePixel` → server-side cooldown check
- `PaintCell` `validateBeforeChange` locks CRDT writes to `AUTH_SERVER_PEER_ID` (TODO)
- Rate-limit: one cell per `placePixel` message enforced by server (`PAINT_TICK_MAX_CELLS = 1`)
- Legacy `paintTick` (from canvas brush system) explicitly ignored server-side

---

## 7. What was reused from prior projects

**From `dcl-canvas`** (the tile-painting research project):
- Entire maze/tile generation system
- `PaintCell` sparse CRDT architecture
- Palette interning (Color4 → byte index)
- `paintSync.ts` server-authoritative sync wiring
- Snapshot export (`paintSnapshot.ts` → JPG)
- Top-down spectator camera
- React-ECS UI theme + layer system

**From `dcl-snowdrift`** (the previous social scene):
- Mobile touch control patterns
- Bottom UI button layout / thumb zone conventions
- Help modal, music toggle patterns

**New for dcl/place:**
- 16-color palette (replaces 2-team palette)
- `placePixel` message + server cooldown enforcement
- Tap-to-place client (replaces brush-streaming)
- Color picker UI
- Cooldown ring UI
- Eternal-canvas architecture (no round reset)

---

## 8. 10-day build plan

| Day | Milestone |
|---|---|
| 1 | ✅ Scaffold on `@dcl/sdk@auth-server`, port canvas systems, expand palette to 16, new server `placePixel` + cooldown, project builds clean |
| 2 | Client tap-to-place → `placePixel`, one hardcoded color, verify end-to-end paint through server |
| 3 | Color picker UI (mobile), cooldown ring UI, paint button |
| 4 | Port spectator cam / help / music from snowdrift, touch-control polish |
| 5 | Leaderboard (top 100 all-time) + Storage persistence for leaderboard |
| 6 | Snapshot pipeline: JPG export → in-world board + web endpoint |
| 7 | First mobile playtest, tune cooldown/palette |
| 8 | Canvas persistence (chunked Storage) — makes the canvas truly eternal |
| 9 | Deploy to World, playtest, polish |
| 10 | README, DoraHacks submission, demo video |

---

## 9. Open questions / decisions to revisit

- [ ] Final cooldown at launch — 10s (playtest) → 30s or 60s?
- [ ] Should the snapshot export interval be time-based (every N min) or event-based (every N pixels)?
- [ ] Are pixels attributable (v2 twist), or fully anonymous?
- [ ] Do we want a spawn-adjacent "welcome sign" / tutorial area, or straight into the canvas?
- [ ] Music track selection — same ambient bed as snowdrift, or something new?
- [ ] Should the 10s cooldown be a server env var (`PAINT_COOLDOWN_MS`) for live tuning?

---

## 10. Success criteria

Minimum for a shippable submission:

- Deployed World that loads on mobile in < 20s
- 16-color canvas that paints reliably with server cooldown
- Bottom UI reachable + usable one-handed
- Spectator top-down view works on touch
- Snapshot export produces a shareable JPG
- Leaderboard survives server restart

Stretch:

- Chunked canvas persistence (truly eternal, survives server sleep)
- In-world snapshot board
- Web endpoint for the live canvas JPG
- Pixel attribution ("who painted this?")
