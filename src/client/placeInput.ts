/**
 * placeInput.ts — dcl/place tap-to-place + 1×1 highlight cursor.
 *
 * Each maze tile registers pointerEventsSystem.onPointerDown; the tap
 * callback (onTileTapped) reads the last pointer command's hit position,
 * resolves cellId, and sends `placePixel`.
 *
 * Alongside that, a continuous local-direction raycast from the camera
 * finds the cell under the crosshair every frame and moves a small
 * highlight box to sit on top of it. That gives cell-accurate feedback
 * without adding a PointerEvents component to every one of the 25,600
 * paint cells.
 */

import {
	engine, Transform, MeshRenderer, Material, Entity,
	inputSystem, InputAction, PointerEventType,
	raycastSystem, RaycastQueryType,
	ColliderLayer, PrimaryPointerInfo,
} from '@dcl/sdk/ecs'
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math'

import { room } from 'src/shared/messages'
import { CELL, STEP, lookupTile } from 'src/shared/maze/generator'
import { PAINT_COOLDOWN_MS, PAINT_CELL_SIZE_METERS } from 'src/shared/settings'
import { placeColor } from 'src/shared/palette'

import { worldToCellId } from 'src/client/paint'
import {
	canPlaceNow,
	getSelectedPaletteIndex,
	noteOptimisticSend,
} from 'src/client/placeState'


// -------- Highlight cursor (flat colored plane) --------

let highlight: Entity | null = null
const HIDDEN_SCALE = Vector3.create(0, 0, 0)
const CURSOR_LIFT  = 0.03 // world m above the paint slab so it doesn't z-fight


function ensureHighlight(): Entity {
	if (highlight !== null) return highlight
	const e = engine.addEntity()
	Transform.create(e, { scale: HIDDEN_SCALE })
	MeshRenderer.setPlane(e)
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


function positionHighlight(x: number, y: number, z: number, index: number): void {
	const e = ensureHighlight()
	const color = placeColor(index) ?? Color4.create(1, 1, 1, 1)
	Transform.createOrReplace(e, {
		position: Vector3.create(x, y + CURSOR_LIFT, z),
		rotation: Quaternion.fromEulerDegrees(-90, 0, 0),
		scale:    Vector3.create(PAINT_CELL_SIZE_METERS * 0.95, PAINT_CELL_SIZE_METERS * 0.95, 1),
	})
	Material.setPbrMaterial(e, {
		albedoColor:       Color4.create(color.r, color.g, color.b, 0.6),
		emissiveColor:     color,
		emissiveIntensity: 0.4,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	})
}


function hideHighlight(): void {
	if (highlight === null) return
	const t = Transform.getMutableOrNull(highlight)
	if (t) t.scale = HIDDEN_SCALE
}


// Center a world coordinate into its owning 1m cell for visual snap.
function snapCellCenter(px: number, pz: number): { cx: number; cz: number } {
	const cell = PAINT_CELL_SIZE_METERS
	const cx = Math.floor(px / cell) * cell + cell / 2
	const cz = Math.floor(pz / cell) * cell + cell / 2
	return { cx, cz }
}


// MARK: initTapToPlace — continuous highlight raycast

export function initTapToPlace(): void {
	console.log('[Place] tap-to-place ready — 16-color palette, 10s cooldown')

	// Continuous local-direction raycast from the camera. The callback runs
	// every time the SDK produces a new raycast result (~1 per frame).
	// Cursor-driven raycast: every frame, re-issue a synchronous raycast
	// from the camera along the current PrimaryPointerInfo.worldRayDirection
	// so the highlight tracks the actual on-screen pointer (mouse, touch,
	// or locked-crosshair) rather than just camera-forward.
	engine.addSystem(() => {
		const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
		const dir  = info?.worldRayDirection ?? Vector3.create(0, 0, 1)
		const opts = raycastSystem.globalDirectionOptions({
			queryType:     RaycastQueryType.RQT_HIT_FIRST,
			maxDistance:   64,
			collisionMask: ColliderLayer.CL_PHYSICS,
			direction:     Vector3.create(dir.x, dir.y, dir.z),
		})
		const result = raycastSystem.registerRaycast(engine.CameraEntity, opts)
		// Null result = frame with no fresh raycast reply; keep last highlight
		// position rather than flickering off.
		if (!result) return
		const hit = result.hits && result.hits[0]
		if (!hit || !hit.position) { hideHighlight(); return }
		const cell = worldToCellId(
			hit.position.x, hit.position.y, hit.position.z,
			CELL, STEP, lookupTile,
		)
		if (!cell) { hideHighlight(); return }
		const { cx, cz } = snapCellCenter(hit.position.x, hit.position.z)
		positionHighlight(cx, cell.groundY, cz, getSelectedPaletteIndex())
	})
}


// MARK: onTileTapped — invoked by pointerEventsSystem on any maze tile

export function onTileTapped(tileEntity: Entity): void {
	const cmd = inputSystem.getInputCommand(
		InputAction.IA_POINTER,
		PointerEventType.PET_DOWN,
		tileEntity,
	)
	if (!cmd) return
	const hit = cmd.hit
	if (!hit || !hit.position) return
	if (!canPlaceNow()) {
		console.log('[Place] tap ignored — cooldown active')
		return
	}
	const paletteIndex = getSelectedPaletteIndex()
	const cellRes = worldToCellId(
		hit.position.x, hit.position.y, hit.position.z,
		CELL, STEP, lookupTile,
	)
	if (!cellRes) return
	console.log(`[Place] → placePixel ${cellRes.id} color=${paletteIndex}`)
	noteOptimisticSend(PAINT_COOLDOWN_MS)
	room.send('placePixel', { cellId: cellRes.id, paletteIndex })
}
