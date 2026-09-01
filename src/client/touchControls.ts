/**
 * touchControls.ts — mobile on-screen gamepad configuration.
 *
 * DCL renders a fixed cluster of native on-screen buttons around the
 * jump button on mobile. Button order follows a fixed priority stack:
 *   JUMP > POINTER (hand) > PRIMARY (E) > SECONDARY (F)
 *        > ACTION_3 (1) > ACTION_4 (2) > ACTION_5 (3) > ACTION_6 (4)
 * With 5 or fewer visible, all show directly; with more, the last slot
 * becomes a "+" overflow toggle. We hide ACTION_4/5/6 so exactly 4
 * buttons surround JUMP with no "+".
 *
 * Mapping (mobile only):
 *   • IA_POINTER   (hand)  → HIDDEN. Binding it to a global action
 *                            back-fires because ANY mobile UI tap
 *                            (d-pad, zoom, swatches, paint) fires
 *                            IA_POINTER, so a global handler would
 *                            toggle on every UI interaction.
 *   • IA_PRIMARY   (E)     → mute/unmute icon; toggleMusic
 *   • IA_SECONDARY (F)     → leaderboard icon; toggleLeaderboard
 *   • IA_ACTION_3  (slot3) → eye icon; toggleTopDownCamera
 *                            (dispatch owned by topDownCamera.ts)
 *   • IA_ACTION_4  (slot4) → help "?" icon; toggleHelpPanel
 *
 * TouchScreenControls only affects native on-screen buttons, so this
 * whole module is a no-op on desktop. Requires SDK 7.26.0+.
 */

import {
	InputAction,
	PointerEventType,
	TouchScreenControls,
	engine,
	inputSystem,
} from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

import { isMusicMuted, toggleMusic } from 'src/client/audio'
import { toggleHelpPanel }           from 'src/client/ui/layers/layer.helpPanel'
import { toggleLeaderboard }         from 'src/client/ui/layers/layer.leaderboard'


// MARK: Module state
let installed = false

// Icon sources for the repurposed action buttons.
const EYE_ICON_SRC    = 'assets/images/eye3.png'
const MUTED_ICON_SRC  = 'assets/images/muted_padded.png'
const UNMUTE_ICON_SRC = 'assets/images/unmute_padded.png'
const HELP_ICON_SRC   = 'assets/images/help-v3.png'
const LB_ICON_SRC     = 'assets/images/star3.png'


// MARK: applyLayout
function applyLayout(): void {
	const muteSrc = isMusicMuted() ? MUTED_ICON_SRC : UNMUTE_ICON_SRC

	TouchScreenControls.createOrReplace(engine.RootEntity, {
		touchInputs: [
			// Hand → hidden (see header note on IA_POINTER back-fire).
			{ inputAction: InputAction.IA_POINTER, hide: true },
			// E → mute / unmute (icon tracks state)
			{
				inputAction: InputAction.IA_PRIMARY,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: muteSrc } } },
			},
			// F → leaderboard
			{
				inputAction: InputAction.IA_SECONDARY,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: LB_ICON_SRC } } },
			},
			// Slot 3 → eye / spectator
			{
				inputAction: InputAction.IA_ACTION_3,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: EYE_ICON_SRC } } },
			},
			// Slot 4 → help "?"
			{
				inputAction: InputAction.IA_ACTION_4,
				hide       : false,
				icon       : { tex: { $case: 'texture', texture: { src: HELP_ICON_SRC } } },
			},
			// Hide the rest so no "+" overflow appears.
			{ inputAction: InputAction.IA_ACTION_5, hide: true },
			{ inputAction: InputAction.IA_ACTION_6, hide: true },
		],
		hideJoystick : false,
		hideCrosshair: false,
	})
}


// MARK: setupTouchControls
/**
 * Configure the native mobile button cluster and register the input
 * dispatch system. Idempotent — safe to call once from bootstrap.
 * No-op on desktop.
 */
export function setupTouchControls(): void {
	if (installed) return
	installed = true

	if (!isMobile()) return

	applyLayout()

	// Rising-edge dispatch.
	// NOTE: IA_ACTION_3 (spectator) is NOT handled here — topDownCamera.ts
	// already owns that input action for both desktop and mobile.
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
			toggleMusic()
			applyLayout() // re-apply so mute glyph tracks state
		}
		if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
			toggleLeaderboard()
		}
		if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) {
			toggleHelpPanel()
		}
	})

	console.log('touchControls: mobile layout applied (E=mute, F=leaderboard, 3=spec, 4=help)')
}
