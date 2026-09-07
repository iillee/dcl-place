/**
 * webhookSecrets.example.ts — TEMPLATE. Copy to `webhookSecrets.ts` and
 * fill in the real webhook URL. `webhookSecrets.ts` is gitignored.
 *
 * Why this file exists
 * --------------------
 * `sdk-commands storage env set` only supports scenes with
 * `worldConfiguration.name` in scene.json — i.e. World deploys only.
 * Genesis City deploys have no CLI-supported way to set EnvVars right
 * now, so `EnvVar.get('DISCORD_SNAPSHOT_WEBHOOK')` returns undefined
 * on the Genesis server and snapshot posting is silently disabled.
 *
 * As a workaround, snapshotDiscord.ts falls back to the value exported
 * here IF the EnvVar path returns nothing. World deploys continue to
 * use the EnvVar (source of truth), so this file only matters for
 * Genesis. Leave it empty ('') to disable snapshots entirely for a
 * given local build.
 *
 * Setup
 * -----
 *   cp src/server/webhookSecrets.example.ts src/server/webhookSecrets.ts
 *   # edit webhookSecrets.ts, paste the real URL
 *   npm run deploy:genesis
 *
 * Rotation
 * --------
 * The real URL is a secret. Rotate it in Discord (Edit Channel →
 * Integrations → Webhooks → delete + recreate) whenever it leaks and
 * update webhookSecrets.ts + redeploy.
 */

/** Fallback webhook URL used only when EnvVar is not set (Genesis deploys). */
export const FALLBACK_DISCORD_SNAPSHOT_WEBHOOK = ''
