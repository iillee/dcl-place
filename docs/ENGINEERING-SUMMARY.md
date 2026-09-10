# dcl/place — GDD Summary

A human-readable summary of [`DESIGN.md`](./DESIGN.md), for review.

---

## 🎯 The Pitch

**dcl/place** is a mobile-first Decentraland reimagining of Reddit's r/place:
a single giant walkable pixel canvas, shared by every visitor, that
**persists forever**. No rounds. No wipes. Pixels placed today may still be
there in a year.

- **Live:** [`dclplace.dcl.eth`](https://decentraland.org/play/?realm=dclplace.dcl.eth)
- **Origin:** Friendzone Mobile Buildathon (submission Sep 7, 2026)
- **Ethos:** the social drama of r/place — tribes, alliances, defended
  territory — native to a 3D social world.

---

## 🕹️ Core Loop

1. Player enters the World → splash overlay hides load while the canvas hydrates.
2. Splash clears → player drops into an **overhead spectator view** with the
   help panel open. One tap dismisses it.
3. Player walks onto the canvas. A colored **highlight cube** appears under
   their feet, previewing the pending placement.
4. Player picks a color from the **8-swatch palette** at the bottom.
5. Player taps the **paint button** (or presses **F** on desktop) →
   `placePixel` sent to server.
6. Server validates a **1-second cooldown** per wallet → writes the pixel →
   acks the client.
7. On the next server tick, the change is broadcast via CRDT → every client
   diffs and recolors only the changed cells.
8. Server flushes the canvas to persistent Storage every 30s.

---

## 📐 The Scene

| Property | Value |
|---|---|
| Parcels | 20 × 20 (400) |
| Footprint | 320 m × 320 m |
| Canvas resolution | 320 × 320 pixels (1 m per pixel) |
| Paintable cells | ~25,444 |
| Palette | 8 colors (blue, red, yellow, green, purple, orange, white, black) |
| Cooldown | 1 second per wallet, server-enforced |
| Spawn | dead-center at (160, 2, 160) |
| SDK | `@dcl/sdk@auth-server` (authoritative multiplayer) |

The floor is **one single GLB** (`tile_floor.glb`) — one draw call for the
whole canvas. Individual pixels are spawned as small plane entities on top.

---

## 📱 Why It Works On Mobile

| Feature | Mobile benefit |
|---|---|
| Tap-to-place | One gesture. No drag. Thumb-friendly. |
| 8-color palette | Fits comfortably in a single bottom row. |
| 1-second cooldown | Every input is deliberate — no accidental scribbling. |
| Feet-based placement | Player walks to position the pixel. No cursor needed. |
| Nothing to do alone | Social by construction — the canvas grows when people show up. |

---

## 🖥️ UI Layout

### Bottom bar (both platforms)
Single row: 8 color swatches + inline paint button.

- Paint button uses a **fuel-fill pattern** — the fill grows left-to-right
  as the cooldown recharges. "Fully filled" = ready to paint.
- Selected swatch has a contrasting ring.
- Denied taps flash the button border **red** so failures aren't silent.

### Top bar (desktop only)
Four buttons: **Spectator** · **Mute** · **★ Leaderboard** · **? Help**.
Leaderboard and help panels slide down from the top; opening one closes
the other.

### Mobile
Top bar is hidden. The native on-screen buttons (jump, E, F, etc.) are
**re-skinned** to become: spectator toggle (eye), mute (E slot),
leaderboard (F slot / ★), help (?).

### Desktop hotkeys
`F` paint · `E` cycle color · `1` spectator · `2` mute · `3` leaderboard · `4` help

---

## 🏗️ Architecture (High Level)

A single codebase runs on both the client and the server, branched at
startup by an async `isServer()` check.

```
src/
├── shared/    — code & types loaded by BOTH sides (messages, palette, grid math)
├── server/    — canvas state, cooldown, persistence, leaderboard, Discord uploads
└── client/    — rendering, input, HUD, spectator camera, audio
```

### Key contracts
- **Client → Server:** `placePixel`, `joinRoster`, `updateName`, `requestLeaderboard`
- **Server → Client:** `cooldownAck` (carries server time so clients don't trust their own clocks)
- **CRDT sync (server writes only):** `PaintTile` (256 bytes per 16×16 tile), palette, coverage, leaderboard

The canvas is chunked into **100 tiles of 16×16 pixels**. Each tile
CRDT-syncs as a single packed byte array — very network-efficient.

---

## 💾 Persistence & Archive

- **Canvas** is saved to Storage every 30 seconds as one compact blob.
  On server restart, the canvas is fully rehydrated before the first
  client connects — nobody ever sees a blank canvas.
- **Leaderboard** — top 100 all-time paint counts, persisted, published
  at most once per second.
- **Discord snapshot pipeline** — the server encodes the canvas as a
  PNG every 5 minutes and posts it to a Discord webhook. That channel
  *is* the timelapse archive.
- **Timelapse video** — a Node script (`scripts/download-timelapse.mjs`)
  scrapes the channel and stitches frames into an MP4 with ffmpeg.

---

## ⚠️ Design Invariants (Load-Bearing Rules)

These are the sharp edges. Break one and the scene breaks:

1. Use the **async** `isServer()` at boot — the sync version races.
2. The **server owns the clock**. Client cooldown math uses server-provided
   time, EMA-smoothed to survive mobile jitter.
3. The unpainted grey (`#EAEAEA`) must be **distinct from every palette
   color** — else color interning aliases white to grey.
4. **Never exceed 300 entity allocations per frame** on mobile. Cell
   spawning and CRDT paint application are gated to run *sequentially*
   (never overlap).
5. Always allocate a **fresh `MaterialInfo`** per `setPbrMaterial` call —
   sharing objects silently blanks the canvas on mobile.
6. UI layers must **gate on splash state** or they bleed through on mobile.
7. **Feet, not cursor.** Placement follows the avatar. The highlight cube
   is the single source of truth — never re-resolve independently.
8. **Never bind a global action to `IA_POINTER` on mobile** — every UI tap
   fires it.

---

## ✅ Shipped

- Deployed to `dclplace.dcl.eth`, loads reliably on mobile
- 8-color paint with 1s server-enforced cooldown
- One-handed mobile UI
- Top-down spectator view with touch pan/zoom
- Canvas persists across server restarts
- Discord snapshot archive + timelapse video pipeline
- Top-20 leaderboard, all-time
- Splash & hydration gate that survives mobile network jitter
- Dual-realm deploy setup (World + Genesis estate, one codebase)

---

## 🚧 Known Future Work

Non-blocking, all documented:

- Graceful-shutdown save hook (up to 30s of pixels lost on server crash)
- Chunked persistence (needed only if canvas grows past ~100k cells)
- Per-pixel attribution ("placed by Alice, 3 days ago")
- In-world snapshot display board (blocked on stable image hosting)
- Larger canvas (needs LOD strategy + paint-storm re-test)
