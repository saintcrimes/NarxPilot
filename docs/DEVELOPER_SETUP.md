# Разработка и проверка NarxPilot

Актуальные команды и состояние окружения — в корневом [README](../README.md) и [VERIFICATION](VERIFICATION.md). Этот файл заменяет исходный контракт ещё не созданного приложения.

## Компоненты

Web: Next.js UI + API, PostgreSQL через сохранённый node-postgres слой. Миграции в `db/migrations`; `schema_migrations` предотвращает повторное применение. Worker: Python 3.12 + asyncpg, транзакционный outbox, пересчёт событий в snapshots. `SELECT … FOR UPDATE` сериализует переходы заказа, условное обновление остатка предотвращает двойной резерв.

Роли БД: владелец для миграций/seed, `narxpilot_web` для бизнес-операций, `narxpilot_worker` для чтения событий и записи аналитики/outbox. Worker не меняет цены и memberships. Истечение резервов — отдельно разрешённая SECURITY DEFINER функция с фиксированным search_path.

## Переменные

| Переменная | Назначение |
|---|---|
| DEMO_MODE | true только для отдельных narxpilot_demo / narxpilot_test баз |
| DEMO_ANCHOR_DATE, DEMO_SEED | Синтетическая историческая часть seed |
| APP_ORIGIN | Точный Origin изменяющих HTTP-запросов; локально http://localhost:3000 |
| APP_TIMEZONE, TZ | Интерфейс/отчёты Asia/Tashkent, процессы UTC; иные отчётные зоны не реализованы |
| DATABASE_URL | Роль web, не публикуется в клиент |
| MIGRATION_DATABASE_URL | Владелец БД, только CLI / migration-контейнер |
| WORKER_DATABASE_URL | Отдельная роль worker |
| POSTGRES_*, WEB_DB_PASSWORD, WORKER_DB_PASSWORD | Bootstrap Compose и db:grants |
| SESSION_SECRET | Случайный секрет iron-session от 32 символов, setup:env создаёт локально |
| RESERVATION_TTL_MINUTES | Время резерва; по умолчанию 15 минут |
| OFFER_DEFAULT_TTL_HOURS | Время актуальности обновляемого предложения; по умолчанию 24 часа |
| OUTBOX_POLL_SECONDS | Период worker; по умолчанию 3 секунды |
| PRICE_TREND_THRESHOLD_PCT и MIN_*/MAX_* | Пороги качества по ANALYTICS_SPEC |
| ANALYTICS_MODE | descriptive; experimental пока не включает отсутствующую модель |
| LLM_PROVIDER | disabled или openai; независим от FAQ |
| OPENAI_API_KEY, OPENAI_MODEL | Необязательный серверный provider, модель указывается явно |
| LLM_TIMEOUT_SECONDS | Таймаут provider; ошибка даёт шаблон |
| CHATBOT_ENABLED | Только точное true включает справку, по умолчанию false |
| CHATBOT_PROVIDER | local по умолчанию или bro24; независим от аналитического AI |
| BRO24_API_KEY | Только серверный ключ внешней справки; в браузер не передаётся |
| BRO24_REPLY_JSON_PATH | Явный точечный путь к строке ответа; без значения внешние вызовы не выполняются |
| BRO24_TIMEOUT_MS | 8000 по умолчанию, ограничен 1000–20000 мс; ошибка даёт локальный fallback |
| NOTIFICATION_CHANNEL | in_app или disabled; внешних каналов нет |
| TEST_DATABASE_URL | Только отдельная *_test база; web и worker fixtures желательно разделять |

## Аналитические пояснения

Ключ не нужен для заказа, графиков, расчётов и локального FAQ. Аналитический provider получает только public-агрегаты, выбирает известные statement_id/metric_id; сервер вставляет текст и числа из проверенного каталога. Произвольный SQL, код, инструменты заказа и свободные гарантии недоступны. Некорректные ответы отклоняются. Кеш ограничен 100 ключами SKU/когорты/происхождения/версии/модели, срок 5 минут. Число запросов ограничено общим лимитом API; отдельный денежный бюджет провайдера следует установить до реального подключения.

Контракт проверен по [официальной документации Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Это проверка схемы реализации, не успешный внешний вызов: живой ключ и выбранная модель в этом окружении не подключались.

## Проверка

Сначала деньги/статусы/RBAC и реальный PostgreSQL, затем worker, типы/сборка, полный браузерный сценарий. Если npm registry недоступен, синтаксическая транспиляция не заменяет typecheck/build: так и фиксируйте в отчёте. Не публикуйте этот прототип без отдельного поручения.
