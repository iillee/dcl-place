/**
 * layer.loadingSplash.tsx — cold-open splash overlay.
 *
 * Full-screen thumbnail (`assets/images/dclplace.png`) shown from scene
 * start until the initial tile cascade has drained AND a minimum
 * display time has elapsed. Hides the tile-pop-in seconds so players
 * see a clean curtain instead of the canvas assembling in front of
 * them.
 *
 * Ported from dcl-snowdrift's layer.loadingSplash (simplified — no
 * cycle-rollover override since dcl/place has no rounds).
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { paintTelemetry, isSpawningCanvas, isApplyingHydration } from 'src/client/paint'

// Solid-floor + lazy-spawn edition: cell entities are created only for
// painted pixels, as CRDT bytes arrive. Splash stays up while EITHER
// hydration hasn't signaled complete OR the apply queue is still
// draining (100 tiles × up to 256 cells each = big burst on hydration;
// we chunk applies at 300/frame so mobile doesn't stall).
function isRebuilding(): boolean {
	return isSpawningCanvas() || isApplyingHydration() || !paintTelemetry().paintHydrated
}


const SPLASH_IMAGE = 'assets/images/dclplace.png'

// Minimum time (ms) the splash stays visible from module load, even if
// the first tile cascade drains sooner. Guarantees every player sees
// the splash regardless of client speed.
const COLD_OPEN_MIN_MS = 2500

const coldOpenStartedAtMs = Date.now()

// Latches true the first frame we ever see isRebuilding() === true.
// Prevents the splash from hiding before the tile cascade has even
// started (e.g. on very fast clients where the splash mounts before
// rebuildMaze() has queued anything).
let hasSeenRebuildStart = false


/**
 * True while the splash overlay is visible. Exported so other UI layers
 * can short-circuit their body() during load — prevents mobile UI
 * (color picker, top bar, help/leaderboard toggles) from bleeding
 * through and looking half-loaded before the splash lifts.
 */
export function isSplashActive(): boolean {
	if (isRebuilding()) {
		hasSeenRebuildStart = true
		return true
	}
	if (Date.now() - coldOpenStartedAtMs < COLD_OPEN_MIN_MS) return true
	if (!hasSeenRebuildStart) return true
	return false
}


class LoadingSplashLayer extends Layer {
	constructor() {
		super({
			id  : 'loadingSplash',
			zone: ZoneType.FullScreen,
		})
	}

	body() {
		if (!isSplashActive()) return <UiEntity />

		// Two-layer splash to defeat the mobile texture-load race:
		//   1. Outer entity = opaque solid color. Renders immediately on
		//      mount, so even if the PNG texture hasn't decoded yet the
		//      scene + UI behind us are fully covered.
		//   2. Inner entity = the actual dclplace.png image, layered on
		//      top. Fades in the moment the texture is resident.
		// Without (1), mobile cold-loads flashed the level + HUD for a
		// frame while the splash texture was still fetching/decoding.
		return (
			<UiEntity
				key         = "ui_LoadingSplash_root"
				uiTransform = {{
					width         : '100%',
					height        : '100%',
					positionType  : 'absolute',
					justifyContent: 'center',
					alignItems    : 'center',
				}}
				uiBackground = {{ color: Color4.create(0, 0, 0, 1) }}
			>
				<UiEntity
					key         = "ui_LoadingSplash_image"
					uiTransform = {{
						width       : '100%',
						height      : '100%',
						positionType: 'absolute',
					}}
					uiBackground = {{
						textureMode: 'stretch',
						texture    : { src: SPLASH_IMAGE },
					}}
				/>
			</UiEntity>
		)
	}
}


export const loadingSplashLayer = new LoadingSplashLayer()
