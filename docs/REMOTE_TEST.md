# Brasswood: тестовый запуск на Cloudflare (Pages `brasswood-test` + D1 `brasswood-test`)

Это отдельное тестовое окружение. Оно **не трогает** старый статический демо-сайт, который уже опубликован через
загрузку в дашборде: у него другой Pages-проект, и в этом репозитории его имя нигде не упоминается.
Все команды ниже рассчитаны на **PowerShell** в Windows (в bash они работают так же). Запускать их нужно из корня
проекта, Node 22+.

> **Стоимость.** Всё ниже укладывается в бесплатный план (Workers Free + D1 Free). На Free при превышении лимита
> ничего не списывается: запросы просто получают ошибку до 00:00 UTC. Деньги появляются только после ручного
> перехода на Workers Paid ($5/мес). **Не включайте Paid**, тест его не требует. Подробности и расчёт нагрузки
> в разделе «Лимиты и расход» в конце.

Легенда: 🔑 нужен вход в Cloudflare или API-токен · ⚠️ есть подтверждение или необратимое действие · 💻 только локально.

---

## 0. Что должно быть готово заранее (💻)

```powershell
node -v                      # v22.x или новее
npm ci                       # зависимости (если ещё не стоят)
git switch remote-test       # ветка с этой конфигурацией
npm run remote:check         # ожидаемо: "NOT READY for remote: … database_id is still the PLACEHOLDER" (exit 1)
```
`remote:check` проверяет, что в `wrangler.toml` вместо заглушки уже стоит настоящий `database_id`. Пока шаг 3 не
выполнен, команда **обязана** падать.

Как устроен `wrangler.toml` (Pages понимает только `[env.production]` и `[env.preview]`):

| Блок | Для чего | D1 |
|---|---|---|
| верхний уровень | только локальная разработка (`wrangler pages dev`, `--local`) | `brasswood`, id-заглушка из нулей, она остаётся навсегда |
| `[env.production]` | деплой ветки `main` проекта `brasswood-test` | `brasswood-test`, **ЗАГЛУШКА → шаг 3** |
| `[env.preview]` | любые другие ветки этого же проекта | тот же `brasswood-test` |

`name = "brasswood-test"`: даже `wrangler pages deploy` без `--project-name` пойдёт только в тестовый проект.

## 1. Вход в Cloudflare (🔑, это делает пользователь)

**Вариант А, интерактивно** (откроется браузер, нужно подтвердить доступ):
```powershell
npx wrangler login
npx wrangler whoami          # ожидается: "You are logged in with an OAuth Token, associated with the email …" и Account ID
```

**Вариант Б, API-токен** (так команды может выполнять и ассистент, без вашего пароля):
1. Дашборд → My Profile → API Tokens → *Create Token* → *Create Custom Token*.
2. Permissions: **Account → D1 → Edit** и **Account → Cloudflare Pages → Edit**. Account Resources: *Include → только
   ваш аккаунт*. Срок действия (TTL) можно поставить 1–7 дней.
3. Account ID: дашборд → Workers & Pages → справа «Account ID» (или `npx wrangler whoami` после варианта А).
```powershell
$env:CLOUDFLARE_API_TOKEN  = "<токен>"
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"
npx wrangler whoami          # ожидается: "You are logged in with an User API Token" + нужный Account ID
```
Переменные живут только в текущем окне PowerShell. Токен не коммитьте и не кладите в `.dev.vars`.

### 1.1 Проверка перед созданием (🔑, только чтение)
```powershell
npx wrangler pages project list   # таблица проектов. Старый демо-проект будет в списке: НЕ трогаем.
npx wrangler d1 list              # список баз
```
**Стоп-условие:** если `brasswood-test` уже есть в одном из списков (например, это старый проект), дальше не
идём. Нужно выбрать другое имя и поменять его в `wrangler.toml`, `scripts/remote-config.mjs` и в этом файле.

## 2. Создать D1 `brasswood-test` (🔑, создаёт ресурс; на Free бесплатно, максимум 10 баз)
```powershell
npx wrangler d1 create brasswood-test --location enam
```
`--location enam` (восток Северной Америки) необязателен и подходит для магазина в America/New_York.
Если wrangler спросит *«Would you like Wrangler to add it on your behalf?»*, ответьте **No**: id впишем сами на шаге 3
(автодобавление записало бы базу на верхний уровень, то есть в локальный блок).
Ожидаемый вывод: `✅ Successfully created DB 'brasswood-test'` и фрагмент конфига с
`"database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`. **Скопируйте этот id.**

## 3. Вписать database_id (💻, обязательный шаг)
```powershell
npm run remote:set-db-id -- xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run remote:check
```
Ожидается `OK: wrangler.toml [env.production] and [env.preview] now use D1 brasswood-test = …`, затем
`OK: project "brasswood-test", D1 "brasswood-test" id … (production + preview)`.
Скрипт меняет только два удалённых блока, локальный верхний блок не трогает. Закоммитьте изменение:
`git commit -am "remote-test: set brasswood-test database_id"` (id не секрет).

## 4. Схема в удалённой базе (🔑 ⚠️ подтверждение)
```powershell
npx wrangler d1 migrations apply brasswood-test --remote --env production
```
Wrangler покажет список (`0001_init.sql`, `0002_data_versions.sql`) и спросит *«Ok to proceed?»*. Ответ **y**.
Перед применением он сам делает бэкап. Ожидается `0001_init.sql │ ✅` и `0002_data_versions.sql │ ✅`.
**Обе миграции обязательны:** 0002 создаёт однострочную таблицу счётчиков изменений `data_versions` (без триггеров:
счётчики увеличиваются в том же batch, что и запись) и индексы для поиска клиентов и диапазонов дат.
Без 0002 админка и публичные страницы не смогут проверять изменения, а `/api/health` покажет не `"schema":2`.
Если 0001 уже была применена раньше, команда применит только 0002. При повторном запуске выводится `No migrations to apply!`.

## 5. Базовые данные (🔑 ⚠️ может спросить подтверждение)
```powershell
npx wrangler d1 execute brasswood-test --remote --env production --file seed/seed.sql
```
Ожидается `🚣 Executed … queries` / `success: true`.
`seed/seed.sql` содержит **только** настройки вымышленного салона, 8 услуг, 3 вымышленных мастера и их часы.
**Клиентов и записей в нём нет.** Контакты заведомо вымышленные: телефон `(555) 555-0142` из резервного
«киношного» диапазона 555-01xx, адрес с пометкой «(fictional)», email на `brasswood.example` (зарезервированный
домен `.example`). Все операторы `INSERT OR IGNORE`, поэтому повторный запуск ничего не дублирует и не перезаписывает
(проверено локально: два прогона, счётчики те же).
**Никогда** не запускайте против remote `db:seed:demo:*` или `.wrangler/seed-demo.sql`: там демо-клиенты.

Проверка (🔑, только чтение):
```powershell
npx wrangler d1 execute brasswood-test --remote --env production --command "SELECT (SELECT count(*) FROM services) services, (SELECT count(*) FROM clients) clients, (SELECT count(*) FROM bookings) bookings"
```
Ожидается `services 8, clients 0, bookings 0`.

## 6. Создать Pages-проект (🔑, создаёт ресурс; на Free бесплатно)
```powershell
npx wrangler pages project create brasswood-test --production-branch main
```
Ожидается `✨ Successfully created the 'brasswood-test' project. It will be available at https://brasswood-test.pages.dev/ once you create your first deployment.`
Если поддомен `brasswood-test.pages.dev` уже занят кем-то другим, Cloudflare выдаст адрес с суффиксом.
Используйте адрес, который напечатает wrangler.

## 7. Секреты администратора (🔑, **это делает пользователь**: пароль знаете только вы)
Пароль должен быть длинным и уникальным, не короче 10 символов, и **не совпадать** с паролем из `.dev.vars`.
```powershell
npx wrangler pages secret put ADMIN_USERNAME --project-name brasswood-test   # введите, например: admin
npx wrangler pages secret put ADMIN_PASSWORD --project-name brasswood-test   # введите пароль (ввод скрыт)
npx wrangler pages secret list --project-name brasswood-test                 # видны ИМЕНА секретов, но не значения
```
Ожидается `✨ Success! Uploaded secret ADMIN_PASSWORD`.
- Секреты относятся к production-окружению проекта. Preview-деплои (не `main`) их не получат, и вход в админку
  там не заработает. Это нормально, мы деплоим только `main`.
- На бесплатном плане **используйте `ADMIN_PASSWORD`, а не `ADMIN_PASSWORD_HASH`**. PBKDF2 со 100 000 итераций может
  выйти за лимит CPU 10 мс на запрос в Workers Free и приводить к ошибкам входа.
- Если секрет меняется после деплоя, нужен повторный деплой (шаг 9): секреты применяются к новым деплоям.

## 8. Сборка и проверка бандла (💻)
```powershell
npm run remote:check         # должен быть OK (иначе стоп: заглушка не заменена)
npm run check:bundle         # build + сборка functions; в бандле нет пароля, DEMO_CREDENTIALS, 'admin/demo'
```
Ожидается, что все строки `PASS`, а в конце `OK`. Если хоть одна строка `FAIL`, **не деплоить**.

## 9. Деплой (🔑, публикует сайт по публичному адресу)
```powershell
npx wrangler pages deploy dist --project-name brasswood-test --branch main --commit-dirty=true
```
То же одной командой с обеими проверками: `npm run deploy:test`.
Ожидается `✨ Compiled Worker successfully`, затем `✨ Success! Uploaded N files`, затем
`✨ Deployment complete! Take a peek over at https://<hash>.brasswood-test.pages.dev`.
Ветка `main` совпадает с production-веткой, поэтому применяется `[env.production]`: D1 `brasswood-test` к
переменной `DB`. Файл `wrangler.toml` становится источником истины для настроек проекта: биндинги, которые
задали бы руками в дашборде, при деплое заменятся значениями из файла.

## 10. Проверка биндинга D1 (🔑 / браузер)
```powershell
curl.exe -s https://brasswood-test.pages.dev/api/health
```
Ожидается `{"ok":true,"db":"ok","seeded":true,"schema":2}`.
- `"schema"` меньше 2 или нет поля: не применена миграция 0002, повторите шаг 4.
- В ответе **не должно быть** `"testClock":true`. Переменную `TEST_CLOCK` нельзя задавать ни в `wrangler.toml`, ни в
  дашборде Cloudflare: она нужна только локальному тесту `e2e:tz` и позволяет подменять время сервера заголовком.
- `"D1 binding \"DB\" is missing"` означает, что биндинга нет. Дашборд → Workers & Pages → brasswood-test → Settings →
  Bindings: там должно быть **D1 database `DB` → `brasswood-test`** для Production.
- `"schema is missing"` означает, что не выполнен шаг 4. `"seeded":false` означает, что не выполнен шаг 5.

## 11. Автоматическая проверка (💻 + нужен пароль из шага 7)
```powershell
$env:BASE_URL       = "https://brasswood-test.pages.dev"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "<пароль из шага 7>"
npm run verify:remote
Remove-Item Env:ADMIN_PASSWORD
```
`scripts/verify-remote.mjs` по HTTP проверяет:
- `/api/health`, `"schema":2` и отсутствие `testClock`;
- счётчик изменений `/api/admin/changes` растёт после тестовой записи, а поиск по коду возвращает `canCancel`;
- 401 без cookie;
- **ровно одну** попытку с неверным паролем (блокировка IP включается после 5 неудачных за 15 минут, успешный вход
  сбрасывает счётчик);
- успешный вход и флаги cookie (HttpOnly, SameSite=Strict, Secure);
- запись из «браузера A» без cookie видна в админке из нового «браузера B», а слот исчезает из свободных;
- 10 параллельных записей на один слот дают ровно 1×201 и 9×409;
- перенос записи в занятый слот даёт 409;
- публичные эндпоинты не отдают имя, email, телефон и clientId.

Данные заведомо фейковые: `Test Verify`, `test+<timestamp>…@example.com`, `(555) 555-01xx`. В конце скрипт отменяет и
**удаляет** все свои записи и клиентов и закрывает свои сессии. Ожидается строка `N/N checks passed`, код выхода 0.
Один прогон делает около 50 запросов и примерно 150 записанных строк, это ничтожно мало относительно лимитов.
Если прогон оборвался посередине, остатки удаляются командой `npm run verify:remote -- --cleanup-only`.

### 11.1 Ручная проверка сохранности и доступа с разных браузеров
1. `npm run verify:remote -- --keep`: скрипт оставит **одну** тестовую запись и напечатает её код и время.
2. Закройте все окна браузера. Откройте **другой браузер** (или окно инкогнито, или телефон через мобильную сеть),
   зайдите на `https://brasswood-test.pages.dev/admin` и войдите. Запись «Test Verify» должна быть в расписании
   на указанную дату. Это и есть проверка, что данные лежат в D1, а не в браузере.
3. По желанию: на главной странице сделайте запись сами, используя имя «Test Verify» и `test+manual@example.com`,
   и найдите её через «Manage booking» по коду из другого браузера.
4. Уборка: `npm run verify:remote -- --cleanup-only` удаляет всех клиентов «Test Verify» с адресами
   `test+…@example.com` и их записи. Остальное удалите в админке (Bookings → Delete).

## 12. Откат и удаление

| Что | Команда / действие | Примечание |
|---|---|---|
| Вернуть прошлый деплой | Дашборд → brasswood-test → Deployments → нужный деплой → *Rollback to this deployment* | БД не меняется |
| Бэкап БД в файл | `npx wrangler d1 export brasswood-test --remote --env production --output brasswood-test-backup.sql` | 🔑, чтение. Файл может содержать персональные данные, не коммитьте его |
| Откат БД во времени | `npx wrangler d1 time-travel info brasswood-test --env production`, затем `npx wrangler d1 time-travel restore brasswood-test --env production --timestamp=<ISO/unix>` | 🔑 ⚠️ перезаписывает текущее состояние; Free хранит 7 дней |
| Удалить тестовый сайт | `npx wrangler pages project delete brasswood-test` | 🔑 ⚠️ необратимо, спросит подтверждение. **Проверьте имя**: только `brasswood-test` |
| Удалить тестовую БД | `npx wrangler d1 delete brasswood-test` | 🔑 ⚠️ необратимо (Time Travel тоже пропадёт). Только `brasswood-test` |
| Вернуть конфиг | `git checkout d1-backend -- wrangler.toml` или вручную поставить заглушку обратно | 💻 |
| Отозвать токен | My Profile → API Tokens → токен → *Delete* | после окончания работ |
| Выйти | `npx wrangler logout` | |

Старый демо-проект ни одна из этих команд не затрагивает, пока вы не подставите его имя сами.

## Лимиты и расход (Free), актуально на 23.10.2026

- Workers/Pages Functions: 100 000 запросов в сутки на аккаунт (общий лимит с Workers), 10 мс CPU на запрос.
  Статика бесплатна и без лимита. При превышении будет ошибка 1027, а не счёт.
- D1: 5 млн прочитанных строк в сутки, 100 тыс. записанных строк в сутки, 5 ГБ на аккаунт и 500 МБ на базу.
  При превышении запросы получают ошибку до 00:00 UTC.
- Pages: 500 сборок в месяц, 100 проектов. У новых аккаунтов в первые 48 часов действует ограничение на число проектов.

Оценка для теста: одна вкладка админки открыта 8 часов. Админка раз в 20 с (в простое раз в 60 с, на скрытой вкладке
никогда) делает **один** запрос `/api/admin/changes`, который читает 1 строку. Это не больше 1 440 запросов и
1 440 строк. Списки перечитываются только после реального изменения и только нужные (записи, клиенты или каталог).

| D1, строк в сутки (оценка) | 1 000 клиентов | 2 500 клиентов |
|---|---|---|
| Было: каждые 20 с дашборд перечитывал всё | ≈ 3,4 млн | ≈ 5,3 млн (выше лимита) |
| Было: открыта страница Clients | ≈ 10 млн | > 20 млн |
| Стало: дашборд (1,4 тыс. проверок и ~80 изменений × ~2,4 тыс. строк) | ≈ 0,2 млн | ≈ 0,2 млн |
| Стало: Clients, сортировка Recent/Top spend (~80 × все записи и клиенты) | ≈ 0,6 млн | ≈ 1,4 млн |
| Стало: Clients, A–Z или поиск (50 строк на страницу) | < 0,05 млн | < 0,05 млн |

Предположения: около 80 изменений в сутки, около 1,2 тыс. записей в 41-дневном окне дашборда, около 6 записей на
клиента за всё время. Публичные страницы тоже проверяют `/api/changes`, это 1 строка раз в 20 с на открытую вкладку.
Реальные цифры смотрите после запуска: Cloudflare → D1 → brasswood-test → Metrics (Rows read).

Источники:
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/pages/functions/pricing/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
