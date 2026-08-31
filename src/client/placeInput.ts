/**
 * placeInput.ts — dcl/place feet-based placement + 1×1 highlight cursor.
 *
 * Design shift (Day 3): the selection cursor tracks the tile UNDER THE
 * AVATAR'S FEET, not the on-screen pointer. Players place a pixel by
 * walking to a cell and tapping the PAINT button (cooldown pill in the
 * UI). This encourages movement and makes the canvas feel like a shared
 * physical space rather than a shared paint program — social players
 * bumping into each other while they hunt for empty pixels.
 *
 * Two pieces:
 *   1. Per-frame system: reads player Transform → resolves cellId under
 *      feet → moves a flat colored highlight plane to sit on that cell.
 *   2. `placeAtFeet()`: called by the PAINT button; validates cooldown,
 *      resolves the current feet-cell, sends `placePixel` to the server.
 */

import {
	engine, Transform, MeshRenderer, Material, Entity,
	InputAction, PointerEventType, inputSystem,
} from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math'

import { room } from 'src/shared/messages'
import { CELL, STEP, lookupTile } from 'src/shared/maze/generator'
import { PAINT_COOLDOWN_MS, PAINT_CELL_SIZE_METERS, MAZE_TILE_GLTF_SCALE } from 'src/shared/settings'
import { placeColor, PLACE_PALETTE_SIZE } from 'src/shared/palette'

import { worldToCellId } from 'src/client/paint'
import {
	canPlaceNow,
	getSelectedPaletteIndex,
	setSelectedPaletteIndex,
	noteOptimisticSend,
} from 'src/client/placeState'
import { playUiClick } from 'src/client/audio'


// -------- Highlight cursor (flat colored plane) --------

let highlight: Entity | null = null
let edges: Entity[] | null = null

// Match dcl-canvas: thin black wireframe (4 top + 4 vertical corners, 8 total).
const EDGE_THICKNESS = 0.02
const EDGES_PER_CUBE = 8
const HIDDEN_SCALE  = Vector3.create(0, 0, 0)
const CURSOR_HEIGHT = 0.1 // total cube height; bottom flush with the painted tile plane, top 0.1m above

// worldToCellId returns groundY = tile.y + WALKABLE_TOP (the walkable floor top).
// The visible painted slabs (paint.ts FLAT_OFFSET) sit lower than that. Offset
// the highlight down by the delta so the cube's bottom is flush with the slab.
const WALKABLE_TOP_M = 0.5   * MAZE_TILE_GLTF_SCALE
const FLAT_OFFSET_M  = 0.275 * MAZE_TILE_GLTF_SCALE
const TILE_PLANE_DROP = WALKABLE_TOP_M - FLAT_OFFSET_M

// Max distance (world m) the avatar's feet may sit above the walkable
// surface and still count as "on the tile". Anything larger — jumping,
// gliding, falling — hides the highlight and blocks placement. Matches
// dcl-canvas GROUND_TOLERANCE.
const GROUND_TOLERANCE = 0.4

/** Latest resolved feet-cell — refreshed every frame by the feet system.
 *  `placeAtFeet()` reads this when the player taps PAINT. */
let currentFeetCellId: string | null = null


function ensureHighlight(): Entity {
	if (highlight !== null) return highlight
	const e = engine.addEntity()
	Transform.create(e, { scale: HIDDEN_SCALE })
	MeshRenderer.setBox(e)
	Material.setPbrMaterial(e, {
		albedoColor: Color4.create(1, 1, 1, 0.5),
		emissiveColor: Color4.create(1, 1, 1, 1),
		emissiveIntensity: 0.5,
		roughness: 1.0,
		metallic:  0.0,
		specularIntensity: 0.0,
	})
	highlight = e
	return e
}


function ensureEdges(): Entity[] {
	if (edges !== null) return edges
	const mat = { albedoColor: Color4.Black(), emissiveColor: Color4.Black(), roughness: 1.0, metallic: 0.0, specularIntensity: 0.0 }
	const arr: Entity[] = []
	for (let i = 0; i < EDGES_PER_CUBE; i++) {
		const e = engine.addEntity()
		Transform.create(e, { scale: HIDDEN_SCALE })
		MeshRenderer.setBox(e)
		Material.setPbrMaterial(e, mat)
		arr.push(e)
	}
	edges = arr
	return arr
}


function positionEdges(cx: number, yBottom: number, cz: number): void {
	const arr = ensureEdges()
	const E = EDGE_THICKNESS
	const W = PAINT_CELL_SIZE_METERS * 0.95
	const D = W
	const H = CURSOR_HEIGHT
	const yTop = yBottom + H
	const yMid = yBottom + H / 2
	const set = (i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
		const t = Transform.getMutableOrNull(arr[i])
		if (t) {
			t.position = Vector3.create(x, y, z)
			t.scale    = Vector3.create(sx, sy, sz)
			t.rotation = Quaternion.Identity()
		} else {
			Transform.create(arr[i], { position: Vector3.create(x, y, z), scale: Vector3.create(sx, sy, sz) })
		}
	}
	// 4 top edges.
	set(0, cx,       yTop, cz + D/2, W, E, E)
	set(1, cx,       yTop, cz - D/2, W, E, E)
	set(2, cx - W/2, yTop, cz,       E, E, D)
	set(3, cx + W/2, yTop, cz,       E, E, D)
	// 4 vertical corner edges.
	set(4, cx - W/2, yMid, cz - D/2, E, H, E)
	set(5, cx + W/2, yMid, cz - D/2, E, H, E)
	set(6, cx - W/2, yMid, cz + D/2, E, H, E)
	set(7, cx + W/2, yMid, cz + D/2, E, H, E)
}


function hideEdges(): void {
	if (edges === null) return
	for (const e of edges) {
		const t = Transform.getMutableOrNull(e)
		if (t) t.scale = HIDDEN_SCALE
	}
}


function positionHighlight(x: number, y: number, z: number, index: number): void {
	const e = ensureHighlight()
	const color = placeColor(index) ?? Color4.create(1, 1, 1, 1)
	Transform.createOrReplace(e, {
		position: Vector3.create(x, y - TILE_PLANE_DROP + CURSOR_HEIGHT / 2, z), // bottom flush with painted tile plane, top 0.1m above
		rotation: Quaternion.Identity(),
		scale:    Vector3.create(PAINT_CELL_SIZE_METERS * 0.95, CURSOR_HEIGHT, PAINT_CELL_SIZE_METERS * 0.95),
	})
	Material.setPbrMaterial(e, {
		albedoColor:       Color4.create(color.r, color.g, color.b, 1),
		emissiveColor:     color,
		emissiveIntensity: 0.4,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	})
}


function hideHighlight(): void {
	currentFeetCellId = null
	if (highlight !== null) {
		const t = Transform.getMutableOrNull(highlight)
		if (t) t.scale = HIDDEN_SCALE
	}
	hideEdges()
}


// Center a world coordinate into its owning 1m cell for visual snap.
function snapCellCenter(px: number, pz: number): { cx: number; cz: number } {
	const cell = PAINT_CELL_SIZE_METERS
	const cx = Math.floor(px / cell) * cell + cell / 2
	const cz = Math.floor(pz / cell) * cell + cell / 2
	return { cx, cz }
}


// MARK: initFeetPaint

/**
 * Wires up a per-frame system that tracks the avatar's feet, resolves the
 * paint cell they're standing on, and moves the highlight plane to sit
 * on top of it. The resolved cellId is cached in `currentFeetCellId` for
 * `placeAtFeet()` to read on demand.
 */
export function initFeetPaint(): void {
	console.log('[Place] feet-based paint ready — walk to a cell, tap PAINT to place')

	engine.addSystem(() => {
		const t = Transform.getOrNull(engine.PlayerEntity)
		if (!t) { hideHighlight(); return }
		const p = t.position

		const cell = worldToCellId(p.x, p.y, p.z, CELL, STEP, lookupTile)
		if (!cell) { hideHighlight(); return }

		// Airborne gate: hide preview + block placement when the player's
		// feet aren't near the walkable surface (jumping / gliding).
		if (p.y - cell.groundY > GROUND_TOLERANCE) { hideHighlight(); return }

		currentFeetCellId = cell.id
		const { cx, cz } = snapCellCenter(p.x, p.z)
		const yBottom = cell.groundY - TILE_PLANE_DROP
		positionHighlight(cx, cell.groundY, cz, getSelectedPaletteIndex())
		positionEdges(cx, yBottom, cz)
	})
}


// MARK: placeAtFeet

/**
 * Called by the PAINT button (cooldown pill). Sends `placePixel` for the
 * cell currently under the avatar's feet, using the selected palette
 * index. Silent no-op if cooldown is active or the avatar isn't standing
 * on a valid cell.
 */
export function placeAtFeet(): void {
	if (!canPlaceNow()) {
		console.log('[Place] tap ignored — cooldown active')
		return
	}
	if (!currentFeetCellId) {
		console.log('[Place] tap ignored — no valid cell under feet')
		return
	}
	const paletteIndex = getSelectedPaletteIndex()
	console.log(`[Place] → placePixel ${currentFeetCellId} color=${paletteIndex}`)
	noteOptimisticSend(PAINT_COOLDOWN_MS)
	room.send('placePixel', { cellId: currentFeetCellId, paletteIndex })
}


// MARK: initPaintHotkey

/** Desktop hotkeys:
 *    F (IA_SECONDARY) — fires placeAtFeet(), same as the paint button.
 *    E (IA_PRIMARY)   — cycles the selected palette color forward,
 *                       wrapping at the end.
 *  Mobile has no keyboard; the picker + button own touch input. */
export function initPaintHotkey(): void {
	if (isMobile()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
			placeAtFeet()
		}
		if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
			// paletteIndex is 1..PLACE_PALETTE_SIZE; wrap 8 → 1.
			const cur  = getSelectedPaletteIndex()
			const next = (cur % PLACE_PALETTE_SIZE) + 1
			setSelectedPaletteIndex(next)
			playUiClick()
		}
	})
}
