import { ExternalLink, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { PopupConfig } from '../types';
import { normalizeExternalUrl } from '../utils/streamExtractor';

interface AnnouncementPopupProps {
  config: PopupConfig | null;
  open: boolean;
  onClose: () => void;
}

export function AnnouncementPopup({ config, open, onClose }: AnnouncementPopupProps) {
  if (!config || !config.enabled) return null;

  const hasContent =
    config.title.trim().length > 0 ||
    config.description.trim().length > 0 ||
    (config.buttonText.trim().length > 0 && config.buttonUrl.trim().length > 0);

  if (!hasContent) return null;

  const targetHref = normalizeExternalUrl(config.buttonUrl);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="announcement-popup-title"
        >
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-lg bg-[#0F141E] border border-white/12 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-white/8">
              <div className="min-w-0">
                <p className="text-xs font-medium text-rose-400 mb-1">Official Notice</p>
                <h2
                  id="announcement-popup-title"
                  className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-white leading-tight"
                >
                  {config.title.trim() || 'Important Announcement'}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close announcement"
                className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/8 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 max-h-[55vh] overflow-y-auto">
              {config.description.trim() ? (
                <p className="text-[15px] text-slate-200 leading-relaxed whitespace-pre-line">
                  {config.description.trim()}
                </p>
              ) : null}
            </div>

            {/* Footer Actions */}
            <div className="px-6 pb-6 pt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 border-t border-white/8 bg-[#0B0F17]">
              {targetHref && config.buttonText.trim() && (
                <a
                  href={targetHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-h-[48px] px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.99] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
                >
                  <span className="truncate">{config.buttonText.trim()}</span>
                  <ExternalLink className="w-4 h-4 shrink-0" />
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="min-h-[48px] px-5 py-3 rounded-xl bg-white/6 hover:bg-white/10 text-slate-200 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                Continue
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
