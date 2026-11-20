/**
 * Доступ к API генератора — только по ключу.
 *
 * Генератор смотрит в интернет (generator.signbridge.kz → nginx на :5173), а
 * рендер стоит минут работы видеокарты. До этой правки проверка ключа была
 * выключена (`return next(); // BYPASS`), и запустить рендер мог кто угодно.
 * Прежняя проверка за этим BYPASS тоже не годилась: она пускала по заголовкам
 * Origin/Referer, которые клиент вне браузера подставляет любые, и по ключу с
 * доменом `*`.
 *
 * Теперь так:
 *   - ключ приходит заголовком `X-API-Key` и сверяется с `GENERATOR_API_KEYS`
 *     (через запятую — чтобы менять ключ без простоя: добавить новый, перевести
 *     клиента, убрать старый);
 *   - запрос с верным ключом частотой НЕ режется. Наш клиент — портал, у него
 *     свои квоты, а все его пользователи приходят сюда с одного адреса: общий
 *     лимит на IP душил бы их всех разом;
 *   - без ключа — 401, а частые попытки с одного адреса — 429: подбирать ключ
 *     незачем давать в полную силу;
 *   - ключей не задано — отказ ВСЕМ. Открытый по ошибке генератор хуже, чем
 *     громко сломанный.
 */
import crypto from 'crypto';

/** `"a, b,,c"` → `['a', 'b', 'c']`. */
export function parseApiKeys(raw) {
    return String(raw ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
}

function digest(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
}

/**
 * Совпадает ли ключ с одним из разрешённых.
 *
 * Сравниваем хэши через `timingSafeEqual`: обычное `===` выходит на первом
 * несовпавшем символе, и по времени ответа ключ можно угадывать посимвольно.
 * Хэш выравнивает длину — сам `timingSafeEqual` на разной длине бросает.
 */
export function keyMatches(provided, keys) {
    if (typeof provided !== 'string' || provided === '') return false;
    const candidate = digest(provided);
    let ok = false;
    for (const key of keys) {
        // Без раннего выхода: время не зависит от того, который из ключей подошёл.
        if (crypto.timingSafeEqual(candidate, digest(key))) ok = true;
    }
    return ok;
}

/**
 * @param {object} options
 * @param {string[]} options.keys — разрешённые ключи
 * @param {number} [options.limit] — попыток без ключа на адрес за окно
 * @param {number} [options.windowMs]
 * @param {() => number} [options.now] — часы (для тестов)
 */
export function createApiGuard({ keys, limit = 10, windowMs = 60_000, now = Date.now }) {
    // Пустой ключ не ключ: иначе запрос с пустым заголовком прошёл бы.
    const allowed = keys.filter((key) => typeof key === 'string' && key !== '');
    const attempts = new Map();

    function overLimit(ip) {
        const at = now();
        // Уборка по ходу дела, без таймера: карта растёт только от чужих
        // адресов, и чистить её есть смысл, лишь когда она заметно выросла.
        if (attempts.size > 10_000) {
            for (const [address, entry] of attempts) {
                if (at - entry.start > windowMs) attempts.delete(address);
            }
        }
        const entry = attempts.get(ip);
        if (!entry || at - entry.start > windowMs) {
            attempts.set(ip, { start: at, count: 1 });
            return false;
        }
        entry.count += 1;
        return entry.count > limit;
    }

    /** Express-middleware: пропускает только запросы с верным ключом. */
    function requireApiKey(req, res, next) {
        if (keyMatches(req.get('x-api-key'), allowed)) return next();
        if (overLimit(req.ip || req.socket?.remoteAddress || 'unknown')) {
            return res.status(429).json({ error: 'Too many requests. Try again later.' });
        }
        return res.status(401).json({ error: 'Unauthorized: missing or invalid X-API-Key' });
    }

    /**
     * Заголовки для запросов к соседним воркерам.
     *
     * Воркеры передают друг другу задачи и опрос чужих задач через тот же
     * `/api/v1/video/*`. Окружение у них общее, поэтому годится любой из наших
     * ключей; без него сосед ответил бы 401, и передача работы между картами
     * тихо отключилась бы — каждый кусок считался бы там, куда попал.
     */
    function peerHeaders() {
        return allowed.length > 0 ? { 'X-API-Key': allowed[0] } : {};
    }

    return { requireApiKey, peerHeaders, configured: allowed.length > 0 };
}
