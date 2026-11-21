import type { Timestamp } from 'firebase/firestore';

export type MatchStatus = 'live' | 'upcoming';
export type StreamType = 'auto' | 'hls' | 'mp4' | 'iframe' | 'youtube';

/**
 * Verbatim validation constants synchronized with firebase-blueprint.json & firestore.rules
 */
export const SCHEMA_LIMITS = {
  MATCH_TITLE_MAX: 140,
  MATCH_DESC_MAX: 2000,
  MATCH_BANNER_MAX: 450000,
  MATCH_STREAM_LINK_MAX: 4000,
  MATCH_EXTRACTED_URL_MAX: 4000,
  MATCH_SCHEDULED_TIME_MAX: 80,
  POPUP_TITLE_MAX: 160,
  POPUP_DESC_MAX: 5000,
  POPUP_BTN_TEXT_MAX: 80,
  POPUP_BTN_URL_MAX: 1000,
  MONETAG_URL_MAX: 1000,
  MONETAG_INTERVAL_MIN: 1,
  MONETAG_INTERVAL_MAX: 60,
  MONETAG_DISPLAY_MIN: 5,
  MONETAG_DISPLAY_MAX: 60,
  DEVICE_LABEL_MAX: 160,
  EMAIL_MAX: 254,
} as const;

export const BOOTSTRAPPED_ADMIN_EMAIL = 'akm6393236867@gmail.com';

export const ASSET_PATHS = {
  HERO_STADIUM: '/src/assets/images/hero_cricket_stadium_1795134589855.jpg',
  DEFAULT_BANNER: '/src/assets/images/default_match_banner_1795134586888.jpg',
  BRAND_EMBLEM: '/src/assets/images/brand_emblem_icon_1795134594160.jpg',
} as const;

export interface MatchItem {
  id: string;
  title: string;
  description: string;
  bannerUrl: string;
  streamLink: string;
  extractedVideoUrl: string;
  streamType: StreamType;
  status: MatchStatus;
  scheduledTime: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface PopupConfig {
  enabled: boolean;
  title: string;
  description: string;
  buttonText: string;
  buttonUrl: string;
  updatedBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface MonetagConfig {
  enabled: boolean;
  adUrl: string;
  intervalMinutes: number;
  displaySeconds: number;
  updatedBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface DeviceLockDoc {
  isLocked: boolean;
  deviceHash: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AdminSecretDoc {
  boundAdminUid: string;
  boundAdminEmail: string;
  deviceLabel: string;
  deviceHash: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface StreamCandidate {
  type: 'dash' | 'hls' | 'mp4' | 'youtube' | 'iframe';
  url: string;
  label: string;
  clearKeys?: Record<string, string>;
  cookie?: string;
  needsTextStrip?: boolean;
}

export interface ExtractedStreamResult {
  type: 'dash' | 'hls' | 'mp4' | 'youtube' | 'iframe';
  videoUrl: string;
  candidates: StreamCandidate[];
  sourceTitle: string;
}
