#!/usr/bin/env node
// scripts/download-timelapse.mjs
//
// Pages the snapshot Discord channel, downloads every PNG attachment in
// chronological order (oldest → newest) into timelapse/frames/, then invokes
// ffmpeg to stitch them into timelapse/timelapse.mp4.
//
// Env (from .env or shell):
//   DISCORD_BOT_TOKEN            — bot token with View Channel + Read Message History
//   DISCORD_SNAPSHOT_CHANNEL_ID  — snapshot channel snowflake
//
// Flags:
//   --skip-download   reuse existing frames, only run ffmpeg
//   --skip-encode     download frames, skip ffmpeg
//   --fps <n>         output frames per second (default 24)
//   --limit <n>       stop after N messages (debug)
//   --after <iso>     only include messages after this ISO timestamp
//                     (e.g. --after 2026-09-02T00:00:00Z)
//   --renumber        rename existing frames to close gaps before encoding
//                     (use after manually deleting test frames)

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'timelapse')
const FRAMES_DIR = join(OUT_DIR, 'frames')

// ---- env loading (tiny .env parser, no dep) ----
function loadDotenv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m || line.trim().startsWith('#')) continue
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadDotenv()

const TOKEN = process.env.DISCORD_BOT_TOKEN
const CHANNEL_ID = process.env.DISCORD_SNAPSHOT_CHANNEL_ID
if (!TOKEN) die('DISCORD_BOT_TOKEN missing — set it in .env')
if (!CHANNEL_ID) die('DISCORD_SNAPSHOT_CHANNEL_ID missing — set it in .env')

// ---- args ----
const args = process.argv.slice(2)
const skipDownload = args.includes('--skip-download')
const skipEncode = args.includes('--skip-encode')
const fps = Number(argVal('--fps') ?? 24)
const limit = argVal('--limit') ? Number(argVal('--limit')) : Infinity
const afterIso = argVal('--after')
const afterMs = afterIso ? Date.parse(afterIso) : 0
if (afterIso && Number.isNaN(afterMs)) die(`--after: not a valid ISO date: ${afterIso}`)
const renumber = args.includes('--renumber')
function argVal(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

// ---- main ----
mkdirSync(FRAMES_DIR, { recursive: true })

if (!skipDownload) {
  await downloadAllFrames()
} else {
  log(`--skip-download set, reusing ${countFrames()} existing frames`)
}

if (renumber) renumberFrames()

if (!skipEncode) {
  await encodeVideo()
} else {
  log('--skip-encode set, done')
}

// ---- discord paging ----
async function downloadAllFrames() {
  log(`fetching snapshot channel ${CHANNEL_ID}…`)
  let before = undefined
  let total = 0
  let downloaded = 0
  let skipped = 0
  // Collect all first (Discord returns newest → oldest), then reverse.
  const all = []
  while (total < limit) {
    const batch = await fetchMessages(before)
    if (batch.length === 0) break
    for (const msg of batch) {
      if (total >= limit) break
      total++
      if (afterMs && Date.parse(msg.timestamp) < afterMs) continue
      for (const att of msg.attachments || []) {
        if (!att.filename?.toLowerCase().endsWith('.png')) continue
        all.push({ msg, att })
      }
    }
    before = batch[batch.length - 1].id
    process.stdout.write(`  paged ${total} messages, ${all.length} PNG attachments so far\r`)
    await sleep(250) // gentle on the rate limiter
  }
  process.stdout.write('\n')
  log(`total: ${total} messages, ${all.length} PNGs`)

  // Reverse so oldest is frame 000001.
  all.reverse()

  // Download in order, name sortable.
  for (let i = 0; i < all.length; i++) {
    const { msg, att } = all[i]
    const idx = String(i + 1).padStart(6, '0')
    const dest = join(FRAMES_DIR, `${idx}.png`)
    if (existsSync(dest) && statSync(dest).size > 0) {
      skipped++
      continue
    }
    await downloadFile(att.url, dest)
    downloaded++
    if ((i + 1) % 25 === 0 || i === all.length - 1) {
      process.stdout.write(`  frame ${i + 1}/${all.length} (${downloaded} new, ${skipped} cached)\r`)
    }
  }
  process.stdout.write('\n')
  log(`downloaded ${downloaded}, reused ${skipped} cached`)
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    channelId: CHANNEL_ID,
    totalMessages: total,
    totalFrames: all.length,
  }, null, 2))
}

async function fetchMessages(before) {
  const url = new URL(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`)
  url.searchParams.set('limit', '100')
  if (before) url.searchParams.set('before', before)
  const res = await fetch(url, {
    headers: { Authorization: `Bot ${TOKEN}` },
  })
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') ?? '2')
    log(`  rate limited, sleeping ${retry}s`)
    await sleep(retry * 1000)
    return fetchMessages(before)
  }
  if (!res.ok) {
    const body = await res.text()
    die(`Discord API ${res.status}: ${body}`)
  }
  return res.json()
}

async function downloadFile(url, dest) {
  const res = await fetch(url)
  if (!res.ok) die(`download failed ${res.status}: ${url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  writeFileSync(dest, buf)
}

// ---- ffmpeg ----
async function encodeVideo() {
  const frames = countFrames()
  if (frames === 0) die('no frames to encode')
  const out = join(OUT_DIR, 'timelapse.mp4')
  log(`encoding ${frames} frames @ ${fps}fps → ${out}`)
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', join(FRAMES_DIR, '%06d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    out,
  ]
  await run('ffmpeg', args)
  log(`✅ done: ${out}`)
}

function countFrames() {
  if (!existsSync(FRAMES_DIR)) return 0
  return readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).length
}

function renumberFrames() {
  const files = readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).sort()
  log(`renumbering ${files.length} frames to close gaps…`)
  // Two-pass rename to avoid collisions (tmp prefix, then final).
  for (let i = 0; i < files.length; i++) {
    renameSync(join(FRAMES_DIR, files[i]), join(FRAMES_DIR, `_tmp_${String(i + 1).padStart(6, '0')}.png`))
  }
  for (let i = 0; i < files.length; i++) {
    const idx = String(i + 1).padStart(6, '0')
    renameSync(join(FRAMES_DIR, `_tmp_${idx}.png`), join(FRAMES_DIR, `${idx}.png`))
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
    p.on('error', reject)
  })
}

// ---- utils ----
function log(msg) { console.log(`[timelapse] ${msg}`) }
function die(msg) { console.error(`[timelapse] ERROR: ${msg}`); process.exit(1) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
