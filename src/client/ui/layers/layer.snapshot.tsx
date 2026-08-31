/**
 * layer.snapshot.tsx \u2014 modal overlay that renders the current paint
 * state as a colored-cell mosaic and offers a "Download PNG" button.
 *
 * Visible / hidden via toggleSnapshot(); wired to the camera icon in the
 * right-edge HUD stack (layer.brushSize.tsx).
 *
 * The inline mosaic is rendered as a grid of UiEntity boxes (React-ECS
 * cannot display a data-URL as a texture, so we can't just show the PNG
 * directly). The Download button generates the actual PNG on click and
 * calls openExternalUrl() so the player's browser opens it; from there
 * they can save it to their device.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'

import { buildSnapshotPixels, SNAPSHOT_HEIGHT_CELLS, SNAPSHOT_WIDTH_CELLS, snapshotDataUrl } from 'src/client/paintSnapshot'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { getCurrentCanvasSize } from 'src/client/ui/utils/sizing'


const { colors, borderRadius, fontSizes, spacing } = UI_THEME

// Screen area reserved for other HUD elements so the mosaic never sits
// under them. Right stack is ~72px + 32px margin; we leave a bit more.
// The button row + panel padding beneath the mosaic needs ~140px.
const RESERVED_RIGHT_PX  = 140
const RESERVED_BOTTOM_PX = 160
const RESERVED_MARGIN_PX = 40   // breathing room around the mosaic edges
// Absolute floor / ceiling for cell size so tiny viewports still fit.
const MIN_CELL_PX = 3
const MAX_CELL_PX = 20


// MARK: computeCellPx
/**
 * Choose the largest integer PREVIEW_CELL_PX that keeps the mosaic
 * inside the available (screen minus reserved HUD) area while preserving
 * the 112:64 aspect ratio.
 */
function computeCellPx(): number {
	const { width, height } = getCurrentCanvasSize()
	const availW = Math.max(200, width  - RESERVED_RIGHT_PX  - RESERVED_MARGIN_PX * 2)
	const availH = Math.max(200, height - RESERVED_BOTTOM_PX - RESERVED_MARGIN_PX * 2)
	const byW    = Math.floor(availW / SNAPSHOT_WIDTH_CELLS)
	const byH    = Math.floor(availH / SNAPSHOT_HEIGHT_CELLS)
	return Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.min(byW, byH)))
}

let visible = false


// MARK: isSnapshotVisible
export function isSnapshotVisible(): boolean {
	return visible
}


// MARK: toggleSnapshot
/** Show / hide the snapshot overlay. */
export function toggleSnapshot(): void {
	visible = !visible
}


// MARK: onDownloadClick
function onDownloadClick(): void {
	try {
		const url = snapshotDataUrl()
		openExternalUrl({ url })
	} catch (err) {
		console.log('[Snapshot] onDownloadClick: failed to build PNG', err)
	}
}


// MARK: PreviewMosaic
/**
 * Render the paint grid as a wall of UiEntity boxes. Iterates rows top -> bottom
 * (image y=0 is NORTH edge, matching snapshotDataUrl()).
 */
function PreviewMosaic() {
	const pixels: Color4[][] = buildSnapshotPixels()
	const cellPx     = computeCellPx()
	const drawPx     = cellPx + 1
	const overlapPx  = -1
	const rows: any[] = []
	// pixels[] is already oriented top-to-bottom to match the exported PNG.
	for (let cy = 0; cy < SNAPSHOT_HEIGHT_CELLS; cy++) {
		const rowPixels = pixels[cy]
		const cells: any[] = []
		for (let cx = 0; cx < SNAPSHOT_WIDTH_CELLS; cx++) {
			cells.push(
				<UiEntity
					key = {`snap_${cy}_${cx}`}
					uiTransform = {{
						width : drawPx,
						height: drawPx,
						margin: { right: overlapPx },
					}}
					uiBackground = {{ color: rowPixels[cx] }}
				/>
			)
		}
		rows.push(
			<UiEntity
				key = {`snap_row_${cy}`}
				uiTransform = {{
					flexDirection: 'row',
					height       : cellPx,
					margin       : { bottom: overlapPx },
				}}
			>
				{cells}
			</UiEntity>
		)
	}
	return (
		<UiEntity
			key = "ui_SnapMosaic"
			uiTransform = {{
				width : SNAPSHOT_WIDTH_CELLS  * cellPx,
				height: SNAPSHOT_HEIGHT_CELLS * cellPx,
				flexDirection: 'column',
			}}
		>
			{rows}
		</UiEntity>
	)
}


// MARK: SnapshotLayer
/** Modal overlay. Renders nothing when hidden. */
export function SnapshotLayer() {
	if (!visible) return null
	return (
		<UiEntity
			key = "ui_SnapshotOverlay"
			uiTransform = {{
				width        : '100%',
				height       : '100%',
				positionType : 'absolute',
				position     : { top: 0, left: 0 },
				flexDirection: 'column',
				justifyContent: 'center',
				alignItems   : 'center',
				// Let clicks fall through the empty space to the HUD / world;
				// only the panel + buttons should intercept input.
				pointerFilter: 'none',
			}}
		>
			<UiEntity
				key = "ui_SnapshotPanel"
				uiTransform = {{
					padding      : spacing.lg,
					flexDirection: 'column',
					alignItems   : 'center',
					borderRadius : borderRadius.md,
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				<PreviewMosaic />
				<UiEntity
					key = "ui_SnapshotBtnRow"
					uiTransform = {{
						flexDirection: 'row',
						margin       : { top: spacing.md },
					}}
				>
					<UiEntity
						key = "ui_SnapshotDownload"
						uiTransform = {{
							width : 200,
							height: 56,
							margin: { right: spacing.md },
							justifyContent: 'center',
							alignItems   : 'center',
							borderRadius : borderRadius.md,
						}}
						uiBackground = {{ color: Color4.White() }}
						onMouseDown  = {onDownloadClick}
					>
						<Label
							value    = "Download PNG"
							fontSize = {fontSizes.md}
							color    = {Color4.Black()}
							font     = "sans-serif"
							textAlign= "middle-center"
						/>
					</UiEntity>
					<UiEntity
						key = "ui_SnapshotClose"
						uiTransform = {{
							width : 120,
							height: 56,
							justifyContent: 'center',
							alignItems   : 'center',
							borderRadius : borderRadius.md,
						}}
						uiBackground = {{ color: Color4.create(0.35, 0.35, 0.35, 1) }}
						onMouseDown  = {toggleSnapshot}
					>
						<Label
							value    = "Close"
							fontSize = {fontSizes.md}
							color    = {Color4.White()}
							font     = "sans-serif"
							textAlign= "middle-center"
						/>
					</UiEntity>
				</UiEntity>
			</UiEntity>
		</UiEntity>
	)
}
