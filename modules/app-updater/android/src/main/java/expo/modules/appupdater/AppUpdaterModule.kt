// SPDX-License-Identifier: MIT
//
// AppUpdater: the native half of the in-app update flow (build 15).
// A tiny Expo module, Android only, deliberately separate from the
// liquid-glass-refraction module so the portable glass unit stays
// dependency-free.
//
// Why a native module at all: installing an APK needs (1) the
// REQUEST_INSTALL_PACKAGES permission (manifest, via app.json),
// (2) a FileProvider content:// URI — a file:// URI throws
// FileUriExposedException on Android 7+ — and (3) the package
// installer intent. expo-intent-launcher can open the
// unknown-sources settings page but cannot build the FileProvider
// URI, so the honest path is this small module. It does NOT
// download anything (expo-file-system does that) and it does NOT
// decide whether an update exists (src/updates/updateCheck.ts
// does that against the GitHub Releases API).
//
// HARD REQUIREMENT, stated plainly: the install only succeeds if
// the new APK has the SAME package (com.liquidglass.navbar) and
// the SAME signing key as the installed build. A signature
// mismatch fails the install outright. The release keystore lives
// in GitHub Secrets and CI signs every release build with it (see
// .github/workflows/android-apk.yml); a debug-signed or
// differently-signed APK can never update the installed app.

package expo.modules.appupdater

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class AppUpdaterModule : Module() {
  // The Android Context (the ReactApplicationContext). Expo's
  // AppContext is NOT a Context: build 15 attempt 1 failed to
  // compile with every appContext.packageManager / .packageName /
  // .startActivity as an unresolved reference, and FileProvider
  // rejected the AppContext argument outright. Use this.
  private val context: Context
    get() = appContext.reactContext
      ?: throw IllegalStateException("React context not available")

  override fun definition() = ModuleDefinition {
    Name("AppUpdater")

    // True when the system will let this app fire the installer
    // intent directly. False on first run (Android 8+): the user
    // must allow "install unknown apps" for this package once.
    // Cheap binder call; a sync Function is fine.
    Function("canInstall") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
    }

    // Opens Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES for this
    // package — the system page with the "Allow from this source"
    // toggle. The TS side shows its own explanation first, then
    // calls this; when the app returns to the foreground it
    // re-checks canInstall() and retries.
    Function("openUnknownSourcesSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    // Fires the system package installer for the APK at `path`
    // (a plain filesystem path, e.g. the expo-file-system
    // documentDirectory file). The APK is shared as a
    // content://<package>.appupdater.fileprovider/... URI with
    // FLAG_GRANT_READ_URI_PERMISSION, MIME
    // application/vnd.android.package-archive, action ACTION_VIEW.
    // The system installer shows its own Install screen; the user
    // taps Install and the app is replaced in place. Returns
    // immediately — installation itself is asynchronous and the
    // app process is replaced, so there is no result to await.
    Function("installApk") { path: String ->
      val file = File(path)
      val uri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.appupdater.fileprovider",
        file,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      // Fail loudly (not silently) if nothing can handle it: a
      // missing FileProvider entry or a bad path must surface as
      // an error in the update modal, not a dead Install button.
      if (intent.resolveActivity(context.packageManager) == null) {
        throw IllegalStateException("No activity can install this APK")
      }
      context.startActivity(intent)
    }

    // SHA-256 of the file at `path`, streamed in 8KB chunks so a
    // ~37MB APK never sits in memory as a string. Async: hashing
    // takes ~100-300ms and must not block the JS thread. Used to
    // verify the download against the .sha256 asset published
    // alongside the APK in the GitHub Release (when present).
    AsyncFunction("sha256File") { path: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(File(path)).use { input ->
        val buffer = ByteArray(8192)
        var read: Int
        while (input.read(buffer).also { read = it } != -1) {
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
