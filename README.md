# Dictello


## English

Dictello is a private, local-first voice input and AI text assistant for Apple
Silicon Macs. Dictate into any active text field, translate speech or a screen
region, transform selected text, or translate a document with local models.

[**Download Dictello 0.2.0 beta 3 for Apple Silicon**](https://github.com/NekoNokoo/Dictello/releases/download/v0.2.0-beta.3/Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg)
· [Website](https://nekonokoo.github.io/Dictello/)

### Highlights

- local dictation with a user-selected Whisper model;
- six transcription models available for explicit in-app download, with
  progress, downloaded size, checksum verification, and cancellation;
- Russian, English, mixed speech, and automatic language detection;
- on-device voice translation through Apple Translation;
- Command Mode for correcting, shortening, rewriting, summarizing, and
  converting selected text to Markdown;
- Compose Mode for contextual replies and structured documents;
- screen-area translation with selectable text and image export;
- PDF and DOCX translation beta with layout reconstruction;
- optional local Ollama models, including compatible models already installed
  on the Mac;
- local dictionary and optional transcript history;
- 14 interface languages, light and dark themes;
- no accounts, cloud transcription, analytics, or advertising SDKs.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| Start or finish dictation | `fn` / Globe |
| Cancel recording or processing | `Escape` |
| Translate dictation | Double-press `fn` |
| Transform selected text | `fn + Space` |
| Open Compose Mode | `fn + Shift + Space` |
| Translate a screen area | `fn + T` |

### Requirements

- Apple Silicon Mac;
- macOS 26 or newer;
- about 60 MB for the app, plus space for the transcription model you choose;
- Microphone and Accessibility permissions.

The beta includes the Whisper arm64 runtime but no speech-model weights. Choose
and download a model during onboarding or in Settings; compatible existing
model files can remain outside the app bundle.

### Install the public beta

1. [Download the DMG directly](https://github.com/NekoNokoo/Dictello/releases/download/v0.2.0-beta.3/Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg)
   and get the matching checksum from
   [Releases](https://github.com/NekoNokoo/Dictello/releases/tag/v0.2.0-beta.3).
2. Open the DMG.
3. Right-click `Установить Dictello.command`, choose **Open**, and confirm.
4. Grant Microphone and Accessibility access during onboarding.

This beta is currently ad-hoc signed and not notarized. macOS therefore asks
for one explicit confirmation before the first launch.

### Privacy

Speech recognition, text processing, the dictionary, and history operate on
the Mac. Temporary audio is deleted after recognition. History is local and
opt-in. Dictello accesses the network only when the user explicitly downloads
an optional model; macOS may also prepare an Apple Translation language pack.

### Verify the download

```bash
shasum -a 256 -c Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg.sha256
```

Expected result:

```text
Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg: OK
```

---

## Русский

Dictello — приватное локальное приложение для голосового ввода и работы с
текстом на Mac с Apple Silicon. Оно умеет вставлять диктовку в активное поле,
переводить речь и области экрана, преобразовывать выделенный текст и локально
переводить документы.

[**Скачать Dictello 0.2.0 beta 3 для Apple Silicon**](https://github.com/NekoNokoo/Dictello/releases/download/v0.2.0-beta.3/Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg)
· [Открыть сайт](https://nekonokoo.github.io/Dictello/)

### Основные возможности

- локальная диктовка на выбранной пользователем модели Whisper;
- шесть моделей транскрибации для явной загрузки прямо в приложении: со шкалой
  прогресса, объёмом загрузки, проверкой checksum и отменой;
- русский, английский, смешанная речь и автоматическое определение языка;
- локальный голосовой перевод через Apple Translation;
- Command Mode для исправления, сокращения, изменения стиля, резюмирования и
  преобразования выделенного текста в Markdown;
- Compose Mode для ответов по контексту и создания структурированных документов;
- перевод области экрана с выделением текста и сохранением изображения;
- beta перевода PDF и DOCX с восстановлением вёрстки;
- опциональные локальные модели Ollama, включая совместимые модели, уже
  установленные на Mac;
- локальный словарь и опциональная история диктовок;
- 14 языков интерфейса, светлая и тёмная темы;
- без аккаунтов, облачного распознавания, аналитики и рекламных SDK.

### Горячие клавиши

| Действие | Сочетание |
| --- | --- |
| Начать или завершить диктовку | `fn` / Globe |
| Отменить запись или обработку | `Escape` |
| Перевести диктовку | Двойное нажатие `fn` |
| Преобразовать выделенный текст | `fn + Space` |
| Открыть Compose Mode | `fn + Shift + Space` |
| Перевести область экрана | `fn + T` |

### Требования

- Mac с Apple Silicon;
- macOS 26 или новее;
- около 60 МБ для приложения и место для выбранной модели транскрибации;
- разрешения на доступ к микрофону и Универсальному доступу.

В beta включён arm64-runtime Whisper, но нет встроенных весов речевой модели.
Модель выбирается и загружается во время настройки или позднее в параметрах;
совместимые имеющиеся файлы моделей могут храниться вне bundle приложения.

### Установка публичной beta

1. [Скачайте DMG напрямую](https://github.com/NekoNokoo/Dictello/releases/download/v0.2.0-beta.3/Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg),
   а соответствующий checksum — на
   [странице релиза](https://github.com/NekoNokoo/Dictello/releases/tag/v0.2.0-beta.3).
2. Откройте DMG.
3. Нажмите правой кнопкой на `Установить Dictello.command`, выберите
   **«Открыть»** и подтвердите запуск.
4. Во время первого запуска разрешите доступ к микрофону и Универсальному
   доступу.

Текущая beta подписана ad-hoc и пока не нотариализирована Apple, поэтому перед
первым запуском macOS запросит дополнительное подтверждение.

### Приватность

Распознавание речи, обработка текста, словарь и история работают на Mac.
Временное аудио удаляется после распознавания, а локальная история по умолчанию
выключена. Dictello обращается к сети только при явной загрузке дополнительной
модели; macOS также может подготовить языковой пакет Apple Translation.

### Проверка загрузки

```bash
shasum -a 256 -c Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg.sha256
```

Ожидаемый результат:

```text
Dictello-0.2.0-beta.3-apple-silicon-macos26.dmg: OK
```

## Beta feedback / Обратная связь

When reporting a problem, include the Mac model, macOS version, selected local
model, active application, and the workflow that failed. Do not attach dictated
or selected text unless you intentionally want to share it.

При сообщении об ошибке укажите модель Mac, версию macOS, выбранную локальную
модель, активное приложение и режим, в котором возникла проблема. Не прикладывайте
текст диктовки или выделенный текст, если не хотите передавать его намеренно.
