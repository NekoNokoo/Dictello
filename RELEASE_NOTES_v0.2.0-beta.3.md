# Dictello 0.2.0 beta 3

## English

This beta makes Dictello a lightweight download. Transcription model weights
are no longer embedded in the app: the DMG is 21 MB instead of about 1.4 GB.

### New

- Choose one of six Whisper transcription models in onboarding or Settings:
  Base, Small, Large v3 Turbo Q5, Large v3 Turbo, Large v3 Q5, or Large v3.
- The previously bundled Large v3 Turbo remains available as an explicit
  download.
- Download the selected model directly in Dictello with a progress bar,
  downloaded and total size, cancellation, and SHA-256 verification.
- Model files are stored outside the application bundle, so application updates
  do not duplicate or remove them.
- Local translation/assistant model selection includes compatible Ollama models
  already installed on the Mac and adds `ornith:9b` to the catalog.

### Requirements and current limitations

- Apple Silicon and macOS 26+ only.
- The app occupies about 60 MB; transcription models require an additional
  roughly 142 MB to 3.0 GB depending on the selected model.
- Network access happens only after an explicit model download action; macOS may
  also prepare an Apple Translation language pack.
- This build is ad-hoc signed and not notarized; macOS requires one explicit
  confirmation before first launch.
- Automatic updates are not available yet.

### Verification

- SHA-256:
  `112bef1fb64fd90613739000f82671aae02902549c39932fa432955dff2a5cdd`.
- DMG size: `21,992,505` bytes.
- 144 automated tests passed.
- Version `0.2.0-beta.3`, build `9`.
- The app bundle and all nested executables passed strict code-signature
  verification.
- The DMG checksum and disk-image integrity were verified.
- A clean app copy from the mounted DMG was verified in an isolated directory;
  no `.bin`, `.gguf`, or `.safetensors` model weights are embedded.

---

## Русский

Эта beta делает загрузку Dictello лёгкой. Веса модели транскрибации больше не
встроены в приложение: размер DMG уменьшился примерно с 1,4 ГБ до 21 МБ.

### Новое

- В онбординге и настройках можно выбрать одну из шести моделей Whisper: Base,
  Small, Large v3 Turbo Q5, Large v3 Turbo, Large v3 Q5 или Large v3.
- Ранее встроенная Large v3 Turbo сохранена в списке и теперь загружается по
  явному выбору пользователя.
- Выбранная модель скачивается прямо в Dictello: со шкалой прогресса, объёмом
  загруженных данных, отменой и проверкой SHA-256.
- Файлы моделей хранятся вне bundle приложения, поэтому обновление Dictello не
  дублирует и не удаляет их.
- В выборе локальных моделей для перевода и ассистента сохранены совместимые
  модели Ollama, уже установленные на Mac, и добавлена `ornith:9b`.

### Требования и текущие ограничения

- Только Apple Silicon и macOS 26 или новее.
- Приложение занимает около 60 МБ; выбранная модель транскрибации потребует ещё
  примерно от 142 МБ до 3,0 ГБ.
- Сеть используется только после явной команды скачать модель; macOS также
  может подготовить языковой пакет Apple Translation.
- Сборка подписана ad-hoc и пока не нотариализирована; перед первым запуском
  macOS потребует дополнительное подтверждение.
- Автоматических обновлений пока нет.

### Проверка

- SHA-256:
  `112bef1fb64fd90613739000f82671aae02902549c39932fa432955dff2a5cdd`.
- Размер DMG: `21 992 505` байт.
- Пройдено 144 автоматических теста.
- Версия `0.2.0-beta.3`, сборка `9`.
- Bundle приложения и все вложенные исполняемые файлы прошли строгую проверку
  подписи.
- Проверены контрольная сумма и целостность DMG.
- Чистая копия приложения из смонтированного DMG проверена во временной папке;
  встроенных весов `.bin`, `.gguf` или `.safetensors` нет.
