/**
 * In-app update check (build 15): is there a newer build on GitHub
 * Releases, and where do we download it from.
 *
 * SOURCE OF TRUTH. One GitHub Release per build, tag `build-<N>`
 * where N is a monotonically increasing integer. The SAME integer
 * lives in three places and they must all agree: the app.json
 * android.versionCode (N for this build), the release tag, and the
 * in-app displayed build number (read at runtime from
 * expo-application's nativeBuildVersion, which IS the versionCode
 * on Android — never a hardcoded constant in this file). The
 * marketing version stays 1.0.0; only the build number is compared.
 *
 * WHY NOT expo-updates: it delivers OTA JS only, and every build
 * here changes native code (the Kotlin glass module, and now the
 * AppUpdater module), so a full APK is required.
 *
 * CHECK. GET https://api.github.com/repos/HaziqShake/liquid-haz/
 * releases/latest, unauthenticated (60 req/hr per IP — the app
 * checks once per launch plus on manual tap, so this is plenty).
 * Parse tag_name -> N and the app-release.apk asset's
 * browser_download_url + size. Update iff remote N > local N.
 * Any failure (offline, API down, unexpected shape) returns null
 * and the caller fails SILENT — a launch check never shows an
 * error, and a manual check reports "couldn't check" only in the
 * settings row, never as a modal.
 *
 * SHA-256. CI publishes app-release.apk.sha256 alongside the APK.
 * If that asset exists in the release, its content is fetched
 * (browser_download_url, plain text "<sha256>  app-release.apk")
 * and returned so the download can be verified before install.
 * It is optional: a missing/invalid sha means size-only
 * verification (the hard minimum).
 */

import * as Application from 'expo-application';

export const UPDATE_REPO = 'HaziqShake/liquid-haz';
export const UPDATE_APK_ASSET = 'app-release.apk';
export const UPDATE_SHA_ASSET = 'app-release.apk.sha256';
/** Filename of the downloaded APK inside the app-private files
 *  dir (expo-file-system documentDirectory). App-private storage
 *  needs no storage permission on modern Android. */
export const UPDATE_FILE_NAME = 'liquid-haz-update.apk';

export interface ReleaseInfo {
  /** Remote build number N, from the release tag `build-<N>`. */
  buildNumber: number;
  /** Release tag, e.g. "build-15". */
  versionName: string;
  /** Release body (notes), as published. May be empty. */
  notes: string;
  /** Direct download URL of the app-release.apk asset. */
  downloadUrl: string;
  /** Asset size in bytes (0 when the API did not report one). */
  sizeBytes: number;
  /** Lowercase hex SHA-256 from the .sha256 asset, or null when
   *  the release has no usable .sha256 asset. */
  sha256: string | null;
}

/** Local build number: expo-application nativeBuildVersion, which
 *  is the Android versionCode (set from app.json). Null when the
 *  value is missing or not a number (never happens on a real
 *  build, but the check must fail silent rather than crash). */
export function localBuildNumber(): number | null {
  const raw = Application.nativeBuildVersion;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

type ReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
};

/** Fetch the latest release from the GitHub API. Returns null on
 *  ANY failure or unexpected shape — the caller treats null as
 *  "could not check", never as "no update". */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;
    const json: {
      tag_name?: unknown;
      body?: unknown;
      assets?: unknown;
    } = await res.json();
    const tag = typeof json.tag_name === 'string' ? json.tag_name : '';
    const match = /^build-(\d+)$/.exec(tag);
    if (!match) return null;
    const assets: ReleaseAsset[] = Array.isArray(json.assets) ? json.assets : [];
    const apk = assets.find((a) => a.name === UPDATE_APK_ASSET);
    if (!apk || typeof apk.browser_download_url !== 'string') return null;
    const shaAsset = assets.find((a) => a.name === UPDATE_SHA_ASSET);
    let sha256: string | null = null;
    if (shaAsset && typeof shaAsset.browser_download_url === 'string') {
      try {
        const shaRes = await fetch(shaAsset.browser_download_url);
        if (shaRes.ok) {
          const text = await shaRes.text();
          const token = text.trim().split(/\s+/)[0] ?? '';
          if (/^[0-9a-f]{64}$/i.test(token)) sha256 = token.toLowerCase();
        }
      } catch {
        // SHA is optional; a failed fetch just means size-only
        // verification. Never fail the whole check over it.
      }
    }
    return {
      buildNumber: parseInt(match[1], 10),
      versionName: tag,
      notes: typeof json.body === 'string' ? json.body : '',
      downloadUrl: apk.browser_download_url,
      sizeBytes: typeof apk.size === 'number' ? apk.size : 0,
      sha256,
    };
  } catch {
    return null;
  }
}

export type UpdateCheckResult =
  | { status: 'available'; release: ReleaseInfo }
  | { status: 'up-to-date'; localBuild: number }
  /** Check failed (offline / API unreachable / no local build
   *  number). The caller stays silent on launch; the manual check
   *  reports it in the settings row only. */
  | { status: 'unknown' };

/** Compare local vs remote build numbers. Update iff remote N >
 *  local N — numeric comparison, never string comparison
 *  ("build-9" < "build-15" numerically but not lexicographically). */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const local = localBuildNumber();
  const release = await fetchLatestRelease();
  if (local === null || release === null) return { status: 'unknown' };
  if (release.buildNumber > local) return { status: 'available', release };
  return { status: 'up-to-date', localBuild: local };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
