#!/usr/bin/env node
// Dump the last 5 messages from the snapshot channel to see what's actually there.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const p = join(ROOT, '.env')
if (existsSync(p)) {
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const TOKEN = process.env.DISCORD_BOT_TOKEN
const CHANNEL_ID = process.env.DISCORD_SNAPSHOT_CHANNEL_ID

// Channel info
const chRes = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}`, {
  headers: { Authorization: `Bot ${TOKEN}` },
})
console.log(`--- Channel ${CHANNEL_ID} ---`)
console.log(chRes.status, await chRes.text())

// Last 5 messages
const msgRes = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=5`, {
  headers: { Authorization: `Bot ${TOKEN}` },
})
const msgs = await msgRes.json()
console.log(`\n--- Last ${Array.isArray(msgs) ? msgs.length : '?'} messages ---`)
if (Array.isArray(msgs)) {
  for (const m of msgs) {
    console.log(`\n[${m.timestamp}] ${m.author?.username} (webhook=${!!m.webhook_id}):`)
    console.log(`  content: ${JSON.stringify(m.content).slice(0, 120)}`)
    console.log(`  attachments: ${m.attachments?.length ?? 0}`)
    for (const a of m.attachments ?? []) {
      console.log(`    - ${a.filename} (${a.content_type}, ${a.size}B)`)
    }
    console.log(`  embeds: ${m.embeds?.length ?? 0}`)
  }
} else {
  console.log(JSON.stringify(msgs, null, 2))
}
