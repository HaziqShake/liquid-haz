/**
 * withReleaseSigning — Expo config plugin (build 15).
 *
 * PROBLEM. The Expo SDK 54 prebuild template signs release builds
 * with the DEBUG keystore (android/app/build.gradle: release
 * buildType -> signingConfigs.debug) and defines NO release
 * signingConfig at all — the React Native community template's
 * MYAPP_UPLOAD_* gradle.properties recipe does not apply here.
 * A debug-signed APK can never update the installed app in place:
 * the in-app update flow REQUIRES the same package AND the same
 * signing key every build, and a signature mismatch fails the
 * install outright. So the release keystore must be wired in at
 * prebuild time, from values CI writes into gradle.properties
 * from GitHub Secrets — never committed to the repo.
 *
 * WHAT IT DOES. Adds signingConfigs.release reading
 * MYAPP_RELEASE_STORE_FILE / MYAPP_RELEASE_STORE_PASSWORD /
 * MYAPP_RELEASE_KEY_ALIAS / MYAPP_RELEASE_KEY_PASSWORD from
 * gradle.properties, and points the release buildType at it.
 * If the properties are absent the build FAILS at configuration
 * time with a plain message — a silently debug-signed release
 * APK would ship an app that can never be updated in place, which
 * is worse than a failed build. (Debug builds are unaffected:
 * they keep signingConfigs.debug.)
 *
 * The anchors are matched against the generated build.gradle and
 * the plugin throws if the template ever changes shape, instead
 * of silently not applying.
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

const DEBUG_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const RELEASE_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            // Release keystore (build 15): CI writes release.keystore
            // into android/app/ and MYAPP_RELEASE_* into
            // gradle.properties from GitHub Secrets. The in-app
            // update flow requires the SAME signing key every build;
            // failing here is deliberate — a debug-signed release APK
            // could never update the installed app in place.
            if (!project.hasProperty('MYAPP_RELEASE_STORE_FILE')) {
                throw new GradleException("Release signing keystore is not configured: set MYAPP_RELEASE_STORE_FILE, MYAPP_RELEASE_STORE_PASSWORD, MYAPP_RELEASE_KEY_ALIAS and MYAPP_RELEASE_KEY_PASSWORD in gradle.properties (CI writes them from GitHub Secrets).")
            }
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }
    }`;

const RELEASE_BUILD_TYPE_OLD = `            signingConfig signingConfigs.debug
            def enableShrinkResources`;
const RELEASE_BUILD_TYPE_NEW = `            signingConfig signingConfigs.release
            def enableShrinkResources`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes('signingConfigs.release')) {
      // Already applied (prebuild re-run without --clean).
      return config;
    }
    if (!contents.includes(DEBUG_BLOCK)) {
      throw new Error(
        'withReleaseSigning: the generated android/app/build.gradle no longer contains the expected debug signingConfigs block — update the plugin anchors.',
      );
    }
    contents = contents.replace(DEBUG_BLOCK, RELEASE_BLOCK);
    if (!contents.includes(RELEASE_BUILD_TYPE_OLD)) {
      throw new Error(
        'withReleaseSigning: the generated android/app/build.gradle no longer contains the expected release buildType block — update the plugin anchors.',
      );
    }
    contents = contents.replace(RELEASE_BUILD_TYPE_OLD, RELEASE_BUILD_TYPE_NEW);
    config.modResults.contents = contents;
    return config;
  });
};
