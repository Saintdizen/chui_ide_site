/**
 * lib/site.mjs — данные и разметка сайта chui_iDE.
 *
 * Модуль ничего не пишет на диск: он читает `content/` один раз при загрузке,
 * режет README приложения на страницы и отдаёт готовый HTML функциями.
 * Кто их вызывает — сервер (`server.mjs`) или проверка (`scripts/check.mjs`) —
 * модулю всё равно, поэтому шаблоны живут отдельно от HTTP.
 *
 * Почему так, а не сборка в файлы: страниц два десятка, они не меняются между
 * запусками, а держать рядом с исходниками ещё и копию готового HTML — значит
 * чинить каждую правку дважды.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";
import markdownItTaskLists from "markdown-it-task-lists";

import { app, guide, release as releaseSpec, shots } from "../content/site.mjs";
import { assistant, facts, features, hero, limits, requirements, shortcuts, steps } from "../content/landing.mjs";
import { buildDownloads, loadRelease } from "./release.mjs";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SRC = path.join(ROOT, "src");
export const CONTENT = path.join(ROOT, "content");
export const DOWNLOADS_DIR = path.join(ROOT, "downloads");

/** Замечания сборки (раздел из README не назван в `content/site.mjs` и подобное). */
export const warnings = [];

const warn = (message) => warnings.push(message);

const esc = (text) =>
    String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function readRequired(file, hint) {
    if (!existsSync(file)) throw new Error(`${path.relative(ROOT, file)}: файла нет. ${hint ?? ""}`.trim());
    return readFileSync(file, "utf8");
}

/* ── адреса ──────────────────────────────────────────────────────────────── */

/** Кириллица → латиница: адреса страниц и якорей остаются читаемыми. */
const TRANSLIT = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
};

function translit(text) {
    return [...text.toLowerCase()].map((char) => (TRANSLIT[char] !== undefined ? TRANSLIT[char] : char)).join("");
}

/** Заголовок → якорь: латиница, цифры и дефисы, без хвостовых дефисов. */
function slugify(text) {
    const slug = translit(text)
        .replaceAll("«", "")
        .replaceAll("»", "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    return slug || "section";
}

/** Уникальный якорь в пределах страницы: повтор получает номер. */
function uniqueId(base, used) {
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let index = 2;
    while (used.has(`${base}-${index}`)) index += 1;
    const id = `${base}-${index}`;
    used.add(id);
    return id;
}

/* ── утилиты ─────────────────────────────────────────────────────────────── */

/** Размер PNG из заголовка файла: у снимка в разметке есть width/height,
 *  поэтому картинка не скачет при загрузке. */
function pngSize(file) {
    const buffer = readFileSync(file);
    if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Размер человеческим видом: мегабайты, от сотни — без десятых: «148 МБ» читается,
 *  «148.6 МБ» — нет. */
function formatSize(bytes) {
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} МБ`;
}

/** Размер комплекта — цифрой рядом с файлом: обещать «лёгкую» сборку, не зная веса,
 *  незачем. У локального файла размер берётся с диска, у внешнего — из `bytes`. */
function sizeText(relative) {
    const file = path.join(DOWNLOADS_DIR, relative);
    if (!existsSync(file)) return "";
    return formatSize(statSync(file).size);
}

/** Склонение: 1 слово, 2 слова, 5 слов. Нужно для счётчика под заголовком раздела. */
function plural(count, forms) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
}

const clip = (text, length) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);

/**
 * Лёгкая подсветка кода без зависимостей: подсвечиваем то, что встречается
 * в примерах руководства — JSON, shell, JS/TS и Python. Язык неизвестен —
 * отдаём экранированный текст как есть.
 */
function highlightCode(source, lang) {
    const safe = esc(source);

    /** Красим один слой: сначала комментарии и строки, потом слова и числа. */
    const paint = (value, rules) => {
        let out = value;
        for (const [pattern, cls] of rules)
            out = out.replace(pattern, (hit) => `<span class="tok_${cls}">${hit}</span>`);
        return out;
    };

    if (lang === "json" || lang === "jsonc") {
        /* Строка-ключ до «:», значения-строки, числа и литералы. */
        return safe
            .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="tok_key">$1</span>$2')
            .replace(/:\s*(&quot;[^&]*?&quot;)/g, ': <span class="tok_string">$1</span>')
            .replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span class="tok_number">$1</span>')
            .replace(/\b(true|false|null)\b/g, '<span class="tok_lit">$1</span>');
    }
    if (lang === "sh" || lang === "bash" || lang === "shell" || lang === "zsh") {
        return paint(safe, [
            [/(^|\s)(#[^\n]*)/gm, "comment"],
            [/(&quot;[^&]*?&quot;|'[^']*?')/g, "string"],
        ]);
    }
    if (lang === "js" || lang === "javascript" || lang === "ts" || lang === "typescript") {
        return paint(safe, [
            [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, "comment"],
            [/(&quot;[^&]*?&quot;|'[^']*?'|`[^`]*?`)/g, "string"],
            [
                /\b(const|let|var|function|return|if|else|for|of|in|new|class|export|import|await|async|throw|try|catch)\b/g,
                "keyword",
            ],
            [/\b(\d+(?:\.\d+)?)\b/g, "number"],
        ]);
    }
    if (lang === "py" || lang === "python") {
        return paint(safe, [
            [/(#[^\n]*)/g, "comment"],
            [/(&quot;[^&]*?&quot;|'[^']*?'|&quot;&quot;&quot;[\s\S]*?&quot;&quot;&quot;)/g, "string"],
            [
                /\b(def|class|return|import|from|if|else|elif|for|while|in|not|and|or|None|True|False|with|as|try|except|raise)\b/g,
                "keyword",
            ],
        ]);
    }
    return safe;
}

/**
 * Плоский список: раздел README, состоящий почти целиком из пунктов списка
 * («Безопасность», «Ограничения версии»). Такой список показываем карточками —
 * иначе на странице получается стена строк без единого заголовка.
 */
function isFlatList(body) {
    const lines = body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 4) return false;
    const bullets = lines.filter((line) => /^[-*]\s+/.test(line)).length;
    return bullets >= 4 && bullets >= lines.length - 1;
}

/** Короткое описание раздела без разметки — для карточек и поиска. */
function plainText(markdown) {
    const chunks = [];
    for (const raw of markdown.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        /* заголовки, код, таблицы, цитаты и картинки описанием не считаем */
        if (/^(#{1,6}\s|```|\||>|!\[)/.test(line)) continue;
        chunks.push(line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, ""));
        if (chunks.join(" ").length >= guide.summaryLength) break;
    }
    return chunks
        .join(" ")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\*\*([^*]*)\*\*/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

/* ── markdown ────────────────────────────────────────────────────────────── */

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use(markdownItTaskLists, { label: true, labelAfter: true });

const defaultHeadingOpen = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options);

/** Заголовкам выдаём якоря и собираем оглавление страницы. */
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const inline = tokens[idx + 1];
    const title = inline ? inline.content.trim() : "";
    const id = token.attrGet("id") ?? uniqueId(slugify(title), env.used);
    token.attrSet("id", id);
    env.lastHeadingId = id;
    env.toc.push({ id, title, level: Number(token.tag.slice(1)) });
    return defaultHeadingOpen(tokens, idx, options, env, self);
};

/** У заголовка — знак ссылки: по нему видно, что на раздел можно сослаться. */
md.renderer.rules.heading_close = (tokens, idx, _options, env, _self) => {
    const anchor = env.lastHeadingId
        ? `<a class="anchor_link" href="#${env.lastHeadingId}" aria-label="Ссылка на раздел" title="Ссылка на раздел">#</a>`
        : "";
    return `${anchor}</${tokens[idx].tag}>\n`;
};

/** Блок кода: полоса с подписью языка (в неё же встаёт кнопка копирования). */
md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = (token.info || "").trim().split(/\s+/)[0];
    const label = lang ? `<span class="code_lang">${esc(lang)}</span>` : "<span></span>";
    return `<div class="code_block"><div class="code_head">${label}</div><pre class="code" tabindex="0">${highlightCode(
        token.content,
        lang
    )}</pre></div>\n`;
};

/** Плоский список раздела показываем карточками — см. isFlatList. */
const defaultBulletOpen =
    md.renderer.rules.bullet_list_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.bullet_list_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (env.flatList && !env.flatListUsed) {
        env.flatListUsed = true;
        token.attrJoin("class", "list_cards");
    }
    return defaultBulletOpen(tokens, idx, options, env, self);
};

/** Превращает абзацы «**Зачин.** текст» в заголовки: у страницы появляется
 *  оглавление и точки для поиска. */
function promoteLeads(markdown) {
    const lines = markdown.split("\n");
    const out = [];
    let inFence = false;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*```/.test(line)) inFence = !inFence;
        const previous = out.length ? out[out.length - 1] : "";
        const atBlockStart = previous.trim() === "";
        const match = !inFence && atBlockStart ? line.match(/^\*\*([^*«»]{2,72})\.\*\*[ \t]+(\S.*)$/) : null;
        if (match) {
            out.push(`## ${match[1].trim()}`, "", match[2].trim());
            continue;
        }
        out.push(line);
    }
    return out.join("\n");
}

/** Разделы README: страница на каждый заголовок второго уровня. */
function splitSections(readme) {
    const lines = readme.split("\n");
    const sections = [];
    const intro = [];
    let current = null;
    let inFence = false;

    for (const line of lines) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        const heading = !inFence ? line.match(/^## (?!#)\s*(.+?)\s*$/) : null;
        if (heading) {
            if (current) sections.push(current);
            current = { title: heading[1], lines: [] };
            continue;
        }
        if (current) current.lines.push(line);
        else intro.push(/^#\s/.test(line) ? "" : line);
    }
    if (current) sections.push(current);

    return {
        intro: intro.join("\n").trim(),
        sections: sections.map((section) => ({ title: section.title, body: section.lines.join("\n").trim() })),
    };
}

/* ── данные ──────────────────────────────────────────────────────────────── */

export const meta = (() => {
    const file = path.join(CONTENT, "guide", "readme.json");
    if (!existsSync(file)) {
        warn("content/guide/readme.json нет — запустите `npm run sync`, версия на сайте будет без номера");
        return { version: null, productName: app.name, source: null, syncedAt: null };
    }
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
        warn(`readme.json не разобран (${error.message}) — версия на сайте будет без номера`);
        return { version: null, productName: app.name, source: null, syncedAt: null };
    }
})();

/** Сравнение версий по числовым частям: 0.3.47 > 0.3.46, 0.4.0 > 0.3.9. */
const compareVersions = (left, right) => {
    const parts = (value) =>
        String(value)
            .split(/[^\d]+/)
            .filter(Boolean)
            .map(Number);
    const a = parts(left);
    const b = parts(right);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
};

/* ── последний релиз ─────────────────────────────────────────────────────── */

/** Сведения о последнем релизе GitHub: тег, версия, файлы сборок с размерами.
 *  Данные приходят из `lib/release.mjs`: сеть спрашивается один раз при запуске
 *  и не чаще раза в 15 минут — дальше работает кэш `content/release.json`. */
const latest = await loadRelease(releaseSpec.repo);

export const releaseInfo = latest.release;

if (!releaseInfo) {
    warn(`последнего релиза нет — карточки скачивания покажут «скоро» (${latest.note})`);
} else if (latest.note) {
    warn(latest.note);
}

/** Версия для шапки сайта и заголовка «Скачать»: свежий релиз главнее копии README —
 *  кнопки ведут именно к нему. */
export const version = releaseInfo?.version ?? meta.version ?? app.name;

/* Версия README и версия релиза разошлись в любую сторону: отстал README — лечится
   `npm run sync`, опередил — сборка ещё не выпущена, и ссылки ведут на прошлый тег. */
if (releaseInfo && meta.version && releaseInfo.version !== meta.version) {
    const ahead = compareVersions(meta.version, releaseInfo.version) > 0;
    warn(
        ahead
            ? `README скопирован от ${meta.version}, а последний релиз — v${releaseInfo.version}: ` +
                  `руководство описывает ещё не выпущенную сборку, файлы скачивания — от v${releaseInfo.version}`
            : `последний релиз — v${releaseInfo.version}, а README скопирован от ${meta.version}: ` +
                  "запустите `npm run sync`"
    );
}

/** Комплекты для скачивания: системы и порядок — из `content/site.mjs`, файлы — из релиза. */
export const downloads = buildDownloads(releaseInfo, releaseSpec);

const readme = readRequired(
    path.join(CONTENT, "guide", "readme.md"),
    "Запустите `npm run sync` — скрипт положит README приложения в репозиторий сайта."
);
const split = splitSections(readme);

/** Разделы — в порядке из `content/site.mjs`; незнакомые из README идут следом. */
const orderedSections = (() => {
    const byTitle = new Map(split.sections.map((section) => [section.title, section]));
    const ordered = [];
    for (const title of guide.order) {
        const section = byTitle.get(title);
        if (!section) {
            warn(`раздел «${title}» из content/site.mjs в README не найден — проверьте заголовок`);
            continue;
        }
        byTitle.delete(title);
        ordered.push(section);
    }
    for (const [title, section] of byTitle) {
        warn(`в README появился раздел «${title}» — он не назван в content/site.mjs, страница собрана автоматически`);
        ordered.push(section);
    }
    return ordered;
})();

/** Страницы руководства: адрес, текст, оглавление, описание. */
export const pages = orderedSections.map((section) => {
    const slug = guide.slugs[section.title] ?? slugify(section.title);
    const env = { used: new Set(["content"]), toc: [], flatList: isFlatList(section.body) };
    const body = md.render(promoteLeads(section.body), env);
    const plain = plainText(section.body);
    const summary = clip(plain, guide.summaryLength);
    /* Сколько читать: считаем по всему разделу (таблицы и код тоже),
       180 слов в минуту — обычный темп чтения. */
    const words = section.body
        .replace(/[`*#>|\-]/g, " ")
        .split(/\s+/)
        .filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 180));
    return {
        title: section.title,
        slug,
        url: `/guide/${slug}`,
        body,
        toc: env.toc,
        summary,
        plain,
        words,
        minutes,
    };
});

/** Быстрый поиск страницы по адресу: сервер не должен обходить массив на запрос. */
export const pagesBySlug = new Map(pages.map((page) => [page.slug, page]));

/** Комплекты для скачивания: адрес, размер и готовность каждого файла.
 *
 *  `url` — ссылка на ассет релиза (размер известен из `bytes`, скачивает GitHub),
 *  `path` — файл в `downloads/`, который раздаёт сам сайт (размер считаем по файлу).
 *  Локального файла может ещё не быть на диске: тогда строка помечается «скоро»,
 *  и сайт не ссылается на пустоту. */
export const downloadCards = downloads.map((item) => ({
    ...item,
    files: (item.files ?? []).map((file) => ({
        ...file,
        href: file.url ?? `/downloads/${file.path}`,
        external: Boolean(file.url),
        size: file.bytes ? formatSize(file.bytes) : file.path ? sizeText(file.path) : "",
        ready: Boolean(file.url) || (file.path ? existsSync(path.join(DOWNLOADS_DIR, file.path)) : false),
    })),
}));

/** Заявленные файлы, которых нет на диске: о них `npm run check` пишет предупреждением. */
export const missingDownloads = (() => {
    const missing = [];
    for (const item of downloads) {
        for (const file of item.files ?? []) {
            if (file.path && !existsSync(path.join(DOWNLOADS_DIR, file.path))) {
                missing.push({ os: item.os, path: file.path });
            }
        }
    }
    return missing;
})();

/** Файлы, которые раздаёт сам сайт (у остальных адрес внешний). Их проверяет `npm run check`. */
export const downloadFiles = downloads.flatMap((item) =>
    (item.files ?? []).filter((file) => file.path).map((file) => file.path)
);

/* ── каркас страницы ─────────────────────────────────────────────────────── */

/** Версия файлов оформления — по времени правки файла. Подставляется в ссылки
 *  на каждый ответ: поправили `style.css` — браузер сразу берёт новую версию,
 *  а всё остальное время файлы лежат в кэше. */
export function assetVersion() {
    const stamp = (name) => Math.round(statSync(path.join(SRC, name)).mtimeMs).toString(36);
    return `${stamp("style.css")}-${stamp("site.js")}`;
}

function head({ title, description, root, sections = false }) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1b1b1d">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="icon" type="image/png" href="/assets/icon.png">
<link rel="stylesheet" href="/assets/style.css?v=__ASSET_VERSION__">
<script src="/search-index.js" defer></script>
<script src="/assets/site.js?v=__ASSET_VERSION__" defer></script>
</head>
<body data-page="${esc(root)}"${sections ? ' data-sections="true"' : ""}>`;
}

/** Шапка одна на весь сайт: знак, разделы и поиск по руководству.
 *
 *  `sections` — есть ли на странице боковое меню разделов: кнопка «☰» в шапке
 *  раскрывает именно его, и там, где меню нет (главная, оглавление руководства),
 *  кнопка была бы пустой — её не выводим. */
function topbar({ root, sections = false }) {
    const links = [
        { href: "/#features", label: "Возможности", key: "features" },
        { href: "/#assistant", label: "Ассистент", key: "assistant" },
        { href: "/#download", label: "Скачать", key: "download" },
        { href: "/guide", label: "Руководство", key: "guide" },
    ];
    const nav = links
        .map((link) => {
            const active = root === link.key ? ' class="is_active" aria-current="page"' : "";
            return `            <a href="${link.href}"${active}>${link.label}</a>`;
        })
        .join("\n");

    return `<a class="skip_link" href="#content">К содержимому</a>
<header class="topbar">
${sections ? '    <button class="icon_button only_narrow" id="nav_toggle" type="button" aria-label="Показать разделы" aria-expanded="false">☰</button>\n' : ""}    <a class="brand" href="/"><img src="/assets/icon.png" alt="" width="26" height="26"><span>chui<i>_iDE</i></span></a>
    <nav class="topbar_nav" aria-label="Разделы сайта">
${nav}
    </nav>
    <div class="search_box" role="search">
        <input id="search_input" type="search" placeholder="Поиск по руководству" autocomplete="off"
               aria-label="Поиск по руководству" aria-controls="search_results" aria-expanded="false">
        <kbd class="search_hint" aria-hidden="true">/</kbd>
        <ul id="search_results" class="search_results" aria-label="Результаты поиска" hidden></ul>
    </div>
</header>`;
}

/** Подвал. На страницах руководства (`shell`) его колонки встают в те же
 *  границы, что боковое меню и текст статьи — иначе он шире содержимого. */
function footer(shell = false) {
    return `<footer class="footer${shell ? " footer_shell" : ""}" id="content_footer">
    <div class="footer_col">
        <a class="brand brand_footer" href="/"><img src="/assets/icon.png" alt="" width="24" height="24"><span>chui<i>_iDE</i></span></a>
        <p>${esc(app.tagline)}. Лицензия ${esc(app.license)}.</p>
    </div>
    <div class="footer_col">
        <h2>Сайт</h2>
        <ul>
            <li><a href="/">Главная</a></li>
            <li><a href="/guide">Руководство</a></li>
            <li><a href="/guide/hotkeys">Горячие клавиши</a></li>
            <li><a href="/guide/limits">Ограничения версии</a></li>
        </ul>
    </div>
</footer>`;
}

const pageEnd = `</body>
</html>
`;

/* ── главная страница ────────────────────────────────────────────────────── */

/** Иконки карточек возможностей: простые значки, нарисованные здесь же. */
const ICONS = {
    editor: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5Z"/><path d="M8 9.5h5M8 13.5h8"/>',
    language: '<path d="m8.5 6-5 6 5 6M15.5 6l5 6-5 6"/>',
    folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l2 2H19a2 2 0 0 1 2 2v7A2 2 0 0 1 19 18.5H5a2 2 0 0 1-2-2Z"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7 10 2.5 2.5L7 15M12.5 15H17"/>',
    play: '<path d="M8 5.5 19 12 8 18.5Z"/>',
    git: '<circle cx="7" cy="6" r="2.5"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="12" r="2.5"/><path d="M7 8.5v7M9.5 6h3.5a2 2 0 0 1 2 2v2"/>',
    assistant:
        '<path d="M12 3v2M5 7.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.2 2.4 3.3 5.1 3.3 8S14.2 17.6 12 20c-2.2-2.4-3.3-5.1-3.3-8S9.8 6.4 12 4Z"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m5 17 5-4 3 2.5L16 12l3 3"/>',
    palette:
        '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.6-2-.6-3c0-1.1.9-2 2-2H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7Z"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="15.5" cy="10" r="1"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    rules: '<path d="M6 3h9l5 5v13H6Z"/><path d="M15 3v5h5M9.5 13h5M9.5 17h5"/>',
};

/** Значок карточки: контурный, наследует цвет текста. */
const cardIcon = (name) =>
    `<span class="card_icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.rules}</svg></span>`;

/** Надзаголовок раздела: короткая метка над h2, чтобы у блоков был ритм. */
const eyebrow = (text) => `        <p class="section_eyebrow">${esc(text)}</p>\n`;

export function renderLanding() {
    const description = `${app.name} — ${app.tagline}: свой редактор и терминал, языковые подсказки, отладчик, git и ассистент. Windows, Linux, macOS.`;

    const factsHtml = facts.map((fact) => `                <li>${esc(fact)}</li>`).join("\n");

    const featuresHtml = features
        .map((feature) => {
            const page = pagesBySlug.get(feature.page);
            /* `anchor` — когда тема лежит внутри чужого раздела (встроенный браузер описан
               в «Просмотре файлов»): ссылка ведёт прямо к нему. */
            const href = page ? `${page.url}${feature.anchor ? `#${feature.anchor}` : ""}` : null;
            const more = href
                ? `<a class="card_more" href="${href}">Подробнее <span aria-hidden="true">→</span></a>`
                : "";
            return `            <article class="card">
                ${cardIcon(feature.icon)}
                <h3>${esc(feature.title)}</h3>
                <p>${esc(feature.text)}</p>
${more}
            </article>`;
        })
        .join("\n");

    const assistantHtml = assistant.groups
        .map(
            (group) => `            <article class="assistant_group">
                <h3>${esc(group.title)}</h3>
                <ul>
${group.items.map((item) => `                    <li>${esc(item)}</li>`).join("\n")}
                </ul>
            </article>`
        )
        .join("\n");

    /* Снимки окна: пропавший файл — не беда, он просто выпадет из галереи.
       Размеры берём из самих PNG, чтобы картинка не скакала при загрузке. */
    const shotsHtml = shots
        .map((item) => {
            const file = path.join(SRC, "shots", item.file);
            if (!existsSync(file)) {
                warn(`снимок ${item.file} не найден в src/shots — выпал из галереи`);
                return "";
            }
            const size = pngSize(file);
            const attrs = size ? ` width="${size.width}" height="${size.height}"` : "";
            return `            <figure class="shot">
                <a href="/assets/shots/${esc(item.file)}" title="Открыть снимок целиком">
                    <img src="/assets/shots/${esc(item.file)}" alt="${esc(item.alt)}" loading="lazy"${attrs}>
                </a>
                <figcaption><b>${esc(item.title)}</b><span>${esc(item.caption)}</span></figcaption>
            </figure>`;
        })
        .filter(Boolean)
        .join("\n");

    const stepsHtml = steps
        .map(
            (step, index) => `            <article class="step">
                <span class="step_number">${String(index + 1).padStart(2, "0")}</span>
                <h3>${esc(step.title)}</h3>
                <p>${esc(step.text)}</p>
            </article>`
        )
        .join("\n");

    /* Карточка системы: есть файлы — строки-кнопки с размером; нет — бейдж «Скоро»
       и перечень форматов, которые выйдут. Одно место, две ступени готовности. */
    const downloadsHtml = downloadCards
        .map((item) => {
            const filesHtml = item.files
                .map((file) => {
                    /* Формат и архитектура — общие для обеих ступеней: готовый файл и
                       заявленный. Так карточка не меняет вид, когда файл зальют. */
                    const faces = `                        <span class="download_format">${esc(file.format)}</span>
                        <span class="download_arch">${esc(file.arch)}</span>`;
                    if (!file.ready) {
                        return `                    <li><span class="download_file is_pending" aria-disabled="true">
${faces}
                        <span class="download_pending">скоро</span>
                    </span></li>`;
                    }
                    const label = `Скачать ${esc(item.os)}: ${esc(file.format)}, ${esc(file.arch)}`;
                    const target = file.external ? ' target="_blank" rel="noopener noreferrer"' : " download";
                    const size = file.size
                        ? `
                        <span class="download_size">${esc(file.size)}</span>`
                        : "";
                    const arrow = file.external
                        ? '<path d="M8 16 16 8M9.5 8H16v6.5"/>'
                        : '<path d="M12 4.5v10M12 14.5l4-4M12 14.5l-4-4M5.5 19.5h13"/>';
                    return `                    <li><a class="download_file" href="${esc(file.href)}"${target} aria-label="${label}${file.external ? " (внешняя ссылка)" : ""}">
${faces}${size}
                        <svg class="download_arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${arrow}</svg>
                    </a></li>`;
                })
                .join("\n");
            const body = item.files.length
                ? `                <ul class="download_files">
${filesHtml}
                </ul>`
                : `                <p class="download_formats">${esc(item.formats ?? "")}</p>
                <span class="download_soon"><span class="download_soon_dot" aria-hidden="true"></span>Скоро</span>`;
            return `            <article class="download_card">
                <h3>${esc(item.os)}</h3>
${body}
                <p class="download_cardnote">${esc(item.note)}</p>
            </article>`;
        })
        .join("\n");

    /* Над заголовком — только версия приложения: из неё одной видно, насколько сайт свежий. */
    const kickerHtml = meta.version
        ? `        <p class="kicker"><span class="kicker_dot" aria-hidden="true"></span>Версия ${esc(version)}</p>\n`
        : "";

    const shortcutsHtml = shortcuts
        .map((item) => `                <tr><td><kbd>${esc(item.keys)}</kbd></td><td>${esc(item.action)}</td></tr>`)
        .join("\n");

    const requirementList = requirements.items.map((item) => `                <li>${esc(item)}</li>`).join("\n");
    const limitList = limits.items.map((item) => `                <li>${esc(item)}</li>`).join("\n");

    return `${head({ title: `${app.name} — ${app.tagline}`, description, root: "home" })}
${topbar({ root: "home" })}
<main id="content">
    <section class="hero">
        <img class="hero_icon" src="/assets/icon.png" alt="" width="96" height="96">
${kickerHtml}        <h1>${esc(hero.title)}</h1>
        <p class="hero_lead">${esc(hero.lead)}</p>
        <p class="hero_actions">
            <a class="button button_primary" href="#download">Скачать</a>
            <a class="button button_secondary" href="/guide">Руководство</a>
        </p>
        <ul class="facts">
${factsHtml}
        </ul>
    </section>

    <section class="section section_quiet" id="start">
        <div class="section_head">
${eyebrow("Старт")}        <h2>Три шага до работы</h2>
        </div>
        <div class="steps">
${stepsHtml}
        </div>
    </section>

    <section class="section" id="features">
        <div class="section_head">
${eyebrow("Возможности")}        <h2>Одно окно вместо набора инструментов</h2>
        <p class="section_lead">Всё ниже — про одно окно: панели не нужно открывать по отдельности, они рядом и связаны между собой.</p>
        </div>
        <div class="cards">
${featuresHtml}
        </div>
    </section>

    <section class="section section_alt" id="assistant">
        <div class="section_head">
${eyebrow("Ассистент")}        <h2>${esc(assistant.title)}</h2>
        <p class="section_lead">${esc(assistant.lead)}</p>
        </div>
        <div class="assistant_groups">
${assistantHtml}
        </div>
        <p class="section_more"><a class="button button_secondary" href="/guide/assistant">Как это устроено в руководстве</a></p>
        <div class="shortcuts">
            <h3>Частые сочетания клавиш</h3>
            <table class="keys">
                <tbody>
${shortcutsHtml}
                </tbody>
            </table>
            <p class="muted"><a href="/guide/hotkeys">Полный список сочетаний</a> — и они же меняются в настройках приложения.</p>
        </div>
    </section>

    <section class="section" id="shot">
        <div class="section_head">
${eyebrow("Снимки")}        <h2>Как это выглядит</h2>
        <p class="section_lead">Настоящее окно: панели «островами», свой редактор и терминал, пометки git в дереве, строка состояния с языком и веткой.</p>
        </div>
        <div class="shots">
${shotsHtml}
        </div>
    </section>

    <section class="section section_alt" id="download">
        <div class="section_head">
${eyebrow("Скачать")}        <h2>Скачать${meta.version ? ` ${esc(version)}` : ""}</h2>
        </div>
        <div class="downloads">
${downloadsHtml}
        </div>
    </section>

    <section class="section" id="requirements">
        <div class="section_head">
${eyebrow("Требования")}        <h2>Что нужно, чтобы начать</h2>
        </div>
        <div class="two_cols">
            <div class="panel">
                <h3>${esc(requirements.title)}</h3>
                <ul class="ticks">
${requirementList}
                </ul>
            </div>
            <div class="panel">
                <h3>${esc(limits.title)}</h3>
                <ul class="dashes">
${limitList}
                </ul>
                <p class="muted"><a href="/guide/limits">Подробнее об ограничениях</a></p>
            </div>
        </div>
    </section>
</main>
${footer()}
${pageEnd}`;
}

/* ── руководство ─────────────────────────────────────────────────────────── */

/** Оглавление руководства: все разделы со своими зачинами. */
export function renderGuideIndex() {
    const description = `Руководство ${app.name}: начало работы, редактор, терминал, git, ассистент и справочник сочетаний клавиш.`;
    const intro = split.intro ? md.render(split.intro) : "";

    const cards = pages
        .map(
            (page) => `            <article class="card card_link">
                <h2 class="card_title"><a href="${page.url}">${esc(page.title)}</a></h2>
                <p>${esc(page.summary || "Раздел руководства.")}</p>
                <p class="card_meta">${page.minutes} мин · ${page.toc.length - 1} ${plural(page.toc.length - 1, [
                    "подраздел",
                    "подраздела",
                    "подразделов",
                ])}</p>
            </article>`
        )
        .join("\n");

    return `${head({ title: `Руководство · ${app.name}`, description, root: "guide" })}
${topbar({ root: "guide" })}
<div class="shell shell_index">
<main id="content" class="article">
    <nav class="crumbs" aria-label="Вы здесь"><a href="/">Главная</a> <span>/</span> <b>Руководство</b></nav>
    <h1>Руководство</h1>
    <div class="intro">
${intro}
    </div>
    <div class="cards cards_guide">
${cards}
    </div>
    <p class="source_note">Тексты руководства — README приложения${meta.version ? ` версии ${esc(meta.version)}` : ""}, разложенный по разделам.
    Если приложение изменилось, а сайт нет, — обновите копию: <code>npm run sync</code>.</p>
</main>
</div>
${footer(true)}
${pageEnd}`;
}

/** Страница раздела: боковое оглавление, текст, переходы. */
export function renderGuidePage(page) {
    const index = pages.indexOf(page);
    const previous = pages[index - 1] ?? null;
    const next = pages[index + 1] ?? null;

    const navItems = pages
        .map((item) => {
            const active = item === page ? ' class="is_active" aria-current="page"' : "";
            return `            <li><a href="${item.url}"${active}>${esc(item.title)}</a></li>`;
        })
        .join("\n");

    /* Подразделы — в правой колонке «На этой странице»: в левом меню они теснили
       список разделов, а тут стоят рядом с текстом и подсказывают, где мы. */
    const pageToc = page.toc.filter((entry) => entry.level >= 2);
    const tocAside =
        pageToc.length > 1
            ? `    <aside class="page_toc" id="page_toc" aria-label="На этой странице">
        <p class="page_toc_title">На этой странице</p>
        <ul>
${pageToc.map((entry) => `            <li><a href="#${entry.id}">${esc(entry.title)}</a></li>`).join("\n")}
        </ul>
    </aside>`
            : "";

    const pager = `<nav class="pager" aria-label="Соседние разделы">
        ${previous ? `<a class="pager_item" href="${previous.url}"><span>Назад</span><b>${esc(previous.title)}</b></a>` : "<span></span>"}
        ${next ? `<a class="pager_item pager_next" href="${next.url}"><span>Дальше</span><b>${esc(next.title)}</b></a>` : "<span></span>"}
    </nav>`;

    return `${head({ title: `${page.title} · руководство ${app.name}`, description: page.summary || page.title, root: "guide", sections: true })}
${topbar({ root: "guide", sections: true })}
<div class="shell">
    <nav class="sidebar" id="sidebar" aria-label="Разделы руководства">
        <p class="sidebar_title">Руководство</p>
        <ul class="nav_list">
            <li><a href="/guide">Оглавление</a></li>
${navItems}
        </ul>
        <p class="sidebar_back"><a href="/">← На главную</a></p>
    </nav>
    <main id="content" class="article">
        <nav class="crumbs" aria-label="Вы здесь"><a href="/">Главная</a> <span>/</span> <a href="/guide">Руководство</a> <span>/</span> <b>${esc(page.title)}</b></nav>
        <h1>${esc(page.title)}</h1>
        <p class="meta_line">
            <span>${page.minutes} мин чтения</span>
            <span>${page.words} ${plural(page.words, ["слово", "слова", "слов"])}</span>${
                page.toc.length > 1
                    ? `
            <span>${page.toc.length - 1} подразделов</span>`
                    : ""
            }
        </p>
        <div class="prose">
${page.body}
        </div>
        ${pager}
        <p class="source_note">Раздел взят из README приложения${meta.version ? ` версии ${esc(meta.version)}` : ""}.
        Нашли расхождение с приложением — скажите о нём, и раздел поправят вместе с приложением.</p>
    </main>
${tocAside}
</div>
${footer(true)}
${pageEnd}`;
}

/** Страница «не найдено»: адрес мог устареть, и человеку нужно куда-то идти. */
export function renderNotFound(pathname = "") {
    return `${head({
        title: `Страница не найдена · ${app.name}`,
        description: "Такой страницы на сайте нет.",
        root: "404",
    })}
${topbar({ root: "404" })}
<main id="content" class="article not_found">
    <p class="not_found_code">404</p>
    <h1>Такой страницы нет</h1>
    <p class="muted">Адрес <code>${esc(pathname)}</code> не отвечает ни одному разделу сайта.</p>
    <p>
        <a class="button button_primary" href="/">На главную</a>
        <a class="button button_secondary" href="/guide">Руководство</a>
    </p>
    <p class="muted">Нужен конкретный раздел? Поиск в шапке ищет по всем страницам руководства.</p>
</main>
${footer()}
${pageEnd}`;
}

/* ── поиск ───────────────────────────────────────────────────────────────── */

/** Поисковый индекс: страницы руководства и их подразделы. */
export const searchEntries = (() => {
    const entries = [];
    for (const page of pages) {
        entries.push({ t: page.title, u: page.url, d: page.summary, p: "Руководство" });
        for (const entry of page.toc) {
            if (entry.level < 2) continue;
            entries.push({ t: entry.title, u: `${page.url}#${entry.id}`, d: page.summary, p: page.title });
        }
    }
    return entries;
})();

/** Индекс отдаётся скриптом: страницам он нужен до первого ввода в поиск. */
export const searchIndexScript = `/* Поисковый индекс сайта: собирается lib/site.mjs из страниц руководства. */
window.CHUI_SEARCH_INDEX = ${JSON.stringify({ entries: searchEntries }, null, 0)};
`;

/** Всё, что сайт умеет отдавать, — одной таблицей: по ней ходит сервер и проверка. */
export function siteRoutes() {
    const routes = new Map();
    routes.set("/", renderLanding());
    routes.set("/guide", renderGuideIndex());
    for (const page of pages) routes.set(page.url, renderGuidePage(page));
    return routes;
}
