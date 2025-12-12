export const CONFIG = {
    defaultAvatar: 'Aibek',
    avatars: {
        'Ainaz': '/AINaz.vrm',
        'Aibek': '/AliciaSolidmen.vrm',
    },
    animations: {
        idle: '/idle.vrma', // Анимация покоя
        hello: '/some.vrma', // Анимация покоя
        // 'hello': '/hello.vrma',
    },
    camera: {
        posX: 0.0,
        posY: 1.3,      // Камера на уровне груди/плеч
        posZ: 2.5,      // Ближе к аватару для крупного плана
        fov: 35.0,      // Поле зрения (field of view)
    },
    avatar: {
        position: { x: 0, y: -0.5, z: 0 },  // Опускаем, чтобы видеть торс
        scale: 1.2,     // Немного увеличиваем для лучшей видимости жестов
    },
    // Настройки виджета
    widget: {
        transparent: true,   // Прозрачный фон
        width: 400,          // Ширина виджета
        height: 500,         // Высота виджета (портретная ориентация)
    },
    lights: {
        intensity: 1.3,
    },
};
