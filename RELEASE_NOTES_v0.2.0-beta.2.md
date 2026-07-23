# Dictello 0.2.0 beta 2

## English

This beta adds local screen-area and document translation, while keeping
Dictello local-first and preserving the existing dictation, Command Mode, and
Compose Mode workflows.

### New

- **Screen-area translation** (`fn + T`): select any region, recognize its text,
  and place the translation over the original layout.
- Translated screen text can be selected and copied, or saved together with the
  translated image through the standard macOS save panel.
- Optional direct translation through the local model selected in Dictello;
  Apple Translation remains the default.
- **Document translation beta** for PDF and DOCX with automatic format
  detection, block-level translation, and layout reconstruction.
- A new bilingual Dictello landing page for the release.

### Improved

- Screen selection no longer switches to the Dictello desktop or flashes
  between dimmed and undimmed states.
- Recognition animation remains active during local processing and transitions
  into a pixel reveal before the final translation appears.
- Better paragraph reconstruction keeps wrapped sentences together while
  preserving independent headings, captions, buttons, lists, and type scales.
- Better handling of Japanese manga and East Asian UI text, including adaptive
  fitting and collision avoidance around images.
- More reliable preservation of underlines without inventing formatting that
  is not present in the source.
- Higher-resolution translated composites and cleaner Halo-style result
  controls.
- Saving or closing a translated area now dismisses the dimmed overlay
  correctly.

### Requirements and current limitations

- Apple Silicon and macOS 26+ only.
- The DMG is about 1.4 GB because Whisper Large v3 Turbo is bundled.
- Optional Ollama models are downloaded only on explicit user action.
- Document translation is a beta feature. Dense layouts, complex tables, and
  scanned documents are still being improved.
- This build is ad-hoc signed and not notarized; macOS requires one explicit
  confirmation before first launch.
- Automatic updates are not available yet.

### Verification

- SHA-256:
  `40619faa48ce863b084bd83b61764ed9857440cfd2d23317475ae36e56d7ee84`.
- 142 automated tests passed.
- The app bundle and all nested executables passed strict code-signature
  verification.
- The DMG checksum and disk-image integrity were verified.
- A clean installation from the mounted DMG was tested in an isolated
  directory, including version `0.2.0-beta.2`, build `8`, and quarantine
  removal.

---

## Русский

В этой beta появились локальный перевод области экрана и перевод документов.
Диктовка, Command Mode и Compose Mode продолжают работать по прежней локальной
схеме.

### Новое

- **Перевод области экрана** (`fn + T`): выделите участок экрана, и Dictello
  распознает текст и разместит перевод поверх исходной вёрстки.
- Переведённый текст можно выделять и копировать, а готовое изображение —
  сохранять через стандартное окно macOS.
- Можно сразу направлять перевод в выбранную локальную модель; по умолчанию
  используется Apple Translation.
- **Beta перевода документов** для PDF и DOCX: Dictello сам определяет формат,
  переводит блоки и восстанавливает макет.
- Новый двуязычный лендинг Dictello.

### Улучшения

- При выделении области Dictello больше не переключает рабочий стол и не
  создаёт светлую вспышку между затемнёнными состояниями.
- Анимация распознавания продолжается во время локальной обработки и переходит
  в пиксельное появление готового перевода.
- Улучшено восстановление абзацев: переносы одного предложения сохраняют
  контекст, а заголовки, подписи, кнопки, списки и разные кегли остаются
  отдельными элементами.
- Улучшена работа с японской мангой и азиатскими интерфейсами: адаптивное
  вписывание текста и защита изображений от наложения.
- Подчёркивания переносятся точнее и не добавляются без уверенного
  распознавания.
- Переведённые изображения рендерятся в более высоком разрешении, а кнопки
  результата приведены к Halo-стилю.
- После сохранения или закрытия результата затемнение экрана корректно
  исчезает.

### Требования и текущие ограничения

- Только Apple Silicon и macOS 26 или новее.
- DMG занимает около 1,4 ГБ, потому что Whisper Large v3 Turbo встроена в
  сборку.
- Опциональные модели Ollama загружаются только по явному действию пользователя.
- Перевод документов пока находится в beta. Плотная вёрстка, сложные таблицы и
  сканы продолжают улучшаться.
- Сборка подписана ad-hoc и пока не нотариализирована; перед первым запуском
  macOS потребует дополнительное подтверждение.
- Автоматических обновлений пока нет.

### Проверка

- SHA-256:
  `40619faa48ce863b084bd83b61764ed9857440cfd2d23317475ae36e56d7ee84`.
- Пройдено 142 автоматических теста.
- Bundle приложения и все вложенные исполняемые файлы прошли строгую проверку
  подписи.
- Проверены контрольная сумма и целостность DMG.
- Выполнена чистая установка из смонтированного DMG во временную папку:
  версия `0.2.0-beta.2`, сборка `8`, quarantine-атрибут отсутствует.
