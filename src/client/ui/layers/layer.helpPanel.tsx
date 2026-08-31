/**
 * layer.helpPanel.tsx — how-to-play panel that slides down from the top.
 *
 * Anchored to the TopCenter zone so the slide travels a short, snappy
 * distance. Opened / closed by the Help (?) button in the top bar or by
 * pressing `3` (IA_ACTION_5) on desktop.
 *
 * Ported from dcl-snowdrift with content rewritten for dcl/place.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { InputAction, PointerEventType, engine, inputSystem } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, ZoneType } from '@stom66/dcl-ui-component-kit'

import { playUiClick } from 'src/client/audio'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { VERSION }  from 'src/shared/data/version'
// Cycle-safe: only accessed inside toggleHelpPanel(), never at module load.
import { leaderboardLayer } from 'src/client/ui/layers/layer.leaderboard'


const { colors, borderRadius, spacing, fontSizes } = UI_THEME
const WHITE = Color4.White()

// Layout — sit just below the top button row.
const BAR_TOP_DT       = 32
const BAR_TOP_MB       = 28
const BTN_SIZE         = 72
const GAP_BELOW_BAR_PX = 16

const PANEL_W = 500
const PANEL_H = 240


// MARK: HelpPanelLayer
class HelpPanelLayer extends Layer {
	constructor() {
		super({
			id         : 'helpPanel',
			zone       : ZoneType.TopCenter,
			canBeHidden: true,
			startHidden: true,
			showFrom   : 'top',
		})
	}

	body() {
		const mobile = isMobile()
		const barTop = mobile ? BAR_TOP_MB : BAR_TOP_DT
		const top    = barTop + BTN_SIZE + GAP_BELOW_BAR_PX
		return (
			<UiEntity
				key         = "ui_HelpPanel_root"
				uiTransform = {{
					width         : PANEL_W,
					height        : PANEL_H,
					margin        : { top },
					padding       : spacing.lg,
					borderRadius  : borderRadius.md,
					borderWidth   : 4,
					borderColor   : Color4.create(1, 1, 1, 0.75),
					flexDirection : 'column',
					alignItems    : 'stretch',
					justifyContent: 'flex-start',
				}}
				uiBackground = {{ color: colors.statsBg }}
			>
				{/* Title */}
				<UiEntity
					uiTransform = {{ width: '100%', height: 32, margin: { bottom: 8 } }}
					uiText = {{
						value    : '<b>dcl/place</b>',
						fontSize : 24,
						color    : WHITE,
						textAlign: 'middle-center',
					}}
				/>

				{/* Tagline */}
				<UiEntity
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 12 } }}
					uiText = {{
						value    : 'The eternal collaborative pixel canvas.',
						fontSize : 18,
						color    : WHITE,
						textAlign: 'middle-center',
					}}
				/>

				{/* Rules — three concise lines */}
				<UiEntity
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 4 } }}
					uiText = {{
						value    : '<b><color=#ffcc4d>1.</color></b>  Walk to any tile on the canvas',
						fontSize : 18,
						color    : WHITE,
						textAlign: 'middle-left',
					}}
				/>
				<UiEntity
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 4 } }}
					uiText = {{
						value    : '<b><color=#ffcc4d>2.</color></b>  Pick a color from the bottom palette',
						fontSize : 18,
						color    : WHITE,
						textAlign: 'middle-left',
					}}
				/>
				<UiEntity
					uiTransform = {{ width: '100%', height: 26, margin: { bottom: 12 } }}
					uiText = {{
						value    : '<b><color=#ffcc4d>3.</color></b>  Tap PAINT — every <b><color=#ffcc4d>1s</color></b>. Nothing resets.',
						fontSize : 18,
						color    : WHITE,
						textAlign: 'middle-left',
					}}
				/>

				{/* Version chip */}
				<UiEntity
					uiTransform = {{
						width         : '100%',
						height        : 24,
						flexDirection : 'row',
						justifyContent: 'center',
						alignItems    : 'center',
					}}
				>
					<UiEntity
						uiTransform = {{
							width       : 'auto',
							height      : 24,
							borderRadius: borderRadius.sm,
							padding     : { right: 4, left: 4 },
						}}
						uiText = {{
							value    : VERSION,
							fontSize : fontSizes.md,
							color    : colors.versionFg,
							textAlign: 'middle-center',
						}}
						uiBackground = {{ color: colors.versionBg }}
					/>
				</UiEntity>
			</UiEntity>
		)
	}
}


export const helpPanelLayer = new HelpPanelLayer()


// MARK: helpers
export function isHelpPanelVisible(): boolean {
	return !helpPanelLayer.visibility.isHidden
}

export function toggleHelpPanel(): void {
	const wasHidden = helpPanelLayer.visibility.isHidden
	helpPanelLayer.toggle()
	if (wasHidden && !leaderboardLayer.visibility.isHidden) {
		// Mutually exclusive with the leaderboard panel — same slot.
		leaderboardLayer.hide()
	}
}


// MARK: initHelpPanelHotkey
/** Desktop hotkey: `3` (IA_ACTION_5) toggles the help panel. */
export function initHelpPanelHotkey(): void {
	if (isMobile()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) {
			playUiClick()
			toggleHelpPanel()
		}
	})
}
