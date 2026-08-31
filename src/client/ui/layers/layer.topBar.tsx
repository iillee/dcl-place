/**
 * layer.topBar.tsx — top-center HUD row with three buttons:
 *   [ Spectator ]  [ Mute ]  [ Help ]
 *
 * Same visual language as dcl-snowdrift's HUD (72×72 dark panels with
 * centered icons/glyphs; gold accent when active). Anchored to
 * ZoneType.Top with a small top margin so it sits below the browser /
 * mobile status area but clear of the client's own top HUD.
 *
 * Each button is a PropsController-driven layer child so the icon /
 * accent updates when the underlying state changes (music muted,
 * spectator active, help panel open).
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { Layer, PropsController, ZoneType } from '@stom66/dcl-ui-component-kit'

import { isMusicMuted, playUiClick, toggleMusic } from 'src/client/audio'
import { isTopDownActive, toggleTopDownCamera }   from 'src/client/topDownCamera'
import {
	helpPanelLayer,
	isHelpPanelVisible,
	toggleHelpPanel,
} from 'src/client/ui/layers/layer.helpPanel'
import {
	isLeaderboardVisible,
	toggleLeaderboard,
} from 'src/client/ui/layers/layer.leaderboard'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, borderRadius } = UI_THEME

const BTN_SIZE     = 72
const BTN_GAP      = 8
const BAR_TOP_DT   = 32
const BAR_TOP_MB   = 28
const PANEL_BG     = colors.statsBg

// Muted gold — accent for "on / active" states across all three buttons.
const GOLD  = Color4.create(1.00, 0.80, 0.30, 1)
const WHITE = Color4.White()


// MARK: PanelButton
/** Common dark rounded button. Icon child is caller-provided. */
function PanelButton(props: {
	keyId    : string
	onPress  : () => void
	children?: ReactEcs.JSX.Element | ReactEcs.JSX.Element[]
}) {
	return (
		<UiEntity
			key         = {props.keyId}
			uiTransform = {{
				width         : BTN_SIZE,
				height        : BTN_SIZE,
				margin        : { left: BTN_GAP / 2, right: BTN_GAP / 2 },
				justifyContent: 'center',
				alignItems    : 'center',
				borderRadius  : borderRadius.md,
				borderWidth   : 2,
				borderColor   : WHITE,
			}}
			uiBackground = {{ color: PANEL_BG }}
			onMouseDown  = {props.onPress}
		>
			{props.children}
		</UiEntity>
	)
}


// MARK: EyeIcon — white eye PNG tinted via uiBackground.color (ported
// from snowdrift's SpectatorButton). Eye asset is wider than tall so we
// hardcode the aspect box; adjust EYE_ICON_W / EYE_ICON_H together.
const EYE_ICON_SRC = 'assets/images/eye.png'
const EYE_ICON_W   = 48
const EYE_ICON_H   = 32

function EyeIcon(props: { color: Color4 }) {
	return (
		<UiEntity
			uiTransform = {{ width: EYE_ICON_W, height: EYE_ICON_H }}
			uiBackground = {{
				textureMode: 'stretch',
				texture    : { src: EYE_ICON_SRC },
				color      : props.color,
			}}
		/>
	)
}


// MARK: QuestionGlyph — ? for the help button. Text-based so no atlas needed.
function QuestionGlyph(props: { color: Color4 }) {
	return (
		<UiEntity
			uiTransform = {{
				width: 40, height: 40,
				justifyContent: 'center', alignItems: 'center',
				margin: { bottom: 6 },
			}}
			uiText = {{
				value    : '?',
				fontSize : 36,
				color    : props.color,
				textAlign: 'middle-center',
			}}
		/>
	)
}


// MARK: MuteIcon — swaps between muted / unmute PNG.
function MuteIcon(props: { muted: boolean }) {
	// Distinct key per state so React-ECS mounts a fresh element and
	// picks up the new texture (same trick as snowdrift's MuteButton).
	return (
		<UiEntity
			key = {props.muted ? 'ui_TopBar_mute_on' : 'ui_TopBar_mute_off'}
			uiTransform = {{ width: 34, height: 34 }}
			uiBackground = {{
				textureMode: 'stretch',
				texture    : { src: props.muted ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
			}}
		/>
	)
}


// MARK: TrophyGlyph — ★ for the leaderboard button.
function TrophyGlyph(props: { color: Color4 }) {
	return (
		<UiEntity
			uiTransform = {{
				width: 40, height: 40,
				justifyContent: 'center', alignItems: 'center',
				margin: { bottom: 6 },
			}}
			uiText = {{
				value    : '★',
				fontSize : 32,
				color    : props.color,
				textAlign: 'middle-center',
			}}
		/>
	)
}


// MARK: TopBarLayer
type TopBarProps = {
	specActive  : boolean
	musicMuted  : boolean
	helpOpen    : boolean
	lbOpen      : boolean
}

class TopBarLayer extends Layer {

	constructor() {
		super({
			id  : 'topBar',
			zone: ZoneType.TopCenter,
			uiTransform: {
				margin: { top: isMobile() ? BAR_TOP_MB : BAR_TOP_DT },
			},
		})

		this.props = new PropsController<TopBarProps>({
			specActive: isTopDownActive(),
			musicMuted: isMusicMuted(),
			helpOpen  : isHelpPanelVisible(),
			lbOpen    : isLeaderboardVisible(),
		})

		// Poll shared state each frame so button visuals stay in sync
		// with anything that toggles them (hotkeys, other systems, etc.).
		// Only push when a value actually changed to avoid rerender storms.
		engine.addSystem(() => {
			if (!this.props) return
			const spec  = isTopDownActive()
			const mute  = isMusicMuted()
			const help  = isHelpPanelVisible()
			const lb    = isLeaderboardVisible()
			const cur   = this.props.get.bind(this.props)
			if (spec !== cur('specActive')) this.props.set('specActive', spec)
			if (mute !== cur('musicMuted')) this.props.set('musicMuted', mute)
			if (help !== cur('helpOpen'))   this.props.set('helpOpen',   help)
			if (lb   !== cur('lbOpen'))     this.props.set('lbOpen',     lb)
		})
	}

	body() {
		const specActive = (this.props?.get('specActive') as boolean) ?? false
		const musicMuted = (this.props?.get('musicMuted') as boolean) ?? false
		const helpOpen   = (this.props?.get('helpOpen')   as boolean) ?? false
		const lbOpen     = (this.props?.get('lbOpen')     as boolean) ?? false

		return (
			<UiEntity
				key = "ui_TopBar_row"
				uiTransform = {{
					flexDirection : 'row',
					alignItems    : 'center',
					justifyContent: 'center',
				}}
			>
				<PanelButton
					keyId   = "ui_TopBar_spec"
					onPress = {() => { playUiClick(); toggleTopDownCamera() }}
				>
					<EyeIcon color={specActive ? GOLD : WHITE} />
				</PanelButton>

				<PanelButton
					keyId   = "ui_TopBar_mute"
					onPress = {() => { playUiClick(); toggleMusic() }}
				>
					<MuteIcon muted={musicMuted} />
				</PanelButton>

				<PanelButton
					keyId   = "ui_TopBar_lb"
					onPress = {() => { playUiClick(); toggleLeaderboard() }}
				>
					<TrophyGlyph color={lbOpen ? GOLD : WHITE} />
				</PanelButton>

				<PanelButton
					keyId   = "ui_TopBar_help"
					onPress = {() => { playUiClick(); toggleHelpPanel() }}
				>
					<QuestionGlyph color={helpOpen ? GOLD : WHITE} />
				</PanelButton>
			</UiEntity>
		)
	}
}


export const topBarLayer = new TopBarLayer()
