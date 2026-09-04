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
import { Color4 } from '@dcl/sdk/math'
import { engine } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

import { playUiClick } from 'src/client/audio'

import { Layer, PropsController, ZoneType } from '@stom66/dcl-ui-component-kit'

import { PLACE_PALETTE, PALETTE_NONE } from 'src/shared/palette'
import {
	canPlaceNow,
	cooldownRemainingMs,
	getSelectedPaletteIndex,
	setSelectedPaletteIndex,
	subscribePlaceState,
} from 'src/client/placeState'
import { placeAtFeet } from 'src/client/placeInput'
import { PAINT_COOLDOWN_MS } from 'src/shared/settings'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius, spacing } = UI_THEME

const SWATCH_SIZE     = 56
const SWATCH_GAP      = 6
const SELECTED_BORDER       = 3
// The black ring on white-backed swatches (white + eraser) reads thinner
// on-screen than the white ring on colored swatches at the same pixel
// width, so bump it up to match.
const SELECTED_BORDER_BLACK = 3
const PANEL_PAD       = 10
// Paint button sits inline to the right of the swatch panel. Height
// matches the panel (SWATCH_SIZE + PANEL_PAD*2 = 76) so both read as one
// row; width gives the fill room to feel like progress, not a dot.
// Mobile gets a wider paint button (2×) since it's the primary tap
// target — no F key fallback on mobile.
const PAINT_BTN_W       = isMobile() ? 192 : 96
const PAINT_BTN_H       = SWATCH_SIZE + PANEL_PAD * 2
const PAINT_BTN_GAP     = 10
// Snowdrift torch pattern: framed button with an inset fill that grows
// horizontally (left→right for us; theirs grows bottom→top). Border +
// symmetric inset make the fill read as "inside" the frame.
const PAINT_BORDER_W    = 4
const PAINT_BORDER_OFF  = { r: 1, g: 1, b: 1, a: 0.75 } as const
const PAINT_FILL_INSET  = 4
// Paletteindex of white — the F glyph flips to black when this is
// selected so it stays readable against the fill.
const WHITE_PALETTE_INDEX = 7
const KEY_HINT_WHITE      = Color4.create(1, 1, 1, 0.95)
const KEY_HINT_BLACK      = Color4.create(0, 0, 0, 1)
// Opaque black used for the white-swatch selection ring (alpha-blended
// KEY_HINT_BLACK reads as grey on top of pure white).
const SELECT_RING_BLACK   = Color4.create(0, 0, 0, 1)

// Eraser occupies palette index 0 (PALETTE_NONE). Rendered on the LEFT
// as a white square with a red diagonal (assets/images/eraser.png). Its
// swatch color entry is just a placeholder — the icon PNG is drawn on top.
const ERASER_COLOR = Color4.create(1, 1, 1, 1)

// Render every entry in PLACE_PALETTE in its natural order. paletteIndex
// = position in PLACE_PALETTE + 1 (index 0 is reserved for "unpainted" /
// eraser — which is prepended as the first entry below).
const VISIBLE_PALETTE: Array<{ paletteIndex: number, color: Color4, iconSrc?: string }> = [
	{ paletteIndex: PALETTE_NONE, color: ERASER_COLOR, iconSrc: 'assets/images/eraser.png' },
	...PLACE_PALETTE.map((color, i) => ({ paletteIndex: i + 1, color })),
]
const PALETTE_COUNT   = VISIBLE_PALETTE.length
// Extra horizontal buffer so the selected-swatch border + Background edge
// don't clip the last swatch.
const PANEL_EXTRA_PAD = SELECTED_BORDER * 2
const PANEL_WIDTH     = PALETTE_COUNT * SWATCH_SIZE + (PALETTE_COUNT - 1) * SWATCH_GAP + PANEL_PAD * 2 + PANEL_EXTRA_PAD
const PANEL_HEIGHT    = SWATCH_SIZE + PANEL_PAD * 2


type PickerProps = {
	selected   : number
	remainingMs: number
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
				// Nudge up on mobile so it clears the on-screen jump / action
				// button and the cooldown pill.
				margin: { bottom: isMobile() ? 48 : 16 },
			},
		})

		this.props = new PropsController<PickerProps>({
			selected   : getSelectedPaletteIndex(),
			remainingMs: cooldownRemainingMs(),
		})

		// Mirror the shared placeState into local props so the layer
		// rerenders when selection changes from any source.
		subscribePlaceState(() => {
			if (!this.props) return
			this.props.set('selected', getSelectedPaletteIndex())
		})

		// Cooldown poll — bucketize to 100ms so we don't rerender every
		// single frame while nothing visible has changed. Also polls the
		// selected palette index as a safety net for mobile, where the
		// subscribePlaceState notify -> props.set path occasionally fails
		// to redraw the selection border on tap.
		let lastBucket = -1
		engine.addSystem(() => {
			if (!this.props) return
			const sel = getSelectedPaletteIndex()
			if (sel !== this.props.get('selected')) this.props.set('selected', sel)
			const remaining = cooldownRemainingMs()
			const bucket    = Math.ceil(remaining / 100)
			if (bucket === lastBucket) return
			lastBucket = bucket
			this.props.set('remainingMs', remaining)
		})
	}


	// MARK: body
	body() {
		const selected  = (this.props?.get('selected')    as number) ?? 1
		const remaining = (this.props?.get('remainingMs') as number) ?? 0

		return (
			<UiEntity
				key         = "ui_ColorPicker_row"
				uiTransform = {{
					flexDirection : 'row',
					alignItems    : 'center',
					justifyContent: 'center',
				}}
			>
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
						return renderSwatch(entry.color, entry.paletteIndex, isSelected, isLast, entry.iconSrc)
					})}
				</UiEntity>

				{renderPaintButton(remaining, selected)}
			</UiEntity>
		)
	}
}


// MARK: renderPaintButton
// Ported from snowdrift's TorchButton fuel-fill: framed slot with an
// inset inner bar that grows via percentage sizing (so it scales with
// canvas rescales instead of drifting out on window resize). Same outer
// frame + inner bar split as snowdrift so a border + centred child
// coexist cleanly. Only the axis is different — theirs fills bottom→
// top for fuel drain; ours fills left→right for cooldown recharge.
function renderPaintButton(remainingMs: number, selectedPaletteIndex: number) {
	const ready         = remainingMs <= 0
	const progress      = ready ? 1 : 1 - remainingMs / PAINT_COOLDOWN_MS
	const fillWidthPct  = `${Math.round(progress * 100)}%` as const
	// Fill is always the currently-selected palette color. "Fully filled"
	// = ready to paint; a partial fill IS the cooldown.
	// Eraser (index 0) fills the paint button with the eraser icon
	// (white + red diagonal) instead of a solid color so it visually
	// matches the eraser swatch.
	const isEraser      = selectedPaletteIndex === PALETTE_NONE
	const fillColor     = isEraser
		? Color4.create(1, 1, 1, 1)
		: (PLACE_PALETTE[selectedPaletteIndex - 1] ?? PLACE_PALETTE[0])
	// Only apply the diagonal texture when the bar is fully charged —
	// otherwise the stretch-scaled texture would distort the diagonal as
	// the fill grows. During cooldown the eraser bar is plain white.
	const fillBg        = (isEraser && ready)
		? { color: fillColor, textureMode: 'stretch' as const, texture: { src: 'assets/images/eraser.png' } }
		: { color: fillColor }
	// Both the white swatch and the eraser (white-backed) need the dark
	// glyph so the `F` stays readable against the fill.
	const hintColor     = (selectedPaletteIndex === WHITE_PALETTE_INDEX || isEraser)
		? KEY_HINT_BLACK
		: KEY_HINT_WHITE
	return (
		<UiEntity
			key         = "ui_PaintBtn"
			uiTransform = {{
				width       : PAINT_BTN_W,
				height      : PAINT_BTN_H,
				margin      : { left: PAINT_BTN_GAP },
				borderRadius: borderRadius.md,
				borderWidth : PAINT_BORDER_W,
				borderColor : PAINT_BORDER_OFF,
			}}
			uiBackground = {{ color: colors.statsBg }}
			onMouseDown  = {() => { if (canPlaceNow()) placeAtFeet() }}
		>
			{/* Fill frame — fills the content box with a symmetric inset ring,
			   then flex-anchors the inner bar to the LEFT so it grows right
			   as `progress` climbs. Percentage sizing keeps the fill inside
			   the frame across canvas rescales. Snowdrift TorchButton uses
			   the identical pattern with column + flex-end for bottom-up. */}
			<UiEntity
				key         = "ui_PaintBtn_fillFrame"
				// Absolute overlay covers the whole button, so on mobile it
				// intercepts taps before they bubble to the parent's
				// onMouseDown. Duplicate the paint handler here so tapping
				// anywhere on the button actually paints.
				onMouseDown = {() => { if (canPlaceNow()) placeAtFeet() }}
				uiTransform = {{
					positionType   : 'absolute',
					// Explicit pixel size subtracting the border on both axes.
					// `width:'100%'` measured from the outer border-box (leaking
					// PAINT_BORDER_W past the frame on mobile); anchor-all-edges
					// via `position:{left,right,top,bottom:0}` didn't render
					// reliably. Fixed pixel dims + position 0,0 (which Yoga
					// resolves to the top-left of the padding box, i.e. inside
					// the border) is the one that actually pins the fill.
					position       : { left: 0, top: 0 },
					width          : PAINT_BTN_W - PAINT_BORDER_W * 2,
					height         : PAINT_BTN_H - PAINT_BORDER_W * 2,
					padding        : {
						top   : PAINT_FILL_INSET,
						bottom: PAINT_FILL_INSET,
						left  : PAINT_FILL_INSET,
						right : PAINT_FILL_INSET,
					},
					flexDirection  : 'row',
					justifyContent : 'flex-start',
					alignItems     : 'stretch',
				}}
			>
				<UiEntity
					key         = "ui_PaintBtn_fillBar"
					uiTransform = {{
						width       : fillWidthPct,
						height      : '100%',
						borderRadius: borderRadius.sm,
					}}
					uiBackground = {fillBg}
				/>
			</UiEntity>

			{/* Desktop key hint — small centred `F`. Hidden on mobile (no
			   keyboard). Flips to black when white is the selected color so
			   the glyph stays readable against the fill. */}
			{!isMobile() && (
				<UiEntity
					key         = "ui_PaintBtn_keyHint"
					uiTransform = {{
						positionType  : 'absolute',
						position      : { left: 0, top: 0 },
						width         : '100%',
						height        : '100%',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
					uiText = {{
						value    : '<b>F</b>',
						fontSize : 22,
						color    : hintColor,
						textAlign: 'middle-center',
					}}
				/>
			)}

			{/* Mobile ready hint — shows "click" only when the cooldown has
			   fully drained and the button is ready to paint. Flips to black
			   on white so it stays readable. */}
			{isMobile() && ready && (
				<UiEntity
					key         = "ui_PaintBtn_readyHint"
					uiTransform = {{
						positionType  : 'absolute',
						position      : { left: 0, top: -6 },
						width         : '100%',
						height        : '100%',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
					uiText = {{
						// Plain string (no <b>) — rich-text markup on a Label/uiText
						// bleeds into the parent hitbox measurement even when the
						// child is absolutely positioned, shrinking the tappable
						// area of the paint button on mobile. See snowdrift bug
						// report: react-ecs-richtext-hitbox-mismatch.md.
						value    : 'click',
						fontSize : 28,
						color    : hintColor,
						textAlign: 'middle-center',
					}}
				/>
			)}
		</UiEntity>
	)
}


// MARK: renderSwatch
// Two-layer structure: an outer WRAPPER draws the selection ring, and an
// inner FILL holds the color/texture background. DCL's borderWidth is
// otherwise partially obscured by the uiBackground (especially textures),
// making the ring look like it's *behind* the swatch. Splitting the ring
// out into its own element guarantees it renders on top of the fill.
function renderSwatch(color: Color4, paletteIndex: number, isSelected: boolean, isLast: boolean, iconSrc?: string) {
	// White swatch (and eraser, which is also white-backed) gets a black
	// selection ring so it's visible against the default border color.
	const whiteBacked = paletteIndex === WHITE_PALETTE_INDEX || paletteIndex === PALETTE_NONE
	const selBorder   = whiteBacked ? SELECT_RING_BLACK : colors.light
	const ringWidth   = whiteBacked ? SELECTED_BORDER_BLACK : SELECTED_BORDER
	return (
		<UiEntity
			// Include selection state in the key so the swatch REMOUNTS
			// when it's selected / deselected. DCL react-ecs sometimes
			// fails to update borderWidth / borderColor on an already-
			// mounted UiEntity (works on desktop, silently no-ops on
			// mobile), so a key change is the reliable way to make the
			// selection ring appear on the newly-tapped swatch.
			key         = {`swatch_${paletteIndex}_${isSelected ? 'sel' : 'unsel'}`}
			uiTransform = {{
				width       : SWATCH_SIZE,
				height      : SWATCH_SIZE,
				flexShrink  : 0,
				margin      : { right: isLast ? 0 : SWATCH_GAP },
				borderRadius: borderRadius.sm,
				borderWidth : isSelected ? ringWidth : 0,
				borderColor : isSelected ? selBorder : undefined,
			}}
			onMouseDown  = {() => {
				// Play the UI click on every swatch tap for consistent feedback.
				playUiClick()
				setSelectedPaletteIndex(paletteIndex)
			}}
		>
			{/* Fill layer — sits INSIDE the wrapper's border box so the
			   selection ring is never covered by the color/texture. */}
			<UiEntity
				key         = {`swatch_${paletteIndex}_fill`}
				uiTransform = {{
					positionType  : 'absolute',
					position      : { left: 0, top: 0 },
					width         : '100%',
					height        : '100%',
					borderRadius  : borderRadius.sm,
					justifyContent: 'center',
					alignItems    : 'center',
				}}
				uiBackground = {iconSrc
					? { color, textureMode: 'stretch', texture: { src: iconSrc } }
					: { color }
				}
			>
				{/* Desktop key hint — `E` cycles palette. Only shown on the
				   selected swatch; flips to black on the white / eraser swatch
				   so it stays readable against the light fill. */}
				{isSelected && !isMobile() && (
					<UiEntity
						key         = {`swatch_${paletteIndex}_keyHint`}
						uiTransform = {{
							positionType  : 'absolute',
							position      : { left: 0, top: 0 },
							width         : '100%',
							height        : '100%',
							justifyContent: 'center',
							alignItems    : 'center',
						}}
						uiText = {{
							value    : '<b>E</b>',
							fontSize : 22,
							color    : whiteBacked ? KEY_HINT_BLACK : KEY_HINT_WHITE,
							textAlign: 'middle-center',
						}}
					/>
				)}
			</UiEntity>
		</UiEntity>
	)
}


export const colorPickerLayer = new ColorPickerLayer()
