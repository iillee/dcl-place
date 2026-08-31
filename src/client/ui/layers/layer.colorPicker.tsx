/**
 * layer.colorPicker.tsx — bottom-center 16-swatch palette picker.
 *
 * Displays the 16-color r/place palette (`PLACE_PALETTE`) as a horizontal
 * row of tap targets. Tapping a swatch sets the client-side selected
 * palette index used by `placeInput` for the next tap-to-place.
 *
 * The row uses a single Bottom zone with a small bottom margin so it sits
 * flush above the mobile safe area. `PropsController` mirrors the
 * currently-selected index so the highlighted swatch stays in sync when
 * something else (e.g. keyboard shortcuts, tests) changes selection.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import type { Color4 } from '@dcl/sdk/math'

import { Layer, PropsController, ZoneType } from '@stom66/dcl-ui-component-kit'

import { PLACE_PALETTE } from 'src/shared/palette'
import {
	getSelectedPaletteIndex,
	setSelectedPaletteIndex,
	subscribePlaceState,
} from 'src/client/placeState'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, spacing } = UI_THEME

const SWATCH_SIZE     = 56
const SWATCH_GAP      = 6
const SELECTED_BORDER = 3
const PANEL_PAD       = 10

// Render every entry in PLACE_PALETTE in its natural order. paletteIndex
// = position in PLACE_PALETTE + 1 (index 0 is reserved for "unpainted").
const VISIBLE_PALETTE: Array<{ paletteIndex: number, color: Color4 }> =
	PLACE_PALETTE.map((color, i) => ({ paletteIndex: i + 1, color }))
const PALETTE_COUNT   = VISIBLE_PALETTE.length
// Extra horizontal buffer so the selected-swatch border + Background edge
// don't clip the last swatch.
const PANEL_EXTRA_PAD = SELECTED_BORDER * 2
const PANEL_WIDTH     = PALETTE_COUNT * SWATCH_SIZE + (PALETTE_COUNT - 1) * SWATCH_GAP + PANEL_PAD * 2 + PANEL_EXTRA_PAD
const PANEL_HEIGHT    = SWATCH_SIZE + PANEL_PAD * 2


type PickerProps = {
	selected: number
}


// MARK: ColorPickerLayer
class ColorPickerLayer extends Layer {

	constructor() {
		super({
			id  : 'colorPicker',
			zone: ZoneType.BottomCenter,
			// NOTE: do NOT set width/height on the Layer's uiTransform. Doing
			// so is forwarded to the Zone, which already has left:25% + right:25%.
			// Adding an explicit width pins the Zone to left:25% and breaks the
			// symmetric centering. The child <UiEntity> below owns the panel size.
			uiTransform: {
				margin: { bottom: 16 },
			},
		})

		this.props = new PropsController<PickerProps>({
			selected: getSelectedPaletteIndex(),
		})

		// Mirror the shared placeState into local props so the layer
		// rerenders when selection changes from any source.
		subscribePlaceState(() => {
			if (!this.props) return
			this.props.set('selected', getSelectedPaletteIndex())
		})
	}


	// MARK: body
	body() {
		const selected = (this.props?.get('selected') as number) ?? 1

		return (
			<UiEntity
				uiTransform  = {{
					width        : PANEL_WIDTH,
					height       : PANEL_HEIGHT,
					padding      : PANEL_PAD,
					borderRadius : borderRadius.md,
					flexDirection: 'row',
					alignItems   : 'center',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				{VISIBLE_PALETTE.map((entry, i) => {
					const isSelected = entry.paletteIndex === selected
					const isLast     = i === VISIBLE_PALETTE.length - 1
					return renderSwatch(entry.color, entry.paletteIndex, isSelected, isLast)
				})}
			</UiEntity>
		)
	}
}


// MARK: renderSwatch
function renderSwatch(color: Color4, paletteIndex: number, isSelected: boolean, isLast: boolean) {
	return (
		<UiEntity
			key         = {`swatch_${paletteIndex}`}
			uiTransform = {{
				width       : SWATCH_SIZE,
				height      : SWATCH_SIZE,
				flexShrink  : 0,
				margin      : { right: isLast ? 0 : SWATCH_GAP },
				borderRadius: borderRadius.sm,
				borderWidth : isSelected ? SELECTED_BORDER : 0,
				borderColor : isSelected ? colors.light : undefined,
			}}
			uiBackground = {{ color }}
			onMouseDown  = {() => setSelectedPaletteIndex(paletteIndex)}
		/>
	)
}


export const colorPickerLayer = new ColorPickerLayer()
