import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { MonetagConfig } from '../types';
import { extractPrimaryUrlFromRawInput, normalizeExternalUrl } from '../utils/streamExtractor';

interface MonetagAdOverlayProps {
  config: MonetagConfig | null;
  /** Disable scheduled ads when inside the Admin Panel */
  paused?: boolean;
  /** Allow admin to manually preview an ad inside the website */
  forcePreviewUrl?: string | null;
  forceDisplaySeconds?: number;
  onCloseForcePreview?: () => void;
}

export function MonetagAdOverlay({
  config,
  paused = false,
  forcePreviewUrl = null,
  forceDisplaySeconds = 5,
  onCloseForcePreview,
}: MonetagAdOverlayProps) {
  const [adVisible, setAdVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [renderKey, setRenderKey] = useState(0);

  const resolvedConfigUrl = config?.adUrl
    ? normalizeExternalUrl(extractPrimaryUrlFromRawInput(config.adUrl))
    : '';

  const activeAdUrl = forcePreviewUrl
    ? normalizeExternalUrl(extractPrimaryUrlFromRawInput(forcePreviewUrl))
    : resolvedConfigUrl;

  const isPreviewMode = Boolean(forcePreviewUrl);
  const intervalMinutes = Math.max(1, Math.min(60, Number(config?.intervalMinutes) || 2));
  const displaySeconds = Math.max(
    5,
    Math.min(
      60,
      Number(isPreviewMode ? forceDisplaySeconds : config?.displaySeconds) || 10
    )
  );

  // Trigger manual admin preview immediately inside the website
  useEffect(() => {
    if (forcePreviewUrl) {
      setSecondsLeft(displaySeconds);
      setRenderKey((k) => k + 1);
      setAdVisible(true);
    }
  }, [forcePreviewUrl, displaySeconds]);

  // Scheduled interval runner (strictly inside the website, never opens external tabs)
  useEffect(() => {
    if (isPreviewMode || paused || !config?.enabled || !resolvedConfigUrl || adVisible) {
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    const timer = window.setTimeout(() => {
      setSecondsLeft(displaySeconds);
      setRenderKey((k) => k + 1);
      setAdVisible(true);
    }, intervalMs);

    return () => window.clearTimeout(timer);
  }, [
    adVisible,
    config?.enabled,
    displaySeconds,
    intervalMinutes,
    isPreviewMode,
    paused,
    resolvedConfigUrl,
  ]);

  // Countdown tick while ad overlay is displayed
  useEffect(() => {
    if (!adVisible || secondsLeft <= 0) return;
    const tick = window.setTimeout(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(tick);
  }, [adVisible, secondsLeft]);

  if (!adVisible || !activeAdUrl) return null;

  const handleClose = () => {
    setAdVisible(false);
    setSecondsLeft(0);
    if (isPreviewMode && onCloseForcePreview) {
      onCloseForcePreview();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Sponsored Ad"
    >
      <div className="w-full max-w-4xl h-[82dvh] max-h-[680px] bg-[#0B0F17] border border-white/12 rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        {/* Compact In-Site Ad Top Bar */}
        <div className="h-13 px-4 bg-[#0F141E] border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="font-semibold text-white">Sponsored</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-400">In-Site Ad</span>
          </div>

          {secondsLeft > 0 ? (
            <span className="text-xs font-mono tabular-nums text-slate-300 px-3 py-1.5 rounded-lg bg-white/6">
              Close in {secondsLeft}s
            </span>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[38px] px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>Close Ad</span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* In-Website Sandboxed Ad Container (never opens external browser windows/tabs) */}
        <div className="flex-1 w-full bg-black relative overflow-hidden">
          <iframe
            key={`${renderKey}_${activeAdUrl}`}
            src={activeAdUrl}
            title="Monetag Sponsored Content"
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </div>
  );
}

export default MonetagAdOverlay;

