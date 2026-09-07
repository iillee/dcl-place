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

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
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


// -------- Progress readout --------
//
// Real progress is only partially observable from the client (we don't
// know total painted-pixel count until hydration is done, and on an
// empty canvas no tiles ever arrive), so we use a simple time-based
// ease as the base curve and snap to 100% the moment hydration flips.
//
//   - Base: eases 0 → 95% over ~6s of wall-time with an ease-out curve
//     (fast at first, slowing as it approaches 95). Always advancing,
//     never stalls waiting on a signal that may never come.
//   - Snap: when paintTelemetry().paintHydrated flips AND the apply
//     queue has drained, target jumps to 100%.
//
// A `lastShown` latch enforces monotonicity: the displayed number
// never decreases across frames.

const BASE_DURATION_MS = 6000
let lastShownProgress = 0

function computeProgressPct(): number {
	const t = paintTelemetry()

	// Only snap to 100% when the splash is ACTUALLY about to lift — i.e.
	// hydration is complete AND the cold-open minimum-display time has
	// elapsed. Otherwise (fast desktop hydrations) the bar would sit at
	// 100% for a couple of seconds while the min-time floor keeps the
	// splash up, which reads as "loaded but stuck".
	const elapsed         = Date.now() - coldOpenStartedAtMs
	const minTimeSatisfied = elapsed >= COLD_OPEN_MIN_MS
	const hydrationDone   = t.paintHydrated && !isApplyingHydration()

	let target: number
	if (hydrationDone && minTimeSatisfied) {
		target = 100
	} else {
		const linear = Math.min(1, elapsed / BASE_DURATION_MS)
		// Ease-out: 1 - (1 - x)^2. Fast start, gentle approach to 95%.
		const eased = 1 - Math.pow(1 - linear, 2)
		target = eased * 95
	}

	// Monotonic: never tick backward.
	lastShownProgress = Math.max(lastShownProgress, target)
	return Math.min(100, Math.floor(lastShownProgress))
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
				{/* Progress readout — bottom 25% of screen, centered.
				    Sits below the splash art so it never overlaps the wordmark.
				    Percentage number is big + bold; label sits underneath. */}
				<UiEntity
					key         = "ui_LoadingSplash_progress"
					uiTransform = {{
						width         : '100%',
						height        : '25%',
						positionType  : 'absolute',
						position      : { top: '75%', left: 0 },
						flexDirection : 'column',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
				>
					<Label
						value     = "Loading canvas"
						fontSize  = {22}
						color     = {Color4.Black()}
						textAlign = "middle-center"
						uiTransform = {{ width: '100%', height: 28 }}
					/>
					<Label
						value     = {`${computeProgressPct()}%`}
						fontSize  = {56}
						color     = {Color4.Black()}
						textAlign = "middle-center"
						uiTransform = {{ width: '100%', height: 64 }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const loadingSplashLayer = new LoadingSplashLayer()
