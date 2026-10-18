#!/usr/bin/env node
/**
 * scripts/sync-readme.mjs — забрать README приложения chui_iDE в репозиторий сайта.
 *
 * Руководство сайта целиком строится из README приложения, поэтому README лежит
 * здесь копией (`content/guide/readme.md`), а не читается из соседней папки при
 * сборке: сайт должен собираться из своего репозитория, даже если исходников
 * приложения рядом нет.
 *
 * Источник ищется по порядку (первый, где есть README.md):
 *   1. переменная окружения CHUI_IDE_DIR — папка приложения;
 *   2. `../../GITHUB/chui_ide` — как проекты лежат у автора;
 *   3. `../chui_ide` — если приложение склонировано рядом с сайтом.
 *
 * Рядом с копией кладётся `content/guide/readme.json`: откуда взято, когда,
 * какая версия приложения и контрольная сумма — по ним видно, не устарела ли копия.
 *
 * Запуск:  npm run sync   (или `node scripts/sync-readme.mjs`)
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "content", "guide");
const OUT_README = path.join(OUT_DIR, "readme.md");
const OUT_META = path.join(OUT_DIR, "readme.json");

/** Куда смотреть в поисках приложения — по порядку. */
const CANDIDATES = [
    process.env.CHUI_IDE_DIR,
    path.resolve(ROOT, "..", "..", "GITHUB", "chui_ide"),
    path.resolve(ROOT, "..", "chui_ide"),
].filter(Boolean);

function findAppDir() {
    for (const dir of CANDIDATES) {
        if (existsSync(path.join(dir, "README.md"))) return dir;
    }
    return null;
}

const appDir = findAppDir();

if (!appDir) {
    console.error("sync-readme: не нашёл приложение chui_iDE с README.md.");
    console.error("Проверил:");
    for (const dir of CANDIDATES) console.error(`  • ${dir}`);
    console.error("Укажите папку приложения переменной: CHUI_IDE_DIR=/путь/к/chui_ide npm run sync");
    process.exit(1);
}

/** Версия и имя продукта — из package.json приложения: бейдж на сайте берёт их отсюда. */
function readAppPackage(dir) {
    const file = path.join(dir, "package.json");
    if (!existsSync(file)) return {};
    try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        return { version: data.version ?? null, productName: data.productName ?? null };
    } catch (error) {
        console.warn(`sync-readme: package.json приложения не разобран (${error.message}) — версия без изменений.`);
        return {};
    }
}

const readme = readFileSync(path.join(appDir, "README.md"), "utf8");
const pkg = readAppPackage(appDir);
const sha = createHash("sha256").update(readme).digest("hex").slice(0, 12);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_README, readme, "utf8");
writeFileSync(
    OUT_META,
    `${JSON.stringify(
        {
            source: appDir,
            syncedAt: new Date().toISOString(),
            sha256: sha,
            version: pkg.version,
            productName: pkg.productName,
        },
        null,
        4
    )}\n`,
    "utf8"
);

const lines = readme.split("\n").length;
console.log(`sync-readme: ${path.relative(ROOT, OUT_README)} ← ${path.join(appDir, "README.md")}`);
console.log(`sync-readme: ${lines} строк, версия ${pkg.version ?? "неизвестна"}, сумма ${sha}`);
