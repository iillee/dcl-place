#!/usr/bin/env node
/**
 * swap-scene.mjs — Copy scene.<target>.json into scene.json before deploy.
 *
 * Usage:
 *   node scripts/swap-scene.mjs world     # activate the World variant
 *   node scripts/swap-scene.mjs genesis   # activate the Genesis variant
 *   node scripts/swap-scene.mjs status    # show which variant is currently active
 *
 * scene.json is the file the SDK reads. We keep two source-of-truth variants
 * (scene.world.json, scene.genesis.json) in git and copy the chosen one into
 * scene.json at deploy time. A .bak is written so an accidental swap can be
 * recovered without git.
 *
 * Invariants:
 *   - scene.world.json MUST contain worldConfiguration.name
 *   - scene.genesis.json MUST NOT contain worldConfiguration
 *   - Source files inside src/ never differ between variants.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENE = resolve(ROOT, 'scene.json');
const BAK = resolve(ROOT, 'scene.json.bak');

const VARIANTS = {
  world: resolve(ROOT, 'scene.world.json'),
  genesis: resolve(ROOT, 'scene.genesis.json'),
};

function detectActive() {
  if (!existsSync(SCENE)) return 'missing';
  const s = JSON.parse(readFileSync(SCENE, 'utf8'));
  if (s.worldConfiguration?.name) return `world (${s.worldConfiguration.name})`;
  return `genesis (base ${s.scene?.base ?? '?'}, ${s.scene?.parcels?.length ?? 0} parcels)`;
}

const target = process.argv[2];

if (!target || target === 'status') {
  console.log('active scene.json:', detectActive());
  console.log('variants available:');
  for (const [k, p] of Object.entries(VARIANTS)) {
    console.log(`  ${k.padEnd(8)} ${existsSync(p) ? p : '(missing: ' + p + ')'}`);
  }
  process.exit(0);
}

const src = VARIANTS[target];
if (!src) {
  console.error(`unknown target "${target}". valid: ${Object.keys(VARIANTS).join(', ')}, status`);
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`variant file missing: ${src}`);
  process.exit(1);
}

// Sanity-check the variant before promoting it.
const parsed = JSON.parse(readFileSync(src, 'utf8'));
if (target === 'world' && !parsed.worldConfiguration?.name) {
  console.error('refuse: scene.world.json is missing worldConfiguration.name');
  process.exit(1);
}
if (target === 'genesis' && parsed.worldConfiguration) {
  console.error('refuse: scene.genesis.json still has worldConfiguration — remove it');
  process.exit(1);
}

if (existsSync(SCENE)) copyFileSync(SCENE, BAK);
copyFileSync(src, SCENE);
console.log(`activated ${target} → scene.json`);
console.log('now:', detectActive());
