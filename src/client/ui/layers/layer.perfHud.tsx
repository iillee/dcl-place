/**
 * layer.perfHud.tsx — TEMPORARY perf HUD for the chunked-CRDT rollout.
 *
 * Always-on top-left overlay showing paint hydration metrics so playtesters
 * can screenshot numbers back to us. Delete this file + its registration in
 * ui/index.tsx once we've validated the migration scales to 100% saturation.
 *
 * Metrics:
 *   - Painted pixels observed via PaintTile CRDT (server-authoritative)
 *   - Fill %: painted / theoretical max (400 tiles × 256 cells = 102,400)
 *   - PaintTile CRDT entity count (chunked layout \u2014 should stay bounded)
 *   - Cell mesh entity count (still one per painted pixel \u2014 render ceiling)
 *   - Boot timings: module load \u2192 first tile, module load \u2192 hydration done
 *   - Rolling FPS (last 60 frames)
 *
 * The whole layer costs one <UiEntity> per line. Text updates via
 * React-ECS reactive state on a 500 ms tick so we don't re-render every
 * frame.
 */

import ReactEcs, { UiEntity, ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { paintTelemetry } from 'src/client/paint'
import { paintGridCapacity } from 'src/shared/paintGrid'
import { room } from 'src/shared/messages'


const REFRESH_INTERVAL_S = 0.5
const FPS_WINDOW_FRAMES  = 60


// MARK: Reactive HUD state (updated by system, read by body())

let lines: string[] = ['[perf] initializing\u2026']

const fpsSamples: number[] = []
let refreshClock = 0

engine.addSystem((dt: number) => {
	// FPS sampler \u2014 rolling window.
	fpsSamples.push(dt)
	if (fpsSamples.length > FPS_WINDOW_FRAMES) fpsSamples.shift()

	refreshClock += dt
	if (refreshClock < REFRESH_INTERVAL_S) return
	refreshClock = 0

	const t   = paintTelemetry()
	const cap = paintGridCapacity()
	const maxPixels = cap.cellCapacity
	const pct = maxPixels > 0 ? ((t.observedPaintedPx / maxPixels) * 100).toFixed(2) : '0.00'

	const now = Date.now()
	const sinceLoadMs = now - t.moduleLoadMs
	const firstTileDeltaMs = t.firstTileAtMs !== null
		? (t.firstTileAtMs - t.moduleLoadMs).toString() + 'ms'
		: '\u2014'
	const hydrationDeltaMs = t.lastHydrationAtMs !== null
		? (t.lastHydrationAtMs - t.moduleLoadMs).toString() + 'ms'
		: (t.paintHydrated ? '\u2014' : 'pending')

	const avgDt = fpsSamples.length > 0
		? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length
		: dt
	const fps = avgDt > 0 ? (1 / avgDt).toFixed(1) : '?'

	// Approximate live entity count: painted pixels each hold one MeshRenderer
	// plane entity. This is our render-side ceiling and the key mobile metric.
	// (400 tile GLBs + palette + UI entities not counted here.)
	const renderCells = t.observedPaintedPx

	// Rough CRDT bytes: PaintTile ships one byte per cell in the tile plus
	// a small protobuf overhead. tileShadowSize is the count of tiles the
	// client has actually observed. Undercounts headers but useful direction.
	const crdtBytesApprox = t.tileShadowSize * cap.cellsPerTile

	lines = [
		`[PERF HUD \u2014 temporary]`,
		`painted: ${t.observedPaintedPx} / ${maxPixels} (${pct}%)`,
		`tiles observed: ${t.tileShadowSize} (CRDT bytes ~${(crdtBytesApprox / 1024).toFixed(1)}KB)`,
		`render cells (mesh entities): ${renderCells}`,
		`first PaintTile: ${firstTileDeltaMs}   hydration: ${hydrationDeltaMs}`,
		`uptime: ${(sinceLoadMs / 1000).toFixed(1)}s   fps: ${fps}`,
	]
})


// MARK: PerfHudLayer

class PerfHudLayer extends Layer {
	constructor() {
		super({
			id  : 'perfHud',
			zone: ZoneType.TopLeft,
		})
	}

	body() {
		return (
			<UiEntity
				key         = "ui_PerfHud_root"
				uiTransform = {{
					width         : 380,
					height        : 'auto',
					padding       : { left: 8, right: 8, top: 6, bottom: 6 },
					flexDirection : 'column',
					margin        : { left: 8, top: 8 },
				}}
				uiBackground = {{ color: { r: 0, g: 0, b: 0, a: 0.62 } }}
			>
				{lines.map((line, i) => (
					<UiEntity
						key         = {`ui_PerfHud_line_${i}`}
						uiTransform = {{ width: '100%', height: 18 }}
						uiText      = {{
							value    : line,
							fontSize : 13,
							color    : i === 0
								? { r: 1.0, g: 0.85, b: 0.35, a: 1 }
								: { r: 1, g: 1, b: 1, a: 1 },
							textAlign: 'middle-left',
						}}
					/>
				))}

				{/* Debug storm buttons — server-side gated on DCL_PLACE_ALLOW_STORM.
				    Clicks fail silently in production. */}
				<UiEntity
					key         = "ui_PerfHud_stormRow"
					uiTransform = {{ width: '100%', height: 26, margin: { top: 6 }, flexDirection: 'row' }}
				>
					{stormButton('25k',  25000,  'random')}
					{stormButton('50k',  50000,  'random')}
					{stormButton('100k', 100000, 'random')}
					{stormButton('FILL', 102400, 'fill')}
					{stormButton('CLR',  0,      'clear')}
				</UiEntity>
			</UiEntity>
		)
	}
}


// MARK: stormButton

function stormButton(label: string, target: number, mode: string) {
	return (
		<UiEntity
			key         = {`ui_PerfHud_storm_${label}`}
			uiTransform = {{
				height      : 24,
				width       : 60,
				margin      : { right: 4 },
			}}
			uiBackground = {{ color: mode === 'clear'
				? { r: 0.6, g: 0.15, b: 0.15, a: 0.95 }
				: { r: 0.15, g: 0.35, b: 0.55, a: 0.95 } }}
			uiText       = {{ value: label, fontSize: 12, color: { r: 1, g: 1, b: 1, a: 1 }, textAlign: 'middle-center' }}
			onMouseDown  = {() => {
				console.log(`[PerfHud] storm click: target=${target} mode=${mode}`)
				room.send('debugStorm', { target, mode })
			}}
		/>
	)
}


export const perfHudLayer = new PerfHudLayer()

// Suppress unused-import warning for ReactEcsRenderer when tsx strips the
// namespace annotation at compile time.
void ReactEcsRenderer
