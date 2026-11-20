# Входной nginx генератора (сервис avatar-widget, порт 5173).
#
# Своей страницы у генератора больше нет: его единственный клиент — бэкенд
# портала, и nginx здесь только раздаёт запросы /api/v1/video/* по воркерам
# рендера (см. nginx.conf.template). Ключ проверяют сами воркеры.
FROM nginx:stable-alpine

# Шаблон обрабатывается envsubst при старте (штатный entrypoint образа).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
