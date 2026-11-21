import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowLeft, Lock, Mail, ShieldAlert, ShieldCheck } from 'lucide-react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import { BOOTSTRAPPED_ADMIN_EMAIL, type DeviceLockDoc } from '../types';
import { getDeviceLabel, getLocalDeviceHash } from '../utils/deviceLock';

interface AdminAuthGateProps {
  deviceLock: DeviceLockDoc | null;
  localDeviceHash: string;
  onAuthorized: (user: User) => void;
  onCancel: () => void;
}

export function AdminAuthGate({
  deviceLock,
  localDeviceHash,
  onAuthorized,
  onCancel,
}: AdminAuthGateProps) {
  const [authTab, setAuthTab] = useState<'google' | 'email'>('google');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const isLockedToAnotherDevice = Boolean(
    deviceLock?.isLocked &&
      deviceLock.deviceHash &&
      localDeviceHash &&
      deviceLock.deviceHash !== localDeviceHash
  );

  // Strict Single-Device Lock: immediately block any secondary phone or browser
  if (isLockedToAnotherDevice) {
    return (
      <div className="min-h-screen bg-[#07090E] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#0F141E] border border-white/10 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-rose-600/15 text-rose-500 flex items-center justify-center mx-auto mb-5">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-white mb-2">
            Access Restricted
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            The Admin Panel is permanently locked to the primary authorized device. Login and
            admin access are disabled on all other phones and browsers.
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-white/8 hover:bg-white/12 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Live Matches
          </button>
        </div>
      </div>
    );
  }

  const verifyAndBindAdminDevice = async (user: User) => {
    // Reload to get latest emailVerified state
    await user.reload();

    if (!user.email || !user.emailVerified) {
      try {
        await sendEmailVerification(user);
      } catch {
        // ignore rate-limit error
      }
      await signOut(auth);
      setInfoMsg(
        'A verification email has been sent to your address. Please verify your email and sign in again — or use Google Sign-In for instant verified access.'
      );
      return;
    }

    // Check admin authorization (bootstrapped owner email or /admins/{uid} doc)
    const isBootstrapped =
      user.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    let isRegisteredAdmin = isBootstrapped;
    if (!isRegisteredAdmin) {
      const adminDocPath = `admins/${user.uid}`;
      try {
        const snap = await getDoc(doc(db, 'admins', user.uid));
        isRegisteredAdmin = snap.exists();
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, adminDocPath);
      }
    }

    if (!isRegisteredAdmin) {
      await signOut(auth);
      setErrorMsg(
        `This account (${user.email}) is not authorized as an administrator.`
      );
      return;
    }

    // Re-check latest device lock directly from Firestore before granting access
    const currentHash = await getLocalDeviceHash();
    let latestLock: DeviceLockDoc | null = null;
    try {
      const lockSnap = await getDoc(doc(db, 'deviceLocks', 'primary'));
      if (lockSnap.exists()) {
        latestLock = lockSnap.data() as DeviceLockDoc;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'deviceLocks/primary');
    }

    if (latestLock?.isLocked && latestLock.deviceHash !== currentHash) {
      await signOut(auth);
      setErrorMsg(
        'Admin access is already locked to the primary device and cannot be opened on another device.'
      );
      return;
    }

    // Ensure /admins/{uid} record exists
    try {
      const adminRef = doc(db, 'admins', user.uid);
      const existingAdmin = await getDoc(adminRef);
      if (!existingAdmin.exists()) {
        await setDoc(adminRef, {
          uid: user.uid,
          email: user.email.slice(0, 254),
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `admins/${user.uid}`);
    }

    // Bind THIS device permanently if not locked yet
    if (!latestLock || !latestLock.isLocked) {
      const deviceLabel = getDeviceLabel();
      try {
        await setDoc(doc(db, 'deviceLocks', 'primary'), {
          isLocked: true,
          deviceHash: currentHash,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'deviceLocks/primary');
      }

      try {
        await setDoc(doc(db, 'adminSecrets', 'primaryDevice'), {
          boundAdminUid: user.uid,
          boundAdminEmail: user.email.slice(0, 254),
          deviceLabel,
          deviceHash: currentHash,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'adminSecrets/primaryDevice');
      }
    }

    onAuthorized(user);
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await verifyAndBindAdminDevice(result.user);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in window was closed. Please try again.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const cleanEmail = email.trim();
      const credential = isRegisterMode
        ? await createUserWithEmailAndPassword(auth, cleanEmail, password)
        : await signInWithEmailAndPassword(auth, cleanEmail, password);
      await verifyAndBindAdminDevice(credential.user);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          'Email/Password sign-in is not yet enabled in Firebase Console (Authentication → Sign-in method → Email/Password). You can use Google Sign-In immediately or enable Email/Password in Firebase Console.'
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setErrorMsg('Invalid email or password. Please verify your credentials.');
      } else if (code === 'auth/weak-password') {
        setErrorMsg('Password must be at least 6 characters.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Email authentication failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full bg-[#0F141E] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="px-6 pt-6 pb-5 border-b border-white/8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600/15 text-rose-500 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-wide text-white leading-none">
                Admin Access
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {deviceLock?.isLocked
                  ? 'Primary Authorized Device Verified'
                  : 'First-Time Setup · Binds to This Device'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="min-w-[40px] min-h-[40px] rounded-lg bg-white/6 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Back to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Auth Mode Switcher */}
        <div className="px-6 pt-5">
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#07090E] rounded-xl border border-white/8">
            <button
              type="button"
              onClick={() => {
                setAuthTab('google');
                setErrorMsg(null);
              }}
              className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                authTab === 'google'
                  ? 'bg-[#171E2E] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Google Sign-In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('email');
                setErrorMsg(null);
              }}
              className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                authTab === 'email'
                  ? 'bg-[#171E2E] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Email & Password
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 leading-relaxed">
              {infoMsg}
            </div>
          )}

          {authTab === 'google' ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300 leading-relaxed">
                Sign in with your authorized Google admin account. Once logged in, admin access
                will automatically lock exclusively to this device.
              </p>
              <button
                type="button"
                disabled={submitting}
                onClick={handleGoogleSignIn}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-950 text-sm font-semibold flex items-center justify-center gap-3 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
                {submitting ? 'Verifying Admin...' : 'Continue with Google'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Admin Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full min-h-[46px] px-4 rounded-xl bg-[#07090E] border border-white/10 focus:border-rose-500 focus:outline-none text-sm text-white placeholder:text-slate-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {submitting
                  ? 'Authenticating...'
                  : isRegisterMode
                    ? 'Create Admin Password Account'
                    : 'Sign In to Admin Panel'}
              </button>

              <button
                type="button"
                onClick={() => setIsRegisterMode((v) => !v)}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                {isRegisterMode
                  ? 'Already have an admin password? Sign in'
                  : 'First-time email setup? Create account'}
              </button>
            </form>
          )}

          <div className="pt-3 border-t border-white/8 flex items-start gap-2.5 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              Single-Device Protection: After first verified login, only this device can open or
              manage the Admin Panel.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
