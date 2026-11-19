# REST API: генерация видео с жестовым переводом

Отправляешь текст — получаешь `.webm` с 3D-аватаром, который его показывает.
Виджет подключать не нужно.

**База:** `https://generator.signbridge.kz` — только с ключом в заголовке
`X-API-Key` (см. «Авторизация»).

---

## Быстрый старт

Синхронный запрос: одно обращение, в ответ сразу файл.

```bash
curl -X POST https://generator.signbridge.kz/api/v1/video/generate \
  -H 'X-API-Key: <ключ>' \
  -H 'Content-Type: application/json' \
  -d '{"glosses":"сәлем достар","background":"green"}' \
  -o video.webm
```

Годится для коротких фраз. Рендер идёт от нескольких секунд до пары минут, и всё
это время соединение висит открытым. Для длинного текста бери асинхронный путь.

---

## POST /api/v1/video/generate — синхронно

**Тело запроса**

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `glosses` | string \| string[] | да | Текст. Массив склеивается через пробел |
| `background` | string | нет | `green`, `transparent`, `white` или любой CSS-цвет. По умолчанию `white` |
| `avatar` | string | нет | Имя аватара, по умолчанию `Aibek`. До 50 символов |
| `tokens` | array | нет | Оригинальные слова для губ — см. [ниже](#глоссы-уже-готовы-speech-to-avatar) |
| `speeds` | number[] | нет | Скорость каждого жеста — см. [ниже](#глоссы-уже-готовы-speech-to-avatar) |
| `already_glossed` | boolean | нет | Текст уже в глоссах — см. [ниже](#глоссы-уже-готовы-speech-to-avatar) |
| `mode` | string | нет | Наследие. Ни на что не влияет, только разделяет записи в кэше |

Текст присылай **как есть**, обычным языком. Перевод в глоссы
(«сәлем достар» → «СӘЛЕМ ДОС») делает сервер сам.

**Ответы**

- `200` — тело это сам файл, заголовок `Content-Disposition: attachment; filename="animation.webm"`
- `400` — `{"error":"glosses missing"}`
- `429` — превышен лимит запросов
- `500` — `{"error":"<причина>"}`

Повторный запрос с тем же текстом отдаётся из кэша мгновенно.

---

## Асинхронный путь

Для длинного текста: ставишь задачу, следишь за прогрессом, забираешь файл.

### 1. POST /api/v1/video/generate-async

Тело то же, что у синхронного.

```json
{
  "taskId": "3f2a…",
  "status": "queued",
  "glossPreview": "СӘЛЕМ ДОС",
  "glossTokens": [ { "original": "сәлем", "gloss": "СӘЛЕМ", "kind": "matched" } ]
}
```

Поле `warnings` появляется только при проблемах с `tokens`/`speeds` — см. раздел
про speech-to-avatar.

`glossPreview` — во что превратился текст. `glossTokens` — разбор по словам, у
каждого `kind`: `matched` (жест найден), `dactyl` (покажут по буквам), `missing`
(показать нечем). Удобно предупредить пользователя заранее.

### 2. GET /api/v1/video/status/:taskId

Server-Sent Events. Форма события зависит от момента:

```json
// первое, сразу при подключении — полное состояние задачи
{ "progress": 12, "message": "…", "status": "processing", "downloadUrl": null, "error": null }

// промежуточные — только прогресс
{ "progress": 55, "message": "Оживляем аватар…" }

// финальное
{ "progress": 100, "message": "Готово!", "downloadUrl": "/api/v1/video/cache/<hash>.webm" }

// при сбое
{ "error": "Render timeout: exceeded 240 seconds", "progress": 0 }
```

Поэтому проверяй **наличие `downloadUrl` или `error`**, а не `status` — в
промежуточных событиях его просто нет.

Два предупреждения по опыту:

- **`progress` не монотонный.** Прогресс приходит из двух источников (сервер и
  страница рендера) и может прыгнуть назад: 90 → 80 → 100. Для полосы загрузки
  бери максимум из виденных значений.
- Между событиями идут ping-комментарии (`: ping`), чтобы прокси не рвал
  соединение. Их надо игнорировать — штатные SSE-клиенты делают это сами.

### 3. Забрать файл

`downloadUrl` имеет вид `/api/v1/video/cache/<hash>.webm` — это статика, отдаётся
быстро и переживает перезапуск сервера.

Альтернатива: `GET /api/v1/video/download/:taskId`, но она работает только пока
задача жива в памяти.

### Пример целиком

```javascript
// Node 18+. EventSource из браузера не годится: ему не передать X-API-Key.
const base = 'https://generator.signbridge.kz';
const headers = { 'X-API-Key': process.env.GENERATOR_API_KEY };

const { taskId, glossPreview } = await fetch(`${base}/api/v1/video/generate-async`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ glosses: 'сәлем достар', background: 'green' }),
}).then(r => r.json());

console.log('Глоссы:', glossPreview);

// Статус — поток SSE, но первым событием он сразу шлёт текущее состояние:
// читаем его, закрываем соединение и спрашиваем снова через пару секунд.
async function status() {
    const resp = await fetch(`${base}/api/v1/video/status/${taskId}`, { headers });
    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Поток закрылся без состояния');
        text += value;
        const line = text.split('\n').find(l => l.startsWith('data:'));
        if (line) { reader.cancel(); return JSON.parse(line.slice(5)); }
    }
}

for (;;) {
    const s = await status();
    if (s.error) throw new Error(s.error);
    if (s.status === 'completed') break;
    await new Promise(r => setTimeout(r, 2000));
}

const video = await fetch(`${base}/api/v1/video/download/${taskId}`, { headers });
console.log('Готово:', video.headers.get('content-type'));
```

---

## Глоссы уже готовы (speech-to-avatar)

Если ты глоссировал текст сам и знаешь, за сколько должен уложиться каждый
жест, — работают три дополнительных поля. Они принимаются всеми тремя
эндпоинтами (`preview` использует только `already_glossed`).

| Поле | Тип | Описание |
|---|---|---|
| `already_glossed` | boolean | Не глоссировать повторно. Обязателен, иначе второй проход перепишет глоссы, к которым привязаны `tokens` и `speeds` |
| `tokens` | array | Позиционно по глоссам. `word` — оригинальное слово: руки показывают глосс, губы проговаривают слово |
| `speeds` | number[] | Позиционно по глоссам. Множитель скорости i-й анимации, 0.1–5 |

```json
{
  "glosses": "АДАМ БАРУ",
  "already_glossed": true,
  "tokens": [
    { "gloss": "АДАМ", "word": "адам" },
    { "gloss": "БАРУ", "word": "барады" }
  ],
  "speeds": [1.0, 1.5],
  "background": "green"
}
```

Что получится: на «БАРУ» руки покажут жест БАРУ в полтора раза быстрее, а губы
скажут «барады». Скорость тянет за собой и губы, и паузу после жеста, так что
рассинхрона не возникает.

**Оба массива позиционные и должны совпадать по длине с последовательностью
глоссов.** При несовпадении `tokens` игнорируются целиком (губы вернутся к
проговариванию глоссов), а недостающие `speeds` станут единицами.
`generate-async` в таком случае вернёт поле `warnings`:

```json
{ "warnings": ["tokens: got 1 for 2 glosses — ignored, lips will speak the glosses"] }
```

Без этих полей всё работает и так: gateway глоссирует сам, а губы проговаривают
исходное слово, потому что оригинал приходит в ответе рядом с глоссом.

### Целиком одним запросом

```bash
curl -X POST https://generator.signbridge.kz/api/v1/video/generate \
  -H 'X-API-Key: <ключ>' \
  -H 'Content-Type: application/json' \
  -d '{"glosses":"АДАМ БАРУ","already_glossed":true,"tokens":[{"gloss":"АДАМ","word":"адам"},{"gloss":"БАРУ","word":"барады"}],"speeds":[1.0,1.5],"background":"green"}' \
  -o video.webm
```

---

## POST /api/v1/video/preview — только глоссы, без рендера

Отвечает за доли секунды и не занимает видеокарту. Годится, чтобы показать
разбор до генерации или проверить, найдутся ли жесты.

```json
{ "status": "ready", "glossPreview": "СӘЛЕМ ДОС", "glossTokens": [ … ] }
```

---

## Лимиты

| | |
|---|---|
| Запросов с ключом | без ограничения частоты |
| Попыток без ключа с одного IP | 10 в минуту (`401`), дальше `429` |
| Одновременных рендеров | по одному на видеокарту (4), остальные ждут в очереди |
| Задач в памяти | 500 |
| Кэш видео | 100 МБ, вытесняется по давности |

Рендер тяжёлый: одна фраза занимает слот на видеокарте на десятки секунд. Не
запускай генерацию в цикле без пауз — упрёшься в очередь.

---

## Авторизация

Весь `/api/v1/video/*`, включая готовые файлы кэша, — только с заголовком
`X-API-Key`. Без него или с чужим ключом — `401`.

```bash
curl https://generator.signbridge.kz/api/v1/video/status/<taskId> \
  -H 'X-API-Key: <ключ>'
```

Ключи задаются на сервере генератора переменной `GENERATOR_API_KEYS` (через
запятую, чтобы сменить ключ без простоя). Сейчас клиент один — портал; его ключ
лежит у него в `AVATAR_MP4_GENERATOR_API_KEY`. Привязки к домену через
`Origin`/`Referer` больше нет: эти заголовки клиент вне браузера подставляет
любые.

---

## Чего ожидать от результата

- Формат — **WebM (VP8)**, 1280×1024, 30 fps, **без звука**. Кадр шире человеческого
  роста специально: разведённые в стороны руки должны помещаться целиком.
- `background: "green"` даёт чистый хромакей под монтаж.
- Слова без готового жеста показываются **по буквам** (дактиль). Это штатное
  поведение, а не ошибка; заранее увидеть такие слова можно через `preview`.
- Один и тот же текст даёт один и тот же файл, пока не обновится аватар или база
  жестов.
