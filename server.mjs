/**
 * server.mjs — сайт chui_iDE на Express.
 *
 * Страницы собираются из `content/` при запуске (см. `lib/site.mjs`) и живут
 * в памяти: между запросами они не меняются, а README приложения обновляется
 * командой `npm run sync` — после неё сервер перезапускается.
 *
 * Что отдаёт сервер:
 *   • `/`                 — главная: обзор, возможности, снимки, скачивание;
 *   • `/guide`            — оглавление руководства;
 *   • `/guide/:slug`      — раздел руководства;
 *   • `/search-index.js`  — индекс поиска для поля в шапке;
 *   • `/assets/*`         — оформление, значок и снимки из `src/`;
 *   • `/downloads/*`      — файлы сборок из `downloads/` (в git их нет).
 *
 * Запуск: npm start (или `npm run dev` — с перезапуском на правку).
 */

import path from "node:path";

import compression from "compression";
import express from "express";

import {
    DOWNLOADS_DIR,
    ROOT,
    SRC,
    assetVersion,
    downloadCards,
    meta,
    pages,
    renderNotFound,
    searchIndexScript,
    siteRoutes,
    warnings,
} from "./lib/site.mjs";

/** Порт по умолчанию — 9091; переопределяется переменной `PORT` (например на хостинге). */
const PORT = Number(process.env.PORT ?? 9091);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = express();
app.disable("x-powered-by");
app.use(compression());

/** Страницы собираются один раз: рендер двадцати разделов дешевле любого кэша. */
const routes = siteRoutes();

/** Адреса в старом виде (`/guide/editor.html`, `/guide/`) ведут на новый —
 *  без файла в пути: у страницы один адрес, и он не зависит от того, как её открыли. */
app.use((req, res, next) => {
    const url = req.path;
    if (url.length > 1 && url.endsWith("/")) return res.redirect(301, url.replace(/\/+$/, ""));
    if (url.endsWith(".html")) return res.redirect(301, url.slice(0, -".html".length) || "/");
    next();
});

app.use((req, res, next) => {
    const html = routes.get(req.path.replace(/\/+$/, "") || "/");
    if (!html) return next();
    /* `no-cache` без запрета хранения: браузер спрашивает «не изменилось ли»
       и получает 304 по ETag — страница не мигает, а правки видны сразу. */
    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    res.type("html").send(html.replaceAll("__ASSET_VERSION__", assetVersion()));
});

app.get("/search-index.js", (_req, res) => {
    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    res.type("application/javascript").send(searchIndexScript);
});

app.use(
    "/assets",
    express.static(SRC, {
        index: false,
        etag: true,
        /* Оформление и снимки меняются только вместе с файлом, а ссылки несут `?v=` —
           можно отдавать надолго и не спрашивать сервер заново. */
        maxAge: "365d",
        immutable: true,
        setHeaders(res) {
            res.set("X-Content-Type-Options", "nosniff");
        },
    })
);

/* Сборки не отдаём как страницу: браузер должен сохранять файл, а не открывать
   его. Имена содержат версию, поэтому кэш можно держать долго. */
app.use(
    "/downloads",
    express.static(DOWNLOADS_DIR, {
        index: false,
        maxAge: "365d",
        immutable: true,
        setHeaders(res, file) {
            res.set("Content-Disposition", `attachment; filename="${path.basename(file)}"`);
        },
    })
);

app.get("/healthz", (_req, res) => {
    res.json({
        ok: true,
        version: meta.version,
        pages: pages.length,
        downloads: downloadCards.reduce((sum, card) => sum + card.files.length, 0),
    });
});

app.use((req, res) => {
    res.status(404).type("html").send(renderNotFound(req.path));
});

app.use((error, _req, res, _next) => {
    console.error("server:", error);
    res.status(500).type("text/plain").send("На сервере что-то сломалось — попробуйте обновить страницу.");
});

app.listen(PORT, HOST, () => {
    const links = downloadCards.reduce((sum, card) => sum + card.files.length, 0);
    console.log(`server: http://localhost:${PORT}/ — страниц ${pages.length + 2}, ссылок на сборки ${links}`);
    for (const message of warnings) console.warn(`! ${message}`);
    console.log(`server: файлы сайта — ${path.relative(ROOT, SRC)}/, сборки — ${path.relative(ROOT, DOWNLOADS_DIR)}/`);
});
