/**
 * placeInput.ts — dcl/place tap-to-place input.
 *
 * On every IA_POINTER trigger (mouse click or mobile tap) we cast a ray
 * from the camera forward, hit the paint cell / floor entity below the
 * cursor, resolve the world-space hit → cellId, and send `placePixel`
 * with the currently selected palette color.
 *
 * The server enforces the 10s cooldown; the client also gates locally so
 * a spam-tapping player doesn't waste the network round-trip. Every send
 * (accepted or optimistic-reject) burns the local cooldown estimate so
 * the UI ring behaves consistently.
 */

import {
	engine,
	inputSystem,
	InputAction,
	PointerEventType,
	raycastSystem,
	RaycastQueryType,
	Transform,
} from '@dcl/sdk/ecs'

import { room } from 'src/shared/messages'
import { CELL, STEP, lookupTile } from 'src/shared/maze/generator'
import { PAINT_COOLDOWN_MS } from 'src/shared/settings'

import { worldToCellId } from 'src/client/paint'
import {
	canPlaceNow,
	getSelectedPaletteIndex,
	noteOptimisticSend,
} from 'src/client/placeState'

const RAYCAST_MAX_DISTANCE = 64 // meters — comfortably reaches across ~4 parcels


// MARK: initTapToPlace

export function initTapToPlace(): void {
	engine.addSystem(() => {
		const cmd = inputSystem.getInputCommand(
			InputAction.IA_POINTER,
			PointerEventType.PET_DOWN,
		)
		if (!cmd) return
		if (!canPlaceNow()) return
		tryPlaceAtCursor()
	})
}


// MARK: tryPlaceAtCursor

function tryPlaceAtCursor(): void {
	raycastSystem.registerLocalDirectionRaycast(
		{
			entity: engine.CameraEntity,
			opts: {
				queryType:   RaycastQueryType.RQT_HIT_FIRST,
				direction:   { x: 0, y: 0, z: 1 }, // camera-local forward
				maxDistance: RAYCAST_MAX_DISTANCE,
			},
		},
		(result) => {
			const hits = result.hits
			if (!hits || hits.length === 0) return
			const hit = hits[0]
			if (!hit.position) return
			const paletteIndex = getSelectedPaletteIndex()
			const cellRes = worldToCellId(
				hit.position.x, hit.position.y, hit.position.z,
				CELL, STEP, lookupTile,
			)
			if (!cellRes) return
			sendPlacePixel(cellRes.id, paletteIndex)
		},
	)
}


// MARK: sendPlacePixel

function sendPlacePixel(cellId: string, paletteIndex: number): void {
	// Optimistic cooldown lock — if the server rejects, cooldownAck will
	// overwrite this with the truth on the next tick.
	noteOptimisticSend(PAINT_COOLDOWN_MS)
	room.send('placePixel', { cellId, paletteIndex })
	// suppress unused-import lints for Transform (kept for future use)
	void Transform
}
