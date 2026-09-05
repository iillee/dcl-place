# Plan — Solid-Floor Refactor

**Status:** proposed, scheduled for next week
**Owner:** luke (art) + agent (code)
**Estimated effort:** ~2 hours code + Blender remodel time
**Risk:** low (contained to client-side spawn path; server, CRDT, persistence, UI untouched)

---

## Problem

Playtest surfaced a visible bug on the deployed World: patches of the
canvas render as unpaintable "warmer white" tiles, visually distinct from
the `#EAEAEA` unpainted-cell grey. Friend on Android sent a screenshot
(`images/Screenshot_20260905-010352.png`) that made the two-shade pattern
obvious.

## Root cause

`src/client/paint.ts::spawnCellsForTile()` early-exits when the tile's
type is not present in the `MASKS` table:

```ts
const raw = MASKS[tileType as TileType]
if (!raw) return
```

The scene inherits a maze generator from a previous project
(`src/shared/maze/`, ~1,450 lines). It emits many tile types
(cross, corner, ramp, dead-end, wall variants). Only a subset have
paint-cell masks defined. Every tile whose type is missing from `MASKS`
gets **zero paint cells** — the raw GLB top surface shows through
forever. Because the seed is server-authoritative and CRDT-synced, the
pattern is identical on every client, desktop and mobile alike. The
Android screenshot just made it easier to notice via tone-mapping
contrast in overhead spectator view.

This is structural, not a load race. The bug has been latent since the
scene was scaffolded from the maze project.

## Why we're refactoring instead of patching MASKS

Adding masks for every emitted tile type (~30 min of copy-paste) would
fix the visible symptom but leaves in place:

- ~1,450 lines of maze code the scene does not need (dcl/place is a
  solid 320×320m square, not a maze)
- 400 individual GLB fetches on boot (one per tile), which is the actual
  cause of the "first-deploy CDN warmup" gotcha already documented in
  `HANDOFF.md`
- A per-round rebuild pipeline (`rebuildMaze`, teardown queue, reveal
  cascade) that has no reason to exist in a persistent canvas
- Complexity in the spawn path that will keep producing bugs of this
  shape

The maze → solid-grid refactor has been on the roadmap for two sessions.
This playtest gave us the real-world justification to prioritize it.

## Scope

### Art (luke)

Author `assets/models/floor.glb`:

- 320m × 320m single mesh, top surface at the same world Y as the
  current `tile-cross-full.glb` top (so paint cells don't shift
  vertically and existing painted pixels stay aligned).
- Origin at world (0, 0, 0) = SW corner of the canvas.
- Existing cross-tile border pattern baked into the texture, tiled
  20×20 across the mesh, so the visible grid is preserved.
- Walkable collider on the top face (`CL_PHYSICS`).

### Code (agent)

1. **Spawn the floor entity** — replace maze-driven tile spawning with
   a single `GltfContainer` pointing at `assets/models/floor.glb`, plus
   the collider.
2. **Deterministic paint-cell spawn loop** — iterate the logical 10×10
   (or whatever `PAINT_TILES_PER_AXIS` is) tile grid and call the paint-
   cell spawner directly for each tile, with a uniform mask (equivalent
   to `MASKS.cross`). Preserves the per-tile grouping (`paintByTile`)
   used by CRDT chunking.
3. **Delete the maze code** — `src/client/maze/rebuild.ts` and
   `src/shared/maze/` (generator, graph, rng, tiles). Rip out
   `SeedHolder`, `RoundReset`, `initMazeNet`, and the "center tile"
   preservation logic — none of it applies to a persistent canvas.
4. **Update composite** — `assets/scene/main.composite` if it declares
   any maze-related static entities.
5. **Preview + verify** — eyeball pixel alignment against a known-good
   region of the live canvas (e.g. the yellow "M" in the playtest
   screenshot) to confirm no drift.

### Untouched

Server, `PaintTile` CRDT, `paintGrid.ts` math, `paintState.ts`, canvas
Storage persistence, palette, cooldown, leaderboard, snapshot pipeline,
all UI. This is a pure client-side visual-and-spawn refactor.

## Justification recap

| Win | Concrete impact |
|---|---|
| Fixes the two-shade-white bug | Every cell in the canvas is paintable — no MASKS lookup miss possible. |
| Fixes first-deploy CDN warmup gotcha | 400 GLB fetches → 1. No warmup race for late clients. |
| Faster boot on mobile | One fetch, one mesh. |
| Deletes ~1,450 lines of legacy code | Less surface for future bugs. |
| Removes per-round rebuild machinery | Simplifies the client boot sequence and matches the "permanence is the pitch" design principle. |

## Non-goals

- Chunked canvas persistence (still gated on 100k-cell milestone).
- In-world snapshot display board (still blocked on stable-URL hosting).
- Any change to the paint / cooldown / leaderboard / snapshot systems.

## Rollback

If pixel alignment drifts or the collider is wrong, revert the commit.
Server state and CRDT are unaffected — the existing canvas re-hydrates
onto the old code path unchanged.

## Sequencing

1. Luke exports `assets/models/floor.glb` and confirms world origin +
   top-Y with agent.
2. Agent lands the code refactor in a single commit, previews locally
   against a fresh CRDT hydrate.
3. Deploy to `dclplace.dcl.eth`. Reload once, confirm on desktop and
   Android.
4. Post-deploy: delete the `models/tile-*.glb` files no longer
   referenced (separate cleanup commit so the refactor commit stays
   focused).

## References

- Screenshot: `images/Screenshot_20260905-010352.png`
- Bug location: `src/client/paint.ts:401` (`spawnCellsForTile` MASKS gate)
- Legacy code to delete: `src/client/maze/rebuild.ts`, `src/shared/maze/`
- Related HANDOFF items:
  - "First-deploy CDN warmup gotcha" (Day 6 session)
  - "Refactor maze → solid grid" (Next up #3)
