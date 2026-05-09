# Инструкция: Интеграция функции скачивания видео

Виджет SignBridge позволяет не только показывать 3D-аватар в реальном времени, но и запрашивать генерацию видео (сохранение жеста в виде видеофайла) прямо с сервера.

Ниже описаны два способа интеграции этой функции на ваш сайт, в зависимости от того, как вы подключили сам виджет.

---

## Способ 1: Для сайтов с прямым встраиванием (Native / DOM)

Если виджет подключен на вашем сайте напрямую (через тег `<script>`), объект виджета доступен глобально как `window.avatarWidget`.

### Шаг 1. Кнопка в HTML
Разместите кнопку скачивания в любом удобном месте:
```html
<button id="download-sign-video-btn" class="my-custom-btn">
    Скачать видео перевода
</button>
```

### Шаг 2. Добавьте логику на JavaScript
Этот код перехватывает клик по кнопке, делает запрос на серверную генерацию и автоматически скачивает полученный файл:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const downloadBtn = document.getElementById('download-sign-video-btn');
    
    downloadBtn.addEventListener('click', async () => {
        if (!window.avatarWidget) {
            alert('Виджет еще загружается, подождите пару секунд.');
            return;
        }

        // Текст для видео (можно брать динамически из DOM)
        const textToSign = "Сәлем"; 
        
        // 1. Показываем визуальную загрузку
        const originalText = downloadBtn.innerHTML;
        downloadBtn.innerHTML = '⏳ Генерируем видео...';
        downloadBtn.disabled = true;

        try {
            // 2. Запрашиваем генерацию видео на сервере
            // Метод вернет абсолютную ссылку на готовый .webm файл
            const videoUrl = await window.avatarWidget.generateVideo(textToSign, {
                background: '#00ff00' // Опционально: сплошной цвет для хромакея
            });
            
            // 3. Автоматически скачиваем файл пользователю
            const link = document.createElement('a');
            link.href = videoUrl;
            link.download = `sign_language_video.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (error) {
            console.error('Ошибка при генерации видео:', error);
            alert('Не удалось сгенерировать видео. Попробуйте позже.');
        } finally {
            // 4. Возвращаем кнопку в исходное состояние
            downloadBtn.innerHTML = originalText;
            downloadBtn.disabled = false;
        }
    });
});
```

---

## Способ 2: Для сайтов с интеграцией через Iframe

Если виджет встроен через `<iframe>`, прямой доступ к функциям заблокирован политиками безопасности браузера. В этом случае используется механизм обмена сообщениями `postMessage`.

### Шаг 1. Кнопка в HTML
Разместите кнопку скачивания на вашем сайте:
```html
<button id="download-iframe-video-btn" class="my-custom-btn">
    Скачать видео перевода
</button>

<!-- Пример вашего iframe -->
<iframe id="my-avatar-iframe" src="https://ваш-домен/embed.html"></iframe>
```

### Шаг 2. Логика общения с Iframe (JavaScript)
Скопируйте этот скрипт на свою страницу. Скрипт будет отправлять команду в iframe при клике на кнопку и «слушать» ответ от виджета с готовой ссылкой.

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const downloadBtn = document.getElementById('download-iframe-video-btn');
    const iframeElement = document.getElementById('my-avatar-iframe');
    
    const textToSign = "Сәлем";

    // 1. Отправляем команду в iframe по клику
    downloadBtn.addEventListener('click', () => {
        if (!iframeElement || !iframeElement.contentWindow) return;

        downloadBtn.innerHTML = '⏳ Генерируем видео...';
        downloadBtn.disabled = true;

        // Отправляем команду на генерацию видео
        iframeElement.contentWindow.postMessage({ 
            type: 'GENERATE_VIDEO', 
            text: textToSign 
        }, '*'); // Рекомендуется заменить '*' на точный домен виджета
    });

    // 2. Слушаем ответы от iframe
    window.addEventListener('message', (event) => {
        // Видео успешно сгенерировано
        if (event.data.type === 'VIDEO_GENERATED') {
            const videoUrl = event.data.url;
            
            // Скачиваем файл
            const link = document.createElement('a');
            link.href = videoUrl;
            link.download = `sign_language_video.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Сброс кнопки
            downloadBtn.innerHTML = 'Скачать видео перевода';
            downloadBtn.disabled = false;
        } 
        // Произошла ошибка на сервере
        else if (event.data.type === 'VIDEO_GENERATION_FAILED') {
            console.error('Ошибка генерации видео:', event.data.error);
            alert('Ошибка при генерации видео. Попробуйте позже.');
            
            downloadBtn.innerHTML = 'Скачать видео перевода';
            downloadBtn.disabled = false;
        }
    });
});
```

### Как это работает "под капотом"
При запросе на генерацию, виджет ставит задачу в очередь на специализированный GPU-сервер. Анимация отрисовывается в фоновом режиме на сервере, не нагружая браузер пользователя. Как только файл готов, вы получаете прямую публичную ссылку на готовый `webm` файл.
