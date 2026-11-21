import type { ExtractedStreamResult } from '../types';

/**
 * Extracts the best candidate URL out of messy pasted text, iframe HTML, or direct stream links.
 */
export function extractPrimaryUrlFromRawInput(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';

  // 1. Check for <iframe ... src="...">
  const iframeMatch = trimmed.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch?.[1]) {
    return iframeMatch[1].trim();
  }

  // 2. Check for direct .m3u8 URL anywhere inside pasted text
  const m3u8Match = trimmed.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i);
  if (m3u8Match?.[0]) {
    return m3u8Match[0].trim();
  }

  // 3. Check for direct .mp4 / .webm URL anywhere inside pasted text
  const videoMatch = trimmed.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|ogg)(?:\?[^\s"'<>]*)?/i);
  if (videoMatch?.[0]) {
    return videoMatch[0].trim();
  }

  // 4. General HTTP(S) URL inside pasted text
  const urlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch?.[0]) {
    return urlMatch[0].trim().replace(/[),.;]+$/, '');
  }

  // 5. Bare domain fallback
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

export function normalizeExternalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('@')) {
    return `https://t.me/${trimmed.slice(1)}`;
  }
  return `https://${trimmed}`;
}

export function getInstantStreamType(url: string): 'dash' | 'hls' | 'mp4' | 'youtube' | null {
  if (!url) return null;
  if (/\.mpd(\?|$|#)/i.test(url)) return 'dash';
  if (/\.m3u8(\?|$|#)/i.test(url)) return 'hls';
  if (/\.(mp4|webm|ogg|mov)(\?|$|#)/i.test(url)) return 'mp4';
  if (/(?:youtube\.com|youtu\.be)/i.test(url)) return 'youtube';
  return null;
}

export function toYouTubeEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') {
      id = parsed.pathname.slice(1).split('/')[0] || null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') id = parsed.searchParams.get('v');
      else if (parsed.pathname.startsWith('/live/')) id = parsed.pathname.split('/')[2] || null;
      else if (parsed.pathname.startsWith('/embed/')) id = parsed.pathname.split('/')[2] || null;
      else if (parsed.pathname.startsWith('/shorts/')) id = parsed.pathname.split('/')[2] || null;
    }
    if (id && /^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
      return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Uses the server-side Video Capture endpoint to strip surrounding webpage text/ads
 * and isolate ONLY the live video stream or player frame.
 */
export async function captureVideoFromLink(rawInput: string): Promise<ExtractedStreamResult> {
  const targetUrl = extractPrimaryUrlFromRawInput(rawInput);
  if (!targetUrl) {
    throw new Error('No valid stream URL found.');
  }

  const yt = toYouTubeEmbedUrl(targetUrl);
  if (yt) {
    return {
      type: 'youtube',
      videoUrl: yt,
      candidates: [{ type: 'youtube', url: yt, label: 'YouTube Live Player' }],
      sourceTitle: 'YouTube Broadcast',
    };
  }

  const instant = getInstantStreamType(targetUrl);
  if (instant === 'dash') {
    return {
      type: 'dash',
      videoUrl: targetUrl,
      candidates: [{ type: 'dash', url: targetUrl, label: 'Direct DASH HD Stream' }],
      sourceTitle: 'DASH Broadcast',
    };
  }
  if (instant === 'hls') {
    return {
      type: 'hls',
      videoUrl: targetUrl,
      candidates: [{ type: 'hls', url: targetUrl, label: 'Direct HLS HD Stream' }],
      sourceTitle: 'HLS Broadcast',
    };
  }
  if (instant === 'mp4') {
    return {
      type: 'mp4',
      videoUrl: targetUrl,
      candidates: [{ type: 'mp4', url: targetUrl, label: 'Direct HD Video' }],
      sourceTitle: 'HD Video Stream',
    };
  }

  const response = await fetch(`/api/extract-stream?url=${encodeURIComponent(targetUrl)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    return {
      type: 'iframe',
      videoUrl: targetUrl,
      candidates: [{ type: 'iframe', url: targetUrl, label: 'Direct Stream Frame' }],
      sourceTitle: 'Broadcast Frame',
    };
  }
  const data = (await response.json()) as ExtractedStreamResult;
  return data;
}

/**
 * Compresses an uploaded banner image file into a sharp 16:9 JPEG data URL (< 300KB)
 * so it stores cleanly inside Firestore without exceeding document limits.
 */
export function compressBannerImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const maxWidth = 1080;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.82;
        let result = canvas.toDataURL('image/jpeg', quality);
        while (result.length > 360000 && quality > 0.35) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(result);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
