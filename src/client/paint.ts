// Squareoff paint grid. Phase 1 scaffolding — single-player, single-team for now.
// Design doc: assets/docs/SQUAREOFF-DESIGN.md
// Constants from settings / maze; tile grid Map passed in via init().

import { engine, Transform, MeshRenderer, MeshCollider, Material, Entity, NetworkEntity, Tween, EasingFunction, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

import { PaintCell, PaletteEntry, PaintCoverage } from 'src/shared/components'
import {
	HI,
	LO,
	MASKS,
	Mask,
	SIZE,
	cellId as sharedCellId,
	rotateMask as sharedRotateMask,
} from 'src/shared/maze/graph'
import { TileType } from 'src/shared/maze/tiles'
import { cellIdToKey, cellKeyFromNetworkId, cellKeyToCellId } from 'src/shared/paintGrid'
import {
	TEAM_COLORS,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	teamPaletteIndex,
} from 'src/shared/palette'
import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_GLTF_SCALE,
	PAINT_CELL_SIZE_METERS,

} from 'src/shared/settings'
import { Team } from 'src/shared/team'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

// Re-export shared symbols so existing paint consumers don't need to
// change their import paths.
export { MASKS, type Mask }

import { playClaimSfx } from 'src/client/audio'
import { getBrushCells } from 'src/client/brush'

// Team enum lives in shared/; re-exported for existing `import { Team } from 'src/client/paint'` call sites.
export { Team } from 'src/shared/team'

// Palette colors from PaletteEntry CRDT. Seeded with the same team colors
// the server writes so materials resolve as soon as PaintCell indexes land.
const paletteByIndex = new Map<number, Color4>([
	[PALETTE_NONE, TEAM_COLORS[Team.None]],
	[PALETTE_RED,  TEAM_COLORS[Team.Red]],
	[PALETTE_BLUE, TEAM_COLORS[Team.Blue]],
])

// Last PaintCell index seen from CRDT (authoritative reconcile).
const cellApplied = new Map<number, number>()
// cellId → last rendered palette index (optimistic local and/or CRDT).
const renderedIndex = new Map<string, number>()

// Set on teamAssigned. Optimistic paint is skipped until then.
let localTeam: Team = Team.None


// MARK: setLocalTeam
/**
 * Override the local team used for optimistic paint. Note: the server
 * still attributes paintTick messages to the player's assigned roster
 * team, so this only affects the local preview colour — CRDT reconcile
 * will overwrite each cell to the server-authoritative colour.
 */
export function setLocalTeam(team: Team): void {
	localTeam = team
}


// MARK: getLocalTeam
export function getLocalTeam(): Team {
	return localTeam
}


// MARK: initPaintNet

/**
 * Observe PaintCell / PaletteEntry CRDT. Local brush also paints
 * optimistically; CRDT reconcile uses cellApplied so stale replicas do
 * not flash over our pending colour until the server index changes.
 */
// Delay CRDT-driven paint on load so old paint from previous sessions
// doesn't pop in as a coloured block before the player has even moved.
// Palette entries still sync immediately (they only touch materials).
const CRDT_PAINT_START_DELAY_MS = 3000
let   crdtPaintElapsedMs        = 0

export function initPaintNet(): void {
	eventBus.on(ClientEvents.TeamAssigned, ({ team }) => {
		localTeam = team
	})
	eventBus.on(ClientEvents.RoundReset, () => {
		clearAllPaintState()
	})

	engine.addSystem((dt: number) => {
		syncPaletteFromCrdt()
		if (crdtPaintElapsedMs < CRDT_PAINT_START_DELAY_MS) {
			crdtPaintElapsedMs += dt * 1000
			// Still track cellApplied so post-delay we don't re-drive cells
			// that arrived during the blackout window — they'll appear when
			// the server sends the NEXT update for those cells.
			for (const [entity, cell] of engine.getEntitiesWith(PaintCell)) {
				const net = NetworkEntity.getOrNull(entity)
				if (!net) continue
				const key = cellKeyFromNetworkId(Number(net.entityId))
				if (key === null) continue
				cellApplied.set(key, cell.index)
			}
			return
		}
		syncCellsFromCrdt()
	})
}


// MARK: syncPaletteFromCrdt

function syncPaletteFromCrdt(): void {
	for (const [_entity, entry] of engine.getEntitiesWith(PaletteEntry)) {
		if (entry.index > PALETTE_BLUE && entry.color.a === 0) continue
		const prev = paletteByIndex.get(entry.index)
		if (prev &&
			prev.r === entry.color.r && prev.g === entry.color.g &&
			prev.b === entry.color.b && prev.a === entry.color.a) {
			continue
		}
		paletteByIndex.set(entry.index, Color4.create(
			entry.color.r, entry.color.g, entry.color.b, entry.color.a,
		))
		for (const [id, idx] of renderedIndex) {
			if (idx === entry.index) applyPaintIndex(id, idx, true)
		}
	}
}


// MARK: syncCellsFromCrdt

function syncCellsFromCrdt(): void {
	for (const [entity, cell] of engine.getEntitiesWith(PaintCell)) {
		const net = NetworkEntity.getOrNull(entity)
		if (!net) continue
		const key = cellKeyFromNetworkId(Number(net.entityId))
		if (key === null) continue
		if (cellApplied.get(key) === cell.index) continue
		cellApplied.set(key, cell.index)
		applyPaintIndex(cellKeyToCellId(key), cell.index, false)
	}
}

// MARK: mask & tile-topology imports
//
// Masks, SIZE/LO/HI, cellId, and rotateMask now live in shared/maze/graph
// (single source of truth used by paint spawning AND bot pathfinding).
// Only paint-specific derivations — mesh spawn helpers, ramp geometry
// with cosA/sinA needed by tile transforms — remain here.

// GLB floor is 0.25 local (0.5m world) above the tile origin. Sit paint cells
// 0.26 local (0.52m world) above origin → 0.02m world above the walkable surface.
export const FLAT_OFFSET = 0.275 * MAZE_TILE_GLTF_SCALE // clears floor + tilted-cell edge sag

/**
 * Flat landing length at each end of a ramp, in world meters.
 * Must match tile-ramp.glb (1.0 local × MAZE_TILE_GLTF_SCALE). Do NOT derive
 * this from paint cell size — when SIZE went 16→32, a 1-cell landing shrank
 * from 2m to 1m and the incline math buried the upper half of the slope.
 */
const RAMP_FLAT_END_METERS = 1.0 * MAZE_TILE_GLTF_SCALE

// Ramp geometry derived from CELL and STEP. Same math used by spawn and lookup
// so cellIds agree.
function rampGeometry(CELL: number, STEP: number) {
	const cellSize     = CELL / SIZE
	const flatLen      = RAMP_FLAT_END_METERS
	const nFlat        = Math.max(1, Math.round(flatLen / cellSize))
	const inclineStart = flatLen
	const inclineEnd   = CELL - flatLen
	const inclineLen   = inclineEnd - inclineStart
	const slopeLen     = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
	// Cap incline row count so total rows (nFlat + nIncline + nFlat) fits within
	// SIZE. Otherwise the top landing row's cellId row-index >= SIZE, which
	// cellIdToKey() rejects — the mesh spawns but never receives paint.
	const nInclineIdeal = Math.round(slopeLen / cellSize)
	const nInclineMax   = SIZE - 2 * nFlat
	const nIncline      = Math.min(nInclineIdeal, nInclineMax)
	const slopeCellSize = slopeLen / nIncline
	const cosA         = inclineLen / slopeLen
	const sinA         = STEP / slopeLen
	return {
		cellSize, flatLen, nFlat,
		inclineStart, inclineEnd, inclineLen,
		slopeLen, nIncline, slopeCellSize, cosA, sinA,
	}
}

// Given canonical (lx, lz) on a ramp, return the cell (col, row) used in
// cellId. Returns null if outside the walkable corridor.
function rampCellIdxFromCanonical(lx: number, lz: number, geom: ReturnType<typeof rampGeometry>): { col: number; row: number } | null {
	const col = Math.floor(lx / geom.cellSize)
	if (col < LO || col >= HI) return null
	let row: number
	if (lz < geom.inclineStart) {
		row = Math.floor(lz / geom.cellSize)
	} else if (lz >= geom.inclineEnd) {
		row = geom.nFlat + geom.nIncline + Math.floor((lz - geom.inclineEnd) / geom.cellSize)
	} else {
		const slopeDist = (lz - geom.inclineStart) / geom.cosA
		row = geom.nFlat + Math.floor(slopeDist / geom.slopeCellSize)
	}
	return { col, row }
}

// MARK: Cell store
// Mesh entities for walkable cells. Paint color comes only from PaintCell CRDT.
// Non-ramp cells spawn as white cubes and tween down to a flat colored slab
// on first paint. Ramp cells stay as tilted planes (kind='plane').
type CellKind = 'cube' | 'plane'
type CellData = {
	entity:   Entity
	kind:     CellKind
	basePos:  Vector3 // world position of the flat state (also the cube's bottom-face center Y)
	cellSize: number
}
const cellEntity  = new Map<string, Entity>()
const cellData    = new Map<string, CellData>()
const paintByTile = new Map<Entity, { entities: Entity[]; ids: string[] }>()

// Cube geometry + extrude-tween settings.
// Extruder mode: painted cells RISE from a flat grey slab into a tall
// colored collidable cube that pushes the player upward.
const CUBE_HEIGHT       = 2.0
const FLAT_THICKNESS    = 0.02
const RISE_DURATION_MS  = 80
const DECAY_DELAY_MS    = 10000 // painted cube visually reverts to flat grey after this
// Temporary switch: when false, pillars never decay back to flat — useful
// while iterating on the extrude / jump-follow feel without cells vanishing.
const DECAY_ENABLED     = false
// Extrusion shape around the brush footprint:
//   • Cells INSIDE the brush all rise to full CUBE_HEIGHT (flat plateau).
//   • Beyond the brush edge we add TAPER_RINGS outer rings that step down
//     in height, giving a staircase / ziggurat silhouette that also acts
//     as a ramp so the player walks up onto the plateau.
// Ring N (1 = closest to plateau) height = CUBE_HEIGHT * TAPER_STEP_HEIGHTS[N-1].
// Base scale (fraction of CUBE_HEIGHT) that plateau cells rise to on a
// regular walking pass. Kept minimal so walking on the ground doesn't
// push the player up over their own paint — tapers derive from this too
// (see TAPER_RATIOS_OF_PLATEAU below), so a low base means tapers are
// essentially flush with the ground. Jump-follow overrides this per-frame
// while the player is airborne, giving the real extrusion effect.
const PLATEAU_BASE_SCALE = 0.05 // ~10cm painted slab, no trip hazard
// Taper ring heights, expressed as a FRACTION OF THE PLATEAU (not of
// CUBE_HEIGHT). This lets tapers scale up in lockstep with the plateau
// when jump-follow lifts it — keeping the ramp silhouette intact at any
// altitude instead of pinning tapers to a tiny fraction of a jumped-up
// pillar.
const TAPER_RATIOS_OF_PLATEAU = [0.66, 0.33] as const
const TAPER_RINGS             = TAPER_RATIOS_OF_PLATEAU.length
// Stacking: while a painted cell sits in the brush footprint we bump it up
// by STACK_BUMP scale every STACK_INTERVAL_MS. This gives visible, chunky
// growth for both standing-still and walking-over-existing-paint cases,
// capped at MAX_STACK_SCALE * CUBE_HEIGHT.
const MAX_STACK_SCALE   = 50   // effectively uncapped (100m tall) while iterating
const STACK_BUMP        = 0.5  // +1m per bump
const STACK_INTERVAL_MS = 500  // one bump every 0.5s while cell stays in brush

// White material for the unpainted flat slab (independent of PALETTE_NONE so
// resetting the palette does not affect the slab colour). Historical name
// kept as CUBE_GREY_MAT to minimise churn across call sites.
const CUBE_GREY_MAT = cellMaterialFromColor(Color4.create(1, 1, 1, 1))

// Thin black wireframe cage rendered on every extruded cube — 12 edge boxes
// (4 top, 4 bottom, 4 vertical) sized to hug the cube's current dimensions.
// Same pattern as the brush-lift overlays on `main`.
const EDGE_THICKNESS  = 0.02
const EDGE_MATERIAL   = cellMaterialFromColor(Color4.Black())
const cellEdges       = new Map<string, Entity[]>()

// Entity pool for edge boxes. Creating/destroying edge entities each time
// a cell paints or decays churns the engine's entity allocator and hits
// per-parcel entity limits fast. Instead we retain freed edges in a pool
// (hidden by zero scale) and hand them back out to the next painted cell.
const edgePool: Entity[] = []
const HIDDEN_SCALE = Vector3.create(0, 0, 0)

// MARK: acquireEdge
function acquireEdge(): Entity {
	const reused = edgePool.pop()
	if (reused !== undefined) return reused
	const e = engine.addEntity()
	MeshRenderer.setBox(e)
	Material.setPbrMaterial(e, EDGE_MATERIAL)
	return e
}

// MARK: prewarmEdgePool
// Amortise entity allocation by creating N edges per frame in the
// background until the pool reaches EDGE_POOL_TARGET. Prevents the
// first painted plateau from having to allocate 200+ entities in a
// single frame, which shows up as a visible hitch on the ground.
const EDGE_POOL_TARGET       = 600  // ~75 painted cells' worth of cages
const EDGE_POOL_PER_FRAME    = 32   // fills in ~20 frames (~0.3s @ 60fps)
let   edgePoolPrewarmDone    = false
function startEdgePoolPrewarm(): void {
	if (edgePoolPrewarmDone) return
	engine.addSystem(() => {
		if (edgePool.length >= EDGE_POOL_TARGET) {
			edgePoolPrewarmDone = true
			return
		}
		for (let i = 0; i < EDGE_POOL_PER_FRAME && edgePool.length < EDGE_POOL_TARGET; i++) {
			const e = engine.addEntity()
			MeshRenderer.setBox(e)
			Material.setPbrMaterial(e, EDGE_MATERIAL)
			const t = Transform.getMutableOrNull(e)
			if (t) t.scale = HIDDEN_SCALE
			else    Transform.create(e, { scale: HIDDEN_SCALE })
			edgePool.push(e)
		}
	})
}

// MARK: releaseEdge
// Hide (scale=0) and return the entity to the pool for later reuse.
function releaseEdge(e: Entity): void {
	const t = Transform.getMutableOrNull(e)
	if (t) t.scale = HIDDEN_SCALE
	edgePool.push(e)
}

type DropAnim = {
	startY:      number
	endY:        number
	startScaleY: number
	endScaleY:   number
	elapsedMs:   number
	durationMs:  number
	// Material to swap in once the tween completes (null = no swap).
	finalMat:    ReturnType<typeof cellMaterialFromColor> | null
}
const dropAnims = new Map<string, DropAnim>()

// Wall-clock (ms since engine start) at which each painted cube should
// decay back to grey. Cleared when the cube is already grey.
const decayAt   = new Map<string, number>()
// Current target height scale (0..1 of CUBE_HEIGHT) for each painted cube.
// Used by applyPaintIndex to detect "re-drive to a new height" as the player
// moves and a cell's position in the gradient changes.
const cellHeightScale = new Map<string, number>()
// paintClockMs timestamp of the last stack-bump applied to each cell.
// Used to throttle stacking so bumps occur at most every STACK_INTERVAL_MS
// regardless of framerate.
const lastStackBumpAt = new Map<string, number>()
let   paintClockMs = 0

engine.addSystem((dt: number) => {
	paintClockMs += dt * 1000

	// Rise / fall tweens.
	if (dropAnims.size > 0) {
		const dtMs = dt * 1000
		for (const [id, anim] of dropAnims) {
			anim.elapsedMs += dtMs
			const raw = Math.min(1, anim.elapsedMs / anim.durationMs)
			const k   = 1 - Math.pow(1 - raw, 3) // easeOutCubic
			const data = cellData.get(id)
			if (!data) { dropAnims.delete(id); continue }
			const y  = anim.startY      + (anim.endY      - anim.startY)      * k
			const sy = anim.startScaleY + (anim.endScaleY - anim.startScaleY) * k
			const tr = Transform.getMutableOrNull(data.entity)
			if (!tr) { dropAnims.delete(id); continue }
			tr.position = Vector3.create(data.basePos.x, y, data.basePos.z)
			tr.scale    = Vector3.create(data.cellSize, sy, data.cellSize)
			// Only reposition edges that already exist — don't lazy-build them
			// during a fall-back tween (unpainted cubes have no cage).
			if (cellEdges.has(id)) updateEdges(id, data.basePos, sy, data.cellSize)
			if (raw >= 1) {
				if (anim.finalMat) Material.setPbrMaterial(data.entity, anim.finalMat)
				dropAnims.delete(id)
			}
		}
	}

	// Paint decay. Purely visual: cube falls back to flat grey but the server
	// still owns the authoritative paint state, so re-painting works.
	if (DECAY_ENABLED && decayAt.size > 0) {
		for (const [id, dueMs] of decayAt) {
			if (paintClockMs < dueMs) continue
			decayAt.delete(id)
			// Purely visual decay: keep cellApplied at the server-authoritative
			// painted index (so syncCellsFromCrdt does NOT re-drive us straight
			// back down next frame), but clear renderedIndex so a fresh local
			// paint (player walks over it again) can re-trigger the drop.
			renderedIndex.delete(id)
			applyPaintIndex(id, PALETTE_NONE, true)
		}
	}
})

// Re-export shared cellId + rotateMask under the original paint.ts names
// so existing callers keep working during migration.
export const cellId = sharedCellId
export const rotateMask = sharedRotateMask

// Matte PBR material. Roughness=1 + metallic=0 + no specular kills the shine
// so paint reads as flat pigment, not plastic. Shared by palette index once
// the Color4 is known.
function cellMaterialFromColor(color: Color4) {
	return {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	}
}

function cellMaterialForIndex(index: number): ReturnType<typeof cellMaterialFromColor> | null {
	const color = paletteByIndex.get(index)
	if (!color) return null
	return cellMaterialFromColor(color)
}

// MARK: Deferred spawn
// Paint cells are held back until the tile's grow-in tween finishes so the
// GLB is fully visible before its grid appears. All entries use the same
// delay, so the queue naturally stays FIFO-ordered by dueMs.
const SPAWN_DELAY_MS = 500 // matches spawnTileWithGrow's tween duration
const deferredSpawns: Array<{ dueMs: number; run: () => void }> = []
let spawnClockMs = 0
engine.addSystem((dt: number) => {
  spawnClockMs += dt * 1000
  while (deferredSpawns.length && deferredSpawns[0].dueMs <= spawnClockMs) {
    deferredSpawns.shift()!.run()
  }
})

// Wipe scoring state immediately (so coverage % snaps to 0) without touching
// entities. Actual paint entity removal is driven per-tile by
// removePaintForTile() during the chunked tile teardown — that way paint
// disappears in the same frame as its tile, avoiding ghost cells, while
// the total ~30k removeEntity() cost is spread across several frames.
export function clearAllPaintState() {
	cellApplied.clear()
	renderedIndex.clear()
	paintOutbox.clear()
}

export function removePaintForTile(tileEntity: Entity) {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (const e of rec.entities) engine.removeEntity(e)
	for (const id of rec.ids) {
		cellEntity.delete(id)
		cellData.delete(id)
		dropAnims.delete(id)
		decayAt.delete(id)
		cellHeightScale.delete(id)
		lastStackBumpAt.delete(id)
		destroyEdges(id)
		renderedIndex.delete(id)
		const key = cellIdToKey(id)
		if (key !== null) cellApplied.delete(key)
	}
	paintByTile.delete(tileEntity)
}

/**
 * Reset paint visuals on a tile without destroying meshes (center cross
 * at round boundary). Authoritative clear comes from server PaintCell writes.
 */
export function resetPaintForTile(tileEntity: Entity) {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (let i = 0; i < rec.entities.length; i++) {
		const id = rec.ids[i]
		renderedIndex.set(id, PALETTE_NONE)
		const key = cellIdToKey(id)
		if (key !== null) cellApplied.set(key, PALETTE_NONE)
		// Force-drive back to unpainted (cube rises, plane hides).
		applyPaintIndex(id, PALETTE_NONE, true)
	}
}

// MARK: Network outbox
// Cell ids to send as paintTick commands. Not paint state — just the
// client→server request queue, drained at PAINT_TICK_HZ after roster join.
const paintOutbox = new Set<string>()


// MARK: drainPaintOutbox

/** Drain up to `max` pending cell ids for one paintTick. */
export function drainPaintOutbox(max: number): string[] {
	if (paintOutbox.size === 0) return []
	const out: string[] = []
	for (const id of paintOutbox) {
		out.push(id)
		if (out.length >= max) break
	}
	for (const id of out) paintOutbox.delete(id)
	return out
}


// MARK: edges

// Build (once) or reposition the 12 black edge boxes for a cell so they hug
// a box of dimensions (cellSize × heightMeters × cellSize) sitting on the
// walkable surface at basePos. Idempotent — safe to call every tween frame.
// 8 edges per cube: 4 top face + 4 vertical corners. Bottom edges are
// omitted because they are almost always hidden (buried under the cube's
// base slab or the adjacent plateau cell). Cuts entity cost per painted
// cell from 13 to 9, a ~30% reduction on entity budget under heavy paint.
const EDGES_PER_CUBE = 8
function updateEdges(id: string, basePos: Vector3, heightMeters: number, cellSize: number): void {
	let edges = cellEdges.get(id)
	if (!edges) {
		edges = []
		for (let i = 0; i < EDGES_PER_CUBE; i++) edges.push(acquireEdge())
		cellEdges.set(id, edges)
	}
	const E    = EDGE_THICKNESS
	const W    = cellSize
	const D    = cellSize
	const H    = Math.max(heightMeters, E) // avoid zero-scale on flat state
	const bx   = basePos.x
	const bz   = basePos.z
	const yTop = basePos.y + H
	const yMid = basePos.y + H / 2
	const set = (i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
		const t = Transform.getMutableOrNull(edges![i])
		if (t) {
			t.position = Vector3.create(x, y, z)
			t.scale    = Vector3.create(sx, sy, sz)
		} else {
			Transform.create(edges![i], { position: Vector3.create(x, y, z), scale: Vector3.create(sx, sy, sz) })
		}
	}
	// 4 top edges.
	set(0, bx,       yTop, bz + D/2, W, E, E)
	set(1, bx,       yTop, bz - D/2, W, E, E)
	set(2, bx - W/2, yTop, bz,       E, E, D)
	set(3, bx + W/2, yTop, bz,       E, E, D)
	// 4 vertical corner edges.
	set(4, bx - W/2, yMid, bz - D/2, E, H, E)
	set(5, bx + W/2, yMid, bz - D/2, E, H, E)
	set(6, bx - W/2, yMid, bz + D/2, E, H, E)
	set(7, bx + W/2, yMid, bz + D/2, E, H, E)
}

// Return all edge entities for a cell to the pool for reuse. Cheaper than
// destroying + recreating on the next paint. Only truly destroys when the
// underlying tile despawns and the pool would otherwise grow unbounded.
function destroyEdges(id: string): void {
	const edges = cellEdges.get(id)
	if (!edges) return
	for (const e of edges) releaseEdge(e)
	cellEdges.delete(id)
}


// MARK: enqueuePaintCandidate

/**
 * Queue a cell id for paintTick and, once rostered, paint the mesh
 * immediately so the brush stays under the avatar.
 */
export function enqueuePaintCandidate(id: string, heightScale: number = 1): void {
	// Drop ids the server cannot pack (e.g. ramp rows outside 0..SIZE-1).
	if (cellIdToKey(id) === null) return
	paintOutbox.add(id)
	if (localTeam === Team.None) return
	const index = teamPaletteIndex(localTeam)
	const data = cellData.get(id)
	// Refresh decay while the player is actively stamping this cube — stops
	// the decay pulse when re-painting an already-extruded cell.
	if (data && data.kind === 'cube' && renderedIndex.get(id) === index) {
		decayAt.set(id, paintClockMs + RISE_DURATION_MS + DECAY_DELAY_MS)
	}
	// If already painted the same colour, re-drive taller in two cases:
	//   1. Fresh paint would raise this cell higher than it currently is
	//      (e.g. taper-ring cell whose position is now inside the plateau).
	//   2. This is a FRESH pass onto the cell (see stampedThisPass gate in
	//      the paint loop) and player is close enough for full-height paint
	//      — bump the pillar up by STACK_BUMP, capped at MAX_STACK_SCALE.
	// Cells further from the brush centre (heightScale < prev) never shrink
	// existing pillars — decay is the only way down.
	if (renderedIndex.get(id) === index) {
		if (!data || data.kind !== 'cube') return
		// Default prev = PLATEAU_BASE_SCALE so preexisting-painted cells
		// (which spawned FLAT with no cellHeightScale entry) are still able
		// to be lifted by jump-follow on the next paint.
		const prev = cellHeightScale.get(id) ?? PLATEAU_BASE_SCALE
		let target = prev
		if (heightScale > prev) {
			// Fresh paint would raise this cell (e.g. was a taper ring, now at
			// full plateau distance, or jump-follow snapping plateau up).
			target = heightScale
		}
		// Stack bumps intentionally disabled: they made plateau cells grow
		// above the player's Y and blocked movement. Height now strictly
		// tracks the caller's requested scale, which the paint loop derives
		// from PLATEAU_BASE_SCALE + jump-follow (player Y).
		void STACK_BUMP; void STACK_INTERVAL_MS; void lastStackBumpAt
		if (target > prev + 0.01) applyPaintIndex(id, index, true, target)
		return
	}
	applyPaintIndex(id, index, false, heightScale)
	playClaimSfx()
}


// MARK: applyPaintIndex

/**
 * Apply a palette index to a cell mesh (optimistic local or CRDT → view).
 * Same-index calls are a no-op unless `force` (palette colour changed).
 */
export function applyPaintIndex(id: string, index: number, force: boolean, heightScale: number = 1): void {
	if (!force && renderedIndex.get(id) === index) return
	renderedIndex.set(id, index)
	const data = cellData.get(id)
	if (!data) return
	const painted = index !== PALETTE_NONE

	if (data.kind === 'cube') {
		// Painted: extrude UP into a tall colored collidable cube.
		// Unpainted: fall back DOWN to a flat grey slab (no collider).
		// Color is applied immediately on rise so the pillar tints as it grows;
		// on fall we swap back to grey when the tween completes.
		const finalMat = painted ? null : CUBE_GREY_MAT
		if (painted) {
			const mat = cellMaterialForIndex(index)
			if (mat) Material.setPbrMaterial(data.entity, mat)
		}
		const clampedScale = painted ? Math.max(0.05, Math.min(MAX_STACK_SCALE, heightScale)) : 1
		const targetHeight = CUBE_HEIGHT * clampedScale
		if (painted) cellHeightScale.set(id, clampedScale)
		else         cellHeightScale.delete(id)
		const tr = Transform.getOrNull(data.entity)
		const startY      = tr ? tr.position.y : data.basePos.y + FLAT_THICKNESS / 2
		const startScaleY = tr ? tr.scale.y    : FLAT_THICKNESS
		const endScaleY   = painted ? targetHeight : FLAT_THICKNESS
		const endY        = data.basePos.y + endScaleY / 2
		dropAnims.set(id, {
			startY, endY, startScaleY, endScaleY,
			elapsedMs: 0, durationMs: RISE_DURATION_MS,
			finalMat,
		})
		// Add / remove the collider that pushes the player upward.
		// The collider lives on the entity for the whole extruded lifetime
		// and is removed once the cube has fully fallen back to flat.
		// Wireframe cage is only rendered while painted — unpainted flat
		// slabs stay clean-looking without outlines.
		if (painted) {
			MeshCollider.setBox(data.entity, ColliderLayer.CL_PHYSICS)
			decayAt.set(id, paintClockMs + RISE_DURATION_MS + DECAY_DELAY_MS)
			// Initialize edges at the cube's CURRENT height (startScaleY), not
			// the target. The tween tick then grows them in lockstep with the
			// cube — otherwise the cage snaps to full height instantly while
			// the cube is still rising.
			updateEdges(id, data.basePos, startScaleY, data.cellSize)
		} else {
			MeshCollider.deleteFrom(data.entity)
			decayAt.delete(id)
			destroyEdges(id)
		}
		return
	}

	// Plane cell (ramp): original behavior — recolor only.
	const mat = cellMaterialForIndex(index)
	if (!mat) return
	Material.setPbrMaterial(data.entity, mat)
}

// MARK: Spawn cells
// Called from index.ts after a tile is placed. `tileType` selects the mask,
// `r` rotates it, and (tx, tz, ty) locate the tile in the maze grid.
export function spawnCellsForTile(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number,
  tileEntity: Entity
) {
  const raw = MASKS[tileType as TileType]
  if (!raw) return // designer hasn't authored this tile's mask yet
  // Defer the actual spawn so cells appear after the GLB's grow-in tween.
  deferredSpawns.push({
    dueMs: spawnClockMs + SPAWN_DELAY_MS,
    run: () => spawnCellsForTileImmediate(tileType, r, tx, tz, ty, CELL, STEP, tileEntity),
  })
}

function spawnCellsForTileImmediate(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number,
  tileEntity: Entity
) {
  const raw = MASKS[tileType as TileType]
  if (!raw) return
  const mask = rotateMask(raw, r)
  const h = mask.length, w = mask[0].length
  // World meters per mask cell. Mask is authored at 1 cell = 1m; the tile
  // fills CELL x CELL world meters, so w should equal CELL.
  const cellSize = CELL / w

  const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
  const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

  // Ramp height helper: canonical ramp rises +Z (N high). After tile rotation
  // r, the slope axis rotates too. Given a world (wx, wz) on the tile, we
  // recover the canonical local (lx, lz) via the same math ROT_OFFSET encodes:
  // local +Z direction, in world frame, is (sin(r*90°), cos(r*90°)) applied to
  // the vector from tile center to the point.
  const isRamp = tileType === 'ramp'
  const rad = r * Math.PI / 2
  const sinR = Math.sin(rad), cosR = Math.cos(rad)
  const geom = rampGeometry(CELL, STEP)
  const slopeAngleDeg = Math.atan2(STEP, geom.inclineLen) * 180 / Math.PI

  // Precomputed rotations. Cell base is -90° around X (face up). Incline cells
  // add slope tilt (negative so the canonical +Z / high edge lifts up). Both
  // then get the tile's yaw (r * 90° around Y) so the tilt axis rotates with
  // the tile — canonical tilt is around world X, rotated versions tilt around
  // the corresponding rotated axis.
  const yaw = Quaternion.fromEulerDegrees(0, r * 90, 0)
  const flatRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90, 0, 0))
  const inclineRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90 - slopeAngleDeg, 0, 0))

  // Convert canonical local (lx, lz) → world (wx, wz), applying the tile's CW
  // yaw around its center. Same math ROT_OFFSET encodes.
  const localToWorld = (lx: number, lz: number) => {
    const cx = lx - CELL / 2, cz = lz - CELL / 2
    const wxRel =  cx * cosR + cz * sinR
    const wzRel = -cx * sinR + cz * cosR
    return {
      wx: tileWorldX + CELL / 2 + wxRel,
      wz: tileWorldZ + CELL / 2 + wzRel,
    }
  }

  let tileRec = paintByTile.get(tileEntity)
  if (!tileRec) {
    tileRec = { entities: [], ids: [] }
    paintByTile.set(tileEntity, tileRec)
  }

	// Ramp cell: tilted plane (unchanged from main).
	const spawnOne = (wx: number, wy: number, wz: number, rot: any, col: number, row: number, scaleY: number = cellSize) => {
		const id  = cellId(tx, tz, ty, col, row)
		const key = cellIdToKey(id)
		const preexisting = (key !== null ? cellApplied.get(key) : undefined)
			?? renderedIndex.get(id)
			?? PALETTE_NONE
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy, wz),
			rotation: rot,
			scale:    Vector3.create(cellSize, scaleY, 1),
		})
		MeshRenderer.setPlane(e)
		const mat = cellMaterialForIndex(preexisting) ?? cellMaterialForIndex(PALETTE_NONE)!
		Material.setPbrMaterial(e, mat)
		cellEntity.set(id, e)
		cellData.set(id, { entity: e, kind: 'plane', basePos: Vector3.create(wx, wy, wz), cellSize })
		renderedIndex.set(id, preexisting)
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

	// Flat (non-ramp) cell: grey slab flush with the walkable surface.
	// On paint, applyPaintIndex tweens it UP into a tall colored cube with a
	// collider that pushes the player upward.
	const spawnCube = (wx: number, wy: number, wz: number, col: number, row: number) => {
		const id = cellId(tx, tz, ty, col, row)
		// Extruder branch: always spawn cells FRESH (white, flat, unpainted),
		// ignoring any preexisting CRDT paint state. This gives a clean slate
		// on load so old sessions don't resurrect coloured blocks. Live paint
		// from other players will still land via syncCellsFromCrdt after the
		// startup delay window.
		const thickness = FLAT_THICKNESS
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy + thickness / 2, wz),
			scale:    Vector3.create(cellSize, thickness, cellSize),
		})
		MeshRenderer.setBox(e)
		Material.setPbrMaterial(e, CUBE_GREY_MAT)
		cellEntity.set(id, e)
		cellData.set(id, { entity: e, kind: 'cube', basePos: Vector3.create(wx, wy, wz), cellSize })
		renderedIndex.set(id, PALETTE_NONE)
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

  // Ramp: space incline cells along the SLOPE so they tile flush.
  // (col, row) from rampCellIdxFromCanonical() agree with worldToCellId.
  if (isRamp) {
    // Bottom landing
    for (let i = 0; i < geom.nFlat; i++) {
      const lz = (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    // Incline — spaced along the slope so cells tile flush on the GLB surface.
    for (let i = 0; i < geom.nIncline; i++) {
      const slopeDist = (i + 0.5) * geom.slopeCellSize
      const lz = geom.inclineStart + slopeDist * geom.cosA
      const y  = ty + FLAT_OFFSET + slopeDist * geom.sinA
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, y, wz, inclineRot, idx.col, idx.row, geom.slopeCellSize)
      }
    }
    // Top landing
    for (let i = 0; i < geom.nFlat; i++) {
      const lz = geom.inclineEnd + (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + STEP + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    return
  }

  // Non-ramp: iterate mask cells. Direct pixelwars positioning — cell N
  // sits at (n + 0.5) * cellSize from the tile SW corner. Works cleanly
  // because SIZE is a multiple of 16 (see settings.ts).
  const flatRotDefault = Quaternion.fromEulerDegrees(-90, 0, 0)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ch = mask[row][col]
      if (ch === '.') continue
      const wx = tileWorldX + (col + 0.5) * cellSize
      const wz = tileWorldZ + (row + 0.5) * cellSize

      let wy: number
      if (ch === 'F') {
        wy = ty + FLAT_OFFSET
      } else if (ch >= '0' && ch <= '9') {
        const t = (ch.charCodeAt(0) - 48) / 9
        wy = ty + t * STEP + FLAT_OFFSET
      } else {
        continue
      }
      spawnCube(wx, wy, wz, col, row)
    }
  }
}

// MARK: coverage

/** red/blue from PaintCoverage CRDT; total = local walkable mesh count. */
export function coverage(): { red: number; blue: number; total: number } {
	const total = cellEntity.size
	for (const [, crdt] of engine.getEntitiesWith(PaintCoverage)) {
		return { red: crdt.red, blue: crdt.blue, total }
	}
	return { red: 0, blue: 0, total }
}

// MARK: World to cell
// Reverses spawnCellsForTile. Requires a tile lookup callback so we don't
// need to import the maze grid directly.
// Returns null if the player isn't standing on a known walkable cell.
// groundY is the expected walkable-surface Y for the cell — use it to detect
// airborne states (jumping / gliding / falling) by comparing to player.y.
export function worldToCellId(
  px: number, py: number, pz: number,
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null
): { id: string; groundY: number } | null {
  const tx = Math.floor((px - MAZE_ORIGIN_OFFSET_METERS) / CELL)
  const tz = Math.floor((pz - MAZE_ORIGIN_OFFSET_METERS) / CELL)
  const tile = lookupTile(tx, tz, py)
  if (!tile) return null

  const raw = MASKS[tile.type as TileType]
  if (!raw) return null

  const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
  const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

  // Ramp: shared canonical-frame helper.
  if (tile.type === 'ramp') {
    const geom = rampGeometry(CELL, STEP)
    const rad = tile.r * Math.PI / 2
    const sinR = Math.sin(rad), cosR = Math.cos(rad)
    const dx = px - tileWorldX, dz = pz - tileWorldZ
    const cx = dx - CELL / 2, cz = dz - CELL / 2
    const lx = cosR * cx - sinR * cz + CELL / 2
    const lz = sinR * cx + cosR * cz + CELL / 2
    const idx = rampCellIdxFromCanonical(lx, lz, geom)
    if (!idx) return null
    // groundY = walkable surface Y (top of 0.5m floor slab, then + slope rise).
    let surfaceY: number
    if (lz < geom.inclineStart) surfaceY = tile.y + WALKABLE_TOP
    else if (lz >= geom.inclineEnd) surfaceY = tile.y + STEP + WALKABLE_TOP
    else {
      const slopeDist = (lz - geom.inclineStart) / geom.cosA
      surfaceY = tile.y + WALKABLE_TOP + slopeDist * geom.sinA
    }
    return { id: cellId(tx, tz, tile.y, idx.col, idx.row), groundY: surfaceY }
  }

  const mask = rotateMask(raw, tile.r)
  const w = mask[0].length
  const cellSize = CELL / w

  // Direct pixelwars inverse: floor local coord by cellSize.
  const localX = px - tileWorldX
  const localZ = pz - tileWorldZ
  const col = Math.floor(localX / cellSize)
  const row = Math.floor(localZ / cellSize)
  if (col < 0 || col >= w || row < 0 || row >= mask.length) return null
  const ch = mask[row][col]
  if (ch === '.') return null

  return { id: cellId(tx, tz, tile.y, col, row), groundY: tile.y + WALKABLE_TOP }
}

// Top of the tile's floor slab in world meters. Matches how player.y reads when
// the avatar is grounded on a flat tile at tile.y = 0.
const WALKABLE_TOP = 0.5

// MARK: Painting system
// Reads player position, resolves current cell, paints it.

/** Overlay boxes are small transient entities spawned only for cells under
 *  the local player's brush footprint. They bounce up on enter, tween down
 *  on exit, then despawn — keeping the base paint mesh a cheap plane.
 *
 *  Sizing rules (so the box bottom is never above the plane while lifted):
 *    OVERLAY_THICKNESS = BRUSH_LIFT_METERS + OVERLAY_REST_TOP_ABOVE_PLANE
 *    rest    top = plane + OVERLAY_REST_TOP_ABOVE_PLANE
 *    rest    bottom = plane - BRUSH_LIFT_METERS
 *    lifted  top = plane + OVERLAY_REST_TOP_ABOVE_PLANE + BRUSH_LIFT_METERS
 *    lifted  bottom = plane                            (never rises above)
 *
 *  Each overlay is built as an anchor entity (moved by the Tween) with the
 *  colored box + 12 thin black edge boxes as children, so borders inherit
 *  the anchor's motion and stay aligned.
 */
const BRUSH_LIFT_METERS            = 0.25
const OVERLAY_REST_TOP_ABOVE_PLANE = 0.05
const OVERLAY_THICKNESS            = BRUSH_LIFT_METERS + OVERLAY_REST_TOP_ABOVE_PLANE
const OVERLAY_EDGE_THICKNESS       = 0.01
const BRUSH_LIFT_UP_MS             = 140
const BRUSH_LIFT_DOWN_MS           = 220

const OVERLAY_EDGE_MATERIAL = cellMaterialFromColor(Color4.Black())

type Overlay = { anchor: Entity; parts: Entity[]; baseY: number }
/** id -> live overlay + its resting center Y. */
const overlays = new Map<string, Overlay>()

/** Overlays whose down-tween is still playing; removed once due. */
const pendingOverlayRemovals: { dueMs: number; anchor: Entity; parts: Entity[] }[] = []
let overlayClockMs = 0

engine.addSystem((dt: number) => {
	overlayClockMs += dt * 1000
	while (pendingOverlayRemovals.length && pendingOverlayRemovals[0].dueMs <= overlayClockMs) {
		const item = pendingOverlayRemovals.shift()!
		destroyOverlayParts(item.anchor, item.parts)
	}
})


// MARK: destroyOverlayParts

/** Remove anchor + all children (colored box + 12 edges). */
function destroyOverlayParts(anchor: Entity, parts: Entity[]): void {
	for (const p of parts) engine.removeEntity(p)
	engine.removeEntity(anchor)
}


// MARK: buildOverlayParts

/** Spawn the colored box + 12 black edge boxes as children of `anchor`.
 *  All positions are LOCAL (anchor sits at world (wx, restY, wz)). */
function buildOverlayParts(anchor: Entity, colorMat: ReturnType<typeof cellMaterialFromColor>): Entity[] {
	const W = PAINT_CELL_SIZE_METERS
	const H = OVERLAY_THICKNESS
	const D = PAINT_CELL_SIZE_METERS
	const E = OVERLAY_EDGE_THICKNESS
	const parts: Entity[] = []

	const addPart = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, mat: ReturnType<typeof cellMaterialFromColor>) => {
		const p = engine.addEntity()
		Transform.create(p, {
			parent:   anchor,
			position: Vector3.create(lx, ly, lz),
			scale:    Vector3.create(sx, sy, sz),
		})
		MeshRenderer.setBox(p)
		Material.setPbrMaterial(p, mat)
		parts.push(p)
	}

	// Colored core.
	addPart(0, 0, 0, W, H, D, colorMat)

	// 4 top edges (y = +H/2).
	addPart(0,  H/2,  D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(0,  H/2, -D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(-W/2, H/2, 0,  E, E, D, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, H/2, 0,  E, E, D, OVERLAY_EDGE_MATERIAL)

	// 4 bottom edges (y = -H/2).
	addPart(0, -H/2,  D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(0, -H/2, -D/2, W, E, E, OVERLAY_EDGE_MATERIAL)
	addPart(-W/2, -H/2, 0, E, E, D, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, -H/2, 0, E, E, D, OVERLAY_EDGE_MATERIAL)

	// 4 vertical edges (corners).
	addPart(-W/2, 0, -D/2, E, H, E, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, 0, -D/2, E, H, E, OVERLAY_EDGE_MATERIAL)
	addPart(-W/2, 0,  D/2, E, H, E, OVERLAY_EDGE_MATERIAL)
	addPart( W/2, 0,  D/2, E, H, E, OVERLAY_EDGE_MATERIAL)

	return parts
}


// MARK: removeOverlayImmediate

/** Force-remove any live overlay for `id` (used when the underlying tile
 *  despawns). */
function removeOverlayImmediate(id: string): void {
	const ov = overlays.get(id)
	if (!ov) return
	destroyOverlayParts(ov.anchor, ov.parts)
	overlays.delete(id)
}

export function initPaintingSystem(
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null,
) {
  startEdgePoolPrewarm()
  const GROUND_TOLERANCE = 0.4
  // Give the player a few seconds to spawn / find their footing before
  // the paint loop starts extruding under them. Prevents an instant
  // pop-up on load and lets the initial teleport settle.
  const PAINT_START_DELAY_MS = 3000
  let   paintStartElapsedMs  = 0
  // Brush footprint is read live from src/client/brush.ts so the +/- HUD
  // buttons can grow/shrink the stamp without a scene reload. Offsets in
  // world meters; one cell is CELL / SIZE.
  const step = CELL / SIZE
	// Queue paintTick ids + optimistic local colour; CRDT reconciles.
	// Also lift cells under the brush footprint and drop them once vacated.
	// Track previous player position so painting only fires while the avatar
	// is actually moving on the XZ plane. Standing still should not keep
	// extruding / stack-bumping cells under the player.
	let lastPx = Number.NaN
	let lastPz = Number.NaN
	const MOVE_EPSILON = 0.02 // metres per frame; ~1.2 m/s at 60fps
	engine.addSystem((dt: number) => {
		if (paintStartElapsedMs < PAINT_START_DELAY_MS) {
			paintStartElapsedMs += dt * 1000
			return
		}
		const newLifted = new Set<string>()
		const t = Transform.getOrNull(engine.PlayerEntity)
		const brushCells = getBrushCells()

		if (t && brushCells > 0) {
			const { x, y, z } = t.position
			const dxMove = Number.isNaN(lastPx) ? 0 : x - lastPx
			const dzMove = Number.isNaN(lastPz) ? 0 : z - lastPz
			const moving = (dxMove * dxMove + dzMove * dzMove) >= MOVE_EPSILON * MOVE_EPSILON
			lastPx = x
			lastPz = z
			if (!moving) { void newLifted; return }
			const center = worldToCellId(x, y, z, CELL, STEP, lookupTile)
			// Player is "paintable" when standing on the base surface OR on top
			// of any extruded pillar (>= ~CUBE_HEIGHT above the base). The upper
			// band is open-ended so stacked pillars (up to MAX_STACK_SCALE tall)
			// keep receiving stack increments while the player stands on them.
			const heightAbove = center ? y - center.groundY : 0
			const onGround    = heightAbove <= GROUND_TOLERANCE
			const onPillar    = heightAbove >= CUBE_HEIGHT - GROUND_TOLERANCE
			if (center && (onGround || onPillar)) {
				// Extrude the full brush footprint PLUS a one-cell outer ring so
				// perimeter pillars start rising before the player walks into them.
				// Brush footprint (inner plateau) + taper rings outside it.
				const innerHalf = Math.floor(brushCells / 2)
				const outerHalf = innerHalf + TAPER_RINGS
				// IMPORTANT: use the base-surface Y (center.groundY) for all
				// neighbour lookups, NOT the player's actual Y. When the player is
				// standing on top of an extruded pillar, their y is elevated and
				// lookupTile may resolve to a different tile / logical layer, which
				// would spawn a NEW pillar on top of the existing one instead of
				// re-driving the same cell taller.
				const refY = center.groundY
				for (let dz = -outerHalf; dz <= outerHalf; dz++) for (let dx = -outerHalf; dx <= outerHalf; dx++) {
					const hit = worldToCellId(x + dx * step, refY, z + dz * step, CELL, STEP, lookupTile)
					if (!hit) continue
					// Accept cells whose ground is near the player OR when the player
					// is standing on any pillar (heightAbove past CUBE_HEIGHT band).
					const dGround = Math.abs(refY - hit.groundY)
					if (dGround > 1.5 && !onPillar) continue
					const dist = Math.max(Math.abs(dx), Math.abs(dz))
					// Compute plateau scale first (base + jump-follow), then scale
					// tapers as a fixed fraction of that so the ramp silhouette
					// is preserved when the plateau lifts.
					const cellHeightAbove = y - hit.groundY
					const jumpScale       = cellHeightAbove / CUBE_HEIGHT
					const plateauScale    = Math.min(MAX_STACK_SCALE, Math.max(PLATEAU_BASE_SCALE, jumpScale))
					let scale: number
					if (dist <= innerHalf) {
						scale = plateauScale
					} else {
						const ringIdx = dist - innerHalf - 1
						const ratio   = TAPER_RATIOS_OF_PLATEAU[ringIdx] ?? TAPER_RATIOS_OF_PLATEAU[TAPER_RATIOS_OF_PLATEAU.length - 1]
						scale = plateauScale * ratio
					}
					enqueuePaintCandidate(hit.id, scale)
					newLifted.add(hit.id)
				}
			}
		}

		void newLifted // reserved for future overlay hooks
	})
}


// MARK: reconcileLiftedCells

/** For each cell currently under the brush, ensure a bouncing overlay
 *  exists; for cells no longer under it, tween the overlay down and
 *  schedule its removal. Overlay core inherits the local player's team
 *  color; edges are always black. */
function reconcileLiftedCells(nowLifted: Set<string>): void {
	// Drop overlays for cells that have left the footprint.
	for (const [id, ov] of overlays) {
		if (nowLifted.has(id)) continue
		const tr = Transform.getOrNull(ov.anchor)
		if (tr) {
			const p = tr.position
			Tween.createOrReplace(ov.anchor, {
				mode: Tween.Mode.Move({
					start: Vector3.create(p.x, p.y,      p.z),
					end:   Vector3.create(p.x, ov.baseY, p.z),
				}),
				duration:        BRUSH_LIFT_DOWN_MS,
				easingFunction:  EasingFunction.EF_EASEOUTQUAD,
			})
			pendingOverlayRemovals.push({
				dueMs:  overlayClockMs + BRUSH_LIFT_DOWN_MS + 30,
				anchor: ov.anchor,
				parts:  ov.parts,
			})
		} else {
			destroyOverlayParts(ov.anchor, ov.parts)
		}
		overlays.delete(id)
	}
	// Spawn + lift overlays for newly-entered cells.
	if (nowLifted.size === 0) return
	const colorIndex = teamPaletteIndex(localTeam)
	const colorMat   = cellMaterialForIndex(colorIndex) ?? cellMaterialForIndex(PALETTE_NONE)!
	for (const id of nowLifted) {
		if (overlays.has(id)) continue
		const cellE = cellEntity.get(id)
		if (cellE === undefined) continue
		const cellTr = Transform.getOrNull(cellE)
		if (!cellTr) continue
		const p     = cellTr.position
		// baseY (rest center) chosen so the box top sits
		// OVERLAY_REST_TOP_ABOVE_PLANE above the plane, and the box bottom
		// tracks BRUSH_LIFT_METERS below — keeping bottom ≤ plane while lifted.
		const baseY  = p.y + OVERLAY_REST_TOP_ABOVE_PLANE - OVERLAY_THICKNESS / 2
		const anchor = engine.addEntity()
		Transform.create(anchor, { position: Vector3.create(p.x, baseY, p.z) })
		const parts = buildOverlayParts(anchor, colorMat)
		overlays.set(id, { anchor, parts, baseY })
		Tween.createOrReplace(anchor, {
			mode: Tween.Mode.Move({
				start: Vector3.create(p.x, baseY,                       p.z),
				end:   Vector3.create(p.x, baseY + BRUSH_LIFT_METERS,   p.z),
			}),
			duration:        BRUSH_LIFT_UP_MS,
			easingFunction:  EasingFunction.EF_EASEOUTBACK,
		})
	}
}
