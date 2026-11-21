import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import shaka from 'shaka-player';
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Play,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ExtractedStreamResult, MatchItem, StreamCandidate } from '../types';
import { captureVideoFromLink, extractPrimaryUrlFromRawInput } from '../utils/streamExtractor';

interface WatchPlayerProps {
  match: MatchItem;
  onExit: () => void;
}

type OrientationWithLock = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

function isTouchPortraitPhone(): boolean {
  if (typeof window === 'undefined') return false;
  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return isCoarsePointer && window.innerWidth < window.innerHeight && window.innerWidth <= 768;
}

async function requestLandscapeOrientation(): Promise<boolean> {
  try {
    const orientation = window.screen?.orientation as OrientationWithLock | undefined;
    if (orientation && typeof orientation.lock === 'function') {
      await orientation.lock('landscape');
      return true;
    }
  } catch {
    // Browsers may restrict orientation.lock without fullscreen or on desktop/iOS
  }
  return false;
}

export async function restorePortraitOrientation(): Promise<void> {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
    }
  } catch {
    // ignore fullscreen exit failure
  }
  try {
    const orientation = window.screen?.orientation as OrientationWithLock | undefined;
    if (orientation && typeof orientation.lock === 'function') {
      await orientation.lock('portrait').catch(() => {});
    }
    if (orientation && typeof orientation.unlock === 'function') {
      orientation.unlock();
    }
  } catch {
    // ignore unlock failure
  }
}

export function WatchPlayer({ match, onExit }: WatchPlayerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const shakaRef = useRef<shaka.Player | null>(null);

  const [loadingStream, setLoadingStream] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<StreamCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [useProxyFallback, setUseProxyFallback] = useState(false);
  const [cleanVideoFilter, setCleanVideoFilter] = useState(true);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAutoLandscapeCss, setIsAutoLandscapeCss] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  }));
  const [isMuted, setIsMuted] = useState(false);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [autoMutedForStart, setAutoMutedForStart] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);

  // Track exact viewport dimensions & auto-landscape ONLY on genuine touch portrait mobile phones
  useEffect(() => {
    let active = true;

    const syncViewport = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewportSize({ width: w, height: h });
      if (w > h) {
        setIsAutoLandscapeCss(false);
      }
    };

    const engageMobileLandscape = async () => {
      if (!isTouchPortraitPhone()) return;
      const nativeLocked = await requestLandscapeOrientation();
      if (!active) return;
      if (!nativeLocked && isTouchPortraitPhone()) {
        setIsAutoLandscapeCss(true);
      }
    };

    syncViewport();
    engageMobileLandscape();

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      syncViewport();
    };

    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      active = false;
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      restorePortraitOrientation();
    };
  }, []);

  // Always run fresh live video extraction from match.streamLink so ClearKeys, tokens & cookies are never stale
  const loadCapturedStream = useCallback(async () => {
    setLoadingStream(true);
    setStreamError(null);
    setUseProxyFallback(false);
    setAutoMutedForStart(false);

    const sourceLink = (match.streamLink || match.extractedVideoUrl || '').trim();
    if (!sourceLink) {
      setStreamError('No stream link has been added for this match yet.');
      setLoadingStream(false);
      return;
    }

    try {
      const result: ExtractedStreamResult = await captureVideoFromLink(sourceLink);
      if (result.candidates && result.candidates.length > 0) {
        setCandidates(result.candidates);
        setActiveIndex(0);
        setCleanVideoFilter(Boolean(result.candidates[0].needsTextStrip));
      } else {
        setCandidates([
          {
            type: result.type,
            url: result.videoUrl,
            label: 'Video Capture',
            needsTextStrip: result.type === 'iframe',
          },
        ]);
        setActiveIndex(0);
        setCleanVideoFilter(result.type === 'iframe');
      }
    } catch {
      const fallbackUrl = extractPrimaryUrlFromRawInput(sourceLink);
      if (fallbackUrl) {
        setCandidates([
          {
            type: 'iframe',
            url: fallbackUrl,
            label: 'Clean Video Capture',
            needsTextStrip: true,
          },
        ]);
        setActiveIndex(0);
        setCleanVideoFilter(true);
      } else {
        setStreamError('Unable to capture video from this match link.');
      }
    } finally {
      setLoadingStream(false);
    }
  }, [match.extractedVideoUrl, match.streamLink]);

  useEffect(() => {
    loadCapturedStream();
  }, [loadCapturedStream]);

  const currentCandidate = candidates[activeIndex] || null;
  const isNativeVideo =
    currentCandidate?.type === 'dash' ||
    currentCandidate?.type === 'hls' ||
    currentCandidate?.type === 'mp4';

  // Bind native Shaka Player (DASH + ClearKey + Cookie), HLS.js (HLS), or HTML5 video locked to 1.0x
  useEffect(() => {
    if (!currentCandidate) return;
    if (
      currentCandidate.type !== 'dash' &&
      currentCandidate.type !== 'hls' &&
      currentCandidate.type !== 'mp4'
    ) {
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;

    let cancelled = false;

    const cleanupPlayers = async () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (shakaRef.current) {
        const oldShaka = shakaRef.current;
        shakaRef.current = null;
        try {
          await oldShaka.destroy();
        } catch {
          // ignore destroy errors
        }
      }
      videoEl.removeAttribute('src');
      videoEl.load();
    };

    const attemptAutoplay = async () => {
      if (cancelled) return;
      videoEl.playbackRate = 1.0;
      videoEl.defaultPlaybackRate = 1.0;
      videoEl.muted = false;
      try {
        await videoEl.play();
        if (!cancelled) {
          setIsMuted(false);
          setAutoMutedForStart(false);
          setNeedsManualPlay(false);
        }
      } catch {
        // Mobile browsers block unmuted autoplay after async fetch — start immediately muted + show Tap for Sound
        try {
          videoEl.muted = true;
          await videoEl.play();
          if (!cancelled) {
            setIsMuted(true);
            setAutoMutedForStart(true);
            setNeedsManualPlay(false);
          }
        } catch {
          if (!cancelled) {
            setNeedsManualPlay(true);
          }
        }
      }
    };

    const startPlayback = async () => {
      await cleanupPlayers();
      if (cancelled) return;

      setNeedsManualPlay(false);
      setAutoMutedForStart(false);
      setStreamError(null);
      videoEl.playbackRate = 1.0;
      videoEl.defaultPlaybackRate = 1.0;

      // 1. Native Shaka Player for DASH (.mpd) + ClearKey DRM + JioTV/Akamai Cookie Token
      if (currentCandidate.type === 'dash') {
        try {
          shaka.polyfill.installAll();
          if (!shaka.Player.isBrowserSupported()) {
            setStreamError('Your browser does not support DASH HD playback.');
            return;
          }

          const player = new shaka.Player();
          shakaRef.current = player;
          await player.attach(videoEl);
          if (cancelled) {
            await player.destroy();
            return;
          }

          player.configure({
            drm:
              currentCandidate.clearKeys && Object.keys(currentCandidate.clearKeys).length > 0
                ? { clearKeys: currentCandidate.clearKeys }
                : {},
            manifest: {
              defaultPresentationDelay: 5,
            },
            streaming: {
              lowLatencyMode: true,
              bufferingGoal: 10,
              rebufferingGoal: 2,
              safeSeekOffset: 5,
            },
          });

          if (currentCandidate.cookie) {
            const rawCookie = currentCandidate.cookie.trim();
            const urlCookie = rawCookie.startsWith('__hdnea__=')
              ? rawCookie.slice(10)
              : rawCookie;

            if (urlCookie) {
              player.getNetworkingEngine()?.registerRequestFilter((type, request) => {
                if (
                  (type === shaka.net.NetworkingEngine.RequestType.MANIFEST ||
                    type === shaka.net.NetworkingEngine.RequestType.SEGMENT) &&
                  request.uris[0] &&
                  !request.uris[0].includes('__hdnea__')
                ) {
                  const sep = request.uris[0].includes('?') ? '&' : '?';
                  request.uris[0] += `${sep}__hdnea__=${urlCookie}`;
                }
              });
            }
          }

          player.addEventListener('error', () => {
            if (!cancelled) {
              setStreamError('Live DASH stream interrupted. Tap Refresh Feed to reconnect.');
            }
          });

          await player.load(currentCandidate.url);
          await attemptAutoplay();
        } catch {
          if (!cancelled) {
            if (activeIndex + 1 < candidates.length) {
              setActiveIndex((prev) => prev + 1);
            } else {
              setStreamError(
                'Unable to load live DASH feed in this network/region. Tap Refresh Feed or try another stream.'
              );
            }
          }
        }
        return;
      }

      // 2. Native HLS.js for .m3u8 (1080p direct video — zero popups, zero text)
      if (currentCandidate.type === 'hls') {
        const playbackUrl = useProxyFallback
          ? `/api/proxy-stream?url=${encodeURIComponent(currentCandidate.url)}`
          : currentCandidate.url;

        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
          });
          hlsRef.current = hls;
          hls.loadSource(playbackUrl);
          hls.attachMedia(videoEl);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            attemptAutoplay();
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && !cancelled) {
              if (!useProxyFallback) {
                setUseProxyFallback(true);
              } else if (activeIndex + 1 < candidates.length) {
                setUseProxyFallback(false);
                setActiveIndex((prev) => prev + 1);
              } else {
                setStreamError('Live HLS stream interrupted. Tap Refresh Feed to reconnect.');
              }
            }
          });
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = playbackUrl;
          videoEl.addEventListener(
            'loadedmetadata',
            () => {
              attemptAutoplay();
            },
            { once: true }
          );
        }
        return;
      }

      // 3. Direct MP4 / WebM video
      videoEl.src = currentCandidate.url;
      videoEl.addEventListener(
        'loadedmetadata',
        () => {
          attemptAutoplay();
        },
        { once: true }
      );
    };

    startPlayback();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (shakaRef.current) {
        const oldShaka = shakaRef.current;
        shakaRef.current = null;
        oldShaka.destroy().catch(() => {});
      }
    };
  }, [currentCandidate, useProxyFallback, activeIndex, candidates.length]);

  useEffect(() => {
    if (!hudVisible) return;
    const timer = window.setTimeout(() => {
      if (isAutoLandscapeCss || isFullscreen) {
        setHudVisible(false);
      }
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [hudVisible, isAutoLandscapeCss, isFullscreen]);

  const handleBackToHome = async () => {
    setIsAutoLandscapeCss(false);
    await restorePortraitOrientation();
    onExit();
  };

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && stageRef.current?.requestFullscreen) {
        await stageRef.current.requestFullscreen();
        await requestLandscapeOrientation();
        setIsAutoLandscapeCss(false);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      setIsAutoLandscapeCss((prev) => !prev);
    }
  };

  const handleToggleRotate = async () => {
    if (isAutoLandscapeCss) {
      setIsAutoLandscapeCss(false);
      await restorePortraitOrientation();
    } else {
      const nativeLocked = await requestLandscapeOrientation();
      if (!nativeLocked) {
        setIsAutoLandscapeCss(true);
      }
    }
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) {
      setAutoMutedForStart(false);
    }
  };

  const handleUnmuteTap = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = false;
    videoRef.current.volume = 1;
    setIsMuted(false);
    setAutoMutedForStart(false);
  };

  const handleManualPlay = () => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = 1.0;
    videoRef.current.muted = false;
    videoRef.current
      .play()
      .then(() => {
        setNeedsManualPlay(false);
        setIsMuted(false);
        setAutoMutedForStart(false);
      })
      .catch(() => {});
  };

  const renderVideoSurface = () => {
    if (loadingStream) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black text-slate-300 gap-3 p-6">
          <div className="w-10 h-10 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-slate-200">Capturing pure video stream...</p>
          <p className="text-xs text-slate-500">100% Video Only · Zero Popups · 1.0x HD</p>
        </div>
      );
    }

    if (streamError || !currentCandidate) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black text-center p-6 gap-4">
          <p className="text-sm sm:text-base font-semibold text-white max-w-md">
            {streamError || 'Broadcast stream unavailable'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={loadCapturedStream}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Video Capture
            </button>
            {candidates.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setStreamError(null);
                  setUseProxyFallback(false);
                  setActiveIndex((prev) => (prev + 1) % candidates.length);
                }}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium cursor-pointer"
              >
                Try Next Feed
              </button>
            )}
          </div>
        </div>
      );
    }

    // Pure captured DASH / HLS / MP4 video — 100% native <video>, ZERO third-party popups, ZERO text!
    if (isNativeVideo) {
      return (
        <div
          className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
          onClick={() => setHudVisible(true)}
        >
          <video
            ref={videoRef}
            controls
            playsInline
            autoPlay
            muted={isMuted}
            className="video-scale-exact bg-black"
          />

          {autoMutedForStart && !needsManualPlay && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUnmuteTap();
              }}
              className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 min-h-[42px] px-4 py-2 rounded-xl bg-black/80 hover:bg-black border border-white/20 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 shadow-xl backdrop-blur-md cursor-pointer"
            >
              <Volume2 className="w-4 h-4 text-rose-400" />
              Tap for Sound
            </button>
          )}

          {needsManualPlay && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleManualPlay();
              }}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 cursor-pointer"
              aria-label="Start live playback"
            >
              <span className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-2xl">
                <Play className="w-7 h-7 fill-current ml-1" />
              </span>
            </button>
          )}
        </div>
      );
    }

    // Fallback for YouTube or isolated video frame (strict sandbox blocks popups & top redirects)
    const safeIframeUrl =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      currentCandidate.url.startsWith('http://')
        ? currentCandidate.url.replace(/^http:\/\//i, 'https://')
        : currentCandidate.url;

    const iframeSrc =
      currentCandidate.type === 'iframe' && cleanVideoFilter
        ? `/api/clean-frame?url=${encodeURIComponent(safeIframeUrl)}`
        : safeIframeUrl;

    return (
      <div
        className="relative w-full h-full bg-black overflow-hidden"
        onMouseMove={() => setHudVisible(true)}
        onTouchStart={() => setHudVisible(true)}
      >
        <iframe
          key={`${iframeSrc}_${cleanVideoFilter ? 'clean' : 'direct'}`}
          src={iframeSrc}
          title={match.title}
          className="w-full h-full border-0 video-scale-exact bg-black"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      </div>
    );
  };

  // Pixel-exact 1.0x Landscape Theater Stage for touch mobile phones
  if (isAutoLandscapeCss) {
    return (
      <div
        ref={stageRef}
        className="landscape-auto-stage flex flex-col"
        style={{
          width: `${viewportSize.height}px`,
          height: `${viewportSize.width}px`,
        }}
      >
        <div
          className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-4 px-4 py-2 bg-gradient-to-b from-black/85 via-black/45 to-transparent transition-opacity duration-200 ${
            hudVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleBackToHome}
              className="min-w-[40px] min-h-[40px] rounded-xl bg-black/70 hover:bg-black/90 border border-white/15 text-white flex items-center justify-center cursor-pointer shrink-0"
              aria-label="Back to Live Now"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{match.title}</p>
              <p className="text-[11px] text-slate-300 font-mono tabular-nums">
                1.0x Pure Video · Popups Blocked
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isNativeVideo && (
              <button
                type="button"
                onClick={handleToggleMute}
                className="min-w-[40px] min-h-[40px] rounded-xl bg-black/70 hover:bg-black/90 border border-white/15 text-white flex items-center justify-center cursor-pointer"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleRotate}
              className="min-h-[40px] px-3 rounded-xl bg-black/70 hover:bg-black/90 border border-white/15 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RotateCw className="w-4 h-4" />
              Portrait
            </button>
          </div>
        </div>

        <div className="w-full h-full relative flex items-center justify-center bg-black">
          {renderVideoSurface()}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col">
      {/* Compact In-Site Broadcast Header */}
      <header className="sticky top-0 z-30 bg-[#07090E]/95 backdrop-blur-md border-b border-white/8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleBackToHome}
            className="min-h-[44px] px-3 -ml-3 rounded-xl text-slate-200 hover:text-white hover:bg-white/6 inline-flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Live Now</span>
          </button>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 truncate">
            <span className="text-rose-500 font-semibold">LIVE</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-200 font-medium truncate">{match.title}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleRotate}
              className="min-h-[40px] px-3 rounded-lg bg-white/6 hover:bg-white/12 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              title="Rotate to 1.0x Landscape"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Landscape 1x</span>
            </button>
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="min-h-[40px] px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              {isFullscreen ? (
                <>
                  <Minimize className="w-3.5 h-3.5" />
                  <span>Exit Full</span>
                </>
              ) : (
                <>
                  <Maximize className="w-3.5 h-3.5" />
                  <span>Fullscreen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Pure In-Website Broadcast Theater Viewport (Exact 16:9, Undistorted 1.0x) */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-7 flex flex-col gap-5">
        <div
          ref={stageRef}
          className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
        >
          {renderVideoSurface()}
        </div>

        {/* Clean Controls Bar (Strictly In-Site, Zero External Page Redirects) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-white leading-tight truncate">
              {match.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                {isNativeVideo ? 'Pure HD Video Stream' : 'Video-Only Capture'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Scale 1.0x</span>
              <span aria-hidden="true">·</span>
              <span>Zero Popups</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {candidates.length > 1 && (
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0F141E] border border-white/8 rounded-xl">
                {candidates.map((cand, idx) => (
                  <button
                    key={`${cand.url}_${idx}`}
                    type="button"
                    onClick={() => {
                      setActiveIndex(idx);
                      setUseProxyFallback(false);
                      setStreamError(null);
                      setCleanVideoFilter(Boolean(cand.needsTextStrip));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      idx === activeIndex
                        ? 'bg-rose-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {cand.label || `Stream ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}

            {currentCandidate?.type === 'iframe' && (
              <button
                type="button"
                onClick={() => setCleanVideoFilter((v) => !v)}
                className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  cleanVideoFilter
                    ? 'bg-emerald-600/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-white/6 border-white/8 text-slate-300 hover:bg-white/10'
                }`}
              >
                {cleanVideoFilter ? 'Text & Popup Strip: ON' : 'Text & Popup Strip: OFF'}
              </button>
            )}

            <button
              type="button"
              onClick={loadCapturedStream}
              className="min-h-[40px] px-3.5 rounded-xl bg-white/6 hover:bg-white/10 border border-white/8 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Feed
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
