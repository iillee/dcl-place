/**
 * layer.leaderboard.tsx — top painters panel, slides in from the right.
 *
 * Backend: server owns a singleton entity carrying `LeaderboardState.json`
 * (LEADERBOARD_NETWORK_ID = 3001). The server publishes on a throttled
 * dirty tick (see server.ts, ~0.5 Hz), so the CRDT replica updates on its
 * own — we don't poll. We do send one `requestLeaderboard` on open so a
 * freshly-opened panel gets current data without waiting for the next
 * server tick.
 *
 * Toggled by the trophy (★) button in the top bar, or by pressing `3`
 * (IA_ACTION_5) on desktop.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { InputAction, PointerEventType, engine, inputSystem } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, PropsController, ZoneType } from '@stom66/dcl-ui-component-kit'

import { playUiClick } from 'src/client/audio'
import { room } from 'src/shared/messages'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { readLeaderboard, LbEntry } from 'src/client/ui/utils/leaderboard'
import { helpPanelLayer } from 'src/client/ui/layers/layer.helpPanel'


const { colors, borderRadius, spacing, fontSizes } = UI_THEME
const WHITE = Color4.White()
const GOLD  = Color4.create(1.00, 0.80, 0.30, 1)
const DIM   = Color4.create(1, 1, 1, 0.55)

const PANEL_W    = 360
const ROW_H      = 26
const MAX_ROWS   = 10
const HEADER_H   = 44
const V_PAD      = 12
const PANEL_H    = HEADER_H + MAX_ROWS * ROW_H + V_PAD * 2 + 8

// Match the top-bar offset so the panel tucks nicely under it — same
// numbers as layer.helpPanel so both slide in from the same place.
const BAR_TOP_DT = 32
const BAR_TOP_MB = 28
const BTN_SIZE   = 72
const GAP_BELOW  = 16


// MARK: LeaderboardLayer
type LbProps = { json: string }

class LeaderboardLayer extends Layer {

	constructor() {
		super({
			id         : 'leaderboard',
			zone       : ZoneType.TopCenter,
			canBeHidden: true,
			startHidden: true,
			showFrom   : 'top',
		})

		this.props = new PropsController<LbProps>({ json: '[]' })

		// Mirror the replicated CRDT into layer props. Server drives updates
		// on its own throttled tick; no client-side polling.
		engine.addSystem(() => {
			if (this.visibility.isHidden) return
			if (!this.props) return
			const arr  = readLeaderboard()
			const json = JSON.stringify(arr)
			if (json !== (this.props.get('json') as string)) {
				this.props.set('json', json)
			}
		})
	}

	body() {
		const json = (this.props?.get('json') as string) ?? '[]'
		let entries: LbEntry[] = []
		try { entries = JSON.parse(json) } catch { /* fall through */ }
		if (!Array.isArray(entries)) entries = []

		const mobile = isMobile()
		// Match the help panel's mobile scaling so text sizes line up.
		// s = 1.8 (slightly under 2) keeps 10 rows fitting comfortably in the
		// 720px virtual screen height.
		const s        = mobile ? 1.4 : 1
		const panelW   = PANEL_W * s
		const rowH     = ROW_H * s
		const headerH  = HEADER_H * s
		const vPad     = V_PAD * s
		const hPad     = 14 * s
		const panelH   = headerH + MAX_ROWS * rowH + vPad * 2 + 8 * s
		const top      = mobile
			? Math.max(0, (720 - panelH) / 2 - 50)
			: BAR_TOP_DT + BTN_SIZE + GAP_BELOW

		return (
			<UiEntity
				key         = "ui_Leaderboard_root"
				uiTransform = {{
					width         : panelW,
					height        : panelH,
					margin        : { top },
					padding       : { top: vPad, bottom: vPad, left: hPad, right: hPad },
					borderRadius  : borderRadius.md,
					borderWidth   : 4,
					borderColor   : Color4.create(1, 1, 1, 0.75),
					flexDirection : 'column',
					alignItems    : 'stretch',
					justifyContent: 'flex-start',
				}}
				uiBackground = {{ color: colors.statsBg }}
				// Tap-to-close is handled by an absolute-positioned overlay child
				// rendered LAST (see bottom of tree). Root handler removed to avoid
				// double-firing.

			>
				{/* Close X — top-right corner. Bold grey glyph, taps to close the panel. */}
				<UiEntity
					key         = "ui_Leaderboard_close"
					uiTransform = {{
						positionType: 'absolute',
						position    : { right: 8 * s, top: 4 * s },
						width       : 36 * s,
						height      : 36 * s,
					}}
					uiText = {{
						value    : mobile ? '<b>✖</b>' : '✖',
						fontSize : 32 * s,
						color    : Color4.create(0.6, 0.6, 0.6, 1),
						textAlign: 'middle-center',
					}}
				/>

				{/* Header */}
				<UiEntity
					uiTransform = {{ width: '100%', height: headerH, margin: { bottom: 8 * s } }}
					uiText = {{
						value    : '<b>TOP 10 PAINTERS</b>',
						fontSize : 22 * s,
						color    : GOLD,
						textAlign: 'middle-center',
					}}
				/>

				{/* Rows */}
				{entries.length === 0
					? renderEmpty(s)
					: entries.slice(0, MAX_ROWS).map((e, i) => renderRow(i + 1, e, s))
				}

				{/* Full-panel invisible tap-catcher — rendered LAST so it sits on
				   top in z-order and absorbs every tap that would otherwise be
				   eaten by rich-text child UiEntities (see
				   dcl-snowdrift/docs/bug-reports/react-ecs-richtext-hitbox-mismatch.md). */}
				<UiEntity
					key         = "ui_Leaderboard_tapCatcher"
					uiTransform = {{
						positionType: 'absolute',
						position    : { left: 0, top: 0, right: 0, bottom: 0 },
						width       : '100%',
						height      : '100%',
					}}
					uiBackground = {{ color: Color4.create(0, 0, 0, 0) }}
					onMouseDown  = {() => { playUiClick(); toggleLeaderboard() }}
				/>
			</UiEntity>
		)
	}
}


// MARK: renderRow
function renderRow(rank: number, e: LbEntry, s: number) {
	const rankColor = rank === 1 ? GOLD
	                : rank === 2 ? Color4.create(0.85, 0.85, 0.90, 1)
	                : rank === 3 ? Color4.create(0.90, 0.60, 0.35, 1)
	                : DIM
	const rowH = ROW_H * s
	const rowFontSize = fontSizes.md * s
	return (
		<UiEntity
			key         = {`ui_Lb_row_${rank}_${e.userId}`}
			uiTransform = {{
				width        : '100%',
				height       : rowH,
				flexDirection: 'row',
				alignItems   : 'center',
			}}
		>
			{/* Rank */}
			<UiEntity
				uiTransform = {{ width: 34 * s, height: rowH }}
				uiText = {{
					value    : `<b>${rank}</b>`,
					fontSize : rowFontSize,
					color    : rankColor,
					textAlign: 'middle-left',
				}}
			/>
			{/* Name */}
			<UiEntity
				uiTransform = {{ width: 190 * s, height: rowH }}
				uiText = {{
					value    : truncate(e.name || e.userId, 20),
					fontSize : rowFontSize,
					color    : WHITE,
					textAlign: 'middle-left',
				}}
			/>
			{/* Count */}
			<UiEntity
				uiTransform = {{ width: 68 * s, height: rowH }}
				uiText = {{
					value    : String(e.cellsPainted | 0),
					fontSize : rowFontSize,
					color    : GOLD,
					textAlign: 'middle-right',
				}}
			/>
		</UiEntity>
	)
}


// MARK: renderEmpty
function renderEmpty(s: number) {
	return (
		<UiEntity
			key         = "ui_Lb_empty"
			uiTransform = {{ width: '100%', height: ROW_H * s * 2 }}
			uiText = {{
				value    : 'No pixels painted yet.',
				fontSize : fontSizes.md * s,
				color    : DIM,
				textAlign: 'middle-center',
			}}
		/>
	)
}


function truncate(s: string, max: number): string {
	if (!s) return ''
	return s.length <= max ? s : s.slice(0, max - 1) + '…'
}


export const leaderboardLayer = new LeaderboardLayer()


// MARK: helpers
export function isLeaderboardVisible(): boolean {
	return !leaderboardLayer.visibility.isHidden
}

export function toggleLeaderboard(): void {
	const wasHidden = leaderboardLayer.visibility.isHidden
	leaderboardLayer.toggle()
	if (wasHidden) {
		// Mutually exclusive with the help panel — they share the same slot.
		if (!helpPanelLayer.visibility.isHidden) helpPanelLayer.hide()
		// Poke immediately on open so the panel isn't blank until next tick.
		room.send('requestLeaderboard', {})
	}
}


// MARK: initLeaderboardHotkey
/** Desktop hotkey: `3` (IA_ACTION_5) toggles the leaderboard. */
export function initLeaderboardHotkey(): void {
	if (isMobile()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) {
			playUiClick()
			toggleLeaderboard()
		}
	})
}
