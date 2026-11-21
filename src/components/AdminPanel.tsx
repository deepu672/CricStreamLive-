import React, { useEffect, useState } from 'react';
import { signOut, type User } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  Play,
  Plus,
  Radio,
  Shield,
  Trash2,
  Tv,
  Upload,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  ASSET_PATHS,
  SCHEMA_LIMITS,
  type AdminSecretDoc,
  type MatchItem,
  type MatchStatus,
  type MonetagConfig,
  type PopupConfig,
  type StreamType,
} from '../types';
import {
  captureVideoFromLink,
  compressBannerImage,
  extractPrimaryUrlFromRawInput,
  normalizeExternalUrl,
} from '../utils/streamExtractor';
import { MonetagAdOverlay } from './MonetagAdOverlay.tsx';

interface AdminPanelProps {
  user: User;
  matches: MatchItem[];
  popupConfig: PopupConfig | null;
  monetagConfig: MonetagConfig | null;
  onExit: () => void;
  onDeviceLockReset: () => void;
}

type AdminSection = 'matches' | 'popup' | 'monetag' | 'security';

function generateSafeMatchId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `match_${Date.now()}_${rand}`;
}

export function AdminPanel({
  user,
  matches,
  popupConfig,
  monetagConfig,
  onExit,
  onDeviceLockReset,
}: AdminPanelProps) {
  const [section, setSection] = useState<AdminSection>('matches');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Match form state
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [streamLink, setStreamLink] = useState('');
  const [extractedVideoUrl, setExtractedVideoUrl] = useState('');
  const [streamType, setStreamType] = useState<StreamType>('auto');
  const [status, setStatus] = useState<MatchStatus>('live');
  const [scheduledTime, setScheduledTime] = useState('');
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [capturingStream, setCapturingStream] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [savingMatch, setSavingMatch] = useState(false);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);

  // Popup settings form state
  const [popupEnabled, setPopupEnabled] = useState<boolean>(popupConfig?.enabled ?? false);
  const [popupTitle, setPopupTitle] = useState<string>(popupConfig?.title ?? '');
  const [popupDescription, setPopupDescription] = useState<string>(
    popupConfig?.description ?? ''
  );
  const [popupButtonUrl, setPopupButtonUrl] = useState<string>(popupConfig?.buttonUrl ?? '');
  const [popupButtonText, setPopupButtonText] = useState<string>(
    popupConfig?.buttonText ?? 'Join Telegram'
  );
  const [savingPopup, setSavingPopup] = useState(false);
  const [popupNotice, setPopupNotice] = useState<string | null>(null);

  // Monetag Ads form state
  const [monetagEnabled, setMonetagEnabled] = useState<boolean>(monetagConfig?.enabled ?? false);
  const [monetagAdUrl, setMonetagAdUrl] = useState<string>(monetagConfig?.adUrl ?? '');
  const [monetagIntervalMinutes, setMonetagIntervalMinutes] = useState<number>(
    monetagConfig?.intervalMinutes ?? 2
  );
  const [monetagDisplaySeconds, setMonetagDisplaySeconds] = useState<number>(
    monetagConfig?.displaySeconds ?? 10
  );
  const [savingMonetag, setSavingMonetag] = useState(false);
  const [monetagNotice, setMonetagNotice] = useState<string | null>(null);
  const [previewMonetagUrl, setPreviewMonetagUrl] = useState<string | null>(null);

  // Security / bound device info
  const [adminSecret, setAdminSecret] = useState<AdminSecretDoc | null>(null);
  const [confirmResetLock, setConfirmResetLock] = useState(false);
  const [resettingLock, setResettingLock] = useState(false);

  // Sync popup config into form when loaded from Firestore
  useEffect(() => {
    if (!popupConfig) return;
    setPopupEnabled(popupConfig.enabled);
    setPopupTitle(popupConfig.title);
    setPopupDescription(popupConfig.description);
    setPopupButtonUrl(popupConfig.buttonUrl);
    setPopupButtonText(popupConfig.buttonText);
  }, [popupConfig]);

  // Sync monetag config into form when loaded from Firestore
  useEffect(() => {
    if (!monetagConfig) return;
    setMonetagEnabled(monetagConfig.enabled);
    setMonetagAdUrl(monetagConfig.adUrl);
    setMonetagIntervalMinutes(monetagConfig.intervalMinutes);
    setMonetagDisplaySeconds(monetagConfig.displaySeconds);
  }, [monetagConfig]);

  // Load private admin device details when viewing security section
  useEffect(() => {
    if (section !== 'security') return;
    let active = true;
    const loadSecret = async () => {
      try {
        const snap = await getDoc(doc(db, 'adminSecrets', 'primaryDevice'));
        if (active && snap.exists()) {
          setAdminSecret(snap.data() as AdminSecretDoc);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'adminSecrets/primaryDevice');
      }
    };
    loadSecret();
    return () => {
      active = false;
    };
  }, [section]);

  const resetMatchForm = () => {
    setEditingMatchId(null);
    setTitle('');
    setDescription('');
    setBannerUrl('');
    setStreamLink('');
    setExtractedVideoUrl('');
    setStreamType('auto');
    setStatus('live');
    setScheduledTime('');
    setCaptureFeedback(null);
  };

  const handleEditMatch = (item: MatchItem) => {
    setEditingMatchId(item.id);
    setTitle(item.title);
    setDescription(item.description);
    setBannerUrl(item.bannerUrl);
    setStreamLink(item.streamLink);
    setExtractedVideoUrl(item.extractedVideoUrl);
    setStreamType(item.streamType);
    setStatus(item.status);
    setScheduledTime(item.scheduledTime);
    setCaptureFeedback(null);
    setMatchNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBannerFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBanner(true);
    setMatchNotice(null);
    try {
      const compressed = await compressBannerImage(file);
      setBannerUrl(compressed);
    } catch (err) {
      setMatchNotice(err instanceof Error ? err.message : 'Failed to process banner image.');
    } finally {
      setUploadingBanner(false);
      e.target.value = '';
    }
  };

  const handleTestVideoCapture = async () => {
    if (!streamLink.trim()) {
      setCaptureFeedback('Paste a match link first.');
      return;
    }
    setCapturingStream(true);
    setCaptureFeedback(null);
    try {
      const result = await captureVideoFromLink(streamLink);
      setExtractedVideoUrl(result.videoUrl.slice(0, SCHEMA_LIMITS.MATCH_EXTRACTED_URL_MAX));
      setStreamType(result.type === 'dash' ? 'auto' : result.type);
      const streamModeLabel =
        result.type === 'dash'
          ? 'PURE DASH HD VIDEO'
          : result.type === 'hls'
            ? 'PURE HLS HD VIDEO'
            : result.type.toUpperCase();
      setCaptureFeedback(
        `Video captured (${streamModeLabel}) · ${result.candidates.length} clean video source${
          result.candidates.length === 1 ? '' : 's'
        } · zero popups or text.`
      );
    } catch (err) {
      setCaptureFeedback(
        err instanceof Error ? err.message : 'Could not extract video stream automatically.'
      );
    } finally {
      setCapturingStream(false);
    }
  };

  const handleSaveMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim().slice(0, SCHEMA_LIMITS.MATCH_TITLE_MAX);
    if (!cleanTitle) return;

    setSavingMatch(true);
    setMatchNotice(null);

    let finalExtracted = extractedVideoUrl.trim();
    let finalType: StreamType = streamType;

    // Auto-run video capture if admin pasted a link without pressing Test Capture
    if (streamLink.trim() && !finalExtracted) {
      try {
        const captured = await captureVideoFromLink(streamLink.trim());
        finalExtracted = captured.videoUrl;
        finalType = captured.type === 'dash' ? 'auto' : captured.type;
      } catch {
        // leave empty so WatchPlayer extracts dynamically
      }
    }

    const basePayload = {
      title: cleanTitle,
      description: description.trim().slice(0, SCHEMA_LIMITS.MATCH_DESC_MAX),
      bannerUrl: bannerUrl.trim().slice(0, SCHEMA_LIMITS.MATCH_BANNER_MAX),
      streamLink: streamLink.trim().slice(0, SCHEMA_LIMITS.MATCH_STREAM_LINK_MAX),
      extractedVideoUrl: finalExtracted.slice(0, SCHEMA_LIMITS.MATCH_EXTRACTED_URL_MAX),
      streamType: finalType,
      status,
      scheduledTime: scheduledTime.trim().slice(0, SCHEMA_LIMITS.MATCH_SCHEDULED_TIME_MAX),
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingMatchId) {
        const path = `matches/${editingMatchId}`;
        try {
          await updateDoc(doc(db, 'matches', editingMatchId), basePayload);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
        setMatchNotice('Match updated live.');
      } else {
        const newId = generateSafeMatchId();
        const path = `matches/${newId}`;
        try {
          await setDoc(doc(db, 'matches', newId), {
            ...basePayload,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
        setMatchNotice('Match published live.');
      }
      resetMatchForm();
    } catch (err) {
      setMatchNotice(err instanceof Error ? err.message : 'Failed to save match.');
    } finally {
      setSavingMatch(false);
    }
  };

  const handleToggleMatchStatus = async (item: MatchItem) => {
    const nextStatus: MatchStatus = item.status === 'live' ? 'upcoming' : 'live';
    const path = `matches/${item.id}`;
    try {
      await updateDoc(doc(db, 'matches', item.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleDeleteMatch = async (item: MatchItem) => {
    const path = `matches/${item.id}`;
    try {
      await deleteDoc(doc(db, 'matches', item.id));
      if (editingMatchId === item.id) resetMatchForm();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleSavePopup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPopup(true);
    setPopupNotice(null);

    const payload = {
      enabled: popupEnabled,
      title: popupTitle.trim().slice(0, SCHEMA_LIMITS.POPUP_TITLE_MAX),
      description: popupDescription.trim().slice(0, SCHEMA_LIMITS.POPUP_DESC_MAX),
      buttonText: popupButtonText.trim().slice(0, SCHEMA_LIMITS.POPUP_BTN_TEXT_MAX),
      buttonUrl: popupButtonUrl.trim().slice(0, SCHEMA_LIMITS.POPUP_BTN_URL_MAX),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    };

    try {
      const popupRef = doc(db, 'siteConfig', 'popup');
      const existingSnap = await getDoc(popupRef);
      if (existingSnap.exists()) {
        await updateDoc(popupRef, payload);
      } else {
        await setDoc(popupRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setPopupNotice('Announcement popup settings saved live.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'siteConfig/popup');
    } finally {
      setSavingPopup(false);
    }
  };

  const handleSaveMonetag = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMonetag(true);
    setMonetagNotice(null);

    const extractedUrl = extractPrimaryUrlFromRawInput(monetagAdUrl).slice(
      0,
      SCHEMA_LIMITS.MONETAG_URL_MAX
    );
    const clampedInterval = Math.max(
      SCHEMA_LIMITS.MONETAG_INTERVAL_MIN,
      Math.min(SCHEMA_LIMITS.MONETAG_INTERVAL_MAX, Math.round(Number(monetagIntervalMinutes) || 1))
    );
    const clampedDisplay = Math.max(
      SCHEMA_LIMITS.MONETAG_DISPLAY_MIN,
      Math.min(SCHEMA_LIMITS.MONETAG_DISPLAY_MAX, Math.round(Number(monetagDisplaySeconds) || 10))
    );

    const payload = {
      enabled: monetagEnabled,
      adUrl: extractedUrl,
      intervalMinutes: clampedInterval,
      displaySeconds: clampedDisplay,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    };

    try {
      const monetagRef = doc(db, 'siteConfig', 'monetag');
      const existingSnap = await getDoc(monetagRef);
      if (existingSnap.exists()) {
        await updateDoc(monetagRef, payload);
      } else {
        await setDoc(monetagRef, {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setMonetagAdUrl(extractedUrl);
      setMonetagIntervalMinutes(clampedInterval);
      setMonetagDisplaySeconds(clampedDisplay);
      setMonetagNotice(
        monetagEnabled
          ? `Monetag Ads saved live — runs inside your website every ${clampedInterval} minute${
              clampedInterval === 1 ? '' : 's'
            }.`
          : 'Monetag Ads settings saved (currently paused).'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'siteConfig/monetag');
    } finally {
      setSavingMonetag(false);
    }
  };

  const handleResetDeviceLock = async () => {
    setResettingLock(true);
    try {
      await deleteDoc(doc(db, 'deviceLocks', 'primary'));
      await deleteDoc(doc(db, 'adminSecrets', 'primaryDevice'));
      await signOut(auth);
      onDeviceLockReset();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'deviceLocks/primary');
    } finally {
      setResettingLock(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    onExit();
  };

  const liveCount = matches.filter((m) => m.status === 'live').length;
  const upcomingCount = matches.filter((m) => m.status === 'upcoming').length;

  const navItems: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
    { id: 'matches', label: 'Matches & Streams', icon: <Tv className="w-4 h-4" /> },
    { id: 'popup', label: 'Announcement Popup', icon: <Bell className="w-4 h-4" /> },
    { id: 'monetag', label: 'Monetag Ads', icon: <Megaphone className="w-4 h-4" /> },
    { id: 'security', label: 'Device Security', icon: <Shield className="w-4 h-4" /> },
  ];

  const renderSidebarNav = () => (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-white/8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={ASSET_PATHS.BRAND_EMBLEM}
            alt="CricStage"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-white/10"
          />
          <div>
            <p className="font-display text-lg font-bold tracking-wide text-white leading-none">
              Admin Console
            </p>
            <p className="text-[11px] text-slate-400 truncate max-w-[155px] mt-0.5">
              {user.email}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden min-w-[40px] min-h-[40px] rounded-lg text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
          aria-label="Close admin menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="p-3 space-y-1 flex-1">
        {navItems.map((item) => {
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSection(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/6'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/8 space-y-1.5">
        <button
          type="button"
          onClick={onExit}
          className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white/6 hover:bg-white/10 text-slate-200 text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>View Public Site</span>
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-rose-400 hover:bg-rose-500/10 text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex">
      {/* Desktop Sidebar Admin Menu */}
      <aside className="hidden lg:block w-64 shrink-0 bg-[#0B0F17] border-r border-white/8 sticky top-0 h-screen">
        {renderSidebarNav()}
      </aside>

      {/* Mobile Slide-Out Admin Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#0B0F17] border-r border-white/10 h-full z-10">
            {renderSidebarNav()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-[#07090E]/90 backdrop-blur-md border-b border-white/8 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] -ml-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/6 flex items-center justify-center cursor-pointer"
              aria-label="Open admin menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-400 flex items-center gap-2 truncate">
              <span className="hidden sm:inline">Admin</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="text-white font-semibold truncate">
                {section === 'matches'
                  ? 'Matches & Streams'
                  : section === 'popup'
                    ? 'Announcement Popup'
                    : section === 'monetag'
                      ? 'Monetag Ads'
                      : 'Device Security'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span>Live: {liveCount}</span>
              <span aria-hidden="true">·</span>
              <span>Upcoming: {upcomingCount}</span>
            </div>
            <button
              type="button"
              onClick={onExit}
              className="min-h-[40px] px-4 rounded-xl bg-white/8 hover:bg-white/12 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              Back to Site
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto space-y-8">
          {/* SECTION 1: MATCHES & STREAMS */}
          {section === 'matches' && (
            <div className="space-y-8">
              {/* Add / Edit Match Form */}
              <section className="bg-[#0F141E] border border-white/8 rounded-2xl p-5 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <div>
                    <h2 className="font-display text-2xl font-bold tracking-wide text-white">
                      {editingMatchId ? 'Edit Match Broadcast' : 'Add New Cricket Match'}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Matches published here appear immediately in Live Now or Upcoming.
                    </p>
                  </div>
                  {editingMatchId && (
                    <button
                      type="button"
                      onClick={resetMatchForm}
                      className="min-h-[40px] px-3.5 rounded-lg bg-white/8 hover:bg-white/12 text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                {matchNotice && (
                  <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{matchNotice}</span>
                  </div>
                )}

                <form onSubmit={handleSaveMatch} className="space-y-5">
                  {/* Status Selector */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-2">
                        Display Section
                      </label>
                      <div className="grid grid-cols-2 gap-2 p-1 bg-[#07090E] border border-white/8 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setStatus('live')}
                          className={`min-h-[42px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            status === 'live'
                              ? 'bg-rose-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Live Now
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus('upcoming')}
                          className={`min-h-[42px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            status === 'upcoming'
                              ? 'bg-slate-200 text-slate-950'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Upcoming
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-2">
                        Scheduled Time (Optional)
                      </label>
                      <input
                        type="text"
                        maxLength={SCHEMA_LIMITS.MATCH_SCHEDULED_TIME_MAX}
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        placeholder="e.g., Today, 7:30 PM IST"
                        className="w-full min-h-[48px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  {/* Add Banner (Upload or URL) */}
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">
                      Add Banner (Upload Image or Paste URL)
                    </label>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                      <div className="lg:col-span-2 space-y-3">
                        <div className="flex flex-col sm:flex-row gap-2.5">
                          <label className="min-h-[46px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 text-slate-100 text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0">
                            <Upload className="w-4 h-4" />
                            <span>{uploadingBanner ? 'Compressing...' : 'Upload Banner'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleBannerFileUpload}
                              className="hidden"
                            />
                          </label>
                          <input
                            type="text"
                            value={bannerUrl.startsWith('data:') ? '' : bannerUrl}
                            onChange={(e) => setBannerUrl(e.target.value)}
                            placeholder="Or paste image URL (https://...)"
                            className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                          />
                        </div>
                        {bannerUrl && (
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>
                              {bannerUrl.startsWith('data:')
                                ? 'Uploaded banner ready (optimized for fast load)'
                                : 'Banner URL attached'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setBannerUrl('')}
                              className="text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              Remove Banner
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="aspect-video rounded-xl overflow-hidden bg-[#07090E] border border-white/10 flex items-center justify-center">
                        {bannerUrl ? (
                          <img
                            src={bannerUrl}
                            alt="Match banner preview"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center p-3 text-slate-500">
                            <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-60" />
                            <p className="text-[11px]">Banner Preview</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Match Title */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Match Title *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={SCHEMA_LIMITS.MATCH_TITLE_MAX}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., India vs Australia — 1st T20I Live"
                      className="w-full min-h-[48px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                    />
                  </div>

                  {/* Match Description */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Match Description
                    </label>
                    <textarea
                      rows={3}
                      maxLength={SCHEMA_LIMITS.MATCH_DESC_MAX}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Series info, stadium, pitch report, or broadcast notes..."
                      className="w-full px-4 py-3 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600 resize-y"
                    />
                  </div>

                  {/* Stream Link + Video Capture */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Match Stream Link (Video Capture Supported)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <div className="relative flex-1">
                        <Link2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          maxLength={SCHEMA_LIMITS.MATCH_STREAM_LINK_MAX}
                          value={streamLink}
                          onChange={(e) => {
                            setStreamLink(e.target.value);
                            setExtractedVideoUrl('');
                            setStreamType('auto');
                          }}
                          placeholder="Paste .m3u8, YouTube, embed iframe, or live match webpage link"
                          className="w-full min-h-[48px] pl-10 pr-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={capturingStream || !streamLink.trim()}
                        onClick={handleTestVideoCapture}
                        className="min-h-[48px] px-4 rounded-xl bg-white/8 hover:bg-white/14 disabled:opacity-50 text-slate-100 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Radio className="w-4 h-4 text-rose-400" />
                        <span>{capturingStream ? 'Capturing...' : 'Capture Video'}</span>
                      </button>
                    </div>
                    {captureFeedback && (
                      <p className="text-xs text-emerald-400">{captureFeedback}</p>
                    )}
                    <p className="text-xs text-slate-500">
                      If the link page has extra text or ads, Video Capture automatically isolates
                      only the HD video stream at 1.0x scale.
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={savingMatch || !title.trim()}
                      className="min-h-[48px] px-6 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" />
                      <span>
                        {savingMatch
                          ? 'Saving...'
                          : editingMatchId
                            ? 'Save Changes'
                            : 'Publish Match'}
                      </span>
                    </button>
                  </div>
                </form>
              </section>

              {/* Published Matches List */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-2xl font-bold tracking-wide text-white">
                    Published Matches ({matches.length})
                  </h3>
                </div>

                {matches.length === 0 ? (
                  <div className="bg-[#0F141E] border border-white/8 rounded-2xl p-10 text-center">
                    <p className="text-sm text-slate-300 font-medium">
                      No matches uploaded yet.
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Add your first Live Now or Upcoming match above — only real uploaded matches
                      are shown to users.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/8 bg-[#0F141E] border border-white/8 rounded-2xl overflow-hidden">
                    {matches.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-white/[0.02] transition-colors"
                      >
                        <img
                          src={item.bannerUrl || ASSET_PATHS.DEFAULT_BANNER}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full sm:w-36 aspect-video rounded-xl object-cover bg-[#07090E] border border-white/8 shrink-0"
                        />

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={
                                item.status === 'live'
                                  ? 'text-rose-400 font-semibold'
                                  : 'text-slate-400 font-medium'
                              }
                            >
                              {item.status === 'live' ? 'Live Now' : 'Upcoming'}
                            </span>
                            {item.scheduledTime && (
                              <>
                                <span className="text-slate-600" aria-hidden="true">·</span>
                                <span className="text-slate-400">{item.scheduledTime}</span>
                              </>
                            )}
                            {item.streamLink && (
                              <>
                                <span className="text-slate-600" aria-hidden="true">·</span>
                                <span className="text-emerald-400 font-mono text-[11px]">
                                  Stream Attached
                                </span>
                              </>
                            )}
                          </div>
                          <h4 className="text-base font-semibold text-white truncate">
                            {item.title}
                          </h4>
                          {item.description && (
                            <p className="text-xs text-slate-400 line-clamp-2">
                              {item.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleMatchStatus(item)}
                            className="min-h-[40px] px-3 rounded-lg bg-white/6 hover:bg-white/12 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {item.status === 'live' ? 'Move to Upcoming' : 'Go Live'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditMatch(item)}
                            className="min-w-[40px] min-h-[40px] rounded-lg bg-white/6 hover:bg-white/12 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                            aria-label={`Edit ${item.title}`}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMatch(item)}
                            className="min-w-[40px] min-h-[40px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
                            aria-label={`Delete ${item.title}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* SECTION 2: ANNOUNCEMENT POPUP MANAGER */}
          {section === 'popup' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-7 bg-[#0F141E] border border-white/8 rounded-2xl p-5 sm:p-7">
                <div className="flex items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-display text-2xl font-bold tracking-wide text-white">
                      Visitor Arrival Popup
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Appears immediately when visitors open your website (Telegram, Instagram,
                      or broadcast updates).
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={popupEnabled}
                    onClick={() => setPopupEnabled((v) => !v)}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      popupEnabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/8 text-slate-300 hover:bg-white/12'
                    }`}
                  >
                    {popupEnabled ? 'Popup Enabled' : 'Popup Disabled'}
                  </button>
                </div>

                {popupNotice && (
                  <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{popupNotice}</span>
                  </div>
                )}

                <form onSubmit={handleSavePopup} className="space-y-5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Popup Headline
                    </label>
                    <input
                      type="text"
                      maxLength={SCHEMA_LIMITS.POPUP_TITLE_MAX}
                      value={popupTitle}
                      onChange={(e) => setPopupTitle(e.target.value)}
                      placeholder="e.g., Join Our Official Telegram Channel"
                      className="w-full min-h-[48px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Full-Detail Message (Description)
                    </label>
                    <textarea
                      rows={7}
                      maxLength={SCHEMA_LIMITS.POPUP_DESC_MAX}
                      value={popupDescription}
                      onChange={(e) => setPopupDescription(e.target.value)}
                      placeholder="Write complete details for your visitors here — live match alerts, toss updates, backup links, and community benefits..."
                      className="w-full px-4 py-3 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600 resize-y leading-relaxed"
                    />
                  </div>

                  <div className="pt-2 border-t border-white/8 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Destination Link (Telegram / Instagram / Channel URL)
                      </label>
                      <input
                        type="text"
                        maxLength={SCHEMA_LIMITS.POPUP_BTN_URL_MAX}
                        value={popupButtonUrl}
                        onChange={(e) => setPopupButtonUrl(e.target.value)}
                        placeholder="https://t.me/yourchannel or https://instagram.com/yourid"
                        className="w-full min-h-[48px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Button Label Text
                      </label>
                      <input
                        type="text"
                        maxLength={SCHEMA_LIMITS.POPUP_BTN_TEXT_MAX}
                        value={popupButtonText}
                        onChange={(e) => setPopupButtonText(e.target.value)}
                        placeholder="e.g., Join Telegram or Join Instagram"
                        className="w-full min-h-[48px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={savingPopup}
                      className="min-h-[48px] px-6 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      {savingPopup ? 'Saving...' : 'Save Popup Settings'}
                    </button>
                  </div>
                </form>
              </section>

              {/* Live Popup Preview */}
              <aside className="lg:col-span-5 bg-[#0F141E] border border-white/8 rounded-2xl p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">Live Visitor Preview</span>
                  <span className={popupEnabled ? 'text-emerald-400' : 'text-slate-500'}>
                    {popupEnabled ? 'Active on Arrival' : 'Currently Hidden'}
                  </span>
                </div>

                <div className="bg-[#07090E] border border-white/10 rounded-xl overflow-hidden">
                  <div className="px-5 pt-5 pb-3 border-b border-white/8">
                    <p className="text-[11px] font-medium text-rose-400 mb-0.5">Official Notice</p>
                    <h4 className="font-display text-xl font-bold text-white">
                      {popupTitle.trim() || 'Your Popup Headline'}
                    </h4>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                      {popupDescription.trim() ||
                        'Your full-detail message will appear here when visitors open the website.'}
                    </p>
                  </div>
                  <div className="px-5 pb-5 pt-3 border-t border-white/8 flex items-center gap-2.5">
                    {popupButtonUrl.trim() && popupButtonText.trim() ? (
                      <a
                        href={normalizeExternalUrl(popupButtonUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-h-[42px] px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                      >
                        <span className="truncate">{popupButtonText.trim()}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    ) : (
                      <div className="flex-1 min-h-[42px] px-4 rounded-lg bg-white/5 text-slate-500 text-xs flex items-center justify-center">
                        Add link & button text
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          )}

          {/* SECTION 3: MONETAG ADS MANAGER */}
          {section === 'monetag' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-7 bg-[#0F141E] border border-white/8 rounded-2xl p-5 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-display text-2xl font-bold tracking-wide text-white">
                      Monetag In-Site Ads
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Paste your Monetag Direct Link and pick how often it opens inside your
                      website (no separate tab or redirect).
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={monetagEnabled}
                    onClick={() => setMonetagEnabled((v) => !v)}
                    className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      monetagEnabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/8 text-slate-300 hover:bg-white/12'
                    }`}
                  >
                    {monetagEnabled ? 'Ads Enabled' : 'Ads Paused'}
                  </button>
                </div>

                {monetagNotice && (
                  <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{monetagNotice}</span>
                  </div>
                )}

                <form onSubmit={handleSaveMonetag} className="space-y-6">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Monetag Direct Link / Ad URL
                    </label>
                    <div className="relative">
                      <Link2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        maxLength={SCHEMA_LIMITS.MONETAG_URL_MAX}
                        value={monetagAdUrl}
                        onChange={(e) => setMonetagAdUrl(e.target.value)}
                        placeholder="https://otieu.com/4/... (paste your Monetag Direct Link)"
                        className="w-full min-h-[48px] pl-10 pr-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">
                      Opens strictly inside an in-website overlay — visitors stay on your site.
                    </p>
                  </div>

                  {/* Interval Selection */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Ad Interval Time (How Often Ads Run)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 5, 10, 15].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setMonetagIntervalMinutes(mins)}
                          className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold font-mono tabular-nums transition-colors cursor-pointer ${
                            monetagIntervalMinutes === mins
                              ? 'bg-rose-600 text-white'
                              : 'bg-[#07090E] border border-white/10 text-slate-300 hover:text-white'
                          }`}
                        >
                          {mins} Min
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <span className="text-xs text-slate-400">Custom interval (minutes):</span>
                      <input
                        type="number"
                        min={SCHEMA_LIMITS.MONETAG_INTERVAL_MIN}
                        max={SCHEMA_LIMITS.MONETAG_INTERVAL_MAX}
                        value={monetagIntervalMinutes}
                        onChange={(e) =>
                          setMonetagIntervalMinutes(
                            Math.max(
                              SCHEMA_LIMITS.MONETAG_INTERVAL_MIN,
                              Math.min(
                                SCHEMA_LIMITS.MONETAG_INTERVAL_MAX,
                                Number(e.target.value) || 1
                              )
                            )
                          )
                        }
                        className="w-24 min-h-[42px] px-3 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm font-mono tabular-nums text-white"
                      />
                    </div>
                  </div>

                  {/* Close Countdown Duration */}
                  <div className="space-y-2.5 pt-2 border-t border-white/8">
                    <label className="block text-xs font-medium text-slate-300">
                      Close Button Unlock Delay (Seconds)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[5, 10, 15, 20].map((secs) => (
                        <button
                          key={secs}
                          type="button"
                          onClick={() => setMonetagDisplaySeconds(secs)}
                          className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold font-mono tabular-nums transition-colors cursor-pointer ${
                            monetagDisplaySeconds === secs
                              ? 'bg-white text-slate-950'
                              : 'bg-[#07090E] border border-white/10 text-slate-300 hover:text-white'
                          }`}
                        >
                          {secs}s
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={!monetagAdUrl.trim()}
                      onClick={() => setPreviewMonetagUrl(monetagAdUrl.trim())}
                      className="min-h-[46px] px-4 rounded-xl bg-white/8 hover:bg-white/12 disabled:opacity-40 text-slate-100 text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Test Ad Inside Site</span>
                    </button>

                    <button
                      type="submit"
                      disabled={savingMonetag}
                      className="min-h-[46px] px-6 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {savingMonetag ? 'Saving...' : 'Save Monetag Settings'}
                    </button>
                  </div>
                </form>
              </section>

              {/* Schedule Summary Card */}
              <aside className="lg:col-span-5 bg-[#0F141E] border border-white/8 rounded-2xl p-5 sm:p-6 space-y-4">
                <h3 className="font-display text-xl font-bold tracking-wide text-white">
                  Active Ad Schedule
                </h3>
                <div className="divide-y divide-white/8 border border-white/8 rounded-xl bg-[#07090E] text-sm">
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-slate-400">Status</span>
                    <span className={monetagEnabled ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                      {monetagEnabled ? 'Running' : 'Paused'}
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-slate-400">Frequency</span>
                    <span className="text-white font-mono tabular-nums">
                      Every {monetagIntervalMinutes} min
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-slate-400">Close Unlock</span>
                    <span className="text-white font-mono tabular-nums">
                      {monetagDisplaySeconds}s
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-slate-400">Display Mode</span>
                    <span className="text-slate-200">In-Website Overlay</span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Scheduled Monetag ads run automatically for visitors on Live Now, Upcoming, and
                  Watch screens — and never interrupt you while working inside the Admin Console.
                </p>
              </aside>

              <MonetagAdOverlay
                config={null}
                forcePreviewUrl={previewMonetagUrl}
                forceDisplaySeconds={monetagDisplaySeconds}
                onCloseForcePreview={() => setPreviewMonetagUrl(null)}
              />
            </div>
          )}

          {/* SECTION 4: DEVICE SECURITY */}
          {section === 'security' && (
            <section className="max-w-2xl bg-[#0F141E] border border-white/8 rounded-2xl p-6 sm:p-7 space-y-6">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-wide text-white">
                  Single-Device Admin Lock
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Admin login is locked strictly to this primary device. Secondary mobiles and
                  browsers are blocked automatically.
                </p>
              </div>

              <div className="divide-y divide-white/8 border border-white/8 rounded-xl bg-[#07090E]">
                <div className="px-4 py-3.5 flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-400">Lock Status</span>
                  <span className="text-emerald-400 font-semibold">Active · Single Device Only</span>
                </div>
                <div className="px-4 py-3.5 flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-400">Authorized Admin</span>
                  <span className="text-white font-medium truncate">
                    {adminSecret?.boundAdminEmail || user.email}
                  </span>
                </div>
                <div className="px-4 py-3.5 flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-400">Bound Device</span>
                  <span className="text-slate-200">
                    {adminSecret?.deviceLabel || 'Current Device'}
                  </span>
                </div>
                {adminSecret?.deviceHash && (
                  <div className="px-4 py-3.5 flex items-center justify-between gap-4 text-sm">
                    <span className="text-slate-400">Device Fingerprint</span>
                    <span className="font-mono text-xs text-slate-300 tabular-nums">
                      {adminSecret.deviceHash.slice(0, 16)}...
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-white/8 space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Only reset the device lock if you are intentionally moving admin access to a new
                  phone. Resetting signs you out immediately so the next verified admin login binds
                  the new device.
                </p>
                {!confirmResetLock ? (
                  <button
                    type="button"
                    onClick={() => setConfirmResetLock(true)}
                    className="min-h-[44px] px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Transfer / Reset Device Lock
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={resettingLock}
                      onClick={handleResetDeviceLock}
                      className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {resettingLock ? 'Resetting...' : 'Confirm Reset & Sign Out'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmResetLock(false)}
                      className="min-h-[44px] px-4 rounded-xl bg-white/8 hover:bg-white/12 text-slate-200 text-xs font-medium cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
