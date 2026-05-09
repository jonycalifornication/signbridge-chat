# Инструкция: Прямое API для генерации видео (без виджета)

Если вам не нужно отображать 3D-аватар в реальном времени, а требуется только получать готовые видеоролики с сурдопереводом, вы можете обращаться к нашему REST API напрямую, **вообще не подключая скрипты виджета**.

## POST /api/v1/video/generate

Этот эндпоинт принимает текст и синхронно возвращает готовый видеофайл (Blob).

**URL:** `http://5.63.119.72:5173/api/v1/video/generate`  
**Метод:** `POST`  
**Заголовки:** `Content-Type: application/json`

### Тело запроса (JSON)
| Поле | Тип | Описание |
| :--- | :--- | :--- |
| `glosses` | `string` | **Обязательно.** Текст для перевода на жестовый язык. |
| `avatar` | `string` | *Опционально.* Имя аватара (по умолчанию `Aibek`). |
| `background` | `string` | *Опционально.* Цвет фона в HEX (например, `#00ff00` для хромакея). |

---

## Пример интеграции (JavaScript / Frontend)

Поскольку запрос делается программно "в фоне" (через `fetch`), браузер не покажет окно скачивания файла автоматически. Разработчику необходимо получить бинарные данные (Blob) из ответа и программно инициировать скачивание.

Ниже приведен полный пример кода:

```javascript
async function generateAndDownloadVideo(textToSign) {
    // 1. Делаем POST запрос к API генератора
    const response = await fetch('http://5.63.119.72:5173/api/v1/video/generate', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
            glosses: textToSign, 
            avatar: 'Aibek' // можно не передавать, тогда будет использован аватар по умолчанию
        })
    });

    if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.statusText}`);
    }

    // 2. Получаем видео из ответа в виде сырых данных (Blob)
    const blob = await response.blob();

    // 3. Создаем временную локальную ссылку на это видео в памяти браузера
    const videoUrl = window.URL.createObjectURL(blob);

    // 4. Создаем невидимый тег <a> (ссылку)
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = 'sign_language_video.webm'; // Имя файла при сохранении

    // 5. Добавляем ссылку на страницу, программно "кликаем" по ней и тут же удаляем
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 6. Очищаем память
    window.URL.revokeObjectURL(videoUrl);
}

// Пример использования: привязка к кнопке
document.getElementById('my-download-button').addEventListener('click', async () => {
    try {
        console.log('Начинаем генерацию...');
        // Кнопку можно заблокировать или показать спиннер
        await generateAndDownloadVideo('Сәлем');
        console.log('Видео успешно скачано!');
    } catch (err) {
        console.error(err);
        alert('Не удалось сгенерировать видео.');
    }
});
```

### Примечания:
- **Время ожидания:** Генерация видео занимает время. В зависимости от длины текста, запрос может выполняться от пары секунд до минуты. Рекомендуется обязательно показывать пользователю лоадер (индикатор загрузки) на время выполнения запроса `fetch`.
- **Формат файла:** По умолчанию сервер отдает видео в формате `.webm` (оптимизировано для веб-использования).
