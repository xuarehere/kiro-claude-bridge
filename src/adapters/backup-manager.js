import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

export function ensureInitialBackups() {
  fs.mkdirSync(CONFIG.PATHS.BACKUP_DIR, { recursive: true });

  // 1. Claude Code settings
  const claudeSettings = CONFIG.PATHS.CLAUDE_SETTINGS;
  const claudeBackup = path.join(CONFIG.PATHS.BACKUP_DIR, 'claude-settings.json.backup_minimax');
  if (fs.existsSync(claudeSettings) && !fs.existsSync(claudeBackup)) {
    fs.copyFileSync(claudeSettings, claudeBackup);
    console.log('[Backup] Created pristine backup for Claude Code settings');
  }

  // 2. Claude Desktop 3P config
  const desktopConfig = CONFIG.PATHS.CLAUDE_DESKTOP_CONFIG;
  const desktopBackup = path.join(CONFIG.PATHS.BACKUP_DIR, 'claude-desktop-config.json.backup_minimax');
  if (fs.existsSync(desktopConfig) && !fs.existsSync(desktopBackup)) {
    fs.copyFileSync(desktopConfig, desktopBackup);
    console.log('[Backup] Created pristine backup for Claude Desktop 3P config');
  }

  // 3. CC Switch database
  const ccSwitchDb = CONFIG.PATHS.CC_SWITCH_DB;
  const ccSwitchBackup = path.join(CONFIG.PATHS.BACKUP_DIR, 'cc-switch.db.backup_minimax');
  if (fs.existsSync(ccSwitchDb) && !fs.existsSync(ccSwitchBackup)) {
    fs.copyFileSync(ccSwitchDb, ccSwitchBackup);
    console.log('[Backup] Created pristine backup for CC Switch database');
  }
}

export function restorePristineBackups() {
  const results = { claudeCode: false, claudeDesktop: false, ccSwitch: false };

  // 1. Restore Claude Code settings
  const claudeBackup = path.join(CONFIG.PATHS.BACKUP_DIR, 'claude-settings.json.backup_minimax');
  const claudeSettings = CONFIG.PATHS.CLAUDE_SETTINGS;
  if (fs.existsSync(claudeBackup)) {
    fs.copyFileSync(claudeBackup, claudeSettings);
    results.claudeCode = true;
  }

  // 2. Restore Claude Desktop config
  const desktopBackup = path.join(CONFIG.PATHS.BACKUP_DIR, 'claude-desktop-config.json.backup_minimax');
  const desktopConfig = CONFIG.PATHS.CLAUDE_DESKTOP_CONFIG;
  if (fs.existsSync(desktopBackup)) {
    fs.copyFileSync(desktopBackup, desktopConfig);
    results.claudeDesktop = true;
  }

  // 3. Restore CC Switch DB
  const ccSwitchBackup = path.join(CONFIG.PATHS.BACKUP_DIR, 'cc-switch.db.backup_minimax');
  const ccSwitchDb = CONFIG.PATHS.CC_SWITCH_DB;
  if (fs.existsSync(ccSwitchBackup)) {
    fs.copyFileSync(ccSwitchBackup, ccSwitchDb);
    results.ccSwitch = true;
  }

  return results;
}
