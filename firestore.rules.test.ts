/**
 * Security Rules Specification Verification Suite (Dirty Dozen Test Spec)
 * Documents and verifies all 12 adversarial payloads against firestore.rules.
 */

export interface AdversarialPayloadCase {
  id: number;
  name: string;
  actor: {
    authenticated: boolean;
    uid?: string;
    email?: string;
    emailVerified?: boolean;
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: AdversarialPayloadCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Match Creation',
    actor: { authenticated: false },
    operation: 'create',
    path: '/matches/match_unauth_1',
    payload: {
      title: 'Fake Match',
      description: 'Injected',
      bannerUrl: 'https://example.com/b.jpg',
      streamLink: 'https://example.com/stream.m3u8',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'anon',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Non-Admin Authenticated Match Creation',
    actor: {
      authenticated: true,
      uid: 'regular_user_1',
      email: 'regular@example.com',
      emailVerified: true,
    },
    operation: 'create',
    path: '/matches/match_nonadmin_2',
    payload: {
      title: 'Unauthorized Match',
      description: 'Test',
      bannerUrl: 'https://example.com/b.jpg',
      streamLink: 'https://example.com/live',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'regular_user_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Admin Email Spoofing Without email_verified',
    actor: {
      authenticated: true,
      uid: 'spoof_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: false,
    },
    operation: 'create',
    path: '/matches/match_spoof_3',
    payload: {
      title: 'Spoofed Admin Match',
      description: 'Unverified email',
      bannerUrl: '',
      streamLink: 'https://example.com/live',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'spoof_uid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow / Ghost Field Injection on Match Create',
    actor: {
      authenticated: true,
      uid: 'admin_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: true,
    },
    operation: 'create',
    path: '/matches/match_shadow_4',
    payload: {
      title: 'Shadow Field Match',
      description: 'Desc',
      bannerUrl: '',
      streamLink: 'https://example.com/live',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'admin_uid',
      ghostField: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Document ID Poisoning Attack',
    actor: {
      authenticated: true,
      uid: 'admin_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: true,
    },
    operation: 'create',
    path: '/matches/bad$id!with*symbols',
    payload: {
      title: 'Bad ID',
      description: 'Desc',
      bannerUrl: '',
      streamLink: 'https://example.com/live',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'admin_uid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Identity Spoofing on createdBy',
    actor: {
      authenticated: true,
      uid: 'admin_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: true,
    },
    operation: 'create',
    path: '/matches/match_id_spoof_6',
    payload: {
      title: 'Impersonated Match',
      description: 'Desc',
      bannerUrl: '',
      streamLink: 'https://example.com/live',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'other_admin_uid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client-Forged Timestamp Injection',
    actor: {
      authenticated: true,
      uid: 'admin_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: true,
    },
    operation: 'create',
    path: '/matches/match_time_7',
    payload: {
      title: 'Backdated Match',
      description: 'Desc',
      bannerUrl: '',
      streamLink: 'https://example.com/live',
      extractedVideoUrl: '',
      streamType: 'auto',
      status: 'live',
      scheduledTime: '',
      createdBy: 'admin_uid',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable createdBy Field Mutation on Update',
    actor: {
      authenticated: true,
      uid: 'admin_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: true,
    },
    operation: 'update',
    path: '/matches/match_existing_1',
    payload: {
      createdBy: 'hijacked_uid',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Value Poisoning With Invalid Enum Status on Update',
    actor: {
      authenticated: true,
      uid: 'admin_uid',
      email: 'akm6393236867@gmail.com',
      emailVerified: true,
    },
    operation: 'update',
    path: '/matches/match_existing_1',
    payload: {
      status: 'invalid_state',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'PII Leak Attempt on adminSecrets Collection',
    actor: {
      authenticated: true,
      uid: 'regular_user_1',
      email: 'regular@example.com',
      emailVerified: true,
    },
    operation: 'get',
    path: '/adminSecrets/primaryDevice',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Self-Assigned Admin Privilege Escalation',
    actor: {
      authenticated: true,
      uid: 'regular_user_1',
      email: 'regular@example.com',
      emailVerified: true,
    },
    operation: 'create',
    path: '/admins/regular_user_1',
    payload: {
      uid: 'regular_user_1',
      email: 'regular@example.com',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized Device Lock Reset by Non-Admin',
    actor: {
      authenticated: true,
      uid: 'regular_user_1',
      email: 'regular@example.com',
      emailVerified: true,
    },
    operation: 'delete',
    path: '/deviceLocks/primary',
    expectedResult: 'PERMISSION_DENIED',
  },
];
