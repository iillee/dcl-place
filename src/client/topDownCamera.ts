// Top-down camera — a fixed VirtualCamera high above the scene looking
// down at the center. Activated by writing its entity id into
// MainCamera.virtualCameraEntity; released by writing `undefined`, which
// snaps the game back to the normal player-follow camera.
//
// IMPORTANT design tradeoff:
//   A perfectly straight-down camera has an undefined projected "forward"
//   on the ground plane, so DCL's camera-relative WASD input axis falls
//   back to a fixed world axis. Rotating what's rendered (via yaw) then
//   decouples from the movement axis and controls feel inverted or
//   sideways.
//
//   The fix is to give the camera a SMALL horizontal offset from its
//   look target so lookAtEntity produces a real forward vector. We keep
//   the offset intentionally small (a few meters at ~50 m altitude ≈
//   nearly-vertical tilt) so the view still reads as pure top-down but
//   the SDK has enough information to align WASD with the view.
//
// The offset direction also picks which world axis is "up" on screen:
//   • +Z offset (south of target) → camera looks north, world +Z at screen top
//   • +X offset (east of target)  → camera looks west, world +X at screen top
//     (this rotates the scene 90° vs a south-offset view)

import { engine, Transform, VirtualCamera, MainCamera, Entity, InputAction, PointerEventType, inputSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { cycleBrushDown, cycleBrushUp } from 'src/client/brush'
import {
	SCENE_WORLD_SIZE_X_METERS,
	SCENE_WORLD_SIZE_Z_METERS,
} from 'src/shared/settings'

// Scene center (X, Z) at ground level — the camera's look target.
const CENTER_X = SCENE_WORLD_SIZE_X_METERS / 2
const CENTER_Z = SCENE_WORLD_SIZE_Z_METERS / 2

// Camera altitude. Kept inside DCL mobile's ~100 m fog band.
const CAM_ALTITUDE = 50

// East offset (world +X) from the look target. Nonzero so lookAtEntity
// yields a real projected forward for WASD alignment; kept minimal so
// the view is visually indistinguishable from straight-down.
// 3 m at altitude 50 m ≈ 3.4° tilt — the camera reads as pure overhead
// but the SDK still has enough directional information to align WASD.
const CAM_EAST_OFFSET = 3

// Smooth transition speed (m/s) for entering / exiting the top-down view.
const TRANSITION_SPEED = 200

let camEntity:  Entity | null = null
let lookTarget: Entity | null = null
let active = false


// MARK: setupTopDownCamera
/** Create the VirtualCamera + look-target entities. Call once at boot. */
export function setupTopDownCamera(): void {
	if (camEntity !== null) return

	lookTarget = engine.addEntity()
	Transform.create(lookTarget, {
		position: Vector3.create(CENTER_X, 0, CENTER_Z),
	})

	camEntity = engine.addEntity()
	Transform.create(camEntity, {
		position: Vector3.create(CENTER_X + CAM_EAST_OFFSET, CAM_ALTITUDE, CENTER_Z),
	})
	VirtualCamera.create(camEntity, {
		lookAtEntity: lookTarget,
		defaultTransition: { transitionMode: VirtualCamera.Transition.Speed(TRANSITION_SPEED) },
	})

	// Hotkeys:
	//   E (IA_PRIMARY)      = brush size UP   (wraps 11 -> 1)
	//   F (IA_SECONDARY)    = brush size DOWN (clamps at 1)
	//   1 (IA_ACTION_3)     = toggle spectator / top-down view
	// IA_ACTION_3..6 map to the action-bar slots 1..4 in DCL's default map.
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
			cycleBrushUp()
		}
		if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
			cycleBrushDown()
		}
		if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) {
			toggleTopDownCamera()
		}
	})
}


// MARK: toggleTopDownCamera
/** Flip between top-down and normal player camera. */
export function toggleTopDownCamera(): void {
	if (camEntity === null) return
	active = !active
	const main = MainCamera.getMutableOrNull(engine.CameraEntity)
		?? MainCamera.create(engine.CameraEntity)
	main.virtualCameraEntity = active ? camEntity : undefined
}


// MARK: isTopDownActive
export function isTopDownActive(): boolean {
	return active
}
