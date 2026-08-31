/**
 * layer.cooldown.tsx — bottom-center cooldown pill.
 *
 * Reads server-truthful cooldown state from `placeState` and renders a
 * horizontal fill bar plus a text label:
 *   - "READY" (success color) when the player may place a pixel
 *   - "3.2s"  countdown while a cooldown is active
 *
 * The fill progresses from 0 → 100% as the cooldown drains. A per-frame
 * system polls `cooldownRemainingMs()` and pushes updates into
 * `PropsController` so the layer rerenders smoothly (~10 Hz is enough for
 * a mobile ring, but per-frame is cheap and matches how DUCK examples poll).
 *
 * Placement: same Bottom zone as the color picker, lifted higher via
 * `uiTransform.margin.bottom` so it sits directly above the swatch row.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { engine } from '@dcl/sdk/ecs'

import { Layer, PropsController, ZoneType } from '@stom66/dcl-ui-component-kit'

import { PAINT_COOLDOWN_MS } from 'src/shared/settings'
import { canPlaceNow, cooldownRemainingMs } from 'src/client/placeState'
import { placeAtFeet } from 'src/client/placeInput'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, fontSizes } = UI_THEME

const PILL_WIDTH  = 220
const PILL_HEIGHT = 44
// Sits above the color picker (56 swatch + 10 pad*2 + 16 margin = ~92 px).
const BOTTOM_OFFSET = 120


type CooldownProps = {
	remainingMs: number
}


// MARK: CooldownLayer
class CooldownLayer extends Layer {

	constructor() {
		super({
			id  : 'cooldown',
			zone: ZoneType.BottomCenter,
			// NOTE: no width/height here — forwarding those to the Zone pins it
			// to left:25% and breaks centering. Size lives on the child UiEntity.
			uiTransform: {
				margin: { bottom: BOTTOM_OFFSET },
			},
		})

		this.props = new PropsController<CooldownProps>({
			remainingMs: cooldownRemainingMs(),
		})

		// Per-frame poll of cooldown remaining. `PropsController.set` no-ops
		// via reference equality? No — it always emits. To avoid a rerender
		// every single frame while nothing changes, only push when the
		// rendered value (rounded to 100ms) actually changed.
		let lastBucket = -1
		engine.addSystem(() => {
			const remaining = cooldownRemainingMs()
			const bucket    = Math.ceil(remaining / 100)
			if (bucket === lastBucket) return
			lastBucket = bucket
			this.props?.set('remainingMs', remaining)
		})
	}


	// MARK: body
	body() {
		const remaining = (this.props?.get('remainingMs') as number) ?? 0
		const ready     = remaining <= 0

		// Progress: 0 → 1 as the cooldown drains toward READY.
		const progress   = ready ? 1 : 1 - remaining / PAINT_COOLDOWN_MS
		const fillColor  = ready ? colors.success : colors.info
		const labelText  = ready ? 'READY' : `${(remaining / 1000).toFixed(1)}s`

		return (
			<UiEntity
				uiTransform  = {{
					width       : PILL_WIDTH,
					height      : PILL_HEIGHT,
					borderRadius: borderRadius.pill,
				}}
				uiBackground = {{ color: colors.statsBg }}
				onMouseDown  = {() => { if (canPlaceNow()) placeAtFeet() }}
			>
				{/* Fill bar — grows left→right behind the label. */}
				<UiEntity
					uiTransform  = {{
						positionType: 'absolute',
						position    : { left: 0, top: 0 },
						width       : `${progress * 100}%`,
						height      : '100%',
						borderRadius: borderRadius.pill,
					}}
					uiBackground = {{ color: fillColor }}
				/>

				{/* Label — plain uiText on a transparent UiEntity so DUCK's Label
				    background chip doesn't overlay a second color on the pill. */}
				<UiEntity
					uiTransform = {{
						positionType  : 'absolute',
						position      : { left: 0, top: 0 },
						width         : '100%',
						height        : '100%',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
					uiText = {{
						value    : labelText,
						fontSize : fontSizes.lg,
						color    : colors.light,
						textAlign: 'middle-center',
					}}
				/>
			</UiEntity>
		)
	}
}


export const cooldownLayer = new CooldownLayer()
