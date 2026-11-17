/**
 * In-app update state machine (build 15). One hook, owned by
 * DemoScreen, driving the UpdateModal and the settings row.
 *
 * PHASES. idle -> checking (manual only) -> available ->
 * downloading -> downloaded -> install (system installer) — plus
 * needs-permission (unknown-sources toggle off) and error, both
 * with Retry / Later. up-to-date is NOT a modal: only the manual
 * check reports it, as a line in the settings sheet. On launch
 * the check is SILENT: checkSilent() shows the modal only when an
 * update is actually available, and does nothing at all otherwise
 * (no modal, no toast, no badge).
 *
 * DOWNLOAD. expo-file-system LEGACY createDownloadResumable (the
 * `expo-file-system/legacy` subpath): the new File API in v19 has
 * no progress callback and no cancel for downloads, and this flow
 * needs both (progress bar + [Cancel]). The resumable writes to
 * the app-private files dir; partial files are deleted on cancel
 * or failure. A download that already finished and verified is
 * reused instead of re-downloading (the file stays on disk until
 * the update is installed or the user picks Later after an
 * error — dismissing the modal after a successful download keeps
 * the file, so a later manual check jumps straight to Install).
 *
 * VERIFY BEFORE INSTALL. Downloaded bytes must equal the release
 * asset size at minimum (getInfoAsync). When the release carries
 * a .sha256 asset, the file's SHA-256 is also checked via the
 * native AppUpdater.sha256File (streamed, never held in memory).
 * Either mismatch deletes the file and lands in the error phase.
 *
 * INSTALL. install() checks canInstall() first: if the
 * unknown-sources toggle is off, the phase becomes
 * needs-permission with an in-app explanation; [Open settings]
 * fires the system page, and an AppState listener re-checks
 * canInstall() when the app returns to the foreground and
 * advances back to downloaded (Install) if it is now allowed.
 * If allowed, installApk() fires the system installer intent —
 * the system shows its own Install screen, the user taps Install,
 * and the app is replaced in place. The hook cannot observe the
 * install result (the process is replaced); a successful install
 * is proven on next launch by the new build number.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { canInstall, installApk, openUnknownSourcesSettings, sha256File } from 'app-updater';
import {
  UPDATE_FILE_NAME,
  checkForUpdate,
  localBuildNumber,
  type ReleaseInfo,
} from './updateCheck';

export type UpdatePhase =
  | { kind: 'idle' }
  /** Manual check in flight (settings row shows "Checking…"). */
  | { kind: 'checking' }
  | { kind: 'available'; release: ReleaseInfo }
  | { kind: 'downloading'; release: ReleaseInfo; progress: number }
  | { kind: 'downloaded'; release: ReleaseInfo; fileUri: string }
  /** Unknown-sources toggle off: explain, open settings, retry. */
  | { kind: 'needs-permission'; release: ReleaseInfo; fileUri: string }
  | { kind: 'error'; message: string; release: ReleaseInfo | null }
  /** Manual check only: reported in the settings row, never a modal. */
  | { kind: 'up-to-date'; localBuild: number };

function updateFileUri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? dir + UPDATE_FILE_NAME : null;
}

async function deleteUpdateFile(): Promise<void> {
  const uri = updateFileUri();
  if (!uri) return;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort: a stale partial file is harmless (the next
    // download replaces it), never fail the flow over cleanup.
  }
}

/** Verify a downloaded file against the release: size must match
 *  exactly when the API reported one; SHA-256 must match when the
 *  release carries one. Returns an error string, or null when the
 *  file verifies. */
async function verifyDownloadedFile(
  fileUri: string,
  release: ReleaseInfo,
): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return 'Downloaded file is missing.';
    if (release.sizeBytes > 0 && info.size !== release.sizeBytes) {
      return `Downloaded size (${info.size} bytes) does not match the release (${release.sizeBytes} bytes).`;
    }
    if (release.sha256) {
      const actual = await sha256File(fileUri);
      if (actual.toLowerCase() !== release.sha256) {
        return 'Downloaded file failed its SHA-256 check.';
      }
    }
    return null;
  } catch (e) {
    return `Could not verify the download (${e instanceof Error ? e.message : 'unknown error'}).`;
  }
}

export function useAppUpdate(): {
  phase: UpdatePhase;
  localBuild: number | null;
  checkSilent: () => Promise<void>;
  checkManual: () => Promise<void>;
  download: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  install: () => Promise<void>;
  openInstallSettings: () => Promise<void>;
  dismiss: () => void;
  retry: () => void;
} {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: 'idle' });
  const [localBuild] = useState<number | null>(() => localBuildNumber());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const downloadTaskRef = useRef<ReturnType<
    typeof FileSystem.createDownloadResumable
  > | null>(null);
  // Set by cancelDownload() before it cancels the resumable: the
  // download promise rejects on cancel, and the catch below must
  // tell a cancel apart from a real failure (cancel returns to
  // available, a failure goes to error). Without the flag the two
  // paths race and a cancel can flash the error phase.
  const cancelledRef = useRef(false);
  const checkInFlightRef = useRef(false);

  // When the app returns from the unknown-sources settings page,
  // re-check the toggle: if it is on now, advance straight back
  // to the downloaded phase (Install button) without making the
  // user tap anything else.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      const current = phaseRef.current;
      if (current.kind !== 'needs-permission') return;
      void canInstall().then((allowed) => {
        if (allowed && phaseRef.current.kind === 'needs-permission') {
          setPhase({
            kind: 'downloaded',
            release: current.release,
            fileUri: current.fileUri,
          });
        }
      });
    });
    return () => sub.remove();
  }, []);

  const checkSilent = useCallback(async (): Promise<void> => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    try {
      const result = await checkForUpdate();
      // Silent means silent: only an available update surfaces
      // anything (the modal). Up-to-date and unknown do nothing.
      if (result.status === 'available') {
        setPhase({ kind: 'available', release: result.release });
      }
    } finally {
      checkInFlightRef.current = false;
    }
  }, []);

  const checkManual = useCallback(async (): Promise<void> => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    setPhase({ kind: 'checking' });
    try {
      const result = await checkForUpdate();
      if (result.status === 'available') {
        setPhase({ kind: 'available', release: result.release });
      } else if (result.status === 'up-to-date') {
        setPhase({ kind: 'up-to-date', localBuild: result.localBuild });
      } else {
        setPhase({
          kind: 'error',
          message: "Couldn't reach GitHub to check for updates. Check your connection and try again.",
          release: null,
        });
      }
    } finally {
      checkInFlightRef.current = false;
    }
  }, []);

  const download = useCallback(async (): Promise<void> => {
    const current = phaseRef.current;
    if (current.kind !== 'available' && current.kind !== 'error') return;
    const release = current.release;
    if (!release) return;
    const fileUri = updateFileUri();
    if (!fileUri) {
      setPhase({ kind: 'error', message: 'App storage is unavailable.', release });
      return;
    }
    // Reuse a previous verified download instead of downloading
    // the same ~37MB again (e.g. the modal was dismissed after a
    // successful download and the user checked again).
    try {
      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) {
        const problem = await verifyDownloadedFile(fileUri, release);
        if (!problem) {
          setPhase({ kind: 'downloaded', release, fileUri });
          return;
        }
        await deleteUpdateFile();
      }
    } catch {
      // Fall through to a fresh download.
    }
    setPhase({ kind: 'downloading', release, progress: 0 });
    cancelledRef.current = false;
    try {
      const task = FileSystem.createDownloadResumable(
        release.downloadUrl,
        fileUri,
        {},
        (progress) => {
          const expected = progress.totalBytesExpectedToWrite;
          const ratio =
            expected > 0 ? progress.totalBytesWritten / expected : 0;
          setPhase((prev) =>
            prev.kind === 'downloading' ? { ...prev, progress: ratio } : prev,
          );
        },
      );
      downloadTaskRef.current = task;
      const result = await task.downloadAsync();
      downloadTaskRef.current = null;
      if (!result || !result.uri) throw new Error('Download did not produce a file.');
      const problem = await verifyDownloadedFile(result.uri, release);
      if (problem) {
        await deleteUpdateFile();
        setPhase({ kind: 'error', message: problem, release });
        return;
      }
      setPhase({ kind: 'downloaded', release, fileUri: result.uri });
    } catch (e) {
      downloadTaskRef.current = null;
      if (cancelledRef.current) {
        // User-cancelled: back to available with the partial file
        // deleted. (cancelDownload also sets available; doing it
        // here too keeps the state right even if its setPhase
        // lands first.)
        cancelledRef.current = false;
        await deleteUpdateFile();
        setPhase({ kind: 'available', release });
        return;
      }
      await deleteUpdateFile();
      setPhase({
        kind: 'error',
        message: `Download failed (${e instanceof Error ? e.message : 'unknown error'}).`,
        release,
      });
    }
  }, []);

  const cancelDownload = useCallback(async (): Promise<void> => {
    const task = downloadTaskRef.current;
    downloadTaskRef.current = null;
    cancelledRef.current = true;
    if (task) {
      try {
        await task.cancelAsync();
      } catch {
        // Cancel failing just means the download already ended;
        // the partial file is deleted below either way.
      }
    }
    const current = phaseRef.current;
    await deleteUpdateFile();
    if (current.kind === 'downloading' && current.release) {
      setPhase({ kind: 'available', release: current.release });
    } else if (current.kind === 'error') {
      // Cancelling out of an error returns to the release it was
      // about (or idle when the error had no release, e.g. the
      // manual check itself failed to reach GitHub).
      if (current.release) {
        setPhase({ kind: 'available', release: current.release });
      } else {
        setPhase({ kind: 'idle' });
      }
    }
  }, []);

  const install = useCallback(async (): Promise<void> => {
    const current = phaseRef.current;
    if (current.kind !== 'downloaded' && current.kind !== 'needs-permission') return;
    const { release, fileUri } = current;
    let allowed: boolean;
    try {
      allowed = await canInstall();
    } catch {
      allowed = false;
    }
    if (!allowed) {
      setPhase({ kind: 'needs-permission', release, fileUri });
      return;
    }
    try {
      await installApk(fileUri);
      // No result to await: the system installer takes over and
      // the process is replaced on success. The phase stays
      // downloaded underneath it; a failed/cancelled install just
      // returns the user to the app with the modal still there.
    } catch (e) {
      setPhase({
        kind: 'error',
        message: `Couldn't start the installer (${e instanceof Error ? e.message : 'unknown error'}).`,
        release,
      });
    }
  }, []);

  const openInstallSettings = useCallback(async (): Promise<void> => {
    try {
      await openUnknownSourcesSettings();
    } catch (e) {
      setPhase((prev) => ({
        kind: 'error',
        message: `Couldn't open the install-permission page (${e instanceof Error ? e.message : 'unknown error'}).`,
        release: prev.kind === 'needs-permission' ? prev.release : null,
      }));
    }
  }, []);

  const dismiss = useCallback((): void => {
    setPhase({ kind: 'idle' });
  }, []);

  const retry = useCallback((): void => {
    const current = phaseRef.current;
    if (current.kind !== 'error') return;
    if (current.release) {
      setPhase({ kind: 'available', release: current.release });
    } else {
      setPhase({ kind: 'idle' });
      void checkManual();
    }
  }, [checkManual]);

  return {
    phase,
    localBuild,
    checkSilent,
    checkManual,
    download,
    cancelDownload,
    install,
    openInstallSettings,
    dismiss,
    retry,
  };
}
