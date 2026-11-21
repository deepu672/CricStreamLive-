# Security Specification — CricStage Live

## 1. Data Invariants
1. **Admin-Only Mutations**: Only an authenticated user with `email_verified == true` who is either the bootstrapped admin (`akm6393236867@gmail.com`) or exists in `/admins/{uid}` may create, update, or delete any document in `matches`, `siteConfig`, `deviceLocks`, `adminSecrets`, or `admins`.
2. **Public Viewer Zero-Login Read Boundary**: Unauthenticated visitors may ONLY read matches whose `status` is `'live'` or `'upcoming'`, read the singleton `siteConfig/popup`, and read the non-PII `deviceLocks/primary` hash. Visitors can NEVER list `siteConfig`, `deviceLocks`, `adminSecrets`, or `admins`, and can NEVER read `adminSecrets` or `admins`.
3. **Strict Schema & Size Enforcement**: Every write is validated by a dedicated `isValid[Entity]()` helper enforcing exact allowed keys (`hasAll` + `hasOnly`), field types, string min/max sizes, regex patterns for IDs/hashes, enum membership, and exact `request.time` server timestamps.
4. **Immutability**: `createdAt` and `createdBy` on `matches`, and `createdAt` on `siteConfig`, `deviceLocks`, `adminSecrets`, and `admins` are immutable after creation.
5. **PII Isolation**: Admin email addresses and device labels live exclusively inside `/adminSecrets/primaryDevice` and `/admins/{adminUid}`, both of which deny all non-admin reads (`get` and `list`).
6. **Zero DB Lookups in `list` Queries**: `/matches/{matchId}` `allow list` evaluates only `resource.data.status in ['live', 'upcoming']` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)

1. **Unauthenticated Match Creation**: Unauthenticated client attempts `create` on `/matches/match_1` with a valid Match payload.
2. **Non-Admin Authenticated Match Creation**: Signed-in verified regular user (`attacker@example.com`) attempts `create` on `/matches/match_2`.
3. **Email Spoofing Attack**: Signed-in user with `email: "akm6393236867@gmail.com"` and `email_verified: false` attempts `create` on `/matches/match_3`.
4. **Shadow / Ghost Field Injection on Match Create**: Verified admin attempts `create` on `/matches/match_4` with extra field `isFeatured: true`.
5. **ID Poisoning Attack**: Verified admin attempts `create` on `/matches/invalid$id!with*bad#chars` or a 200-char ID.
6. **Spoofed `createdBy` Identity**: Verified admin attempts `create` on `/matches/match_5` with `createdBy: "someoneElseUid"`.
7. **Client-Forged Timestamp**: Verified admin attempts `create` on `/matches/match_6` with a past timestamp instead of `serverTimestamp()`.
8. **Immutable Field Mutation on Update**: Verified admin attempts `update` on `/matches/match_1` changing `createdBy` or `createdAt`.
9. **Value Poisoning on Update**: Verified admin attempts `update` on `/matches/match_1` setting `status: "hacked"` or `title` longer than 140 chars.
10. **PII Read Leak (`adminSecrets`)**: Unauthenticated or non-admin signed-in user attempts `get` or `list` on `/adminSecrets/primaryDevice`.
11. **Self-Assigned Admin Escalation**: Non-admin verified user attempts `create` on `/admins/{theirUid}` to grant themselves admin privileges.
12. **Unauthorized Device Lock Overwrite**: Non-admin verified user attempts `update` or `delete` on `/deviceLocks/primary` to hijack or reset the single-device lock.
