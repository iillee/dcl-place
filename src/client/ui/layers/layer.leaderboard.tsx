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
const MAX_ROWS   = 12
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
		const top    = (mobile ? BAR_TOP_MB : BAR_TOP_DT) + BTN_SIZE + GAP_BELOW

		return (
			<UiEntity
				key         = "ui_Leaderboard_root"
				uiTransform = {{
					width         : PANEL_W,
					height        : PANEL_H,
					margin        : { top },
					padding       : { top: V_PAD, bottom: V_PAD, left: 14, right: 14 },
					borderRadius  : borderRadius.md,
					borderWidth   : 4,
					borderColor   : Color4.create(1, 1, 1, 0.75),
					flexDirection : 'column',
					alignItems    : 'stretch',
					justifyContent: 'flex-start',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				{/* Header */}
				<UiEntity
					uiTransform = {{ width: '100%', height: HEADER_H, margin: { bottom: 8 } }}
					uiText = {{
						value    : '<b>TOP PAINTERS</b>',
						fontSize : 22,
						color    : GOLD,
						textAlign: 'middle-center',
					}}
				/>

				{/* Rows */}
				{entries.length === 0
					? renderEmpty()
					: entries.slice(0, MAX_ROWS).map((e, i) => renderRow(i + 1, e))
				}
			</UiEntity>
		)
	}
}


// MARK: renderRow
function renderRow(rank: number, e: LbEntry) {
	const rankColor = rank === 1 ? GOLD
	                : rank === 2 ? Color4.create(0.85, 0.85, 0.90, 1)
	                : rank === 3 ? Color4.create(0.90, 0.60, 0.35, 1)
	                : DIM
	return (
		<UiEntity
			key         = {`ui_Lb_row_${rank}_${e.userId}`}
			uiTransform = {{
				width        : '100%',
				height       : ROW_H,
				flexDirection: 'row',
				alignItems   : 'center',
			}}
		>
			{/* Rank */}
			<UiEntity
				uiTransform = {{ width: 34, height: ROW_H }}
				uiText = {{
					value    : `<b>${rank}</b>`,
					fontSize : fontSizes.md,
					color    : rankColor,
					textAlign: 'middle-left',
				}}
			/>
			{/* Name */}
			<UiEntity
				uiTransform = {{ width: 190, height: ROW_H }}
				uiText = {{
					value    : truncate(e.name || e.userId, 20),
					fontSize : fontSizes.md,
					color    : WHITE,
					textAlign: 'middle-left',
				}}
			/>
			{/* Count */}
			<UiEntity
				uiTransform = {{ width: 68, height: ROW_H }}
				uiText = {{
					value    : String(e.cellsPainted | 0),
					fontSize : fontSizes.md,
					color    : GOLD,
					textAlign: 'middle-right',
				}}
			/>
		</UiEntity>
	)
}


// MARK: renderEmpty
function renderEmpty() {
	return (
		<UiEntity
			key         = "ui_Lb_empty"
			uiTransform = {{ width: '100%', height: ROW_H * 2 }}
			uiText = {{
				value    : 'No pixels painted yet.',
				fontSize : fontSizes.md,
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
