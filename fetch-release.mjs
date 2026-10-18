#!/usr/bin/env node
/**
 * fetch-release.mjs — забирает файлы сборок из релиза GitHub в `downloads/`.
 *
 * Зачем: репозиторий с релизами закрытый, поэтому браузер по прямой ссылке на файл
 * получает 404. Скрипт идёт в API с токеном, находит нужный релиз и кладёт файлы
 * туда, откуда их раздаёт сайт — в `downloads/<система>/`. Имена и папки совпадают
 * с `content/site.mjs`, поэтому переименовывать ничего не нужно.
 *
 * Токен: `GITHUB_TOKEN`, `GH_TOKEN` или файл `.github-token` в корне проекта
 * (он в `.gitignore`). Достаточно токена на чтение репозитория (Contents: read).
 * Без токена скачается только публичный релиз, приватный ответит 404.
 *
 * Запуск:
 *   node fetch-release.mjs                    # файлы текущей версии
 *   node fetch-release.mjs --tag=v0.3.46      # другой тег
 *   node fetch-release.mjs --dry              # показать план и выйти
 *   node fetch-release.mjs --force            # перекачать уже скачанное
 *   node fetch-release.mjs --all --dest=/tmp  # все файлы релиза куда угодно
 *
 * Код возврата: 0 — всё на месте, 1 — чего-то не хватило (что именно — в конце).
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { downloads } from "./content/site.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Репозиторий с релизами. Меняется флагом `--repo=владелец/имя`. */
const DEFAULT_REPO = "Saintdizen/chui_ide";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback = null) => {
    const hit = argv.find((item) => item.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
};

if (flag("help") || flag("h")) {
    console.log(`fetch-release.mjs — файлы сборок из релиза GitHub в downloads/

  --tag=<тег>             какой релиз брать (по умолчанию v<версия из readme.json>)
  --repo=<владелец/имя>   репозиторий с релизом (по умолчанию ${DEFAULT_REPO})
  --all                   скачать все файлы релиза, а не только из content/site.mjs
  --only=<маска>          только файлы, в имени которых есть эта подстрока
  --dest=<папка>          куда складывать (по умолчанию downloads/)
  --force                 перекачать файлы, которые уже лежат на диске
  --dry                   показать план и выйти

Токен: GITHUB_TOKEN, GH_TOKEN или файл .github-token в корне проекта.`);
    process.exit(0);
}

const REPO = option("repo", process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO);
const DRY = flag("dry");
const FORCE = flag("force");
const ALL = flag("all");
/** Маска имени файла: скачать только нужное, например `--only=deb`. */
const ONLY = option("only", null);
/** Куда складывать: по умолчанию `downloads/` — папка, которую раздаёт сайт. */
const DEST = path.resolve(ROOT, option("dest", "downloads"));

/** Версия сайта — из неё получается тег по умолчанию. */
function siteVersion() {
    try {
        return JSON.parse(readFileSync(path.join(ROOT, "content", "guide", "readme.json"), "utf8")).version;
    } catch {
        return null;
    }
}

const version = siteVersion();
const TAG = option("tag", version ? `v${version}` : null);
if (!TAG) {
    console.error("fetch-release: не знаю, какой тег брать — укажите --tag= или запустите `npm run sync`.");
    process.exit(1);
}

/** Токен: окружение или файл рядом со скриптом — файл удобнее, токен не попадает в историю шелла. */
function token() {
    for (const name of ["GITHUB_TOKEN", "GH_TOKEN"]) {
        if (process.env[name]) return { value: process.env[name].trim(), from: name };
    }
    const file = path.join(ROOT, ".github-token");
    if (existsSync(file)) return { value: readFileSync(file, "utf8").trim(), from: ".github-token" };
    return { value: null, from: null };
}

const auth = token();
const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "chui_iDE-site-fetch-release",
};
if (auth.value) headers.Authorization = `Bearer ${auth.value}`;

/** Ответ API с понятной ошибкой вместо стектрейса: чаще всего дело в токене или имени репозитория. */
async function api(url) {
    const response = await fetch(url, { headers, redirect: "follow" });
    if (response.ok) return response.json();

    if (response.status === 404) {
        console.error(`fetch-release: ${REPO} или релиз ${TAG} не найден (404).`);
        console.error(
            auth.value
                ? "  Токен есть, но доступа к репозиторию нет — проверьте права (Contents: read)."
                : "  Похоже, репозиторий закрытый: добавьте токен в GITHUB_TOKEN или в файл .github-token."
        );
    } else if (response.status === 401) {
        console.error("fetch-release: токен не принят (401) — истёк или скопирован с ошибкой.");
    } else {
        console.error(`fetch-release: GitHub ответил ${response.status} ${response.statusText}.`);
    }
    process.exit(1);
}

/** Путь для печати: внутри проекта — относительный, снаружи — абсолютный. */
function where(target) {
    const relative = path.relative(ROOT, target);
    return relative.startsWith("..") ? target : relative;
}

/** «115 МБ» — та же подпись, что на карточке сайта. */
function sizeText(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} Б`;
    const megabytes = bytes / (1024 * 1024);
    return megabytes >= 1 ? `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
}

/**
 * Адрес файла в приватном релизе. `browser_download_url` — ссылка для браузера: с токеном
 * в заголовке она отвечает 404 (её принимает только сессия на сайте GitHub). Поэтому идём
 * в API ассета, просим байты (`Accept: application/octet-stream`) и получаем 302 на
 * хранилище — туда уже без заголовка авторизации: подписанная ссылка сама себе разрешение.
 */
async function open(asset) {
    const response = await fetch(asset.url, {
        headers: { ...headers, Accept: "application/octet-stream" },
        redirect: "manual",
    });

    /* Ответ 200 — GitHub отдал файл потоком; 302 — уводит на хранилище. */
    if (response.status === 200 && response.body) return response;
    if (response.status !== 302) throw new Error(`ответ ${response.status} ${response.statusText}`);

    const location = response.headers.get("location");
    if (!location) throw new Error("302 без адреса хранилища");

    const signed = await fetch(location, { headers: { "User-Agent": headers["User-Agent"] } });
    if (!signed.ok || !signed.body) throw new Error(`хранилище ответило ${signed.status}`);
    return signed;
}

/** Скачивание с прогрессом: файлы по сотне мегабайт, без счётчика непонятно, идёт ли загрузка. */
async function download(asset, target, expectedSize) {
    mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.part`;
    const response = await open(asset);

    let received = 0;
    let printedAt = 0;
    const name = path.basename(target);
    const progress = new Transform({
        transform(chunk, _encoding, done) {
            received += chunk.length;
            const now = Date.now();
            /* Перерисовываем не чаще пяти раз в секунду — иначе терминал захлёбывается. */
            if (now - printedAt > 200) {
                printedAt = now;
                const share = expectedSize ? Math.round((received / expectedSize) * 100) : null;
                const tail = expectedSize ? ` из ${sizeText(expectedSize)} · ${share}%` : "";
                process.stdout.write(`\r  ${name}: ${sizeText(received)}${tail}   `);
            }
            done(null, chunk);
        },
    });

    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(tmp));
    process.stdout.write("\r");
    renameSync(tmp, target);
    return statSync(target).size;
}

/** Куда положить файл из `--all`: по имени видно систему, иначе — в корень папки.
 *  macOS проверяется раньше Windows: в `apple-darwin` есть подстрока `win`, и без этого
 *  маковский архив уезжал в папку windows. */
function guessDest(name) {
    if (/darwin|macos|osx|\.dmg$|(^|[-_.])mac([-_.]|$)/i.test(name)) return path.join(DEST, "mac", name);
    if (/(^|[-_.])win(dows|32|64)?([-_.]|$)|\.exe$|\.msi$/i.test(name)) return path.join(DEST, "windows", name);
    if (/linux|\.deb$|appimage/i.test(name)) return path.join(DEST, "linux", name);
    return path.join(DEST, name);
}

/* ── план ────────────────────────────────────────────────────────────────── */

const release = await api(`https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(TAG)}`);
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));

console.log(
    `fetch-release: ${REPO}, релиз ${release.tag_name}${release.prerelease ? " (предварительный)" : ""}` +
        ` — файлов ${release.assets.length}${auth.value ? `, токен из ${auth.from}` : ", без токена"}`
);

/* Обычный режим берёт только то, что названо на сайте: чужой файл из релиза тут
   не нужен, а папка и имя уже известны. `--all` забирает релиз целиком. */
const plan = ALL
    ? release.assets.map((asset) => ({ name: asset.name, target: guessDest(asset.name) }))
    : downloads.flatMap((item) =>
          (item.files ?? [])
              .filter((file) => file.path)
              .map((file) => ({ name: path.basename(file.path), target: path.join(DEST, file.path) }))
      );

if (!plan.length) {
    console.error("fetch-release: в content/site.mjs нет файлов с `path` — скачивать нечего.");
    process.exit(1);
}

const missing = [];
const queue = [];

for (const item of plan) {
    if (ONLY && !item.name.includes(ONLY)) continue;
    const asset = assets.get(item.name);
    if (!asset) {
        missing.push(item.name);
        continue;
    }
    /* Размер сошёлся — файл уже скачан целиком: качать полгигабайта заново незачем. */
    const done = existsSync(item.target) && statSync(item.target).size === asset.size && !FORCE;
    queue.push({ ...item, asset, done });
}

for (const item of queue) {
    const state = item.done ? "уже на месте" : DRY ? "будет скачан" : "качаю";
    console.log(`  ${item.name} — ${sizeText(item.asset.size)}, ${state} → ${where(item.target)}`);
}
for (const name of missing) console.warn(`  ! ${name} — в релизе такого файла нет`);

if (DRY) {
    console.log("fetch-release: это был --dry, ничего не скачано.");
    process.exit(missing.length ? 1 : 0);
}

/* ── скачивание ──────────────────────────────────────────────────────────── */

const failed = [];

for (const item of queue) {
    if (item.done) continue;
    try {
        const size = await download(item.asset, item.target, item.asset.size);
        if (size !== item.asset.size) {
            throw new Error(`размер не совпал: ${size} вместо ${item.asset.size} байт`);
        }
        console.log(`  ${item.name} → ${where(item.target)} (${sizeText(size)})`);
    } catch (error) {
        failed.push(`${item.name}: ${error.message}`);
        rmSync(`${item.target}.part`, { force: true });
    }
}

/* ── итог ────────────────────────────────────────────────────────────────── */

if (missing.length || failed.length) {
    for (const message of failed) console.error(`✗ ${message}`);
    console.error(
        `fetch-release: не всё скачано — нет в релизе: ${missing.length}, ошибок: ${failed.length}.\n` +
            "  Если файлы называются иначе, поправьте `path` в content/site.mjs или запустите с --all."
    );
    process.exit(1);
}

const fresh = queue.filter((item) => !item.done).length;
console.log(
    `fetch-release: готово — ${fresh} скачано, ${queue.length - fresh} уже было. ` +
        `Файлы в ${where(DEST)}/, сайт раздаёт их после перезапуска: npm start.`
);
