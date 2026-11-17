// TypeScript wrapper for the AppUpdater native module (build 15).
// Android only: on any other platform these calls throw (the native
// module does not exist there) — guard usage with Platform.OS ===
// 'android'. The demo is Android-only, so no fallback is provided.

import { requireNativeModule } from 'expo-modules-core';

type AppUpdaterModuleType = {
  /** True when the system lets this app fire the installer intent
   *  directly (Android 8+: the "install unknown apps" toggle for
   *  this package is on). */
  canInstall: () => boolean;
  /** Opens the system "install unknown apps" page for this
   *  package. */
  openUnknownSourcesSettings: () => void;
  /** Fires the system package installer for the APK at `path`
   *  (plain filesystem path). Returns immediately; the installer
   *  shows its own Install screen. */
  installApk: (path: string) => void;
  /** SHA-256 hex of the file at `path`, streamed, never held in
   *  memory as a string. */
  sha256File: (path: string) => Promise<string>;
};

const AppUpdater = requireNativeModule<AppUpdaterModuleType>('AppUpdater');

export async function canInstall(): Promise<boolean> {
  return AppUpdater.canInstall();
}

export async function openUnknownSourcesSettings(): Promise<void> {
  AppUpdater.openUnknownSourcesSettings();
}

export async function installApk(path: string): Promise<void> {
  AppUpdater.installApk(path);
}

export async function sha256File(path: string): Promise<string> {
  return AppUpdater.sha256File(path);
}
