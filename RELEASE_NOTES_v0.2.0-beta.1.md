# Dictello 0.2.0 beta 1

## English

The first public beta of the 0.2 line expands Dictello from local dictation and
translation into a broader local-first writing assistant.

### New

- **Command Mode** (`fn + Space`) transforms selected text: correct errors,
  shorten, make polite or formal, summarize, or convert to structured Markdown.
- **Compose Mode** (`fn + Shift + Space`) creates contextual replies and
  structured documents from voice instructions.
- A redesigned animated Compose menu with mouse and radial selection.
- Select compatible Ollama models already installed on the Mac. Dictello still
  recommends 1B–8B models, while larger downloaded models are marked by their
  higher memory and latency cost.
- Larger context and response limits for long Markdown documents; model
  reasoning output is disabled when supported.
- 14 interface languages and a localized in-app training academy.
- New app icon with a larger, more legible Dictello mark.

### Improved

- Persistent Whisper model loading reduces repeated dictation startup latency.
- Orphaned `whisper-server` processes are terminated on quit or cleaned up at
  the next launch.
- Clearer recording, processing, cancellation, insertion, and error states.
- Better guidance for `fn`, `Escape`, Command Mode, Compose Mode, and where the
  generated text will be inserted.
- Markdown validation now accepts complete structured documents with ordinary
  bullets as well as task checkboxes.
- Better handling and user-facing errors for very large local models and
  insufficient memory.

### Requirements and limitations

- Apple Silicon and macOS 26+ only.
- The DMG is about 1.4 GB because Whisper Large v3 Turbo is bundled.
- Optional Ollama models are downloaded only on explicit user action.
- This build is ad-hoc signed and not notarized; macOS requires one explicit
  confirmation before first launch.
- Automatic updates are not available yet.

### Verification

- SHA-256: `fc44930280f5fae19652b83e0f46979296e92ee81c5c4389515c3fba49090822`.
- 88 automated tests passed.
- The app bundle and nested executables passed strict code-signature checks.
- The DMG checksum and disk image were verified.
- A replacement launch was tested with exactly one installed Dictello app and
  cleanup of an intentionally orphaned Whisper server.

---

## Русский

Первая публичная beta ветки 0.2 превращает Dictello из локальной диктовки и
переводчика в более универсальный локальный инструмент для работы с текстом.

### Новое

- **Command Mode** (`fn + Space`) преобразует выделенный текст: исправляет
  ошибки, сокращает, меняет тон на вежливый или формальный, резюмирует и
  превращает исходник в структурированный Markdown.
- **Compose Mode** (`fn + Shift + Space`) создаёт ответы по контексту и
  структурированные документы по голосовой инструкции.
- Переработанное анимированное меню Compose с кликом и радиальным выбором мышью.
- Можно выбирать совместимые модели Ollama, уже скачанные на Mac. Dictello
  рекомендует модели 1B–8B, а более крупные требуют больше памяти и времени.
- Увеличены контекст и максимальная длина ответа для больших Markdown-документов;
  режим размышлений модели отключается, если это поддерживается.
- Добавлены 14 языков интерфейса и локализованная обучающая академия.
- Новая иконка с более крупным и читаемым знаком Dictello.

### Улучшения

- Постоянно загруженный Whisper уменьшает задержку повторных диктовок.
- Осиротевшие процессы `whisper-server` завершаются при выходе или автоматически
  очищаются при следующем запуске.
- Стали понятнее состояния записи, обработки, отмены, вставки и ошибок.
- Улучшены подсказки для `fn`, `Escape`, Command Mode, Compose Mode и места
  вставки готового текста.
- Проверка Markdown теперь принимает полноценные структурированные документы
  как с обычными списками, так и с чекбоксами задач.
- Улучшена обработка очень больших локальных моделей и ошибок нехватки памяти.

### Требования и ограничения

- Только Apple Silicon и macOS 26 или новее.
- DMG занимает около 1,4 ГБ, потому что Whisper Large v3 Turbo встроена в сборку.
- Опциональные модели Ollama скачиваются только по явному действию пользователя.
- Сборка подписана ad-hoc и пока не нотариализирована; перед первым запуском
  macOS потребует дополнительное подтверждение.
- Автоматических обновлений пока нет.

### Проверка

- SHA-256: `fc44930280f5fae19652b83e0f46979296e92ee81c5c4389515c3fba49090822`.
- Пройдено 88 автоматических тестов.
- Bundle приложения и вложенные исполняемые файлы прошли строгую проверку подписи.
- Проверены контрольная сумма и целостность DMG.
- Проверена замена приложения с одной установленной копией Dictello и очисткой
  намеренно осиротевшего Whisper-сервера.
