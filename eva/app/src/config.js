// Все настраиваемые параметры стенда. Панель меняет копию, «Сброс» возвращает эти значения.
import { ASCII_DEFAULTS } from './ascii.js';
import { HAIR_DEFAULTS } from './hair_motion.js';
import { POSE_DEFAULTS } from './hair_poses.js';

// Ход взгляда под набор глаз: старые нарисованы только под центр — малый ход без артефактов;
// v3 дорисованы целиком — крупный «анимешный» ход.
export const EYE_STYLE_PRESETS = {
  old: { maxX: 8, maxY: 5, inwardFactor: 0.25 },
  v3old: { maxX: 14, maxY: 8, inwardFactor: 1 },
  v3: { maxX: 14, maxY: 8, inwardFactor: 1 },
  // v4old: в слежении та же подвижная радужка, что у v3old. v4: радужка запечена в кадр и не двигается —
  // ход нулевой, чтобы настройки панели не обещали движения, которого нет.
  v4old: { maxX: 14, maxY: 8, inwardFactor: 1 },
  v4: { maxX: 0, maxY: 0, inwardFactor: 1 },
};

export const DEFAULTS = Object.freeze({
  seed: 1,
  eyes: { style: 'v3old' }, // 'old' — исходные глаза пакета, 'v3' — пересобранные в Photoshop, 'v3old' — v3 со старой радужкой, 'v4' — цельные кадры Кодекса, 'v4old' — кадры Кодекса + слежение v3old
  gaze: {
    enabled: true,
    maxX: 14,             // px в системе 1024×1024 (для старых глаз — 8, см. EYE_STYLE_PRESETS)
    maxY: 8,
    smoothMs: 140,        // время выхода на ~95% мишени
    returnMs: 400,        // возврат в центр после ухода курсора
    cursorIdleMs: 0,      // >0: курсор не двигается столько мс — взгляд возвращается в центр до следующего движения (0 — следит всегда; во встраиваемой версии 1500)
    rangeFactor: 0.5,     // радиус насыщения = размер портрета × rangeFactor
    preCenterMs: 60,      // подготовка радужки перед закрыванием, не входит в blink-тайминг
    inwardFactor: 1,      // доля сдвига к носу (у старых глаз — 0.25: у внутреннего угла нет белка)
  },
  blink: {
    enabled: true,
    stagesMs: [45, 40, 65, 45, 55], // closing_35, closing_70, closed, closing_70, closing_35
    minIntervalMs: 3000,
    maxIntervalMs: 7000,
    doubleChance: 0.15,
    doubleGapMs: 120,
  },
  transitions: {
    partFadeMs: 180,      // смена бровей/рта/румянца: fade-out, затем fade-in
    closedHoldMs: 180,    // удержание закрытой стадии при смене формы глаз
  },
  blush: {
    enabled: true,        // румянец как эмоция: меняется только прозрачность штрихов
    restAlpha: 0.55,      // в покое
    attentionAfterMs: 1500, attentionAlpha: 0.85, // курсор долго рядом с лицом
    bashfulAlpha: 1,      // смущённые позы (румянец bashful)
    irritationAlpha: 0.9, // раздражение
    sleepAlpha: 0.4,
    clickBump: 0.25, bumpDecayMs: 1500, // короткая вспышка от клика
    riseMs: 1800, fallMs: 2600,
  },
  pet: {
    enabled: true,        // поглаживание: медленно водить курсором туда-сюда над макушкой
    cx: 512, cy: 300, rx: 330, ry: 230, // зона головы (эллипс в системе 1024)
    minStrokePx: 30,      // минимальная длина одного «штриха»
    maxSpeedPx: 2500,     // быстрее — это не поглаживание (px портрета в секунду)
    reversals: 3,         // столько разворотов за окно — и это поглаживание
    windowMs: 2200,
    holdMs: 1000,         // держится после последнего движения
    rippleStrength: 0.3,  // мягкое кольцо ASCII на развороте руки
  },
  moods: {
    enabled: true,          // выражения в поведении (без новых ассетов)
    idleMinMs: 15000, idleMaxMs: 40000, idleMoodMs: 1800, // смена настроения в покое
    celebrate: true, celebrateMs: 1300,   // радость после «Готово» (уже в покое)
    longProcessingMs: 8000,  // долгая обработка: focused/determined в жестах, восторг на «Готово»
    tiredProcessingMs: 15000, // очень долгая: иногда устало
    errorStreakMs: 30000,    // ошибки подряд в этом окне — нервничает сильнее
    errorSadAfterMs: 5000,   // одна ошибка: через столько worried → грустно
    drowsyMs: 8000,          // за столько до автосна — сонное лицо
    shyAfterMs: 5000, shyCooldownMs: 30000, shyMs: 1800, // долгое внимание курсора — смущается
    petLoveAfterMs: 1200,    // гладят дольше — «нравится», сердечко
    silenceMs: 1600,         // событие silence: заминка «?»
    anticipateMs: 700,       // событие anticipate (в автосценарии — перед «Готово»)
  },
  speech: {
    enabled: true,        // рот Tier C (mascot_v2) проходит формы по тексту
    rate: 1,              // скорость речи
    sayOnDone: 'Готово!', // пусто — молчит
    sayOnError: 'Ой…',
    voiceEnabled: true,   // рот двигается в такт голосу пользователя во время записи (событие voice.level)
    voiceGate: 0.04,      // доля над фоном, ниже которой рот закрыт
    voiceMinRange: 0.2,   // минимальный размах «фон → пик» (в шкале приложения), чтобы шум не раскрывал рот
    voiceAttackMs: 45, voiceReleaseMs: 110,
    voiceVowelMs: 140, voiceMinHoldMs: 70,
    vowelMinConf: 0.45,   // уверенность гласной (из пяти), ниже — рот просто приоткрыт
    voicePauseMs: 450,    // тишина дольше — рот возвращается к позе
    voiceStaleMs: 400,    // нет уровней дольше — голос считается замолчавшим
  },
  effects: {
    enabled: true,        // эффекты Tier E (mascot_v2) на реакциях и позах
    fadeMs: 220,
    errorSweatMs: 4000,   // капля пота держится в начале ошибки
  },
  poses: structuredClone(POSE_DEFAULTS), // целые позы волос: ветерок, перемещение, клик (hair_poses.js); при наличии банка заменяют hair
  hair: {
    ...HAIR_DEFAULTS,
    triggers: { click: true },
  },
  indicator: {
    enabled: true,        // синяя пилюля заколки как индикатор статуса
    colors: { success: '#16c79a', warning: '#f2a516', loading: '#8a93a3', error: '#e0262b' },
    successRiseMs: 120, successHoldMs: 700, successFadeMs: 1400, successGlow: 0.8,
    errorGlow: 0.5, errorHoldMs: 10000,
    warningPulseMs: 1600, loadingPulseMs: 2400,
    riseMs: 250, fadeMs: 1200, colorMs: 250,
  },
  breath: {
    enabled: true,
    amplitude: 0.003,     // 0.3% масштаба
    periodMs: 5000,
    pivotY: 1001,         // низ бюста в системе 1024
  },
  idle: {
    enabled: true,        // «жизнь» в покое (idlelife.js): саккады, взгляды, моргание по ситуации, вздох, зевок
    saccadeMinMs: 700, saccadeMaxMs: 2200, saccadeAmpPx: 55, // микро-саккады: пауза и размах (px портрета ≈ 1,5 px радужки)
    glanceMinMs: 6000, glanceMaxMs: 15000, glanceMs: 900, glanceRadiusPx: 330, // взгляд «на что-то» в стороне
    settleMs: 2200,            // после ухода курсора взгляд сначала возвращается в центр, потом оживает
    blinkBeforeGlance: 0.6,    // шанс моргнуть, прикрывая уход взгляда
    blinkOnCursorJump: 0.5,    // шанс моргнуть, когда курсор появился/прыгнул далеко
    cursorJumpPx: 380, jumpBlinkCooldownMs: 4000,
    drowsyBlinkSlow: 1.9,      // сонное моргание: стадии длиннее в столько раз
    drowsyBlinkIntervalMul: 0.55, // и чаще
    drowsyLookDownPx: 28,      // сонный взгляд чуть вниз
    yawn: true, yawnLeadMs: 2000, yawnMs: 2800, yawnDipPx: 3, // зевок за drowsyMs + yawnLeadMs до сна
    sigh: true, sighAfkMs: 22000, sighMinMs: 60000, sighMaxMs: 120000, sighMs: 2400,
    sighBreathAmp: 0.010, sighDipPx: 4, // вздох: плечи поднимаются, голова оседает
    sleepBreathSlow: 1.5,      // во сне дыхание медленнее
  },
  clicks: {
    annoyedCount: 3, annoyedWindowMs: 2000,
    angryCount: 6, angryWindowMs: 4000,
    irritationMs: 2500,
    composureMs: 700,
    cooldownMs: 8000,     // от начала предыдущего раздражения
    clickReactionMs: 900,
    angryGazeStrength: 0.4,
  },
  behavior: {
    sleepAfterMs: 45000,
    listeningCardGazeMs: 1200,
    processingGlanceMinMs: 4500, processingGlanceMaxMs: 8000, processingGlanceMs: 800,
    processingGestureMinMs: 8000, processingGestureMaxMs: 13000, gestureMs: 1200, // жест = bridge thinking, включая смену формы глаз через закрывание
    doneResultGazeMs: 600, doneCursorGazeMs: 700, doneToIdleMs: 1500,
    doneRelief: false, reliefMs: 700, // необязательная поза relief перед возвратом в покой
    errorCardGazeMs: 1000,
    sleepOnsetMs: 1300,
    wakeBridgeMs: 700, wakeCursorMs: 700,
    nearEnterFactor: 0.5, nearExitFactor: 0.7, // доля размера портрета от центра лица
    noticeCooldownMs: 20000, noticeMs: 900, // bridge attention, включая смену формы глаз
    doneLookAtCaret: true, // «Готово»: взгляд на место вставки текста (курсор ввода), иначе на карточку результата
    hotkeyMs: 450,         // горячая клавиша: поза anticipation до начала записи
    hotkeyLeadMs: 250,     // в автосценарии: клавиша нажата за столько до «Слушает»
  },
  ascii: { ...ASCII_DEFAULTS },
  scenario: { idleMs: 1500, listeningMs: 3500, processingMs: 5000 },
});

export function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}
