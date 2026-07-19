# Dictello 0.1.0 beta 1

First friend beta for Apple Silicon Macs running macOS 26 or newer.

## Included

- local Russian, English, and automatic-language dictation;
- double-`fn` on-device voice translation;
- translation language selection in the menu-bar menu;
- automatic insertion into the active application;
- bundled Whisper Large v3 Turbo model and arm64 `whisper.cpp` runtime;
- local personal dictionary and optional transcript history;
- first-run permission setup;
- light and dark native macOS interface.

No separate model, Homebrew package, compiler, or command-line setup is needed.

## Installation note

This build uses an ad-hoc signature and is not notarized by Apple. After moving
Dictello to Applications, macOS may require one explicit approval through:

System Settings → Privacy & Security → Open Anyway.

Then grant Dictello access to Microphone and Accessibility.

## Known beta limitations

- Apple Silicon and macOS 26+ only.
- The archive is approximately 1.4 GB because the local speech model is bundled.
- The first use of a new translation language pair may ask macOS to prepare an
  Apple Translation language pack.
- There is no automatic updater yet.
- Accessibility insertion can differ between applications; report the affected
  application if text is copied but not inserted.

## Verification

- SHA-256:
  `d02d2698d8be1786a18b02b1dfd33bad7a94ca835b8d0ee37d93ddacd013dbf7`
- Automated tests: 39 passed.
- The release ZIP was unpacked into a clean temporary directory and its complete
  code signature was verified.
- Bundled runtime smoke tests passed for Russian speech recognition and
  Russian-to-English local translation.
