# Сервер NarxPilot

Домен: **narxpilot.software-engineer.online**. Установщик получает код из `https://github.com/saintcrimes/NarxPilot.git`, сохраняет секреты на сервере, собирает закреплённые зависимости и запускает Caddy, web, worker и отдельный PostgreSQL. Это защищённый паролем **демонстрационный стенд**, пока в приложении используется переключение демоаккаунтов. Данные синтетические; это не запуск реальных закупок без production-аутентификации.

## Перед запуском

- Linux-сервер с root/sudo. При отсутствии Docker автоматическая установка поддерживает Ubuntu/Debian; другой Linux — с уже установленными Docker Engine, Compose 2.24+, Git, curl и util-linux.
- DNS A-запись `narxpilot.software-engineer.online` должна указывать на публичный IPv4 сервера. AAAA нужна только при реально доступном IPv6 этого сервера.
- В firewall/панели хостинга должны быть открыты входящие TCP 80 и 443; UDP 443 необязателен для HTTP/3. Порты должны быть свободны. Скрипт не отключает чужие Nginx/Apache и не меняет firewall.
- Серверу нужен исходящий HTTPS к GitHub, npm registry, Docker registry и центру сертификации. Для внешнего чата — к документированному Bro24 endpoint.
- Сборка выполняется на сервере: предусмотрите место под образы, PostgreSQL и резервные копии. Практический ориентир — 4 ГБ RAM и 20 ГБ свободного диска; минимальная конфигурация отдельно не измерялась.

## Одна команда

Запустите на сервере:

```bash
curl -fsSL https://raw.githubusercontent.com/saintcrimes/NarxPilot/main/deploy/install.sh | sudo bash
```

Код и серверный `.env` будут в `/opt/narxpilot`. Установщик создаёт случайные отдельные пароли БД/ролей/сессии и доступ к стенду. Секреты не печатаются в журнал. После успеха откройте `https://narxpilot.software-engineer.online` и используйте логин/пароль из локального файла:

```bash
sudo cat /opt/narxpilot/.local/deploy/access.json
```

Этот файл не публикуется. Caddy получает только bcrypt-хеш; пароль HTTP-доступа не передаётся приложению. После входа в стенд доступны демонстрационные профили покупателя/поставщика. HTTPS выдаётся и продлевается Caddy автоматически при правильном DNS и доступных портах; успешный внутренний healthcheck сам по себе не доказывает выпуск сертификата.

Для предварительного просмотра сохраните и прочитайте скрипт. `--dry-run` проверяет аргументы без сети и изменения системы:

```bash
curl -fsSL https://raw.githubusercontent.com/saintcrimes/NarxPilot/main/deploy/install.sh -o narxpilot-install.sh
bash narxpilot-install.sh --dry-run
sudo bash narxpilot-install.sh --domain narxpilot.software-engineer.online --dir /opt/narxpilot --ref main
```

`--ref` также принимает полный SHA проверенного коммита. Для воспроизводимого получения самого установщика замените `main` в download URL на тот же SHA. Скрипт не делает reset/force и не перезаписывает другую историю. Существующий каталог без этого Git-репозитория сохраняется и вызывает понятную ошибку; выберите другой `--dir`.

## API-ключ и настройки чата

Ваш локальный `.env` исключён из GitHub и Docker build context. Ключ с компьютера **не появляется на сервере при clone**. Основной продукт запускается без него. После установки добавьте ключ в серверный `.env` по SSH:

```bash
sudo nano /opt/narxpilot/.env
```

Параметры: `BRO24_API_KEY`, `BRO24_REPLY_JSON_PATH`, `CHATBOT_PROVIDER=bro24`, `CHATBOT_ENABLED=true`. Путь ответа нужно подтвердить по реальному ответу; имя поля не предполагается. Ключ нельзя помещать в `NEXT_PUBLIC_*`, командную строку, README или GitHub. Контекст NarxPilot в кабинете внешнего сервиса настраивается владельцем ключа; недокументированное поле контекста в запрос не добавляется.

Один диагностический запрос с безопасным вопросом:

```bash
sudo bash /opt/narxpilot/deploy/control.sh check-chat
```

Команда выводит HTTP-статус и возможные пути текстовых полей, без ключа, текста ответа или бизнес-данных. Она не меняет настройки автоматически. После подтверждения схемы включите provider и примените изменения:

```bash
sudo bash /opt/narxpilot/deploy/control.sh deploy
```

Не заменяйте всю серверную `.env` файлом с компьютера после первого запуска: уже созданная БД использует серверные пароли. Повтор installer сохраняет существующие ключи/пароли, обновляя явно заданный домен и HTTPS Origin. В `.local/deploy/` остаётся приватная копия изменённого `.env`. Если ключ не задан или формат не подтверждён, действует локальная справка; закупки и аналитика независимы.

## Управление

```bash
sudo bash /opt/narxpilot/deploy/control.sh status
sudo bash /opt/narxpilot/deploy/control.sh logs web
sudo bash /opt/narxpilot/deploy/control.sh logs worker
sudo bash /opt/narxpilot/deploy/control.sh logs caddy
sudo bash /opt/narxpilot/deploy/control.sh backup
sudo bash /opt/narxpilot/deploy/control.sh update
```

`update` проверяет чистый checkout и правильный origin, получает main и допускает только fast-forward. `.env` и `.local` игнорируются Git. Локальные изменения исходников останавливают обновление; они не удаляются. Свежая установка использует detached HEAD выбранного коммита, и `update` это поддерживает.

`deploy` сначала загружает и собирает образы, проверяет Caddy, затем запускает БД. Для существующей схемы создаётся `pg_dump` в `.local/backups/` и проверяется формат через `pg_restore --list`. Только после успешной резервной копии применяются миграции, права и идемпотентный demo seed. Затем обновляются web/worker/Caddy и проверяется их здоровье. Ошибка сборки не останавливает текущие сервисы; ошибка миграции не запускает новую web-версию. Полное восстановление backup нужно отдельно проверять в изолированной базе.

Данные хранятся в именованных volumes проекта `narxpilot-server`, включая PostgreSQL и сертификаты. Скрипты не выполняют `down -v`, удаление данных или автоматический откат миграций. Старые backups автоматически не удаляются: храните внешнюю копию и контролируйте место на диске.

## Проверка и ограничения

### Если миграция остановилась с EACCES /app/package.json

Первоначальные Dockerfile сохраняли root-владельца файлов checkout с правами `0600/0700`, созданных установщиком с `umask 077`. Поэтому непривилегированный пользователь контейнера не мог прочитать исходники. Исправленные образы назначают владельцем копируемых файлов пользователя приложения (`node` или `worker`); приватные права серверных файлов сохраняются.

Для уже созданной установки выполните:

```bash
sudo bash /opt/narxpilot/deploy/control.sh update
```

Команда получает исправления из main, пересобирает образы и повторяет миграции. Существующие `.env`, пароли и volumes сохраняются. Стандартный каталог установки — `/opt/narxpilot`, независимо от каталога, из которого вызван installer. При использовании `--dir` подставьте выбранный путь.

### Границы проверок

- Workflow `.github/workflows/validate.yml` создаёт настоящий lockfile при его отсутствии, выполняет тесты/типы/сборку и проверяет Docker-образы. Запуск CI не является деплоем на ваш сервер.
- `node --test deploy/tests/*.test.mjs` проверяет конфигурацию/секреты и Compose. `RUN_DOCKER_TESTS=true` дополнительно включает реальную проверку Caddy в контейнере.
- Bash-тесты проверяют аргументы и порядок/failure-сценарии через подставленные CLI, без изменения хоста.
- Полный Linux CI прошёл, включая настоящий Caddy, Compose и 6 desktop/mobile E2E. В этом сеансе нет SSH-доступа к вашему серверу: DNS, выпуск сертификата, firewall и реальное восстановление БД там не проверены. Фактические результаты CI — в [VERIFICATION.md](VERIFICATION.md).
- Автоустановка принимает только отдельную `narxpilot_demo` / `narxpilot_demo_*` базу. При live/test-конфигурации она останавливается, сохраняя файл. Настоящий production-вход остаётся отдельной задачей.

Основа настройки: [официальная установка Docker для Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Debian](https://docs.docker.com/engine/install/debian/), [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [безопасное чтение пароля из stdin](https://caddyserver.com/docs/command-line#caddy-hash-password).
