import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { Calendar, Play, Radio, Tv } from 'lucide-react';
import { AdminAuthGate } from './components/AdminAuthGate';
import { AdminPanel } from './components/AdminPanel';
import { AnnouncementPopup } from './components/AnnouncementPopup';
import { MonetagAdOverlay } from './components/MonetagAdOverlay.tsx';
import { restorePortraitOrientation, WatchPlayer } from './components/WatchPlayer';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  ASSET_PATHS,
  BOOTSTRAPPED_ADMIN_EMAIL,
  type DeviceLockDoc,
  type MatchItem,
  type MatchStatus,
  type MonetagConfig,
  type PopupConfig,
} from './types';
import { getLocalDeviceHash } from './utils/deviceLock';

type ActiveView = 'home' | 'watch' | 'admin';

const POPUP_DISMISSED_KEY = 'cricstage_popup_dismissed_v1';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [activeTab, setActiveTab] = useState<MatchStatus>('live');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  // Real-time Firestore state (zero mock/fake data)
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [popupConfig, setPopupConfig] = useState<PopupConfig | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [monetagConfig, setMonetagConfig] = useState<MonetagConfig | null>(null);

  // Auth & Single-Device Lock state
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);
  const [deviceLock, setDeviceLock] = useState<DeviceLockDoc | null>(null);
  const [localDeviceHash, setLocalDeviceHash] = useState<string>('');

  // Stealth 4-tap logo counter for opening Admin Panel
  const logoTapRef = useRef<{ count: number; lastTap: number }>({ count: 0, lastTap: 0 });

  // Compute local device SHA-256 fingerprint once on boot
  useEffect(() => {
    let mounted = true;
    getLocalDeviceHash().then((hash) => {
      if (mounted) setLocalDeviceHash(hash);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Track Firebase Auth state (strictly optional — viewers never need login)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (!user || !user.email || !user.emailVerified) {
        setIsVerifiedAdmin(false);
        return;
      }

      const isBootstrapped =
        user.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
      if (isBootstrapped) {
        setIsVerifiedAdmin(true);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'admins', user.uid));
        setIsVerifiedAdmin(snap.exists());
      } catch {
        setIsVerifiedAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for public matches (status in ['live', 'upcoming'])
  useEffect(() => {
    const matchesQuery = query(
      collection(db, 'matches'),
      where('status', 'in', ['live', 'upcoming'])
    );

    const unsubscribe = onSnapshot(
      matchesQuery,
      (snapshot) => {
        const loaded: MatchItem[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            title: String(data.title || ''),
            description: String(data.description || ''),
            bannerUrl: String(data.bannerUrl || ''),
            streamLink: String(data.streamLink || ''),
            extractedVideoUrl: String(data.extractedVideoUrl || ''),
            streamType: data.streamType || 'auto',
            status: data.status === 'upcoming' ? 'upcoming' : 'live',
            scheduledTime: String(data.scheduledTime || ''),
            createdBy: String(data.createdBy || ''),
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
          };
        });

        // Sort newest createdAt first cleanly client-side (avoids requiring composite Firestore index)
        loaded.sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() ?? 0;
          const bMs = b.createdAt?.toMillis?.() ?? 0;
          return bMs - aMs;
        });

        setMatches(loaded);
        setMatchesLoading(false);
      },
      (error) => {
        setMatchesLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'matches');
      }
    );

    return () => unsubscribe();
  }, []);

  // Real-time listener for visitor arrival popup (siteConfig/popup)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'siteConfig', 'popup'),
      (docSnap) => {
        if (!docSnap.exists()) {
          setPopupConfig(null);
          setPopupOpen(false);
          return;
        }
        const data = docSnap.data() as PopupConfig;
        setPopupConfig(data);

        const hasVisibleContent =
          data.enabled &&
          (data.title.trim().length > 0 ||
            data.description.trim().length > 0 ||
            (data.buttonText.trim().length > 0 && data.buttonUrl.trim().length > 0));

        if (hasVisibleContent) {
          const alreadyDismissed = sessionStorage.getItem(POPUP_DISMISSED_KEY) === 'true';
          if (!alreadyDismissed) {
            setPopupOpen(true);
          }
        } else {
          setPopupOpen(false);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'siteConfig/popup');
      }
    );

    return () => unsubscribe();
  }, []);

  // Real-time listener for timed Monetag Ads config (siteConfig/monetag)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'siteConfig', 'monetag'),
      (docSnap) => {
        if (!docSnap.exists()) {
          setMonetagConfig(null);
          return;
        }
        setMonetagConfig(docSnap.data() as MonetagConfig);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'siteConfig/monetag');
      }
    );

    return () => unsubscribe();
  }, []);

  // Real-time listener for non-PII single-device lock hash (deviceLocks/primary)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'deviceLocks', 'primary'),
      (docSnap) => {
        if (docSnap.exists()) {
          setDeviceLock(docSnap.data() as DeviceLockDoc);
        } else {
          setDeviceLock(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'deviceLocks/primary');
      }
    );

    return () => unsubscribe();
  }, []);

  // Enforce automatic sign-out if a session ever exists on a non-bound secondary device
  useEffect(() => {
    if (
      authUser &&
      deviceLock?.isLocked &&
      localDeviceHash &&
      deviceLock.deviceHash !== localDeviceHash
    ) {
      signOut(auth).catch(() => {});
      setIsVerifiedAdmin(false);
      if (activeView === 'admin') {
        setActiveView('home');
      }
    }
  }, [activeView, authUser, deviceLock, localDeviceHash]);

  // Ensure portrait orientation is always restored when returning to Home
  useEffect(() => {
    if (activeView === 'home') {
      restorePortraitOrientation();
    }
  }, [activeView]);

  const liveMatches = useMemo(
    () => matches.filter((m) => m.status === 'live'),
    [matches]
  );
  const upcomingMatches = useMemo(
    () => matches.filter((m) => m.status === 'upcoming'),
    [matches]
  );

  const activeWatchMatch = useMemo(
    () => matches.find((m) => m.id === selectedMatchId) || null,
    [matches, selectedMatchId]
  );

  // Stealth 4-tap logo handler: clicking logo 4 times opens Admin Panel
  const handleLogoTap = useCallback(() => {
    const now = Date.now();
    if (now - logoTapRef.current.lastTap > 2500) {
      logoTapRef.current = { count: 1, lastTap: now };
    } else {
      logoTapRef.current = {
        count: logoTapRef.current.count + 1,
        lastTap: now,
      };
    }

    if (logoTapRef.current.count >= 4) {
      logoTapRef.current = { count: 0, lastTap: 0 };

      // If locked to a different mobile/device, do NOT open admin login at all
      if (
        deviceLock?.isLocked &&
        localDeviceHash &&
        deviceLock.deviceHash !== localDeviceHash
      ) {
        return;
      }

      setActiveView('admin');
    }
  }, [deviceLock, localDeviceHash]);

  const handleWatchMatch = useCallback((match: MatchItem) => {
    setSelectedMatchId(match.id);
    setActiveView('watch');
    try {
      window.history.pushState({ cricstageView: 'watch', matchId: match.id }, '');
    } catch {
      // ignore history restrictions in sandboxed frames
    }
  }, []);

  const handleExitWatch = useCallback(() => {
    restorePortraitOrientation();
    setSelectedMatchId(null);
    setActiveTab('live');
    setActiveView('home');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (activeView === 'watch') {
        restorePortraitOrientation();
        setSelectedMatchId(null);
        setActiveTab('live');
        setActiveView('home');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeView]);

  const handleClosePopup = useCallback(() => {
    setPopupOpen(false);
    try {
      sessionStorage.setItem(POPUP_DISMISSED_KEY, 'true');
    } catch {
      // ignore storage errors
    }
  }, []);

  const isThisPrimaryDeviceAuthorized =
    Boolean(authUser) &&
    isVerifiedAdmin &&
    (!deviceLock?.isLocked ||
      (Boolean(localDeviceHash) && deviceLock.deviceHash === localDeviceHash));

  // VIEW: WATCH PLAYER (Strictly inside our website + timed in-site Monetag Ads)
  if (activeView === 'watch' && activeWatchMatch) {
    return (
      <>
        <WatchPlayer match={activeWatchMatch} onExit={handleExitWatch} />
        <MonetagAdOverlay config={monetagConfig} paused={false} />
      </>
    );
  }

  // VIEW: ADMIN CONSOLE OR ADMIN AUTH GATE
  if (activeView === 'admin') {
    if (isThisPrimaryDeviceAuthorized && authUser) {
      return (
        <AdminPanel
          user={authUser}
          matches={matches}
          popupConfig={popupConfig}
          monetagConfig={monetagConfig}
          onExit={() => setActiveView('home')}
          onDeviceLockReset={() => {
            setIsVerifiedAdmin(false);
            setActiveView('home');
          }}
        />
      );
    }

    return (
      <AdminAuthGate
        deviceLock={deviceLock}
        localDeviceHash={localDeviceHash}
        onAuthorized={(verifiedUser) => {
          setAuthUser(verifiedUser);
          setIsVerifiedAdmin(true);
        }}
        onCancel={() => setActiveView('home')}
      />
    );
  }

  const displayedMatches = activeTab === 'live' ? liveMatches : upcomingMatches;

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col">
      {/* Visitor Arrival Popup (Admin Controlled) */}
      <AnnouncementPopup
        config={popupConfig}
        open={popupOpen}
        onClose={handleClosePopup}
      />

      {/* Timed In-Website Monetag Ads Overlay */}
      <MonetagAdOverlay config={monetagConfig} paused={false} />

      {/* Strict 3-Zone Top Bar Contract (compact 64px height for <=15% mobile sticky cap) */}
      <header className="sticky top-0 z-30 h-16 bg-[#07090E]/90 backdrop-blur-md border-b border-white/8">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark (4-tap stealth admin trigger) */}
          <button
            type="button"
            onClick={handleLogoTap}
            className="flex items-center gap-2.5 text-left select-none whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-lg"
            aria-label="CricStage Live"
          >
            <img
              src={ASSET_PATHS.BRAND_EMBLEM}
              alt="CricStage Live emblem"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover border border-white/10"
            />
            <span className="font-display text-2xl font-bold tracking-wider text-white">
              CricStage
            </span>
          </button>

          {/* Zone 2: Clean Single-Line Navigation Links */}
          <nav
            aria-label="Match sections"
            className="hidden sm:flex items-center gap-8 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'live'
                  ? 'border-rose-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Live Now
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upcoming')}
              className={`py-1 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'upcoming'
                  ? 'border-rose-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Upcoming
            </button>
          </nav>

          {/* Zone 3: Single Primary Contextual Action */}
          <div className="flex items-center shrink-0">
            {liveMatches.length > 0 ? (
              <button
                type="button"
                onClick={() => handleWatchMatch(liveMatches[0])}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Watch Live</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setActiveTab((prev) => (prev === 'live' ? 'upcoming' : 'live'))
                }
                className="min-h-[40px] px-4 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-slate-100 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {activeTab === 'live' ? 'View Upcoming' : 'View Live Now'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Atmospheric Stadium Hero */}
      <section className="relative overflow-hidden border-b border-white/8">
        <div className="absolute inset-0">
          <img
            src={ASSET_PATHS.HERO_STADIUM}
            alt="International cricket stadium illuminated under night floodlights"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#07090E] via-[#07090E]/70 to-[#07090E]/45" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-10 sm:pt-14 sm:pb-12">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-medium text-rose-400 tracking-wide">
              Broadcast HD · Zero Login Required
            </p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-wide text-white leading-[1.05]">
              Live Cricket Stadium Broadcasts
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Stream live matches in full 1.0x broadcast clarity or check upcoming fixtures as soon
              as they go live.
            </p>
          </div>

          {/* Primary Interactive Section Switcher: Live Now | Upcoming */}
          <div className="mt-7 inline-flex items-center p-1 bg-[#0F141E]/95 border border-white/10 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`min-h-[44px] px-5 sm:px-6 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'live'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Radio className="w-4 h-4" />
              <span>Live Now</span>
              <span className="font-mono text-xs tabular-nums opacity-85">
                ({liveMatches.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('upcoming')}
              className={`min-h-[44px] px-5 sm:px-6 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'upcoming'
                  ? 'bg-white text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Upcoming</span>
              <span className="font-mono text-xs tabular-nums opacity-85">
                ({upcomingMatches.length})
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Matches Feed (Strictly Real Uploaded Matches Only) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-wide text-white">
              {activeTab === 'live' ? 'Live Now' : 'Upcoming Matches'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              {activeTab === 'live'
                ? 'Tap Watch Now to launch the isolated HD video player.'
                : 'Scheduled upcoming cricket fixtures published for broadcast.'}
            </p>
          </div>
        </div>

        {/* Loading Skeleton */}
        {matchesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((slot) => (
              <div
                key={slot}
                className="bg-[#0F141E] border border-white/8 rounded-2xl overflow-hidden animate-pulse"
              >
                <div className="aspect-video bg-white/5" />
                <div className="p-5 space-y-3">
                  <div className="h-3 w-24 bg-white/8 rounded" />
                  <div className="h-5 w-3/4 bg-white/10 rounded" />
                  <div className="h-4 w-full bg-white/5 rounded" />
                  <div className="h-11 w-full bg-white/8 rounded-xl mt-2" />
                </div>
              </div>
            ))}
          </div>
        ) : displayedMatches.length === 0 ? (
          /* Honest Empty State — Zero Fake/Placeholder Matches */
          <div className="bg-[#0F141E] border border-white/8 rounded-2xl px-6 py-16 text-center max-w-2xl mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-white/5 text-slate-400 flex items-center justify-center mx-auto mb-5">
              {activeTab === 'live' ? (
                <Tv className="w-7 h-7" />
              ) : (
                <Calendar className="w-7 h-7" />
              )}
            </div>
            <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-wide text-white mb-2">
              {activeTab === 'live'
                ? 'No Live Matches Right Now'
                : 'No Upcoming Matches Scheduled'}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              {activeTab === 'live'
                ? 'Live match broadcasts will appear here automatically the moment they go on air.'
                : 'Upcoming fixtures will appear here as soon as the schedule is published.'}
            </p>
            {activeTab === 'live' && upcomingMatches.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('upcoming')}
                className="mt-6 min-h-[44px] px-5 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Check Upcoming Matches ({upcomingMatches.length})
              </button>
            )}
          </div>
        ) : (
          /* Real Published Matches Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedMatches.map((match) => (
              <article
                key={match.id}
                className="group bg-[#0F141E] border border-white/8 hover:border-white/16 rounded-2xl overflow-hidden flex flex-col transition-colors"
              >
                {/* 16:9 Match Banner */}
                <div className="relative aspect-video bg-[#07090E] overflow-hidden">
                  <img
                    src={match.bannerUrl || ASSET_PATHS.DEFAULT_BANNER}
                    alt={match.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (!img.src.includes(ASSET_PATHS.DEFAULT_BANNER)) {
                        img.src = ASSET_PATHS.DEFAULT_BANNER;
                      }
                    }}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F141E]/85 via-transparent to-transparent" />
                </div>

                {/* Card Body */}
                <div className="p-5 flex-1 flex flex-col">
                  {/* Unboxed Clean Metadata Line */}
                  <div className="flex items-center gap-2 text-xs mb-2">
                    <span
                      className={
                        match.status === 'live'
                          ? 'text-rose-400 font-semibold'
                          : 'text-slate-400 font-medium'
                      }
                    >
                      {match.status === 'live' ? 'Live Now' : 'Upcoming'}
                    </span>
                    {match.scheduledTime && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-slate-400 truncate">{match.scheduledTime}</span>
                      </>
                    )}
                  </div>

                  <h3 className="font-display text-2xl font-bold tracking-wide text-white leading-snug mb-2">
                    {match.title}
                  </h3>

                  {match.description && (
                    <p className="text-sm text-slate-400 leading-relaxed line-clamp-3 mb-5">
                      {match.description}
                    </p>
                  )}

                  <div className="mt-auto pt-2">
                    {match.status === 'live' ? (
                      <button
                        type="button"
                        onClick={() => handleWatchMatch(match)}
                        className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Watch Now</span>
                      </button>
                    ) : (
                      <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-white/5 border border-white/8 text-slate-300 text-xs font-medium flex items-center justify-center">
                        {match.scheduledTime
                          ? `Scheduled · ${match.scheduledTime}`
                          : 'Coming Soon'}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-white/8 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} CricStage Live. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => {
                setActiveTab('live');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Live Now
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('upcoming');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Upcoming
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
