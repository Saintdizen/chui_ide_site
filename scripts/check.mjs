/**
 * scripts/check.mjs — проверка сайта без запуска сервера.
 *
 * Сайт собирается на лету, поэтому проверять нечего «на диске»: скрипт рендерит
 * те же страницы, что отдаёт `server.mjs`, и смотрит, не ведут ли ссылки в пустоту.
 * Ловится то, чего не видно глазами: битый якорь, ссылка на удалённый раздел,
 * повторяющийся id, пропавший снимок или файл сборки.
 *
 * Запуск: npm run check (заодно проверяет форматирование).
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
    DOWNLOADS_DIR,
    SRC,
    downloadCards,
    missingDownloads,
    pages,
    searchIndexScript,
    siteRoutes,
    version,
    warnings,
} from "../lib/site.mjs";

const failures = [];

const routes = siteRoutes();
const idsByRoute = new Map();

/* ── id на страницах ─────────────────────────────────────────────────────── */

for (const [route, html] of routes) {
    const ids = new Set();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
        if (ids.has(match[1])) failures.push(`${route}: повторяется id «${match[1]}»`);
        ids.add(match[1]);
    }
    idsByRoute.set(route, ids);
}

/* ── ссылки и файлы ──────────────────────────────────────────────────────── */

/** Файл, который отдаёт `express.static`: адрес → путь на диске. */
const staticFile = (url) => {
    if (url.startsWith("/assets/")) return path.join(SRC, url.slice("/assets/".length));
    if (url.startsWith("/downloads/")) return path.join(DOWNLOADS_DIR, url.slice("/downloads/".length));
    return null;
};

let linkCount = 0;

for (const [route, html] of routes) {
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = match[1];
        linkCount += 1;

        if (/^(https?:|mailto:|data:)/.test(target)) continue;

        if (target.startsWith("#")) {
            if (target.length > 1 && !idsByRoute.get(route)?.has(target.slice(1))) {
                failures.push(`${route}: якорь «${target}» никуда не ведёт`);
            }
            continue;
        }

        /* `?v=…` — версия файла оформления, для проверки она не важна. */
        const [cleanTarget, hash] = target.split("#");
        const routePart = cleanTarget.split("?")[0];
        const file = staticFile(routePart);

        if (file) {
            if (!existsSync(file))
                failures.push(`${route}: ссылка «${target}» — файла ${path.relative(process.cwd(), file)} нет`);
            continue;
        }

        if (routePart === "/search-index.js") continue;

        if (!routes.has(routePart)) {
            failures.push(`${route}: ссылка «${target}» — такой страницы нет`);
            continue;
        }

        if (hash && !idsByRoute.get(routePart)?.has(hash)) {
            failures.push(`${route}: ссылка «${target}» — якоря «${hash}» на странице нет`);
        }
    }
}

/* ── данные ──────────────────────────────────────────────────────────────── */

if (pages.length !== new Set(pages.map((page) => page.slug)).size) {
    failures.push("два раздела руководства получили один адрес — проверьте guide.slugs");
}

/* Ссылки на сборки: внешние — проверяем, что это https-адрес файла; локальные —
   что файл на месте. Ссылка в пустоту на главной заметнее всего, её ловим здесь. */
for (const card of downloadCards) {
    for (const item of card.files) {
        if (!item.url && !item.path) {
            failures.push(`${card.os}: у файла «${item.format}» нет ни url, ни path — кнопка ведёт в пустоту`);
            continue;
        }
        if (!item.external) continue;
        if (!/^https:\/\/\S+\/\S+\.[a-z0-9]+$/i.test(item.url)) {
            failures.push(`${card.os}: ссылка «${item.url}» — не похожа на адрес файла (нужен https и расширение)`);
            continue;
        }
        /* Ссылка на релиз должна вести на ту же версию, что названа на сайте:
           иначе в шапке «Версия 0.3.46», а кнопка качает файл 0.3.45. */
        if (item.url.includes("/releases/download/") && !item.url.includes(`/download/v${version}/`)) {
            failures.push(`${card.os}: ссылка «${item.url}» — не релиз v${version}, хотя на сайте эта версия`);
        }
    }
}

/* Заявленные, но ещё не залитые файлы — предупреждение, а не ошибка: сайт на них не
   ссылается (строка показывает «скоро»), значит публиковать можно. */
for (const item of missingDownloads) {
    warnings.push(`${item.os}: файла downloads/${item.path} нет — на карточке «скоро»`);
}

/* Два одинаковых адреса в карточках — почти всегда копипаст чужой строки. */
const seenLinks = new Map();
for (const card of downloadCards) {
    for (const item of card.files) {
        const link = item.url ?? item.path;
        const previous = seenLinks.get(link);
        if (previous) failures.push(`${card.os}: ссылка дублирует ${previous} — проверьте content/site.mjs`);
        else seenLinks.set(link, card.os);
    }
}

/* Индекс поиска должен содержать все страницы: иначе раздел не находится поиском. */
const indexEntries = [...searchIndexScript.matchAll(/"u":"([^"]+)"/g)].map((match) => match[1]);
for (const page of pages) {
    if (!indexEntries.includes(page.url)) failures.push(`${page.url}: страницы нет в поисковом индексе`);
}

/* ── итог ────────────────────────────────────────────────────────────────── */

for (const message of warnings) console.warn(`! ${message}`);

if (failures.length) {
    for (const message of failures) console.error(`✗ ${message}`);
    console.error(`check: ${failures.length} замечаний — публиковать такое не стоит.`);
    process.exit(1);
}

const downloadLinkCount = downloadCards.reduce((sum, card) => sum + card.files.length, 0);
console.log(
    `check: страниц ${routes.size}, ссылок ${linkCount}, ссылок на сборки ${downloadLinkCount} — всё на месте.`
);
