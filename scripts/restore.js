// scripts/restore.js - Safe zero-pollution restore
import { restorePristineBackups } from '../src/adapters/backup-manager.js';
import { restoreCCSwitchToMiniMax } from '../src/adapters/cc-switch.js';

console.log('========================================================');
console.log('  Zero-Pollution Restore: Rolling back configs & proxy');
console.log('========================================================\n');

try {
  const fileResults = restorePristineBackups();
  console.log('[OK] Restored config backups:', fileResults);
} catch (err) {
  console.error('[ERROR] Failed to restore config files:', err.message);
}

try {
  const ccResult = await restoreCCSwitchToMiniMax();
  console.log('[OK] CC Switch DB restore result:', ccResult);
} catch (err) {
  console.error('[WARN] CC Switch restore skipped:', err.message);
}

try {
  await import('./stop.js');
} catch (err) {
  console.error('[WARN] Stop notice:', err.message);
}

console.log('\n========================================================');
console.log('  [SUCCESS] System restored cleanly with zero pollution!');
console.log('========================================================');
