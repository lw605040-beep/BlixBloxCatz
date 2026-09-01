# BlixBloxCatz Android build

This project wraps the working BlixBloxCatz HTML game in a native Android app and places a Google Mobile Ads anchored adaptive banner at the bottom.

Debug builds use Google's official test banner ID. Release builds use the user's AdMob banner ID.

Build locally with Gradle or use the included GitHub Actions workflow. The workflow creates a debug APK using test ads.

For a public release, create a release signing key and configure it as GitHub Actions secrets before switching to a signed release build. Do not publish a debug APK with live ads.
