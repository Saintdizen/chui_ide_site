/**
 * Демонстрационный проект для съёмки: общий для скриптов снимка и диагностики.
 * Осмысленный код на JavaScript и Python, дерево с папками, тесты, данные, README.
 * Активный файл (`src/order.js`) нарочно длинный — на снимке код занимает полотно,
 * а не четверть окна.
 */
const { promises: fs } = require("node:fs");
const path = require("node:path");

const ORDER_JS = `import { priceOf } from "./catalog.js";

const MAX_WEIGHT = 20;
const FREE_FROM = 5000;

/** Собирает заказ: строки, вес и черновая сумма. */
export function buildOrder(items, catalog) {
    if (!items.length) throw new Error("корзина пуста");
    const lines = items.map((item) => makeLine(item, catalog));
    const subtotal = lines.reduce((sum, line) => sum + line.sum, 0);
    const weight = lines.reduce((sum, line) => sum + line.count * line.weight, 0);

    if (weight > MAX_WEIGHT) throw new Error(\`заказ тяжелее \${MAX_WEIGHT} кг\`);
    return { lines, weight, subtotal };
}

/** Строка заказа: цена берётся из каталога, вес — из карточки товара. */
function makeLine(item, catalog) {
    const price = priceOf(catalog, item.id);
    return {
        id: item.id,
        count: item.count,
        price,
        weight: item.weight ?? 0.25,
        sum: price * item.count,
    };
}

/** Промокод снимает долю от суммы, но не больше потолка. */
export function applyDiscount(order, promo) {
    if (!promo) return order.subtotal;
    const share = promo.percent / 100;
    const discount = Math.min(order.subtotal * share, promo.max ?? Infinity);
    return round(order.subtotal - discount);
}

/** Доставка бесплатна от порога, иначе считается по весу. */
export function deliveryCost(order, promo) {
    const total = applyDiscount(order, promo);
    if (total >= FREE_FROM) return 0;
    return round(Math.max(order.weight * 60, 200));
}

/** Итог заказа: товары, доставка и налог отдельными строками. */
export function grandTotal(order, promo, taxRate = 0.2) {
    const goods = applyDiscount(order, promo);
    const delivery = deliveryCost(order, promo);
    const tax = (goods + delivery) * taxRate;
    return { goods: round(goods), delivery, tax: round(tax), total: round(goods + delivery + tax) };
}

function round(value) {
    return Math.round(value * 100) / 100;
}
`;

const DEMO = {
    "README.md": `# orderflow\n\nСервис заказов: расчёт стоимости, скидки и доставка.\n\n- \`npm test\` — тесты\n- \`npm run dev\` — запуск\n`,
    "package.json": `{\n  "name": "orderflow",\n  "version": "2.4.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "node src/server.js",\n    "test": "node --test tests/*.test.js"\n  }\n}\n`,
    "src/server.js": `import { createServer } from "node:http";\nimport { buildOrder, grandTotal } from "./order.js";\nimport { loadCatalog } from "./catalog.js";\n\nconst PORT = Number(process.env.PORT ?? 3000);\nconst catalog = await loadCatalog();\n\nconst server = createServer(async (request, response) => {\n    const url = new URL(request.url, \`http://localhost:\${PORT}\`);\n\n    if (url.pathname === "/order" && request.method === "POST") {\n        const body = await readJson(request);\n        const order = buildOrder(body.items, catalog);\n        respond(response, 201, grandTotal(order, body.promo));\n        return;\n    }\n\n    respond(response, 404, { error: "не найдено" });\n});\n\nserver.listen(PORT);\n`,
    "src/order.js": ORDER_JS,
    "src/catalog.js": `import { readFile } from "node:fs/promises";\n\nlet cached = null;\n\n/** Каталог товаров читается один раз и живёт в памяти. */\nexport async function loadCatalog() {\n    if (cached) return cached;\n    cached = JSON.parse(await readFile(new URL("../data/catalog.json", import.meta.url), "utf8"));\n    return cached;\n}\n\nexport function priceOf(catalog, id) {\n    const item = catalog.items.find((entry) => entry.id === id);\n    if (!item) throw new Error(\`нет товара: \${id}\`);\n    return item.price;\n}\n`,
    "src/report.py": `"""Сводка по заказам: выручка, средний чек и топ товаров."""\nfrom collections import Counter\nfrom dataclasses import dataclass\n\n\n@dataclass\nclass Summary:\n    orders: int\n    revenue: float\n    average: float\n    top: list[tuple[str, int]]\n\n\ndef summarize(orders: list[dict]) -> Summary:\n    revenue = sum(order["total"] for order in orders)\n    counts = Counter(item["id"] for order in orders for item in order["lines"])\n    return Summary(\n        orders=len(orders),\n        revenue=revenue,\n        average=revenue / len(orders) if orders else 0.0,\n        top=counts.most_common(5),\n    )\n`,
    "tests/order.test.js": `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { buildOrder, applyDiscount, grandTotal } from "../src/order.js";\n\nconst catalog = { items: [{ id: "a", price: 100 }, { id: "b", price: 250 }] };\n\ntest("считает сумму заказа", () => {\n    const order = buildOrder([{ id: "a", count: 2 }], catalog);\n    assert.equal(order.subtotal, 200);\n});\n\ntest("промокод уважает потолок скидки", () => {\n    const order = buildOrder([{ id: "b", count: 4 }], catalog);\n    assert.equal(applyDiscount(order, { percent: 50, max: 300 }), 700);\n});\n\ntest("итог включает доставку и налог", () => {\n    const order = buildOrder([{ id: "a", count: 1 }], catalog);\n    const total = grandTotal(order, null);\n    assert.equal(total.delivery, 200);\n});\n`,
    "data/catalog.json": `{\n  "items": [\n    { "id": "a", "title": "Кабель", "price": 100 },\n    { "id": "b", "title": "Адаптер", "price": 250 }\n  ]\n}\n`,
    "data/notes.md": `# Заметки\n\n- очередь отправки: 3 попытки, потом в отложенные\n- скидка не суммируется с бонусами\n`,
};

/** Разложить демонстрационный проект по каталогу. */
async function writeDemo(dir) {
    for (const [relative, contents] of Object.entries(DEMO)) {
        const full = path.join(dir, relative);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, contents, "utf8");
    }
}

module.exports = { DEMO, writeDemo };
