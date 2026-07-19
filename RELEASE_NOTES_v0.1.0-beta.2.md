# Dictello 0.1.0 beta 2

Friend beta for Apple Silicon Macs running macOS 26 or newer.

## What changed

- new Dictello product logo and macOS application icon;
- guided DMG installer that copies Dictello to Applications, removes quarantine,
  and launches the app;
- first-launch responsiveness fix for global hotkey initialization;
- improved translation dictation indicator and processing states.

## Included

- local Russian, English, and automatic-language dictation;
- double-`fn` on-device voice translation;
- translation language selection in the menu-bar menu;
- automatic insertion into the active application;
- bundled Whisper Large v3 Turbo model and arm64 `whisper.cpp` runtime;
- local personal dictionary and optional transcript history;
- first-run permission setup;
- light and dark native macOS interface.

No separate model, Homebrew package, compiler, Terminal setup, or manual model
download is needed.

## Installation

1. Open the downloaded DMG.
2. Right-click `Установить Dictello.command`.
3. Choose Open and confirm.
4. Grant Dictello Microphone and Accessibility access.

This build uses an ad-hoc signature and is not notarized by Apple. Until a
Developer ID certificate is added, macOS requires one explicit confirmation for
the installer.

## Known beta limitations

- Apple Silicon and macOS 26+ only.
- The DMG is approximately 1.4 GB because the local speech model is bundled.
- The first use of a new translation language pair may ask macOS to prepare an
  Apple Translation language pack.
- There is no automatic updater yet.

## Verification

- SHA-256:
  `f0efa514d038667166499c346509a084d3e7dbd27bd1c550dd683bf022d2d867`
- Automated tests: 40 passed.
- The DMG was mounted and the guided installer completed into a clean temporary
  directory.
- The installed app's complete code signature and bundled arm64 executable were
  verified.
