// scripts/package-release.js - Build zero-dependency Source & Portable ZIP packages in dist/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version || '4.0.0';

const INCLUDE_FILES = [
  'package.json',
  'README.md',
  'README_zh.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  'start-web.bat',
  'stop.bat',
  'restore.bat',
  'start.sh',
  'stop.sh',
];

const INCLUDE_DIRS = ['bin', 'src', 'scripts', 'docs'];

function copyAppFiles(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of INCLUDE_FILES) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetDir, file));
    }
  }

  for (const dir of INCLUDE_DIRS) {
    const srcDir = path.join(ROOT, dir);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, path.join(targetDir, dir), { recursive: true });
    }
  }

  // Copy default model-settings template if present (never copy user .backups or bridge-config overrides)
  const settingsSrc = path.join(ROOT, 'config', 'model-settings.json');
  if (fs.existsSync(settingsSrc)) {
    fs.mkdirSync(path.join(targetDir, 'config'), { recursive: true });
    fs.copyFileSync(settingsSrc, path.join(targetDir, 'config', 'model-settings.json'));
  }
}

function createZip(sourceFolder, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  if (process.platform === 'win32') {
    const psCmd = `Compress-Archive -Path '${sourceFolder.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: sourceFolder, stdio: 'inherit' });
  }
}

console.log('========================================================');
console.log(`  Packaging Kiro-Claude-Bridge v${version} Releases`);
console.log('========================================================\n');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. Lightweight zero-dependency source bundle (Works on any Node >= 18 without npm install)
const sourceName = `kiro-claude-bridge-source-v${version}`;
const sourceDir = path.join(DIST, sourceName);
const sourceZip = path.join(DIST, `${sourceName}.zip`);
copyAppFiles(sourceDir);
createZip(sourceDir, sourceZip);
console.log(`[OK] Source plug-and-play bundle: ${sourceZip}`);

// 2. Self-contained Windows x64 Portable Bundle (Includes node.exe runtime — works without Node installed!)
if (process.platform === 'win32') {
  const portableName = `kiro-claude-bridge-win-${process.arch}-portable-v${version}`;
  const portableDir = path.join(DIST, portableName);
  const portableZip = path.join(DIST, `${portableName}.zip`);
  copyAppFiles(portableDir);

  const runtimeDir = path.join(portableDir, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(runtimeDir, 'node.exe'));

  createZip(portableDir, portableZip);
  console.log(`[OK] Portable zero-install bundle: ${portableZip}`);
}

console.log('\n[DONE] Packaging completed cleanly in dist/');
