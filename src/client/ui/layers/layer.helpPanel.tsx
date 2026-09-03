/**
 * layer.helpPanel.tsx — how-to-play panel that slides down from the top.
 *
 * Anchored to the TopCenter zone so the slide travels a short, snappy
 * distance. Opened / closed by the Help (?) button in the top bar or by
 * pressing `4` (IA_ACTION_6) on desktop.
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

const PANEL_W = 380
const PANEL_H = 200


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
		// Mobile: 2× the panel + content, and vertically centered on the
		// 1600×720 virtual screen (top bar is hidden on mobile so we don't
		// have to sit below it). Desktop unchanged.
		const s        = mobile ? 2 : 1
		const width    = PANEL_W * s
		// Mobile height tightened (content fits in ~320px at 2× scale;
		// PANEL_H×2 = 400 left extra padding at the bottom).
		const height   = mobile ? 370 : PANEL_H
		// Extra vertical breathing room between the three rule lines on mobile.
		const ruleGap  = mobile ? 14 : 4 * s
		const top      = mobile
			? Math.max(0, (720 - height) / 2)
			: BAR_TOP_DT + BTN_SIZE + GAP_BELOW_BAR_PX
		return (
			<UiEntity
				key         = "ui_HelpPanel_root"
				uiTransform = {{
					width         : width,
					height        : height,
					margin        : { top },
					padding       : spacing.lg * s,
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
					key         = "ui_HelpPanel_close"
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

				{/* Title */}
				<UiEntity
					uiTransform = {{ width: '100%', height: 32 * s, margin: { bottom: mobile ? 40 : 8 } }}
					uiText = {{
						value    : '<b>welcome to <color=#ffcc4d>dclplace</color>!</b>',
						fontSize : 24 * s,
						color    : WHITE,
						textAlign: 'middle-center',
					}}
				/>

				{/* Rules — three concise lines */}
				<UiEntity
					uiTransform = {{ width: '100%', height: 26 * s, margin: { bottom: ruleGap, left: 16 * s } }}
					uiText = {{
						value    : '<b><color=#ffcc4d>1.</color></b>  select a color from the pallete',
						fontSize : 18 * s,
						color    : WHITE,
						textAlign: 'middle-left',
					}}
				/>
				<UiEntity
					uiTransform = {{ width: '100%', height: 26 * s, margin: { bottom: ruleGap, left: 16 * s } }}
					uiText = {{
						value    : '<b><color=#ffcc4d>2.</color></b>  place pixels to make art',
						fontSize : 18 * s,
						color    : WHITE,
						textAlign: 'middle-left',
					}}
				/>
				{/* Line 3 — inline eye icon (same PNG as the spectator button, tinted white).
				   Explicit pixel widths + flexShrink:0 + flexWrap:nowrap prevent the row
				   from collapsing/wrapping when the viewport is narrow. */}
				<UiEntity
					uiTransform = {{
						width         : '100%',
						height        : 26 * s,
						margin        : { bottom: ruleGap, left: 16 * s },
						flexDirection : 'row',
						flexWrap      : 'nowrap',
						alignItems    : 'center',
						justifyContent: 'flex-start',
					}}
				>
					<UiEntity
						uiTransform = {{ width: mobile ? 190 : 110, height: '100%', flexShrink: 0 }}
						uiText = {{
							value    : '<b><color=#ffcc4d>3.</color></b>  click the',
							fontSize : 18 * s,
							color    : WHITE,
							textAlign: 'middle-left',
						}}
					/>
					<UiEntity
						uiTransform = {{ width: 27 * s, height: 18 * s, margin: { left: 4 * s, right: 8 * s }, flexShrink: 0 }}
						uiBackground = {{
							textureMode: 'stretch',
							texture    : { src: 'assets/images/eye.png' },
							color      : WHITE,
						}}
					/>
					<UiEntity
						uiTransform = {{ width: 200 * s, height: '100%', flexShrink: 0 }}
						uiText = {{
							value    : 'to toggle view',
							fontSize : 18 * s,
							color    : WHITE,
							textAlign: 'middle-left',
						}}
					/>
				</UiEntity>

				{/* Flex spacer — pushes the version chip to the bottom of the panel. */}
				<UiEntity uiTransform={{ width: '100%', height: 0, flexGrow: 1 }} />

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

				{/* Full-panel invisible tap-catcher — rendered LAST so it sits on
				   top in z-order and absorbs every tap that would otherwise be
				   eaten by rich-text child UiEntities (see
				   dcl-snowdrift/docs/bug-reports/react-ecs-richtext-hitbox-mismatch.md).
				   Transparent background so the panel content still shows through. */}
				<UiEntity
					key         = "ui_HelpPanel_tapCatcher"
					uiTransform = {{
						positionType: 'absolute',
						position    : { left: 0, top: 0, right: 0, bottom: 0 },
						width       : '100%',
						height      : '100%',
					}}
					uiBackground = {{ color: Color4.create(0, 0, 0, 0) }}
					onMouseDown  = {() => { playUiClick(); toggleHelpPanel() }}
				/>
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
/** Desktop hotkey: `4` (IA_ACTION_6) toggles the help panel. */
export function initHelpPanelHotkey(): void {
	if (isMobile()) return
	engine.addSystem(() => {
		if (inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) {
			playUiClick()
			toggleHelpPanel()
		}
	})
}
