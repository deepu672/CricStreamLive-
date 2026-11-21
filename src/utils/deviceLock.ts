const DEVICE_TOKEN_KEY = 'cricstage_primary_device_token_v1';

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getOrCreateLocalDeviceToken(): string {
  try {
    const existing = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (existing && /^[a-f0-9]{32,128}$/.test(existing)) {
      return existing;
    }
    const fresh = generateSecureToken();
    localStorage.setItem(DEVICE_TOKEN_KEY, fresh);
    return fresh;
  } catch {
    return generateSecureToken();
  }
}

/**
 * Computes a lowercase hex SHA-256 hash of the local device token.
 * Matches Firestore regex ^[a-f0-9]+$ with length 64.
 */
export async function getLocalDeviceHash(): Promise<string> {
  const token = getOrCreateLocalDeviceToken();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(token);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback hex string (already 64 lowercase hex chars)
  return token.toLowerCase().slice(0, 64);
}

export function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown Device';
  const ua = navigator.userAgent;

  let os = 'Desktop';
  if (/Android/i.test(ua)) os = 'Android Mobile';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS Device';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return `${os} · ${browser}`.slice(0, 160);
}
