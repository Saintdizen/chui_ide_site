/**
 * lib/release.mjs — последний релиз GitHub: что качать, откуда и сколько весит.
 *
 * Зачем: перечислять имена файлов и размеры в `content/site.mjs` руками — это та же
 * работа, что и сам релиз, и одна неверная цифра тихо ломает кнопку. Здесь всё
 * берётся из API `/releases/latest` и раскладывается по системам из `release.os`.
 *
 * Сеть спрашиваем не чаще раза в `TTL`: ответ кладётся в `content/release.json`
 * (файл в git не попадает, см. `.gitignore`). Нет сети — берём кэш, пусть и
 * просроченный: старые ссылки продолжают работать, пока жив их тег, а пустые
 * кнопки заметны сразу. Нет ни сети, ни кэша — карточки покажут «скоро», и
 * `npm run check` об этом скажет.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_FILE = path.join(ROOT, "content", "release.json");

/** Сколько живёт кэш. 15 минут — компромисс: `npm run dev` с перезапуском на правку
 *  не выберет лимит анонимных запросов GitHub (60 в час), а новый релиз появляется
 *  на сайте после ближайшего перезапуска. */
const TTL = Number(process.env.RELEASE_TTL ?? 15 * 60 * 1000);
const TIMEOUT = 6000;

const API = "https://api.github.com";

/**
 * Установщик в имени файла: `chui_iDE-0.3.46-linux-amd64.deb`.
 * Всё остальное (`latest.yml`, `*.blockmap`, `builder-debug.yml`) сайту не нужно —
 * такие ассеты просто не попадают в разбор.
 */
const INSTALLER =
    /^.+?-(\d+\.\d+\.\d+(?:-[\w.]+)?)-(linux|win|windows|mac|darwin)-([A-Za-z0-9_]+)\.(appimage|deb|rpm|exe|msi|dmg|pkg)$/i;

/** Как формат называется на карточке: ключ — расширение из имени файла. */
const FORMAT_LABEL = {
    appimage: "AppImage",
    deb: "deb",
    rpm: "rpm",
    exe: "exe",
    msi: "msi",
    dmg: "dmg",
    pkg: "pkg",
};

/** Платформа из имени файла → система из `content/site.mjs`. */
const SYSTEM = { linux: "linux", win: "windows", windows: "windows", mac: "mac", darwin: "mac" };

/** Ассет релиза → строка для карточки. Не установщик — `null`. */
export function parseAsset(asset) {
    const match = INSTALLER.exec(asset.name ?? "");
    if (!match) return null;
    const [, version, platform, arch, extension] = match;
    return {
        name: asset.name,
        url: asset.browser_download_url,
        bytes: asset.size,
        version,
        system: SYSTEM[platform.toLowerCase()],
        arch,
        format: FORMAT_LABEL[extension.toLowerCase()],
    };
}

/** Спрашивает GitHub о последнем релизе. Ошибка — исключение, решение — у `loadRelease`. */
async function fetchLatest(repo) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    /* Токен нужен только для закрытого репозитория: анонимно он отвечает 404. */
    const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API}/repos/${repo}/releases/latest`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT),
    });
    if (response.status === 404) throw new Error(`${repo}: релизов нет или репозиторий закрыт (404)`);
    if (!response.ok) throw new Error(`GitHub ответил ${response.status} ${response.statusText}`);

    const body = await response.json();
    const assets = (body.assets ?? []).map(parseAsset).filter(Boolean);
    if (!assets.length) throw new Error(`в релизе ${body.tag_name} нет узнаваемых установщиков`);

    return {
        tag: body.tag_name,
        version: String(body.tag_name).replace(/^v/i, ""),
        page: body.html_url,
        publishedAt: body.published_at,
        assets,
    };
}

function readCache(repo) {
    if (!existsSync(CACHE_FILE)) return null;
    try {
        const cached = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
        if (cached?.repo !== repo || !Array.isArray(cached.release?.assets)) return null;
        return cached;
    } catch {
        /* испорченный кэш — то же, что его отсутствие */
        return null;
    }
}

function writeCache(repo, release) {
    try {
        mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        writeFileSync(CACHE_FILE, `${JSON.stringify({ repo, at: new Date().toISOString(), release }, null, 4)}\n`);
    } catch {
        /* кэш — удобство, а не условие работы: не записался — не беда */
    }
}

/**
 * Последний релиз: свежий кэш → сеть → просроченный кэш → ничего.
 *
 * `source` говорит, откуда данные: `cache`, `network`, `stale`, `none` — по нему
 * `lib/site.mjs` решает, предупреждать ли о чём-то в консоли.
 */
export async function loadRelease(repo) {
    const cached = readCache(repo);
    const age = cached ? Date.now() - Date.parse(cached.at) : Number.POSITIVE_INFINITY;
    if (cached && age < TTL) return { release: cached.release, source: "cache" };

    try {
        const release = await fetchLatest(repo);
        writeCache(repo, release);
        return { release, source: "network" };
    } catch (error) {
        if (cached) {
            return {
                release: cached.release,
                source: "stale",
                note: `${error.message} — взяты данные кэша от ${cached.at}`,
            };
        }
        return { release: null, source: "none", note: error.message };
    }
}

/**
 * Релиз → карточки скачивания в том виде, в каком их ждёт `lib/site.mjs`:
 * системы и их порядок — из `spec.os`, файлы — из релиза.
 *
 * Порядок файлов задан `formats` у системы: AppImage раньше deb, exe раньше msi.
 * Файл незнакомого формата не теряется — встаёт в конец.
 */
export function buildDownloads(release, spec) {
    return spec.os.map((entry) => {
        const order = entry.formats ?? [];
        const rank = (asset) => {
            const index = order.indexOf(asset.format);
            return index === -1 ? order.length : index;
        };

        const files = (release?.assets ?? [])
            .filter((asset) => entry.systems.includes(asset.system))
            .sort((left, right) => rank(left) - rank(right) || left.arch.localeCompare(right.arch))
            .map((asset) => ({ format: asset.format, arch: asset.arch, url: asset.url, bytes: asset.bytes }));

        return { os: entry.os, note: entry.note, formats: order.join(" · "), files };
    });
}
