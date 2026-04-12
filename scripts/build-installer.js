#!/usr/bin/env node
/**
 * build-installer.js
 *
 * Orchestrates the full desktop installer build:
 *   1. next build           → .next/standalone  (self-contained Node server)
 *   2. copy static assets   → .next/standalone/.next/static
 *   3. copy public/         → .next/standalone/public
 *   4. electron-builder     → dist-electron/  (NSIS / DMG / AppImage)
 *
 * Usage:
 *   node scripts/build-installer.js          # host platform
 *   node scripts/build-installer.js --win    # Windows NSIS
 *   node scripts/build-installer.js --mac    # macOS DMG
 *   node scripts/build-installer.js --linux  # Linux AppImage
 */

'use strict';

const { execSync }  = require('child_process');
const fs            = require('fs');
const path          = require('path');

const ROOT        = path.resolve(__dirname, '..');
const STANDALONE  = path.join(ROOT, '.next', 'standalone');
const STATIC_SRC  = path.join(ROOT, '.next', 'static');
const STATIC_DST  = path.join(STANDALONE, '.next', 'static');
const PUBLIC_SRC  = path.join(ROOT, 'public');
const PUBLIC_DST  = path.join(STANDALONE, 'public');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`\n▶  ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠  skip copy — source not found: ${src}`);
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  console.log(`  ✓  copied ${path.relative(ROOT, src)} → ${path.relative(ROOT, dst)}`);
}

// ─── Step 1: Next.js production build ────────────────────────────────────────

console.log('\n━━━  Step 1 / 3  ─  Next.js build\n');
run('npm run build');

// ─── Step 2: Patch standalone with static assets ─────────────────────────────

console.log('\n━━━  Step 2 / 3  ─  Patch standalone output\n');

if (!fs.existsSync(STANDALONE)) {
  console.error(`ERROR: .next/standalone not found after build.`);
  console.error(`Make sure next.config.ts has  output: 'standalone'`);
  process.exit(1);
}

copyDir(STATIC_SRC, STATIC_DST);
copyDir(PUBLIC_SRC, PUBLIC_DST);

// ─── Step 3: electron-builder ─────────────────────────────────────────────────

console.log('\n━━━  Step 3 / 3  ─  electron-builder\n');

const arg  = process.argv[2] ?? '';
const flag =
  arg === '--win'   ? '--win'   :
  arg === '--mac'   ? '--mac'   :
  arg === '--linux' ? '--linux' :
  '';                              // no flag = current platform

run(`npx electron-builder build ${flag}`);

console.log('\n✅  Installer written to dist-electron/\n');
