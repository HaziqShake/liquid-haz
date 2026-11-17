/**
 * In-app update prompt (build 15). A custom modal overlay in the
 * same visual language as SettingsSheet (dark panel, rounded 20,
 * above the navbar) — never a browser tab or a GitHub page.
 *
 * STATES (all in this one modal; the hook owns the transitions):
 * - available: "Update available — Build N", release notes, APK
 *   size, [Download update] / [Later]. The size is shown before
 *   the user confirms because ~37MB on mobile data is a real
 *   choice — the Download button IS the confirmation.
 * - downloading: progress bar with %, [Cancel].
 * - downloaded: [Install] / [Later]. The system installer shows
 *   its own Install screen after this; the user taps Install
 *   there and the app is replaced in place.
 * - needs-permission: the unknown-sources toggle is off — an
 *   in-app explanation, [Open settings] / [Later]. Returning
 *   from settings re-checks the toggle automatically (hook).
 * - error: message + [Retry] / [Later].
 *
 * NOT shown here: "you're up to date" (manual check only, as a
 * line in the settings sheet) and anything on a silent launch
 * check with no update (nothing shows at all).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatBytes, type ReleaseInfo } from './updateCheck';
import type { UpdatePhase } from './useAppUpdate';

interface UpdateModalProps {
  phase: UpdatePhase;
  onDownload: () => void;
  onCancelDownload: () => void;
  onInstall: () => void;
  onOpenInstallSettings: () => void;
  onRetry: () => void;
  onLater: () => void;
}

function ModalButton({
  label,
  primary,
  onPress,
}: {
  label: string;
  primary?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={[styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary]}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : styles.buttonTextSecondary]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function UpdateModal({
  phase,
  onDownload,
  onCancelDownload,
  onInstall,
  onOpenInstallSettings,
  onRetry,
  onLater,
}: UpdateModalProps): React.JSX.Element | null {
  if (phase.kind === 'idle' || phase.kind === 'checking' || phase.kind === 'up-to-date') {
    return null;
  }

  // Every phase that reaches this modal carries a release (the
  // early return above handles idle / checking / up-to-date).
  const release: ReleaseInfo | null = phase.release;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.panel}>
        {phase.kind === 'available' && (
          <>
            <Text style={styles.title}>Update available — Build {phase.release.buildNumber}</Text>
            {phase.release.notes ? (
              <Text style={styles.notes} numberOfLines={6}>
                {phase.release.notes}
              </Text>
            ) : null}
            <Text style={styles.meta}>Size: {formatBytes(phase.release.sizeBytes)}</Text>
            <Text style={styles.meta}>
              Downloads the full APK and installs it from inside the app. No browser, no GitHub page.
            </Text>
            <View style={styles.buttons}>
              <ModalButton label="Download update" primary onPress={onDownload} />
              <ModalButton label="Later" onPress={onLater} />
            </View>
          </>
        )}

        {phase.kind === 'downloading' && (
          <>
            <Text style={styles.title}>Downloading — Build {phase.release.buildNumber}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(phase.progress * 100)}%` }]} />
            </View>
            <Text style={styles.meta}>
              {Math.round(phase.progress * 100)}% of {formatBytes(phase.release.sizeBytes)}
            </Text>
            <View style={styles.buttons}>
              <ModalButton label="Cancel" onPress={onCancelDownload} />
            </View>
          </>
        )}

        {phase.kind === 'downloaded' && (
          <>
            <Text style={styles.title}>Download complete — Build {phase.release.buildNumber}</Text>
            <Text style={styles.meta}>
              The system installer will open next. Tap Install there and the app is replaced in place —
              same app, same data, new build.
            </Text>
            <View style={styles.buttons}>
              <ModalButton label="Install" primary onPress={onInstall} />
              <ModalButton label="Later" onPress={onLater} />
            </View>
          </>
        )}

        {phase.kind === 'needs-permission' && (
          <>
            <Text style={styles.title}>Allow this app to install updates</Text>
            <Text style={styles.meta}>
              Android blocks installs from inside apps until you allow it once for this app. Open
              settings, turn on “Allow from this source”, then come back — the Install button will be
              waiting.
            </Text>
            <View style={styles.buttons}>
              <ModalButton label="Open settings" primary onPress={onOpenInstallSettings} />
              <ModalButton label="Later" onPress={onLater} />
            </View>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <Text style={styles.title}>Update failed</Text>
            <Text style={styles.meta}>{phase.message}</Text>
            {release ? (
              <Text style={styles.meta}>Build {release.buildNumber} is still available.</Text>
            ) : null}
            <View style={styles.buttons}>
              <ModalButton label="Retry" primary onPress={onRetry} />
              <ModalButton label="Later" onPress={onLater} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same placement language as SettingsSheet (absolute panel above
  // the navbar), but a higher zIndex so it sits above the sheet
  // itself when both are open (a manual check from settings can
  // raise it). pointerEvents box-none on the overlay so the dim
  // area does not swallow touches meant for nothing — the panel
  // itself takes touches; there is nothing behind it to reach
  // while an update is pending.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 30,
  },
  panel: {
    left: 16,
    right: 16,
    marginHorizontal: 16,
    marginBottom: 100,
    backgroundColor: 'rgba(20,20,22,0.95)',
    borderRadius: 20,
    padding: 16,
  },
  title: {
    fontFamily: 'Inter-Medium',
    fontSize: 17,
    color: '#FFFFFF',
  },
  notes: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 10,
  },
  meta: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 10,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#FFFFFF',
  },
  buttonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  buttonText: {
    fontFamily: 'Inter-Medium',
    fontSize: 15,
  },
  buttonTextPrimary: {
    color: '#111111',
  },
  buttonTextSecondary: {
    color: 'rgba(255,255,255,0.85)',
  },
});
