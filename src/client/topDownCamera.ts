/**
 * topDownCamera.ts — spectator-style overhead camera with follow + pan.
 *
 * Ported from dcl-snowdrift; adapted for dcl/place (no brush hotkeys,
 * uses PAINT-flavored scene constants). See original for detailed
 * design notes.
 *
 * Two modes:
 *   FOLLOW  — lookTarget lerps toward the player each frame (default).
 *   FREE    — lookTarget is driven by pan input (mouse drag on desktop,
 *             d-pad hold on mobile). Follow re-engages on recenter().
 *
 * Public API used by the UI layers:
 *   setupTopDownCamera / toggleTopDownCamera / isTopDownActive /
 *   applyPanDelta / beginDrag / endDrag / isDragging /
 *   beginPan / endPan / getDpadSpeed /
 *   zoomIn / zoomOut / canZoomIn / canZoomOut / recenter
 */

import { engine, Entity, InputAction, MainCamera, PointerEventType, Transform, VirtualCamera, inputSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { playUiClick } from 'src/client/audio'
import { SCENE_WORLD_SIZE_X_METERS, SCENE_WORLD_SIZE_Z_METERS } from 'src/shared/settings'


// MARK: Tuning
const CENTER_X = SCENE_WORLD_SIZE_X_METERS / 2
const CENTER_Z = SCENE_WORLD_SIZE_Z_METERS / 2

// dcl/place is 160m × 160m — 5× bigger than snowdrift, so default altitudes
// are higher to keep the whole canvas readable on first entry.
// Defaults sit 4 zoom-steps (40 m) closer than the wide-canvas readable
// altitude so players start with a pixel-scale view; wheel/pinch out to
// see the whole board.
const CAM_ALTITUDE_DESKTOP_DEFAULT = 50
const CAM_ALTITUDE_MOBILE_DEFAULT  = 30
const CAM_ALTITUDE_DEFAULT         = isMobile() ? CAM_ALTITUDE_MOBILE_DEFAULT : CAM_ALTITUDE_DESKTOP_DEFAULT
const CAM_ALTITUDE_MIN             = 20
// Mobile caps at the lowest 5 zoom steps (20/30/40/50/60) — higher
// altitudes render the canvas too small to read on a phone screen.
const CAM_ALTITUDE_MAX             = isMobile() ? 60 : 140
const CAM_ALTITUDE_STEP            = 10

// Offset direction from directly-overhead determines what world axis is
// "up" on screen. Offset on +Z rotates the view 90° CCW from the old
// +X offset, so now +X points up and +Z points right on screen (matches
// the pan/d-pad axes).
const CAM_OFFSET_X = 0
const CAM_OFFSET_Z = -3
const TRANSITION_SPEED = 200
const FOLLOW_RATE = 5.0
const FOLLOW_SNAP_EPSILON = 0.05
const PAN_BOUNDS_MARGIN_BASE = 4

const DPAD_PAN_SPEED_BASE = 22
const DRAG_START_THRESHOLD_PX = 3
const DRAG_M_PER_PX_BASE = 0.025


// MARK: Module state
let camEntity:      Entity | null = null
let lookTargetEnt:  Entity | null = null
let active                        = false
let currentAltitude               = CAM_ALTITUDE_DEFAULT

const enum Mode { FOLLOW, FREE }
let mode: Mode = Mode.FOLLOW

const targetPos = { x: CENTER_X, z: CENTER_Z }
const panVel    = { x: 0,        z: 0 }

let dragActive  = false
let dragPanning = false
let dragAccumPx = 0


// MARK: setupTopDownCamera
export function setupTopDownCamera(): void {
	if (camEntity !== null) return

	lookTargetEnt = engine.addEntity()
	Transform.create(lookTargetEnt, {
		position: Vector3.create(targetPos.x, 0, targetPos.z),
	})

	camEntity = engine.addEntity()
	Transform.create(camEntity, {
		position: Vector3.create(targetPos.x + CAM_OFFSET_X, currentAltitude, targetPos.z + CAM_OFFSET_Z),
	})
	VirtualCamera.create(camEntity, {
		lookAtEntity:      lookTargetEnt,
		defaultTransition: { transitionMode: VirtualCamera.Transition.Speed(TRANSITION_SPEED) },
	})

	// Hotkey: 1 (IA_ACTION_3) toggles spectator. Also used by the mobile
	// eye button (see touchControls.ts).
	engine.addSystem((dt: number) => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) {
			playUiClick()
			toggleTopDownCamera()
		}
		// Safety net: pointer release ends any active drag even if the
		// UI catcher missed it (cursor left window etc.).
		if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
			dragActive  = false
			dragPanning = false
			dragAccumPx = 0
		}
		if (active) updateCamera(dt)
	})
}


// MARK: updateCamera
function updateCamera(dt: number): void {
	if (mode === Mode.FOLLOW) {
		const p = Transform.getOrNull(engine.PlayerEntity)?.position
		if (p) {
			const t = 1 - Math.exp(-FOLLOW_RATE * dt)
			const dx = p.x - targetPos.x
			const dz = p.z - targetPos.z
			if (Math.abs(dx) < FOLLOW_SNAP_EPSILON && Math.abs(dz) < FOLLOW_SNAP_EPSILON) {
				targetPos.x = p.x
				targetPos.z = p.z
			} else {
				targetPos.x += dx * t
				targetPos.z += dz * t
			}
		}
	} else {
		// Any player movement input re-engages follow.
		if (
			inputSystem.isPressed(InputAction.IA_FORWARD)  ||
			inputSystem.isPressed(InputAction.IA_BACKWARD) ||
			inputSystem.isPressed(InputAction.IA_LEFT)     ||
			inputSystem.isPressed(InputAction.IA_RIGHT)
		) {
			recenter()
		} else {
			targetPos.x += panVel.x * dt
			targetPos.z += panVel.z * dt
		}
	}

	clampToBounds()

	if (lookTargetEnt !== null) {
		const t = Transform.getMutable(lookTargetEnt)
		t.position.x = targetPos.x
		t.position.z = targetPos.z
	}
	if (camEntity !== null) {
		const t = Transform.getMutable(camEntity)
		t.position.x = targetPos.x + CAM_OFFSET_X
		t.position.y = currentAltitude
		t.position.z = targetPos.z + CAM_OFFSET_Z
	}
}


// MARK: clampToBounds
function clampToBounds(): void {
	// Margin scales with altitude so at high zoom edge cells can still
	// be centered on screen. Baseline calibrated at 30 m altitude.
	const margin = PAN_BOUNDS_MARGIN_BASE * (currentAltitude / 30)
	const minX = -margin
	const maxX = SCENE_WORLD_SIZE_X_METERS + margin
	const minZ = -margin
	const maxZ = SCENE_WORLD_SIZE_Z_METERS + margin
	if (targetPos.x < minX) targetPos.x = minX
	if (targetPos.x > maxX) targetPos.x = maxX
	if (targetPos.z < minZ) targetPos.z = minZ
	if (targetPos.z > maxZ) targetPos.z = maxZ
}


// MARK: toggleTopDownCamera
export function toggleTopDownCamera(): void {
	if (camEntity === null) return
	active = !active

	if (active) {
		const p = Transform.getOrNull(engine.PlayerEntity)?.position
		if (p) {
			targetPos.x = p.x
			targetPos.z = p.z
		}
		mode = Mode.FOLLOW
		panVel.x = 0
		panVel.z = 0
	}

	const main = MainCamera.getMutableOrNull(engine.CameraEntity)
		?? MainCamera.create(engine.CameraEntity)
	main.virtualCameraEntity = active ? camEntity : undefined
}


// MARK: isTopDownActive
export function isTopDownActive(): boolean {
	return active
}


// MARK: recenter
export function recenter(): void {
	mode     = Mode.FOLLOW
	panVel.x = 0
	panVel.z = 0
}


// MARK: applyPanDelta
export function applyPanDelta(dxPx: number, dyPx: number): void {
	if (!active) return
	if (!dragActive) return

	dragAccumPx += Math.abs(dxPx) + Math.abs(dyPx)
	if (!dragPanning) {
		if (dragAccumPx < DRAG_START_THRESHOLD_PX) return
		dragPanning = true
	}

	mode = Mode.FREE

	// Screen axes after the camera's -Z offset rotation: +Z is up, +X is right.
	// Mobile: camera-follows-finger (push the world) — drag right → camera +X.
	// Desktop: grab-and-pull (Google-Maps convention) — drag right → camera -X.
	const mPerPx = DRAG_M_PER_PX_BASE * (currentAltitude / 30)
	const xSign  = isMobile() ? 1 : -1
	targetPos.x +=  xSign * dxPx * mPerPx
	targetPos.z += -dyPx * mPerPx
}


// MARK: beginDrag
export function beginDrag(): void {
	if (!active) return
	dragActive  = true
	dragPanning = false
	dragAccumPx = 0
}


// MARK: endDrag
export function endDrag(): void {
	dragActive  = false
	dragPanning = false
	dragAccumPx = 0
}


// MARK: isDragging
export function isDragging(): boolean {
	return dragPanning
}


// MARK: beginPan
export function beginPan(vx: number, vz: number): void {
	if (!active) return
	mode     = Mode.FREE
	panVel.x = vx
	panVel.z = vz
}


// MARK: endPan
export function endPan(): void {
	panVel.x = 0
	panVel.z = 0
}


// MARK: getDpadSpeed
export function getDpadSpeed(): number {
	return DPAD_PAN_SPEED_BASE * (currentAltitude / 30)
}


// MARK: zoomIn
export function zoomIn(): void {
	if (!active) return
	const next = currentAltitude - CAM_ALTITUDE_STEP
	currentAltitude = next < CAM_ALTITUDE_MIN ? CAM_ALTITUDE_MIN : next
}


// MARK: zoomOut
export function zoomOut(): void {
	if (!active) return
	const next = currentAltitude + CAM_ALTITUDE_STEP
	currentAltitude = next > CAM_ALTITUDE_MAX ? CAM_ALTITUDE_MAX : next
}


// MARK: canZoomIn
export function canZoomIn(): boolean {
	return active && currentAltitude > CAM_ALTITUDE_MIN
}


// MARK: canZoomOut
export function canZoomOut(): boolean {
	return active && currentAltitude < CAM_ALTITUDE_MAX
}
