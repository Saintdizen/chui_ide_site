# Сайт chui_iDE

Сайт приложения chui_iDE — редактора кода для Python и Node.js со встроенным
ассистентом. Две части: главная страница с обзором и скачиванием и руководство,
собранное из README приложения.

Сайт — приложение на **Express**: страницы собираются из `content/` при запуске и живут
в памяти, готовых HTML-файлов в репозитории нет. Внешних ресурсов тоже нет: ни шрифтов,
ни скриптов с чужих адресов, ни сборки на клиенте.

## Запуск

```bash
npm install        # express, compression, markdown-it, prettier
npm run sync       # забрать README приложения в content/guide/
npm start          # http://localhost:9091
npm run dev        # то же, но с перезапуском на правку файлов
npm run check      # форматирование и проверка ссылок
```

При первом запуске сервер спрашивает GitHub о последнем релизе и создаёт кэш
`content/release.json`. Без сети (или при недоступном `api.github.com`) карточки на
главной покажут «скоро», а в консоли будет причина — см. «Скачивание».

| Переменная     | Что задаёт                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| `PORT`         | порт (по умолчанию `9091`)                                                   |
| `HOST`         | адрес прослушивания (по умолчанию `0.0.0.0`)                                 |
| `CHUI_IDE_DIR` | где искать приложение для `npm run sync`                                     |
| `RELEASE_TTL`  | сколько миллисекунд держать кэш релиза (по умолчанию `900000` — 15 минут)    |
| `GITHUB_TOKEN` | токен, если релиз в закрытом репозитории (достаточно права `Contents: read`) |

`npm run sync` ищет приложение по порядку: `CHUI_IDE_DIR`, `../../GITHUB/chui_ide`,
`../chui_ide`.

Правка `content/*.mjs`, `lib/site.mjs`, `server.mjs` или README приложения видна после
перезапуска (`npm start` или `npm run dev`). Оформление и скрипты подхватываются сразу:
ссылки на них несут `?v=<время правки>`, поэтому браузер не берёт старую версию из кэша.

## Маршруты

| Адрес                  | Что отдаёт                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `GET /`                | главная: обзор, возможности, снимки, скачивание                            |
| `GET /guide`           | оглавление руководства                                                     |
| `GET /guide/:slug`     | раздел руководства                                                         |
| `GET /search-index.js` | индекс поиска для поля в шапке                                             |
| `GET /assets/*`        | оформление, значок и снимки из `src/`                                      |
| `GET /downloads/*`     | файлы сборок из `downloads/`, с `Content-Disposition: attachment`          |
| `GET /healthz`         | состояние: `{ ok, version, pages, downloads }`; `downloads` — число ссылок |

Старые адреса (`/guide/editor.html`, `/guide/editor/`) отвечают 301 на новый. Неизвестный
адрес — страница 404 с поиском в шапке и ссылками на главную и руководство.

## Из чего состоит

| Путь                        | Что это                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `server.mjs`                | Express: маршруты, статика, заголовки кэша, 404, обработка ошибок               |
| `lib/site.mjs`              | данные и разметка: README → страницы, шаблоны, карточки, поисковый индекс       |
| `lib/release.mjs`           | последний релиз GitHub: файлы сборок, размеры, кэш `content/release.json`       |
| `content/site.mjs`          | системы для скачивания, порядок и адреса разделов руководства                   |
| `content/landing.mjs`       | тексты главной: обзор, карточки возможностей, требования, ограничения           |
| `content/guide/readme.md`   | копия README приложения; обновляется `npm run sync`, руками не правится         |
| `content/guide/readme.json` | версия и хеш копии README; номер — в подвале и на страницах руководства         |
| `src/style.css`             | оформление: палитра приложения как есть, схема одна — тёмная                    |
| `src/site.js`               | меню, поиск по руководству, оглавление, прогресс чтения, копирование примеров   |
| `src/icon.png`              | значок приложения                                                               |
| `src/shots/`                | снимки окна для главной (`editor.png`, `assistant.png`)                         |
| `downloads/`                | файлы сборок для локальной раздачи, если у файла указан `path` (в git не лежат) |
| `scripts/sync-readme.mjs`   | забирает README приложения и его версию в `content/guide/`                      |
| `scripts/check.mjs`         | рендерит те же страницы и проверяет ссылки, якоря, id и файлы                   |
| `scripts/_shot.cjs`         | съёмка снимков окна приложения (разовый скрипт, см. ниже)                       |

## Как что-то поправить

- **Текст на главной** — `content/landing.mjs`, перезапуск.
- **Скачивание** — само: файлы, ссылки и размеры приходят из последнего релиза
  GitHub при запуске (см. ниже). В `content/site.mjs` — только системы, порядок
  форматов и пояснение под карточкой. Новый релиз — перезапуск, больше ничего.
- **Руководство** — правится в README приложения, а не здесь: после правки
  `npm run sync`, иначе сайт и приложение разойдутся.
- **Оформление** — `src/style.css`. Палитра взята из токенов приложения
  (`src/renderer/styles/theme.css`) и повторена как есть: поверхности, ступени текста,
  линии, заливки контролов, акценты и подсветка кода (`core/theme.ts`). У приложения
  схема одна — тёмная, и у сайта тоже: светлой темы и переключателя нет.
  Меняете палитру в приложении — поправьте и здесь.
- **Разметка страницы** — `lib/site.mjs`: шапка, подвал, главная, страницы руководства
  и 404 собираются там. Данные отдельно — в `content/`.

## Скачивание

Сборки публикуются релизом в этот же репозиторий: код приложения закрыт, а готовые файлы
открыты. Сайт не хранит их адреса — он спрашивает GitHub о последнем релизе
(`GET /repos/Saintdizen/chui_ide_site/releases/latest`), берёт из ответа имена файлов,
ссылки и размеры и раскладывает по системам. Новая версия — перезапуск, и всё:
править код не нужно, имена файлов собираются из тега релиза.

Что нужно, чтобы новый ассет попал на карточку: имя по шаблону
`chui_iDE-<версия>-<система>-<архитектура>.<формат>`, например
`chui_iDE-0.3.46-linux-amd64.deb`. Система — `linux`, `win`/`windows`, `mac`/`darwin`;
формат — `AppImage`, `deb`, `rpm`, `exe`, `msi`, `dmg`, `pkg`. Остальное (`latest.yml`,
`*.blockmap`, `builder-debug.yml`) сайт пропускает. Система, которой нет в
`content/site.mjs` → `release.os`, на главную не попадёт, а новый формат встанет в конец
своего списка.

Ответ API кладётся в `content/release.json` (в git не попадает). Кэш живёт 15 минут
(`RELEASE_TTL`): `npm run dev` с перезапуском на правку не выберет лимит анонимных
запросов GitHub (60 в час), а новый релиз появляется на сайте после ближайшего
перезапуска. Если GitHub не ответил, берётся старый кэш — ссылки работают, пока живёт
их тег; `npm run check` пишет о просроченном кэше строкой `!`. Совсем нет ни сети,
ни кэша — карточки покажут «скоро» и положат в консоль причину.

Версия в шапке сайта и в заголовке «Скачать» — из того же релиза, а руководство и подпись
в подвале — от версии в `content/guide/readme.json`. Если они разошлись, `npm run check`
скажет об этом строкой `!`: README отстал — нужен `npm run sync`, а если README впереди
релиза — сборка ещё не выпущена, и руководство на сайте забегает вперёд кнопок.

Вместо ссылки можно отдать файл с самого сайта: укажите в `content/site.mjs` вместо `url`
поле `path` и положи файл в `downloads/<система>/`. Сервер отдаст его по `/downloads/…`
с `Content-Disposition: attachment` и докачкой по `Range`; в git эти файлы не попадают.
Готовность считается по диску: файла нет — строка покажет «скоро» без ссылки.

## Снимки окна

Картинки на главной сняты с живого окна приложения, а не собраны из макетов.
Переснять — из папки приложения (там есть `electron` и собранный `dist/`):

```bash
cd ../chui_ide
npx electron --no-sandbox ../chui_ide_site/scripts/_shot.cjs editor.png wide
npx electron --no-sandbox ../chui_ide_site/scripts/_shot.cjs assistant.png panel
```

Первый кадр — без правой панели (редактор во всю ширину), второй — как окно открывается
само, с панелью ассистента. Скрипт поднимает настоящее окно с демонстрационным проектом
(он в `scripts/_demo.cjs`), раскрывает дерево, открывает файлы и кладёт PNG в `src/shots/`.
Имена и подписи снимков — в `content/site.mjs`.

## Как устроено руководство

README приложения режется по заголовкам второго уровня: `## Редактор` — это страница
`/guide/editor`. Заголовок и адрес страницы связаны таблицей `guide.slugs` в
`content/site.mjs`; раздел, которого в таблице нет, получит адрес сам, а сервер при
запуске скажет об этом предупреждением.

Абзацы с полужирным зачином («**Работа с файлами.** Ввод `a/b/c.txt` создаёт…») становятся
заголовками второго уровня внутри страницы: из них собирается оглавление раздела и точки
для поиска. Без этого у длинных страниц не было бы ни навигации, ни поиска по подразделам.
Раздел почти целиком из пунктов списка («Безопасность», «Ограничения версии») показывается
карточками — стена строк читалась бы хуже.

Адрес страницы — без `.html`: `/guide/editor`. Поисковый индекс (`/search-index.js`)
собирается из тех же страниц и их подразделов.

## Проверка

`npm run check` = prettier + `scripts/check.mjs`. Сервер не поднимается: скрипт рендерит
те же страницы, что отдаёт `server.mjs`, и проверяет то, чего не видно глазами:

- каждая внутренняя ссылка ведёт на существующую страницу, а якорь — на существующий id;
- картинки и файлы из `src/` на месте;
- id на странице не повторяются;
- у каждого раздела руководства есть страница, адреса (`slugs`) не совпадают;
- каждая страница попала в поисковый индекс;
- у каждого файла сборки есть `url` или `path`, ссылка на релиз ведёт на ту же версию,
  что названа на сайте, а у внешней — https и расширение файла; дубли ссылок ловятся.

Сеть `npm run check` не трогает: данные о релизе он берёт из кэша (или из того, что
удалось спросить при импорте). Поэтому ссылка на удалённый тег проверкой не ловится —
только разворотом сайта после обновления релиза.

Отсутствующий локальный файл сборки — предупреждение (`!`), а не ошибка: на сайте такая
строка показана как «скоро». Ненулевой код возврата означает, что на сайте будет битая
ссылка, и публиковать такое не стоит. Просроченный кэш релиза и расхождение версии
релиза с `readme.json` — тоже предупреждения, а не ошибки.

## Кэш и заголовки

| Что                      | Заголовки                                                                    |
| ------------------------ | ---------------------------------------------------------------------------- |
| HTML                     | `Cache-Control: max-age=0, must-revalidate` + `ETag` (304, если не менялось) |
| `/assets/*`              | `max-age=365d, immutable`; ссылки несут `?v=<время правки>`                  |
| `/downloads/*`           | `max-age=365d, immutable`, `attachment`, `Accept-Ranges` (докачка)           |
| HTML, `/search-index.js` | сжимаются `compression` (gzip, от 1 КБ); сборки не сжимаются                 |

## Публикация

Сайту нужен **Node.js 20** или новее — статикой он больше не публикуется: страницы
собираются при запуске. Схема — Node-процесс на `127.0.0.1:9091` за nginx, HTTPS —
через Let's Encrypt. Ниже пример для Ubuntu 22.04/24.04 и домена `chuichat.ru`;
пути замените на свои.

### 1. DNS

У регистратора домена — A-записи на IP сервера:

| Тип | Имя   | Значение |
| --- | ----- | -------- |
| A   | `@`   | IP VPS   |
| A   | `www` | IP VPS   |

`dig +short chuichat.ru` должен вернуть этот адрес до выдачи сертификата: certbot
проверяет домен по DNS и по HTTP.

### 2. Что поставить

```bash
sudo apt update && sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v                       # нужно 20 или новее: в коде fetch и top-level await
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full'
```

### 3. Код и зависимости

```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/Saintdizen/chui_ide_site.git
cd chui_ide_site
sudo npm ci --omit=dev        # prettier нужен только для npm run check на своей машине
```

Отдельно качать ничего не нужно: сборки лежат на GitHub Releases, а `content/guide/`
и кэш релиза обновляются сами при старте. Папка `downloads/` нужна, только если
какой-то файл раздаётся с сайта (`path` вместо `url` в `content/site.mjs`) — в git она
не попадает.

Проверка до systemd:

```bash
PORT=9091 HOST=127.0.0.1 node server.mjs
curl -s localhost:9091/healthz   # {"ok":true,"version":"…","pages":…}
```

Если в логе `! последнего релиза нет …` — сервер не достучался до `api.github.com`:
проверьте исходящую сеть. Строка `! последний релиз — v…, а README скопирован от …`
значит, что копию README пора обновить командой `npm run sync`.

### 4. systemd

`/etc/systemd/system/chui-site.service`:

```ini
[Unit]
Description=chui_iDE site
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/chui_ide_site
ExecStart=/usr/bin/node server.mjs
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=9091
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

`HOST=127.0.0.1` обязателен: по умолчанию сервер слушает `0.0.0.0`, и порт был бы
открыт наружу мимо nginx. Писать процессу нужно только кэш релиза:

```bash
sudo chown -R www-data:www-data /var/www/chui_ide_site/content
sudo systemctl daemon-reload && sudo systemctl enable --now chui-site
sudo systemctl status chui-site --no-pager
```

### 5. nginx

`/etc/nginx/sites-available/chuichat.ru`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name chuichat.ru www.chuichat.ru;

    location / {
        proxy_pass http://127.0.0.1:9091;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;   # не съедать Range при докачке из /downloads
        gzip off;                       # сжатие делает compression в самом Node
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/chuichat.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 6. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d chuichat.ru -d www.chuichat.ru
```

Certbot сам добавит `listen 443 ssl`, сертификат и редирект с http; продление —
таймер `certbot.timer` (`sudo certbot renew --dry-run` для проверки). Один адрес
канонический выбираете вы: без `return 301` на `chuichat.ru` оба имени отдают один
и тот же сайт.

### 7. Обновление сайта

```bash
cd /var/www/chui_ide_site
sudo git pull
sudo npm ci --omit=dev
sudo systemctl restart chui-site
```

Перезапуск обязателен для `content/*.mjs`, `lib/*` и `server.mjs`; `src/style.css`
и `src/site.js` подхватываются без него — ссылки на них несут `?v=<время правки>`.
После смены релиза ничего делать не нужно: новый тег возьмётся при старте, когда кэшу
исполнится 15 минут (`RELEASE_TTL`). Заставить немедленно — `sudo rm content/release.json`
и `sudo systemctl restart chui-site`.

### 8. Приёмка

```bash
curl -s  https://chuichat.ru/healthz
curl -sI https://chuichat.ru/ | head -1
curl -sI https://chuichat.ru/guide/editor.html | grep -i location  # 301 → /guide/editor
curl -s  https://chuichat.ru/ | grep -c 'releases/download/'       # число ссылок на сборки
```

Ожидаемо: `{"ok":true,…}`, `200`, редирект со старого адреса и столько же ссылок,
сколько файлов в последнем релизе.
