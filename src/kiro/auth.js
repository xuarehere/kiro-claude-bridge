import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

const SOCIAL_REFRESH_URL = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let cachedToken = null;
let refreshPromise = null;

export function readKiroToken() {
  const tokenPath = CONFIG.PATHS.KIRO_TOKEN_FILE;
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeKiroToken(tokenData) {
  try {
    const tokenPath = CONFIG.PATHS.KIRO_TOKEN_FILE;
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
  } catch (err) {
    console.warn('[Token] Failed to write token back to disk:', err.message);
  }
}

export function isTokenExpired(tokenData) {
  if (!tokenData?.expiresAt) return true;
  return new Date(tokenData.expiresAt).getTime() < Date.now() + REFRESH_BUFFER_MS;
}

async function refreshSocialToken(tokenData) {
  console.log('[Auth] Refreshing Social token (Google/GitHub)...');
  const res = await fetch(SOCIAL_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokenData.refreshToken }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Social token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (data.expiresIn || 3600) * 1000).toISOString();

  return {
    ...tokenData,
    accessToken: data.accessToken,
    ...(data.refreshToken && { refreshToken: data.refreshToken }),
    ...(data.profileArn && { profileArn: data.profileArn }),
    expiresAt,
  };
}

async function refreshIdCToken(tokenData) {
  console.log('[Auth] Refreshing IdC token (Enterprise/BuilderId)...');
  const clientIdHash = tokenData.clientIdHash;
  if (!clientIdHash) {
    throw new Error('IdC token refresh failed: missing clientIdHash');
  }

  const clientRegPath = path.join(CONFIG.PATHS.SSO_CACHE_DIR, `${clientIdHash}.json`);
  if (!fs.existsSync(clientRegPath)) {
    throw new Error('Client registration cache not found. Please log in again in Kiro.');
  }

  const clientReg = JSON.parse(fs.readFileSync(clientRegPath, 'utf8'));
  const region = tokenData.region || 'us-east-1';
  const endpoint = `https://oidc.${region}.amazonaws.com/token`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: clientReg.clientId,
      clientSecret: clientReg.clientSecret,
      grantType: 'refresh_token',
      refreshToken: tokenData.refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IdC token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (data.expiresIn || 3600) * 1000).toISOString();

  return {
    ...tokenData,
    accessToken: data.accessToken,
    ...(data.refreshToken && { refreshToken: data.refreshToken }),
    expiresAt,
  };
}

export async function getAccessToken() {
  if (cachedToken && !isTokenExpired(cachedToken)) {
    return cachedToken;
  }

  let tokenData = readKiroToken();
  if (!tokenData?.accessToken) {
    throw new Error('No Kiro token found in ~/.aws/sso/cache/kiro-auth-token.json. Please open Kiro IDE and log in.');
  }

  if (!isTokenExpired(tokenData)) {
    cachedToken = tokenData;
    return tokenData;
  }

  if (!tokenData.refreshToken) {
    throw new Error('Kiro token is expired and no refreshToken is available. Please re-login in Kiro IDE.');
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      console.log(`[Auth] Token expired (${tokenData.expiresAt}), refreshing...`);
      let newToken;
      if (tokenData.authMethod?.toLowerCase() === 'social') {
        newToken = await refreshSocialToken(tokenData);
      } else {
        newToken = await refreshIdCToken(tokenData);
      }

      writeKiroToken(newToken);
      cachedToken = newToken;
      console.log(`[Auth] Token refreshed successfully. New expiry: ${newToken.expiresAt}`);
      return newToken;
    } catch (err) {
      console.error('[Auth] Token refresh error:', err.message);
      if (tokenData.expiresAt && new Date(tokenData.expiresAt) > new Date()) {
        console.warn('[Auth] Continuing with existing token before absolute expiration');
        cachedToken = tokenData;
        return tokenData;
      }
      throw err;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function getAuthStatus() {
  const token = readKiroToken();
  if (!token) {
    return {
      authenticated: false,
      message: 'Token file not found. Please log in via Kiro IDE.',
    };
  }

  const expired = isTokenExpired(token);
  return {
    authenticated: !expired,
    provider: token.provider || 'Social',
    authMethod: token.authMethod || 'social',
    profileArn: token.profileArn || 'N/A',
    expiresAt: token.expiresAt,
    isExpired: expired,
    canAutoRefresh: !!token.refreshToken,
  };
}
