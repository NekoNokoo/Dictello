# Dictello

Dictello is a local-first dictation and voice translation app for Apple Silicon
Macs. Press `fn` once to dictate into the active application, or press `fn`
twice to dictate with on-device translation.

## Requirements

- Apple Silicon Mac
- macOS 26 or newer
- About 1.5 GB of free disk space

The beta includes its Whisper model and speech-recognition runtime. Homebrew,
CMake, Python, Terminal setup, and manual model downloads are not required.

## Install the beta

1. Download the ZIP and matching `.sha256` file from
   [Releases](https://github.com/NekoNokoo/Dictello/releases).
2. Unzip it and move `Dictello.app` to Applications.
3. Open Dictello once.
4. This beta is not signed with an Apple Developer certificate. If macOS blocks
   it, open System Settings → Privacy & Security → Open Anyway.
5. Grant Microphone and Accessibility access in the first-run setup.

## Use

- Press `fn` once to start dictation and once more to stop.
- Press `fn` twice to start translated dictation.
- Choose translation languages from the Dictello menu-bar menu.

Speech recognition, cleanup, dictionary processing, and transcript insertion
run locally. Translation uses Apple's on-device Translation framework. macOS
may need an internet connection once to prepare a language pack for a new
language pair.

## Privacy

Dictello contains no analytics, telemetry, cloud transcription, or advertising
SDK. Temporary audio used by the bundled local recognizer is deleted after
processing. Transcript history is local and opt-in.

## Verify the download

From the directory containing both downloaded files:

```bash
shasum -a 256 -c Dictello-0.1.0-beta.1-apple-silicon-macos26.zip.sha256
```

Expected result:

```text
Dictello-0.1.0-beta.1-apple-silicon-macos26.zip: OK
```

## Beta feedback

When reporting a problem, include:

- Mac model and macOS version;
- the application where insertion failed;
- whether ordinary dictation or translation was used;
- the selected source and target languages;
- whether Microphone and Accessibility are enabled for Dictello.
