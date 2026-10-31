# API NarxPilot v0.1

Все маршруты относятся к нашему приложению. Внешнего chat API нет. Денежные поля — строки Decimal с точностью до двух знаков, время — ISO UTC, отчётные дни Asia/Tashkent.

Изменяющие запросы: `Content-Type: application/json`, точный `Origin=APP_ORIGIN`, `X-CSRF-Token` из GET /api/session и HttpOnly-сессия. Для заказов, предложений, складских движений и CSV-import обязателен `Idempotency-Key`: 8–100 латинских букв, цифр, `_` или `-`. Повтор того же payload возвращает сохранённый результат, другой payload с тем же ключом — 409.

| Метод и путь | Тело / параметры | Результат |
|---|---|---|
| GET /api/session | — | csrf, demo, profile, demo profiles, публичный chatbot_enabled |
| POST /api/session/demo | userId | Только DEMO_MODE; членство выбирается сервером |
| POST /api/session/logout | {} | Очистка сессии |
| GET /api/products | q | Точные SKU |
| GET /api/skus/:id/offers | quantity, location, includeStale | Отдельные версии/цены, total строка или null, eligible |
| POST /api/compare | skuId, quantity, location | Только доступные предложения |
| POST /api/orders | skuId, offerId, quantity, baselineOfferId? | REQUESTED и снимок |
| GET /api/orders, /api/orders/:id | — | Только заказы участника; детали включают события, возвраты и сохранённые условия |
| POST /api/orders/:id/quote | unitPrice, delivery, fees? | QUOTED, новая quote_version, срок 30 минут |
| POST /api/orders/:id/accept | quoteVersion | RESERVED в одной транзакции |
| POST /api/orders/:id/ship | {} | SHIPPED; это ещё не продажа |
| POST /api/orders/:id/receive | {} | COMPLETED, ReceiptAccepted, outbox |
| POST /api/orders/:id/cancel | reason? | Отмена до отгрузки, освобождение резерва |
| POST /api/orders/:id/reject | reason? | Отклонение поставщиком до резерва |
| POST /api/orders/:id/dispute | reason | Спор до приёмки, без включения в индекс |
| POST /api/orders/:id/return-request | quantity, resalable, reason | Запрос покупателя; запас ещё не меняется |
| POST /api/orders/:id/return-accept | returnId | Подтверждение поставщика, склад/карантин, пересчёт истории |
| GET /api/supplier | — | Собственные предложения, склады, остатки |
| POST /api/offers | skuId, warehouseId, unitPrice, delivery, fees, minQuantity, deliveryDays | Новое предложение своего склада |
| POST /api/offers/:id | unitPrice, delivery, fees, minQuantity, deliveryDays | Новая неизменяемая версия |
| POST /api/inventory | warehouseId, skuId, kind, quantity, reason, targetWarehouseId? | Приход/списание/корректировка/перемещение/сверка/внешняя продажа |
| POST /api/supplier/csv/preview | csv | Проверка до 100 строк / 32 КБ |
| POST /api/supplier/csv/import | csv | Идемпотентное применение проверенных строк |
| GET /api/analytics/:sku | scope=platform/own, location=all/malika/chilanzar, terms=1/2-9/10+ | series, quality_flags, sample, as_of, data_cutoff, version, pending_events, forecast |
| POST /api/analytics/explain | skuId, location=all/malika/chilanzar, terms=1/2-9/10+ | Пояснение обезличенных агрегатов платформы выбранной когорты; provider, is_ai, sku_id, cohort и snapshot_version явные |
| GET /api/favorites | — | Сохранённые SKU своей организации |
| POST /api/favorites | skuId, location, threshold строка/null, enabled | Настройка порога и избранного |
| GET /api/notifications | — | Внутренние сообщения своей организации |
| POST /api/notifications/read | id | Отметка чтения только своей записи |
| GET /api/admin/quality | — | Только admin: числа событий, снимков и очередь, без чужих заказов |
| GET /api/health/live, /api/health/ready | — | Процесс / наличие миграций и правильная база |

Ошибка: `{ "error": { "code": "QUOTE_CHANGED", "message": "…", "request_id": "uuid" } }`. 400 — валидация; 401 — сессия; 403 — роль/CSRF; 404 — отсутствующий либо чужой объект; 409 — доменный конфликт; 413 — размер; 429 — лимит; 503 — недоступная инфраструктура. SQL и секреты не раскрываются.

CSV содержит `offerId,unitPrice,delivery,fees,minQuantity,deliveryDays`. Не создаёт чужие предложения. Каждая строка имеет производный стабильный idempotency key: при прерывании повтор завершает импорт; весь файл не объявляется атомарным.
