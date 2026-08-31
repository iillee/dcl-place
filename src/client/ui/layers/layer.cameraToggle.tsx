/**
 * layer.cameraToggle.tsx — bottom-right button that flips between the
 * normal player camera and the top-down "see the whole canvas" view.
 *
 * Same visual language as the flagtag Help/Status icons (small square
 * dark panel + centered symbol, gold when active or hovered), simplified
 * for a single toggle with no popup.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import { UI_THEME } from 'src/client/ui/theme/settings'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'


const { colors, borderRadius } = UI_THEME

// Muted gold, matches flagtag's active-icon tint.
const GOLD  = Color4.create(1.0, 0.84, 0.0, 1)
const WHITE = Color4.White()

// Horizontal 2 rows x 4 cols parcel-grid icon.
const GRID_COLS = 4
const GRID_ROWS = 2
const CELL_SIZE = 9
const CELL_GAP  = 2


// MARK: ParcelGridIcon
function ParcelGridIcon(props: { color: Color4 }) {
	const rows: any[] = []
	for (let r = 0; r < GRID_ROWS; r++) {
		const cells: any[] = []
		for (let c = 0; c < GRID_COLS; c++) {
			cells.push(
				<UiEntity
					key = {`cell_${r}_${c}`}
					uiTransform = {{
						width : CELL_SIZE,
						height: CELL_SIZE,
						margin: { left: c === 0 ? 0 : CELL_GAP },
					}}
					uiBackground = {{ color: props.color }}
				/>
			)
		}
		rows.push(
			<UiEntity
				key = {`row_${r}`}
				uiTransform = {{
					flexDirection: 'row',
					margin       : { top: r === 0 ? 0 : CELL_GAP },
				}}
			>
				{cells}
			</UiEntity>
		)
	}
	return (
		<UiEntity
			key = "parcel_grid_icon"
			uiTransform = {{ flexDirection: 'column', alignItems: 'center' }}
		>
			{rows}
		</UiEntity>
	)
}
// Reuse the same alpha as the version chip / stats panel so the button
// blends with the rest of the HUD without extra theme entries.
const PANEL_BG = colors.statsBg


// MARK: CameraToggleLayer
/**
 * Center-bottom camera-toggle button. Full-screen wrapper is required so
 * we can center a fixed-width child horizontally — an `absolute` element
 * with `left: '50%'` won't self-offset by half its width in React-ECS.
 */
export function CameraToggleLayer() {
	const active = isTopDownActive()
	return (
		<UiEntity
			key = "ui_CameraToggle_wrap"
			uiTransform = {{
				width        : '100%',
				height       : '100%',
				positionType : 'absolute',
				position     : { top: 0, left: 0 },
				flexDirection: 'row',
				justifyContent: 'flex-end',
				alignItems   : 'center',
				pointerFilter: 'none',   // let clicks fall through the wrapper
			}}
		>
			<UiEntity
				key = "ui_CameraToggle_btn"
				uiTransform = {{
					width       : 72,
					height      : 72,
					// Anchored below the vertical +/- stack on the right edge.
					// Stack: two 72px buttons + 8px top/bottom margin each = 176px
					// tall, centered on screen. This button sits just below it.
					margin      : { right: 32, top: 280 },
					justifyContent: 'center',
					alignItems  : 'center',
					borderRadius: borderRadius.md,
				}}
				uiBackground = {{ color: PANEL_BG }}
				onMouseDown = {toggleTopDownCamera}
			>
				<ParcelGridIcon color={active ? GOLD : WHITE} />
			</UiEntity>
		</UiEntity>
	)
}
