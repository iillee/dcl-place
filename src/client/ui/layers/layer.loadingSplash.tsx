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
// know total painted-pixel count until hydration is done), so we
// compose a monotonic estimate from three signals:
//
//   Phase A — pre-first-tile: bundle downloading + server waking +
//     CRDT initial state on the wire. We ease 0 → 30% over 4s of
//     wall-time. Fake but honest: something IS happening we can't
//     measure.
//
//   Phase B — tiles arriving, applyQueue draining: ease 30 → 90% over
//     the next 2s. Once paintHydrated flips, jump target to 95%.
//
//   Phase C — hydration done, min-time tail: ease to 100% quickly so
//     the bar visibly completes before the splash lifts.
//
// A `lastShown` latch enforces monotonicity: the displayed number
// never decreases, even if timings jitter across frames. Jumping
// backward reads as broken.

let lastShownProgress = 0

function computeProgressPct(): number {
	const elapsed = Date.now() - coldOpenStartedAtMs
	const t = paintTelemetry()

	let target: number
	if (t.firstTileAtMs === null) {
		// Phase A: 0 → 30% over 4s
		target = Math.min(30, (elapsed / 4000) * 30)
	} else if (!t.paintHydrated || isApplyingHydration()) {
		// Phase B: 30 → 90% over 2s from first tile
		const sinceFirst = Date.now() - t.firstTileAtMs
		target = 30 + Math.min(60, (sinceFirst / 2000) * 60)
	} else {
		// Phase C: hydration signaled complete
		target = 100
	}

	// Monotonic: never go backward.
	lastShownProgress = Math.max(lastShownProgress, target)
	return Math.min(100, Math.floor(lastShownProgress))
}

// Animated ellipsis for the "Loading canvas" label — rotates through
// "", ".", "..", "..." every ~400ms so the readout feels alive even
// when the number is stalled between phases.
function ellipsis(): string {
	const n = Math.floor(((Date.now() - coldOpenStartedAtMs) / 400) % 4)
	return '.'.repeat(n)
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
						value     = {`${computeProgressPct()}%`}
						fontSize  = {56}
						color     = {Color4.White()}
						textAlign = "middle-center"
						uiTransform = {{ width: '100%', height: 64 }}
					/>
					<Label
						value     = {`Loading canvas${ellipsis()}`}
						fontSize  = {22}
						color     = {Color4.White()}
						textAlign = "middle-center"
						uiTransform = {{ width: '100%', height: 28 }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const loadingSplashLayer = new LoadingSplashLayer()
