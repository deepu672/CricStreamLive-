import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Validates that a remote URL is HTTP/HTTPS and does not target private/loopback networks.
 */
function isSafeExternalUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      /^169\.254\./.test(hostname)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveUrl(candidate: string, baseUrl: string): string | null {
  try {
    const cleaned = candidate
      .replace(/\\\//g, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/&amp;/g, '&')
      .trim();
    if (
      !cleaned ||
      cleaned.startsWith('javascript:') ||
      cleaned.startsWith('about:') ||
      cleaned.startsWith('data:')
    ) {
      return null;
    }
    const resolved = new URL(cleaned, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Safely decodes legacy JS unescape('%XX' / '%uXXXX') payloads used by obfuscated cricket wrapper pages.
 */
function safeUnescape(str: string): string {
  return str.replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (_, u, h) =>
    String.fromCharCode(parseInt(u || h, 16))
  );
}

/**
 * Unwraps document.write(unescape('...')) / decodeURIComponent('...') HTML obfuscation.
 */
function decodeObfuscatedHtml(rawHtml: string): string {
  let result = rawHtml;
  const unescapePattern =
    /(?:document\.write|eval)\s*\(\s*(?:unescape|decodeURIComponent)\s*\(\s*(['"])([\s\S]+?)\1\s*\)\s*\)/gi;

  let match: RegExpExecArray | null;
  const decodedChunks: string[] = [];
  while ((match = unescapePattern.exec(rawHtml)) !== null) {
    const payload = match[2];
    if (payload.length > 60) {
      decodedChunks.push(safeUnescape(payload));
    }
  }

  if (decodedChunks.length > 0) {
    result = `${decodedChunks.join('\n')}\n${rawHtml}`;
  }
  return result;
}

function parseYouTubeEmbed(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    let videoId: string | null = null;
    if (host === 'youtu.be') {
      videoId = u.pathname.slice(1).split('/')[0] || null;
    } else if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (u.pathname === '/watch') {
        videoId = u.searchParams.get('v');
      } else if (u.pathname.startsWith('/live/')) {
        videoId = u.pathname.split('/')[2] || null;
      } else if (u.pathname.startsWith('/embed/')) {
        videoId = u.pathname.split('/')[2] || null;
      } else if (u.pathname.startsWith('/shorts/')) {
        videoId = u.pathname.split('/')[2] || null;
      }
    }
    if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    }
    return null;
  } catch {
    return null;
  }
}

const AD_OR_TRACKER_PATTERNS = [
  'googletagmanager',
  'doubleclick',
  'googlesyndication',
  'googleadservices',
  'facebook.com/plugins',
  'platform.twitter.com',
  'analytics',
  'adservice',
  'adsboosters',
  'capitalhospitals.org',
  'llvpn.com',
  'acscdn.com',
  'refpa3665.com',
  'popads',
  'popcash',
  'propellerads',
  'monetag',
  'adsterra',
  'highperformanceformat',
  'effectivegatecpm',
  'profitableratecpm',
  'exoclick',
  'juicyads',
  'trafficjunky',
  'clickadu',
  'hilltopads',
  'admaven',
  'recaptcha',
  'hcaptcha',
  'cloudflareinsights',
  'disqus.com',
  'telegram.org',
  't.me/',
  'chatango',
  'cbox.ws',
];

function isLikelyAdOrTracker(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  return AD_OR_TRACKER_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isStandalonePlayerOrSpa(html: string, urlStr: string): boolean {
  const lower = html.toLowerCase();
  const host = urlStr.toLowerCase();
  if (
    lower.includes('shaka-player') ||
    lower.includes('jwplayer') ||
    lower.includes('clappr') ||
    lower.includes('hls.min.js') ||
    lower.includes('video.min.js') ||
    lower.includes('bitmovin') ||
    lower.includes('artplayer') ||
    lower.includes('dplayer')
  ) {
    return true;
  }
  if (
    host.includes('.lovable.app') ||
    host.includes('.vercel.app') ||
    host.includes('.netlify.app') ||
    lower.includes('rel="modulepreload"') ||
    lower.includes('type="module" crossorigin') ||
    lower.includes('__next_data__')
  ) {
    return true;
  }
  return false;
}

function scoreIframeCandidate(urlStr: string): number {
  const lower = urlStr.toLowerCase();
  let score = 0;
  if (lower.includes('player') || lower.includes('embed') || lower.includes('stream')) score += 50;
  if (
    lower.includes('live') ||
    lower.includes('cricket') ||
    lower.includes('hls') ||
    lower.includes('video')
  ) {
    score += 30;
  }
  if (
    lower.includes('youtube.com/embed') ||
    lower.includes('vimeo.com') ||
    lower.includes('dailymotion.com')
  ) {
    score += 45;
  }
  if (lower.includes('twitch.tv') || lower.includes('jwplayer') || lower.includes('clappr')) {
    score += 40;
  }
  if (isLikelyAdOrTracker(lower)) score -= 500;
  return score;
}

interface StreamCandidate {
  type: 'dash' | 'hls' | 'mp4' | 'youtube' | 'iframe';
  url: string;
  label: string;
  clearKeys?: Record<string, string>;
  cookie?: string;
  needsTextStrip?: boolean;
}

/**
 * Normalizes ClearKey DRM structures from strings ("kid:key"), string[], { kid, key }, or Record<kid, key>.
 */
function parseClearKeys(input: unknown): Record<string, string> | undefined {
  const out: Record<string, string> = {};

  const addPair = (pairStr: string) => {
    const idx = pairStr.indexOf(':');
    if (idx === -1) return;
    const kid = pairStr.slice(0, idx).trim();
    const key = pairStr.slice(idx + 1).trim();
    if (kid && key) {
      out[kid] = key;
    }
  };

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.includes(':')) {
      trimmed.split(/[,\n;]+/).forEach((part) => addPair(part));
    }
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        addPair(item);
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (typeof obj.kid === 'string' && typeof obj.key === 'string') {
          out[obj.kid.trim()] = obj.key.trim();
        }
      }
    }
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.kid === 'string' && typeof obj.key === 'string') {
      out[obj.kid.trim()] = obj.key.trim();
    } else {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && k.trim() && v.trim()) {
          out[k.trim()] = v.trim();
        }
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function decodeBase64Safe(b64: string): string | null {
  try {
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Unwraps base64-encoded proxy URLs (e.g., https://...lovable.app/aHR0cHM6Ly9...master.m3u8?ck=...)
 * into their real direct HTTPS stream URL + ClearKeys.
 */
function unwrapBase64ProxyStream(rawUrl: string): {
  url: string;
  clearKeys?: Record<string, string>;
} {
  try {
    const parsed = new URL(rawUrl);
    let finalUrl = rawUrl;
    let clearKeys: Record<string, string> | undefined;

    // Decode ?ck=<base64 "kid:key"> if present
    const ckParam = parsed.searchParams.get('ck');
    if (ckParam) {
      const decodedCk = decodeBase64Safe(ckParam);
      if (decodedCk) {
        clearKeys = parseClearKeys(decodedCk);
      }
    }

    // Check path segments for base64-encoded http(s):// stream URL ("aHR0c" = "http")
    const segments = parsed.pathname.split('/').filter(Boolean);
    for (const seg of segments) {
      if (seg.startsWith('aHR0c') && seg.length >= 20) {
        const decoded = decodeBase64Safe(seg);
        if (decoded && /^https?:\/\/[^\s"'<>]+$/i.test(decoded)) {
          finalUrl = decoded;
          break;
        }
      }
    }

    return { url: finalUrl, clearKeys };
  } catch {
    return { url: rawUrl };
  }
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts quoted JS string literal starting at `openQuoteIdx` (handles escaped quotes \" and \\).
 */
function extractJsStringLiteral(source: string, openQuoteIdx: number): string | null {
  const quoteChar = source[openQuoteIdx];
  if (quoteChar !== '"' && quoteChar !== "'") return null;
  let i = openQuoteIdx + 1;
  let escaped = false;
  while (i < source.length) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === quoteChar) {
      return source.slice(openQuoteIdx + 1, i);
    }
    i++;
  }
  return null;
}

/**
 * Adds a structured source object (from CMV SSR queryState, Gist JSON, or channel API) as a pure video candidate.
 */
function pushStructuredStreamItem(
  item: Record<string, unknown>,
  baseUrl: string,
  seen: Set<string>,
  candidates: StreamCandidate[],
  fallbackLabel: string
): void {
  const rawLink =
    (typeof item.streamURL === 'string' && item.streamURL) ||
    (typeof item.streamUrl === 'string' && item.streamUrl) ||
    (typeof item.stream_url === 'string' && item.stream_url) ||
    (typeof item.link === 'string' && item.link) ||
    (typeof item.m3u8 === 'string' && item.m3u8) ||
    (typeof item.mpd === 'string' && item.mpd) ||
    (typeof item.url === 'string' && item.url) ||
    '';

  if (!rawLink.trim()) return;
  const resolvedRaw = resolveUrl(rawLink, baseUrl);
  if (!resolvedRaw || isLikelyAdOrTracker(resolvedRaw)) return;

  const unwrapped = unwrapBase64ProxyStream(resolvedRaw);
  const finalUrl = unwrapped.url;
  if (!finalUrl || seen.has(finalUrl) || isLikelyAdOrTracker(finalUrl)) return;

  const mergedClearKeys: Record<string, string> = {
    ...(unwrapped.clearKeys || {}),
    ...(parseClearKeys(item.clearKeys) || {}),
    ...(parseClearKeys(item.clearkey) || {}),
    ...(parseClearKeys(item.drmKeys) || {}),
    ...(parseClearKeys(item.key) || {}),
    ...(typeof item.kid === 'string' && typeof item.key === 'string'
      ? { [item.kid.trim()]: item.key.trim() }
      : {}),
  };
  const clearKeys = Object.keys(mergedClearKeys).length > 0 ? mergedClearKeys : undefined;

  const cookie =
    typeof item.cookie === 'string' && item.cookie.trim() ? item.cookie.trim() : undefined;

  const label =
    (typeof item.title === 'string' && item.title.trim()) ||
    (typeof item.name === 'string' && item.name.trim()) ||
    fallbackLabel;

  const manifestType =
    typeof item.manifestType === 'string' ? item.manifestType.toLowerCase().trim() : '';

  seen.add(finalUrl);

  const yt = parseYouTubeEmbed(finalUrl);
  if (yt) {
    candidates.push({ type: 'youtube', url: yt, label });
    return;
  }

  if (manifestType === 'mpd' || /\.mpd(\?|$|#)/i.test(finalUrl)) {
    candidates.push({ type: 'dash', url: finalUrl, clearKeys, cookie, label });
    return;
  }

  if (manifestType === 'hls' || /\.m3u8(\?|$|#)/i.test(finalUrl)) {
    candidates.push({ type: 'hls', url: finalUrl, cookie, label });
    return;
  }

  if (/\.(mp4|webm|ogg)(\?|$|#)/i.test(finalUrl)) {
    candidates.push({ type: 'mp4', url: finalUrl, label });
  }
}

/**
 * Extracts pure direct streams from TanStack Start SSR `queryState` (like CMV.TV / Lovable sports apps)
 * and external Gist feeds referenced in their JS bundle, eliminating ALL site chrome, Telegram popups & ads.
 */
async function extractSpaSsrStreams(
  decodedHtml: string,
  pageUrl: string,
  seen: Set<string>,
  candidates: StreamCandidate[]
): Promise<boolean> {
  const parsedPage = new URL(pageUrl);
  const queryTargets: string[] = [];
  for (const key of ['watch', 'id', 'slug', 'match', 'channel', 'stream', 'ch']) {
    const val = parsedPage.searchParams.get(key);
    if (val && val.trim()) {
      queryTargets.push(normalizeSlug(val));
    }
  }

  const allEvents: Record<string, unknown>[] = [];

  // 1. Parse TanStack Start SSR dehydrated queryState:"..."
  const qsMarker = 'queryState:"';
  let searchPos = 0;
  while (true) {
    const markerIdx = decodedHtml.indexOf(qsMarker, searchPos);
    if (markerIdx === -1) break;
    const openQuoteIdx = markerIdx + qsMarker.length - 1;
    const escapedJson = extractJsStringLiteral(decodedHtml, openQuoteIdx);
    searchPos = openQuoteIdx + 1;
    if (!escapedJson) continue;

    try {
      const unescapedStr = JSON.parse(`"${escapedJson}"`) as string;
      const stateObj = JSON.parse(unescapedStr) as {
        queries?: Array<{ state?: { data?: unknown } }>;
      };
      const queries = Array.isArray(stateObj?.queries) ? stateObj.queries : [];
      for (const q of queries) {
        const data = q?.state?.data;
        if (!data || typeof data !== 'object') continue;
        if (Array.isArray(data)) {
          for (const entry of data) {
            if (entry && typeof entry === 'object') {
              allEvents.push(entry as Record<string, unknown>);
            }
          }
        } else {
          const obj = data as Record<string, unknown>;
          for (const arrKey of ['live', 'upcoming', 'events', 'sports', 'channels', 'items']) {
            const arr = obj[arrKey];
            if (Array.isArray(arr)) {
              for (const entry of arr) {
                if (entry && typeof entry === 'object') {
                  allEvents.push(entry as Record<string, unknown>);
                }
              }
            }
          }
        }
      }
    } catch {
      // ignore malformed queryState chunk
    }
  }

  // Helper to match an event against ?watch=... slug
  const findMatchingEvent = (events: Record<string, unknown>[]): Record<string, unknown> | null => {
    if (events.length === 0) return null;
    if (queryTargets.length === 0) {
      return events.find(
        (ev) => Array.isArray(ev.sources) || Array.isArray(ev.streams)
      ) || null;
    }

    // Exact normalized slug/id match first
    for (const target of queryTargets) {
      const exact = events.find((ev) => {
        const keys = [ev.slug, ev.id, ev.title, ev.name];
        return keys.some((k) => typeof k === 'string' && normalizeSlug(k) === target);
      });
      if (exact) return exact;
    }

    // Substring fallback match (e.g., slug "willow-" vs query "willow")
    for (const target of queryTargets) {
      const fuzzy = events.find((ev) => {
        const keys = [ev.slug, ev.title, ev.name];
        return keys.some((k) => {
          if (typeof k !== 'string') return false;
          const norm = normalizeSlug(k);
          return norm.includes(target) || target.includes(norm);
        });
      });
      if (fuzzy) return fuzzy;
    }

    return null;
  };

  let matchedEvent = findMatchingEvent(allEvents);

  // 2. If not found in SSR HTML, inspect linked /assets/*.js bundles for external JSON feeds (e.g., Gist sports.json)
  if (!matchedEvent && queryTargets.length > 0) {
    const scriptMatches = Array.from(
      decodedHtml.matchAll(/["'](\/assets\/[^"']+\.js)["']/gi)
    ).map((m) => m[1]);
    const uniqueBundles = Array.from(new Set(scriptMatches)).slice(0, 4);

    for (const bundlePath of uniqueBundles) {
      const bundleUrl = resolveUrl(bundlePath, pageUrl);
      if (!bundleUrl) continue;
      const fetchedJs = await fetchHtmlSafely(bundleUrl, pageUrl);
      if (!fetchedJs?.html) continue;

      const feedUrls = Array.from(
        new Set(
          (fetchedJs.html.match(/https?:\/\/[^"'`\s\\]+?\.json/gi) || []).filter(
            (u) => !isLikelyAdOrTracker(u)
          )
        )
      ).slice(0, 4);

      for (const feedUrl of feedUrls) {
        const safeFeed = isSafeExternalUrl(feedUrl);
        if (!safeFeed) continue;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6500);
        try {
          const resp = await fetch(safeFeed.toString(), {
            headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json,*/*' },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!resp.ok) continue;
          const json = (await resp.json()) as Record<string, unknown>;
          const feedItems: Record<string, unknown>[] = [];
          const root = (json?.data && typeof json.data === 'object' ? json.data : json) as Record<
            string,
            unknown
          >;
          for (const k of ['live', 'upcoming', 'events', 'sports', 'channels', 'items']) {
            if (Array.isArray(root[k])) {
              feedItems.push(...(root[k] as Record<string, unknown>[]));
            }
          }
          const found = findMatchingEvent(feedItems);
          if (found) {
            matchedEvent = found;
            break;
          }
        } catch {
          clearTimeout(timer);
        }
      }
      if (matchedEvent) break;
    }
  }

  if (!matchedEvent) return false;

  const eventTitle =
    (typeof matchedEvent.title === 'string' && matchedEvent.title.trim()) ||
    (typeof matchedEvent.name === 'string' && matchedEvent.name.trim()) ||
    'Live Stream';

  const sourceList = Array.isArray(matchedEvent.sources)
    ? (matchedEvent.sources as Record<string, unknown>[])
    : Array.isArray(matchedEvent.streams)
      ? (matchedEvent.streams as Record<string, unknown>[])
      : [];

  const beforeCount = candidates.length;
  for (const src of sourceList) {
    if (src && typeof src === 'object') {
      pushStructuredStreamItem(src, pageUrl, seen, candidates, eventTitle);
    }
  }

  return candidates.length > beforeCount;
}

/**
 * Extracts pure DASH/HLS stream + ClearKey DRM + Cookie directly from Shaka player pages
 * (e.g., allrounder3-0.pages.dev/cricket/sony-3 with CONFIG = { apiUrl, channelId, fallback }).
 * Completely bypasses the third-party HTML page and its ad/popup scripts (llvpn.com, etc.).
 */
async function extractShakaConfigStreams(
  decodedHtml: string,
  pageUrl: string,
  seen: Set<string>,
  candidates: StreamCandidate[]
): Promise<boolean> {
  const apiUrlMatch = decodedHtml.match(/apiUrl\s*:\s*["']([^"']+)["']/i);
  const channelIdMatch = decodedHtml.match(/channelId\s*:\s*["']([^"']+)["']/i);
  const fallbackStreamMatch = decodedHtml.match(/streamUrl\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  const fallbackCookieMatch = decodedHtml.match(/cookie\s*:\s*["']([^"']*)["']/i);

  // Extract inline drmKeys: ["kid:key", ...]
  const fallbackKeys: string[] = [];
  const drmKeysBlockMatch = decodedHtml.match(/drmKeys\s*:\s*\[([\s\S]*?)\]/i);
  if (drmKeysBlockMatch?.[1]) {
    const keyMatches = drmKeysBlockMatch[1].matchAll(/["']([0-9a-fA-F]+:[0-9a-fA-F]+)["']/g);
    for (const km of keyMatches) {
      fallbackKeys.push(km[1]);
    }
  }

  const beforeCount = candidates.length;

  // 1. Live channel API lookup (always fetches fresh cookie + latest stream_url + DRM keys!)
  if (apiUrlMatch?.[1] && channelIdMatch?.[1]) {
    const resolvedApi = resolveUrl(apiUrlMatch[1], pageUrl);
    const channelId = channelIdMatch[1].trim();
    const safeApi = resolvedApi ? isSafeExternalUrl(resolvedApi) : null;

    if (safeApi) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);
      try {
        const resp = await fetch(safeApi.toString(), {
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'application/json,text/plain,*/*',
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (resp.ok) {
          const data = (await resp.json()) as unknown;
          const channels: Record<string, unknown>[] = Array.isArray(data)
            ? (data as Record<string, unknown>[])
            : data && typeof data === 'object'
              ? (((data as Record<string, unknown>).channels ||
                  (data as Record<string, unknown>).data ||
                  (data as Record<string, unknown>).items ||
                  []) as Record<string, unknown>[])
              : [];

          const channel = channels.find(
            (c) =>
              c &&
              typeof c === 'object' &&
              (String(c.id || '').toLowerCase() === channelId.toLowerCase() ||
                String(c.name || '').toLowerCase() === channelId.toLowerCase())
          );

          if (channel) {
            pushStructuredStreamItem(
              channel,
              safeApi.toString(),
              seen,
              candidates,
              typeof channel.name === 'string' ? channel.name : channelId
            );
          }
        }
      } catch {
        clearTimeout(timer);
      }
    }
  }

  // 2. Inline fallback config if API lookup produced nothing
  if (candidates.length === beforeCount && fallbackStreamMatch?.[1]) {
    pushStructuredStreamItem(
      {
        streamUrl: fallbackStreamMatch[1],
        drmKeys: fallbackKeys,
        cookie: fallbackCookieMatch?.[1] || '',
        name: channelIdMatch?.[1] || 'Live HD Stream',
      },
      pageUrl,
      seen,
      candidates,
      'Live HD Stream'
    );
  }

  return candidates.length > beforeCount;
}

/**
 * Resolves dynamic JSON stream configs fetched by wrapper pages
 * (e.g., cricket-point.pages.dev/p2?id=hindi -> fetch('https://allrounder2-0.pages.dev/id.json') -> iframeSrc).
 */
async function resolveDynamicJsonStreams(
  decodedHtml: string,
  pageUrl: string,
  seen: Set<string>,
  candidates: StreamCandidate[]
): Promise<string[]> {
  const parsedPage = new URL(pageUrl);
  const queryValues: string[] = [];
  for (const key of ['id', 'channel', 'ch', 'stream', 'watch', 'c', 'match', 'v', 'slug']) {
    const val = parsedPage.searchParams.get(key);
    if (val && val.trim()) queryValues.push(val.trim().toLowerCase());
  }

  const jsonUrlRegex = /fetch\s*\(\s*['"`]([^'"`\s]+?\.json(?:\?[^'"`\s]*)?)['"`]/gi;
  const jsonUrls = new Set<string>();
  let jMatch: RegExpExecArray | null;
  while ((jMatch = jsonUrlRegex.exec(decodedHtml)) !== null) {
    const abs = resolveUrl(jMatch[1], pageUrl);
    if (abs && !isLikelyAdOrTracker(abs)) {
      jsonUrls.add(abs);
    }
  }

  if (jsonUrls.size === 0) return [];

  const discoveredEmbeds: string[] = [];

  for (const jsonUrl of Array.from(jsonUrls).slice(0, 3)) {
    const safeJson = isSafeExternalUrl(jsonUrl);
    if (!safeJson) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const resp = await fetch(safeJson.toString(), {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json,text/plain,*/*' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) continue;

      const jsonData = (await resp.json()) as Record<string, unknown> | unknown[];

      const itemArrays: Record<string, unknown>[][] = [];
      if (Array.isArray(jsonData)) {
        itemArrays.push(jsonData as Record<string, unknown>[]);
      } else if (jsonData && typeof jsonData === 'object') {
        for (const listKey of ['iframes', 'channels', 'streams', 'matches', 'events', 'data', 'items']) {
          const maybeArr = (jsonData as Record<string, unknown>)[listKey];
          if (Array.isArray(maybeArr)) {
            itemArrays.push(maybeArr as Record<string, unknown>[]);
          }
        }
        for (const qVal of queryValues) {
          for (const [k, v] of Object.entries(jsonData)) {
            if (k.toLowerCase() === qVal) {
              if (typeof v === 'string') {
                itemArrays.push([{ id: k, url: v }]);
              } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                itemArrays.push([v as Record<string, unknown>]);
              }
            }
          }
        }
      }

      for (const arr of itemArrays) {
        let matchedItem: Record<string, unknown> | undefined;
        if (queryValues.length > 0) {
          matchedItem = arr.find((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            const entryKeys = [entry.id, entry.slug, entry.channel, entry.ch, entry.key, entry.name];
            return entryKeys.some(
              (val) => typeof val === 'string' && queryValues.includes(val.trim().toLowerCase())
            );
          });
        }

        if (!matchedItem) continue;

        const displayName =
          typeof matchedItem.name === 'string' && matchedItem.name.trim()
            ? matchedItem.name.trim()
            : typeof matchedItem.title === 'string' && matchedItem.title.trim()
              ? matchedItem.title.trim()
              : 'Live Stream';

        const urlFields = [
          'm3u8',
          'hls',
          'mpd',
          'streamURL',
          'streamUrl',
          'stream_url',
          'iframeSrc',
          'iframe_src',
          'embedUrl',
          'embed_url',
          'embed',
          'iframe',
          'url',
          'src',
          'link',
        ];

        for (const field of urlFields) {
          const rawVal = matchedItem[field];
          if (typeof rawVal !== 'string' || !rawVal.trim()) continue;
          const resolved = resolveUrl(rawVal, jsonUrl);
          if (!resolved || seen.has(resolved) || isLikelyAdOrTracker(resolved)) continue;

          const yt = parseYouTubeEmbed(resolved);
          if (yt) {
            seen.add(resolved);
            candidates.push({ type: 'youtube', url: yt, label: `${displayName} · YouTube` });
          } else if (/\.mpd(\?|$|#)/i.test(resolved)) {
            pushStructuredStreamItem(matchedItem, jsonUrl, seen, candidates, displayName);
          } else if (/\.m3u8(\?|$|#)/i.test(resolved)) {
            seen.add(resolved);
            candidates.push({ type: 'hls', url: resolved, label: `${displayName} · HD Stream` });
          } else if (/\.(mp4|webm|ogg)(\?|$|#)/i.test(resolved)) {
            seen.add(resolved);
            candidates.push({ type: 'mp4', url: resolved, label: `${displayName} · HD Video` });
          } else {
            seen.add(resolved);
            candidates.push({
              type: 'iframe',
              url: resolved,
              label: `${displayName} · Video Player`,
              needsTextStrip: false,
            });
            discoveredEmbeds.push(resolved);
          }
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }

  return discoveredEmbeds;
}

/**
 * Extracts direct HLS (.m3u8), DASH (.mpd), MP4, base64-encoded stream URLs, meta video URLs, and player iframes.
 */
function parseHtmlForVideoSources(
  html: string,
  finalBase: string,
  seen: Set<string>,
  candidates: StreamCandidate[],
  labelPrefix = ''
): string[] {
  const addCandidate = (
    type: StreamCandidate['type'],
    raw: string,
    label: string,
    needsTextStrip = false
  ) => {
    const resolved = resolveUrl(raw, finalBase);
    if (!resolved || seen.has(resolved)) return;
    if (type === 'iframe' && isLikelyAdOrTracker(resolved)) return;
    seen.add(resolved);
    candidates.push({
      type,
      url: resolved,
      label: labelPrefix ? `${labelPrefix} ${label}` : label,
      needsTextStrip,
    });
  };

  // 1. Direct .m3u8 URLs anywhere in HTML or JS strings (including escaped \/)
  const hlsRegex = /(?:https?:\\?\/\\?\/[^\s"'<>\\`]+?\.m3u8(?:\?[^\s"'<>\\`]*)?)/gi;
  const hlsMatches = html.match(hlsRegex) || [];
  for (const m of hlsMatches.slice(0, 8)) {
    addCandidate('hls', m, 'HD Video Stream');
  }

  // 2. Decode base64-encoded atob('...') stream strings commonly used by sports players
  const atobRegex = /atob\(\s*["']([A-Za-z0-9+/=]{16,600})["']\s*\)/gi;
  let b64Match: RegExpExecArray | null;
  while ((b64Match = atobRegex.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(b64Match[1], 'base64').toString('utf8').trim();
      if (/^https?:\/\/[^\s"'<>]+\.m3u8/i.test(decoded)) {
        addCandidate('hls', decoded, 'Captured HD Stream');
      } else if (/^https?:\/\/[^\s"'<>]+\.mpd/i.test(decoded)) {
        addCandidate('dash', decoded, 'Captured DASH Stream');
      } else if (/^https?:\/\/[^\s"'<>]+\.(?:mp4|webm)/i.test(decoded)) {
        addCandidate('mp4', decoded, 'Captured HD Video');
      }
    } catch {
      // ignore invalid base64
    }
  }

  // 3. Direct <video> / <source> tags
  const videoSrcRegex = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
  let vMatch: RegExpExecArray | null;
  while ((vMatch = videoSrcRegex.exec(html)) !== null) {
    const rawSrc = vMatch[1];
    if (/\.m3u8(\?|$)/i.test(rawSrc)) {
      addCandidate('hls', rawSrc, 'Video Tag HLS');
    } else if (/\.mpd(\?|$)/i.test(rawSrc)) {
      addCandidate('dash', rawSrc, 'Video Tag DASH');
    } else if (/\.(mp4|webm|ogg)(\?|$)/i.test(rawSrc)) {
      addCandidate('mp4', rawSrc, 'Video Tag HD');
    }
  }

  // 4. JS player config assignments
  const jsMediaRegex =
    /(?:file|source|hls|streamUrl|videoUrl|manifestUri|playlist)\s*[:=]\s*["'](https?:\\?\/\\?\/[^"']+\.(?:m3u8|mpd|mp4|webm)(?:\?[^"']*)?)["']/gi;
  let jsMatch: RegExpExecArray | null;
  while ((jsMatch = jsMediaRegex.exec(html)) !== null) {
    const rawUrl = jsMatch[1];
    if (/\.m3u8(\?|$)/i.test(rawUrl)) {
      addCandidate('hls', rawUrl, 'Player HLS Stream');
    } else if (/\.mpd(\?|$)/i.test(rawUrl)) {
      addCandidate('dash', rawUrl, 'Player DASH Stream');
    } else {
      addCandidate('mp4', rawUrl, 'Player HD Video');
    }
  }

  // 5. OpenGraph / Twitter player meta tags
  const metaVideoRegex =
    /<meta[^>]+(?:property|name)=["'](?:og:video:secure_url|og:video:url|og:video|twitter:player)["'][^>]+content=["']([^"']+)["']/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = metaVideoRegex.exec(html)) !== null) {
    const rawMeta = mMatch[1];
    const yt = parseYouTubeEmbed(rawMeta);
    if (yt) {
      addCandidate('youtube', yt, 'YouTube Embed');
    } else if (/\.m3u8(\?|$)/i.test(rawMeta)) {
      addCandidate('hls', rawMeta, 'Meta HLS Stream');
    } else if (/\.mpd(\?|$)/i.test(rawMeta)) {
      addCandidate('dash', rawMeta, 'Meta DASH Stream');
    } else if (/\.(mp4|webm)(\?|$)/i.test(rawMeta)) {
      addCandidate('mp4', rawMeta, 'Meta Video');
    } else {
      addCandidate('iframe', rawMeta, 'Isolated Video Player', false);
    }
  }

  // 6. Embedded player <iframe> elements (excluding template strings like ${...} and ads)
  const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  const discoveredIframes: string[] = [];
  let iMatch: RegExpExecArray | null;
  while ((iMatch = iframeRegex.exec(html)) !== null) {
    const rawIframe = iMatch[1];
    if (rawIframe.includes('${') || rawIframe.includes('{{')) continue;
    const resolved = resolveUrl(rawIframe, finalBase);
    if (resolved && !isLikelyAdOrTracker(resolved)) {
      discoveredIframes.push(resolved);
    }
  }

  const rankedIframes = discoveredIframes
    .sort((a, b) => scoreIframeCandidate(b) - scoreIframeCandidate(a))
    .slice(0, 6);

  rankedIframes.forEach((iframeUrl, idx) => {
    const yt = parseYouTubeEmbed(iframeUrl);
    if (yt) {
      addCandidate('youtube', yt, `YouTube Player ${idx + 1}`);
    } else {
      addCandidate('iframe', iframeUrl, `Isolated Video Frame ${idx + 1}`, false);
    }
  });

  return rankedIframes;
}

async function fetchHtmlSafely(
  urlStr: string,
  referer?: string
): Promise<{ html: string; finalUrl: string; contentType: string } | null> {
  const safe = isSafeExternalUrl(urlStr);
  if (!safe) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);
  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (referer) {
      headers.Referer = referer;
    }
    const response = await fetch(safe.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const html =
      contentType.includes('text/') ||
      contentType.includes('html') ||
      contentType.includes('xml') ||
      contentType.includes('javascript') ||
      contentType.includes('json') ||
      !contentType
        ? (await response.text()).slice(0, 1_200_000)
        : '';

    return {
      html,
      finalUrl: response.url || safe.toString(),
      contentType,
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  /**
   * Deep Server-side Pure-Video Capture Extractor
   * Extracts raw HLS (.m3u8) and DASH (.mpd + ClearKey + Cookie) streams directly from:
   * - Obfuscated unescape() pages + id.json manifests (cricket-point.pages.dev -> allrounder3 -> JioTV DASH)
   * - TanStack Start / Lovable SSR apps (cmvtootahuwagulaabjamun.lovable.app/?watch=... -> direct 1080p HLS/DASH)
   * - Shaka CONFIG pages, direct HLS/DASH/MP4, and YouTube.
   * Zero third-party popups, zero Telegram overlays, zero page text.
   */
  app.get('/api/extract-stream', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const safeUrl = isSafeExternalUrl(rawUrl);

    if (!safeUrl) {
      res.status(400).json({ error: 'Please provide a valid external HTTP(S) URL.' });
      return;
    }

    const urlStr = safeUrl.toString();

    const ytEmbed = parseYouTubeEmbed(urlStr);
    if (ytEmbed) {
      res.json({
        type: 'youtube',
        videoUrl: ytEmbed,
        candidates: [{ type: 'youtube', url: ytEmbed, label: 'YouTube Live Player' }],
        sourceTitle: 'YouTube Broadcast',
      });
      return;
    }

    if (/\.mpd(\?|$|#)/i.test(urlStr)) {
      res.json({
        type: 'dash',
        videoUrl: urlStr,
        candidates: [{ type: 'dash', url: urlStr, label: 'Direct DASH HD Stream' }],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    if (/\.m3u8(\?|$|#)/i.test(urlStr)) {
      res.json({
        type: 'hls',
        videoUrl: urlStr,
        candidates: [{ type: 'hls', url: urlStr, label: 'Direct HLS HD Stream' }],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    if (/\.(mp4|webm|ogg|mov)(\?|$|#)/i.test(urlStr)) {
      res.json({
        type: 'mp4',
        videoUrl: urlStr,
        candidates: [{ type: 'mp4', url: urlStr, label: 'Direct HD Video' }],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    const fetched = await fetchHtmlSafely(urlStr);
    if (!fetched) {
      const upgraded = urlStr.replace(/^http:\/\//i, 'https://');
      res.json({
        type: 'iframe',
        videoUrl: upgraded,
        candidates: [
          { type: 'iframe', url: upgraded, label: 'Isolated Stream Frame', needsTextStrip: false },
        ],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    if (fetched.contentType.includes('dash+xml')) {
      res.json({
        type: 'dash',
        videoUrl: fetched.finalUrl,
        candidates: [{ type: 'dash', url: fetched.finalUrl, label: 'Captured DASH Stream' }],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    if (
      fetched.contentType.includes('mpegurl') ||
      fetched.contentType.includes('vnd.apple.mpegurl')
    ) {
      res.json({
        type: 'hls',
        videoUrl: fetched.finalUrl,
        candidates: [{ type: 'hls', url: fetched.finalUrl, label: 'Captured HLS Stream' }],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    if (fetched.contentType.startsWith('video/')) {
      res.json({
        type: 'mp4',
        videoUrl: fetched.finalUrl,
        candidates: [{ type: 'mp4', url: fetched.finalUrl, label: 'Captured Video Stream' }],
        sourceTitle: safeUrl.hostname,
      });
      return;
    }

    // Unwrap document.write(unescape('...')) obfuscation if present
    const decodedHtml = decodeObfuscatedHtml(fetched.html);

    const titleMatch = decodedHtml.match(/<title[^>]*>([^<]{1,140})<\/title>/i);
    const sourceTitle = titleMatch ? titleMatch[1].trim() : safeUrl.hostname;

    const seen = new Set<string>();
    const candidates: StreamCandidate[] = [];

    // Step 1: Extract direct streams from SSR queryState / SPA JSON feeds (e.g., CMV.TV / Lovable)
    await extractSpaSsrStreams(decodedHtml, fetched.finalUrl, seen, candidates);

    // Step 2: Extract direct DASH/HLS + ClearKey + Cookie from Shaka CONFIG pages
    await extractShakaConfigStreams(decodedHtml, fetched.finalUrl, seen, candidates);

    // Step 3: Resolve dynamic JSON manifest streams (e.g., cricket-point -> id.json -> allrounder3)
    const jsonEmbeds = await resolveDynamicJsonStreams(
      decodedHtml,
      fetched.finalUrl,
      seen,
      candidates
    );

    // Step 4: Inspect decoded HTML for direct HLS/DASH/MP4/YouTube/iframe video sources
    const rankedIframes = parseHtmlForVideoSources(
      decodedHtml,
      fetched.finalUrl,
      seen,
      candidates
    );

    // Step 5: Unwrap discovered player iframes (extract Shaka CONFIG / SSR / direct HLS/DASH
    // so we NEVER show popup-ridden third-party iframes like allrounder3 with llvpn.com!)
    const hasPureVideo = candidates.some(
      (c) => c.type === 'hls' || c.type === 'dash' || c.type === 'mp4'
    );
    const embedsToInspect = Array.from(new Set([...jsonEmbeds, ...rankedIframes])).slice(0, 3);
    if (!hasPureVideo && embedsToInspect.length > 0) {
      for (const iframeUrl of embedsToInspect) {
        const inner = await fetchHtmlSafely(iframeUrl, fetched.finalUrl);
        if (inner && inner.html) {
          const innerDecoded = decodeObfuscatedHtml(inner.html);
          await extractShakaConfigStreams(innerDecoded, inner.finalUrl, seen, candidates);
          await extractSpaSsrStreams(innerDecoded, inner.finalUrl, seen, candidates);
          parseHtmlForVideoSources(innerDecoded, inner.finalUrl, seen, candidates, 'Unwrapped');
        }
      }
    }

    // Prioritize pure video streams (hls > dash > mp4 > youtube > iframe)
    const priorityOrder: Record<StreamCandidate['type'], number> = {
      hls: 0,
      dash: 1,
      mp4: 2,
      youtube: 3,
      iframe: 4,
    };
    candidates.sort((a, b) => priorityOrder[a.type] - priorityOrder[b.type]);

    // CRITICAL: Whenever pure video streams (HLS/DASH/MP4/YouTube) were extracted,
    // remove ALL wrapper iframe candidates so third-party popups, Telegram prompts, and page text NEVER appear!
    const pureCandidates = candidates.filter((c) => c.type !== 'iframe');
    const finalCandidates = pureCandidates.length > 0 ? pureCandidates : candidates;

    if (finalCandidates.length === 0) {
      const upgradedUrl = fetched.finalUrl.replace(/^http:\/\//i, 'https://');
      const keepNativeOrigin = isStandalonePlayerOrSpa(decodedHtml, upgradedUrl);
      finalCandidates.push({
        type: 'iframe',
        url: upgradedUrl,
        label: keepNativeOrigin ? 'Sandboxed Broadcast Player' : 'Clean Video Capture',
        needsTextStrip: !keepNativeOrigin,
      });
    }

    const primary = finalCandidates[0];
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      type: primary.type,
      videoUrl: primary.url,
      candidates: finalCandidates,
      sourceTitle,
    });
  });

  /**
   * Clean Video-Only Frame Sanitizer
   * Strips third-party page text, popups, window.open scripts, and overlays from static HTML pages
   * so ONLY the video element or embedded video player renders at exact 1.0x scale.
   */
  app.get('/api/clean-frame', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const safeUrl = isSafeExternalUrl(rawUrl);
    if (!safeUrl) {
      res.status(400).send('Invalid URL');
      return;
    }

    const fetched = await fetchHtmlSafely(safeUrl.toString());
    if (!fetched || !fetched.html) {
      res.status(502).send('Unable to load clean video frame');
      return;
    }

    let html = decodeObfuscatedHtml(fetched.html);
    const baseHref = new URL('.', fetched.finalUrl).toString();

    html = html.replace(
      /<script[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi,
      (fullTag, srcUrl: string) => {
        return isLikelyAdOrTracker(srcUrl) ? '' : fullTag;
      }
    );

    html = html.replace(/<meta[^>]+http-equiv=["']refresh["'][^>]*>/gi, '');

    const isolationHeadInjection = `
      <base href="${baseHref.replace(/"/g, '&quot;')}">
      <script>
        (function() {
          try {
            window.open = function() { return null; };
            window.alert = function() {};
            window.confirm = function() { return false; };
            window.prompt = function() { return null; };
            document.addEventListener('click', function(e) {
              var a = e.target && e.target.closest ? e.target.closest('a') : null;
              if (a) { e.preventDefault(); e.stopPropagation(); }
            }, true);
          } catch (e) {}
        })();
      </script>
      <style id="cricstage-video-only-css">
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          overflow: hidden !important;
          background: #000 !important;
        }
        header, nav, footer, aside, h1, h2, h3, h4, h5, h6, p, article, ul, ol, form,
        [class*="popup"], [id*="popup"], [class*="modal"], [id*="modal"],
        [class*="banner"], [class*="telegram"], [id*="telegram"],
        [class*="ad-"], [class*="ads-"], [id*="ad-"], [class*="notice"], [class*="alert"],
        .grid-panels, .brand-footer, .stream-header {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        video, .video-js, .jwplayer, .plyr, [data-player], iframe {
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        video {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          max-width: 100vw !important;
          max-height: 100vh !important;
          object-fit: contain !important;
          transform: scale(1) !important;
          background: #000 !important;
          z-index: 2147483640 !important;
        }
      </style>
    `;

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (match) => `${match}${isolationHeadInjection}`);
    } else {
      html = `<!doctype html><html><head>${isolationHeadInjection}</head><body>${html}</body></html>`;
    }

    const postLoadIsolator = `
      <script>
        (function() {
          function isolateVideoOnly() {
            var videos = Array.from(document.querySelectorAll('video'));
            if (videos.length > 0) {
              videos.forEach(function(v) {
                v.style.setProperty('position', 'fixed', 'important');
                v.style.setProperty('inset', '0', 'important');
                v.style.setProperty('width', '100vw', 'important');
                v.style.setProperty('height', '100vh', 'important');
                v.style.setProperty('object-fit', 'contain', 'important');
                v.style.setProperty('transform', 'scale(1)', 'important');
                v.style.setProperty('z-index', '2147483645', 'important');
                v.playbackRate = 1.0;
              });
              return;
            }
            var frames = Array.from(document.querySelectorAll('iframe')).filter(function(f) {
              var s = (f.src || '').toLowerCase();
              return s && s.indexOf('google') === -1 && s.indexOf('ad') === -1 && s.indexOf('pop') === -1;
            });
            if (frames.length > 0) {
              var target = frames[0];
              target.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
              target.style.setProperty('position', 'fixed', 'important');
              target.style.setProperty('inset', '0', 'important');
              target.style.setProperty('width', '100vw', 'important');
              target.style.setProperty('height', '100vh', 'important');
              target.style.setProperty('border', '0', 'important');
              target.style.setProperty('transform', 'scale(1)', 'important');
              target.style.setProperty('z-index', '2147483645', 'important');
            }
          }
          window.addEventListener('DOMContentLoaded', isolateVideoOnly);
          window.addEventListener('load', isolateVideoOnly);
          setTimeout(isolateVideoOnly, 800);
          setTimeout(isolateVideoOnly, 2200);
        })();
      </script>
    `;

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${postLoadIsolator}</body>`);
    } else {
      html += postLoadIsolator;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  });

  /**
   * CORS-safe HLS manifest/segment proxy for streams that do not send Access-Control-Allow-Origin.
   */
  app.get('/api/proxy-stream', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const safeUrl = isSafeExternalUrl(rawUrl);
    if (!safeUrl) {
      res.status(400).send('Invalid stream URL');
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const upstream = await fetch(safeUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: `${safeUrl.origin}/`,
        },
      });
      clearTimeout(timeoutId);

      if (!upstream.ok) {
        res.status(upstream.status).send('Upstream stream unavailable');
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const isM3u8 =
        contentType.toLowerCase().includes('mpegurl') ||
        safeUrl.pathname.toLowerCase().endsWith('.m3u8');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');

      if (isM3u8) {
        const text = await upstream.text();
        const base = upstream.url || safeUrl.toString();
        const rewritten = text
          .split('\n')
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#')) {
              return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
                const abs = resolveUrl(uri, base);
                return abs
                  ? `URI="/api/proxy-stream?url=${encodeURIComponent(abs)}"`
                  : `URI="${uri}"`;
              });
            }
            const abs = resolveUrl(trimmed, base);
            return abs ? `/api/proxy-stream?url=${encodeURIComponent(abs)}` : line;
          })
          .join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewritten);
        return;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(arrayBuffer));
    } catch {
      clearTimeout(timeoutId);
      res.status(502).send('Stream proxy failed');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CricStage Live server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
