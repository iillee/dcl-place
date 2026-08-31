/**
 * layer.brushSize.tsx — bottom-center +/- buttons that grow or shrink the
 * local player's paint brush footprint.
 *
 * Sits just to the left of the CameraToggle button, using the same
 * visual language (dark square panel, centered glyph, gold on hover).
 * The current brush size is rendered as a small label between the two
 * buttons so the player has feedback while tapping.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

import {
	BRUSH_MAX_CELLS,
	BRUSH_MIN_CELLS,
	decreaseBrush,
	getBrushCells,
	increaseBrush,
} from 'src/client/brush'
import { isMusicMuted, toggleMusic } from 'src/client/audio'
import { getLocalTeam } from 'src/client/paint'
import { isTopDownActive, toggleTopDownCamera } from 'src/client/topDownCamera'
import { toggleServerStats } from 'src/client/ui/layers/layer.serverStats'
import { toggleSnapshot } from 'src/client/ui/layers/layer.snapshot'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { room } from 'src/shared/messages'
import { TEAM_COLORS } from 'src/shared/palette'
import { Team } from 'src/shared/team'


const { colors, fontSizes, borderRadius } = UI_THEME

const WHITE     = Color4.White()
const DIM       = Color4.create(1, 1, 1, 0.35)
const GOLD      = Color4.create(1.0, 0.84, 0.0, 1)
const PANEL_BG  = colors.statsBg
const RED_PAINT  = TEAM_COLORS[Team.Red]
const BLUE_PAINT = TEAM_COLORS[Team.Blue]

// Diameter of the color-swatch dot inside the paint-picker buttons.
const SWATCH_PX = 40

// Shared button footprint so every action button in the stack looks identical.
const BTN_SIZE       = 72
const BTN_MARGIN_Y   = 8   // vertical breathing room per-button (top + bottom)

// Parcel-grid icon inside the spectator button.
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
					key = {`gridCell_${r}_${c}`}
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
				key = {`gridRow_${r}`}
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
			key = "ui_ParcelGridIcon"
			uiTransform = {{ flexDirection: 'column', alignItems: 'center' }}
		>
			{rows}
		</UiEntity>
	)
}


// MARK: BrushButton
/**
 * A single square icon button. `enabled = false` renders it dimmed and
 * ignores clicks so the player sees min/max clamping.
 */
function BrushButton(props: {
	label     : string
	onClick   : () => void
	enabled   : boolean
	keySuffix : string
	/** Optional glyph size override (default 64) */
	fontSize? : number
	/** Optional optical-nudge overrides (defaults tuned for +/- glyphs) */
	nudgeTop? : number
	nudgeLeft?: number
}) {
	const fontSize  = props.fontSize  ?? 64
	const nudgeTop  = props.nudgeTop  ?? -10
	const nudgeLeft = props.nudgeLeft ?? 4
	return (
		<UiEntity
			key         = {`ui_BrushBtn_${props.keySuffix}`}
			uiTransform = {{
				width        : BTN_SIZE,
				height       : BTN_SIZE,
				margin       : { top: BTN_MARGIN_Y, bottom: BTN_MARGIN_Y },
				justifyContent: 'center',
				alignItems   : 'center',
				borderRadius : borderRadius.md,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {props.enabled ? props.onClick : () => {}}
		>
			<Label
				value    = {props.label}
				fontSize = {fontSize}
				color    = {props.enabled ? WHITE : DIM}
				font     = "sans-serif"
				textAlign= "middle-center"
				uiTransform = {{
					width : '100%',
					height: '100%',
					// Optical-nudge for glyph baseline / kerning quirks.
					margin: { top: nudgeTop, left: nudgeLeft },
				}}
			/>
		</UiEntity>
	)
}


// MARK: BrushSizeLayer
/**
 * Right-edge, vertically stacked +/- brush size controls. Anchored to
 * the middle-right of the screen with + on top, - beneath.
 */
export function BrushSizeLayer() {
	const size       = getBrushCells()
	const canDec     = size > BRUSH_MIN_CELLS
	const canInc     = size < BRUSH_MAX_CELLS
	const specActive = isTopDownActive()

	return (
		<UiEntity
			key = "ui_BrushSize_wrap"
			uiTransform = {{
				width        : '100%',
				height       : '100%',
				positionType : 'absolute',
				position     : { top: 0, left: 0 },
				flexDirection: 'row',
				justifyContent: 'flex-end',
				alignItems   : 'center',
				pointerFilter: 'none',
			}}
		>
			<UiEntity
				key = "ui_BrushSize_col"
				uiTransform = {{
					margin       : { right: 32 },
					flexDirection: 'column',
					alignItems   : 'center',
					justifyContent: 'center',
				}}
			>
				<BrushButton
					label     = "+"
					onClick   = {increaseBrush}
					enabled   = {canInc}
					keySuffix = "inc"
				/>
				<BrushButton
					label     = "-"
					onClick   = {decreaseBrush}
					enabled   = {canDec}
					keySuffix = "dec"
				/>
				<UiEntity
					key = "ui_SpectatorBtn"
					uiTransform = {{
						width        : BTN_SIZE,
						height       : BTN_SIZE,
						margin       : { top: BTN_MARGIN_Y, bottom: BTN_MARGIN_Y },
						justifyContent: 'center',
						alignItems   : 'center',
						borderRadius : borderRadius.md,
					}}
					uiBackground = {{ color: PANEL_BG }}
					onMouseDown  = {toggleTopDownCamera}
				>
					<ParcelGridIcon color={specActive ? GOLD : WHITE} />
				</UiEntity>
				<PaintSwatchButton
					keySuffix = "team"
					color     = {getLocalTeam() === Team.Blue ? BLUE_PAINT : RED_PAINT}
					onClick   = {() => {
						// Ask the server to switch us. Server echoes teamAssigned,
						// which clientHandler forwards to the eventBus — paint.ts
						// updates localTeam so the swatch + optimistic colour flip.
						const next = getLocalTeam() === Team.Blue ? Team.Red : Team.Blue
						room.send('switchTeam', { team: next })
					}}
				/>
				<BrushButton
					label     = "#"
					onClick   = {toggleServerStats}
					enabled   = {true}
					keySuffix = "stats"
					nudgeTop  = {-2}
				/>
				<BrushButton
					label     = {'\u25A3'}
					onClick   = {toggleSnapshot}
					enabled   = {true}
					keySuffix = "snap"
					fontSize  = {44}
					nudgeTop  = {-16}
				/>
				<UiEntity
					key = "ui_MuteBtn"
					uiTransform = {{
						width        : BTN_SIZE,
						height       : BTN_SIZE,
						margin       : { top: BTN_MARGIN_Y, bottom: BTN_MARGIN_Y },
						justifyContent: 'center',
						alignItems   : 'center',
						borderRadius : borderRadius.md,
					}}
					uiBackground = {{ color: PANEL_BG }}
					onMouseDown  = {toggleMusic}
				>
					<UiEntity
						key = "ui_MuteBtn_icon"
						uiTransform = {{ width: 44, height: 44 }}
						uiBackground = {{
							textureMode: 'stretch',
							texture    : { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
						}}
					/>
				</UiEntity>
			</UiEntity>
		</UiEntity>
	)
}


// MARK: PaintSwatchButton
/**
 * Empty stack button with an optional centered circular color swatch.
 * Same footprint / spacing as every other button in the right-edge stack.
 */
function PaintSwatchButton(props: {
	keySuffix: string
	color    : Color4 | null
	onClick  : () => void
}) {
	return (
		<UiEntity
			key         = {`ui_SwatchBtn_${props.keySuffix}`}
			uiTransform = {{
				width        : BTN_SIZE,
				height       : BTN_SIZE,
				margin       : { top: BTN_MARGIN_Y, bottom: BTN_MARGIN_Y },
				justifyContent: 'center',
				alignItems   : 'center',
				borderRadius : borderRadius.md,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {props.onClick}
		>
			{props.color ? (
				<UiEntity
					key = {`ui_SwatchDot_${props.keySuffix}`}
					uiTransform = {{
						width : SWATCH_PX,
						height: SWATCH_PX,
						borderRadius: SWATCH_PX / 2,
					}}
					uiBackground = {{ color: props.color }}
				/>
			) : null}
		</UiEntity>
	)
}
