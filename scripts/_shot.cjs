/**
 * Временный скрипт съёмки: поднимает настоящее окно IDE с демонстрационным
 * проектом, открывает файлы и кладёт кадр в src/shots сайта.
 *
 * Запуск из папки приложения:
 *   cd /home/dethmond/PROJECTS/GITHUB/chui_ide
 *   npx electron --no-sandbox <путь>/scripts/_shot.cjs editor.png wide
 *   npx electron --no-sandbox <путь>/scripts/_shot.cjs assistant.png panel
 *
 * Режимы: `wide` — правая панель скрыта, редактор во всю ширину;
 * `panel` — как окно открывается само: справа панель ассистента.
 * После съёмки файл можно удалить: он нужен был один раз.
 */
const { app, nativeTheme } = require("electron");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_ROOT = process.cwd();
const SITE_ROOT = path.resolve(__dirname, "..");

/* Electron кладёт в argv и путь скрипта, и свои ключи: берём только наши два слова. */
const words = process.argv.slice(1).filter((item) => !item.startsWith("-") && !item.endsWith(".cjs"));
const outName = words[0] ?? "editor.png";
const mode = words[1] ?? "wide";

const { registerAppScheme, serveRenderer } = require(path.join(APP_ROOT, "dist/main/protocol.js"));
const { SettingsStore } = require(path.join(APP_ROOT, "dist/main/settings.js"));
const { WorkspaceService } = require(path.join(APP_ROOT, "dist/main/workspace/workspace.js"));
const { GitService } = require(path.join(APP_ROOT, "dist/main/git/git.js"));
const { AiService } = require(path.join(APP_ROOT, "dist/main/ai/service.js"));
const { TerminalService } = require(path.join(APP_ROOT, "dist/main/terminal/terminal.js"));
const { registerIpc } = require(path.join(APP_ROOT, "dist/main/ipc/register.js"));
const { HostClient } = require(path.join(APP_ROOT, "dist/main/ipc/host.js"));
const { pushToRenderers } = require(path.join(APP_ROOT, "dist/main/ipc/push.js"));
const { openIdeWindow } = require(path.join(APP_ROOT, "dist/main/window.js"));
const { writeDemo } = require(path.join(__dirname, "_demo.cjs"));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (text) => console.log(`[съёмка] ${text}`);
const ask = (win, expression) => win.webContents.executeJavaScript(expression, true);

/** Клик по строке дерева: так файл открывает человек. */
const clickRow = (win, name, kind) =>
    ask(
        win,
        `(async () => {
            const row = [...document.querySelectorAll('.tree-row')].find(
                (item) => item.querySelector('.tree-name')?.textContent === ${JSON.stringify(name)},
            );
            if (!row) return 'нет строки';
            row.dispatchEvent(new MouseEvent('${kind}', { bubbles: true, detail: 2 }));
            await new Promise((resolve) => setTimeout(resolve, 800));
            return 'ок';
        })()`
    );

/** Открыть нужную вкладку файла: активной должна быть она, а не беседа. */
const activateTab = (win, label) =>
    ask(
        win,
        `(async () => {
            const tab = [...document.querySelectorAll('.tab')].find(
                (item) => item.querySelector('.tab-label')?.textContent === ${JSON.stringify(label)},
            );
            if (!tab) return 'нет вкладки';
            tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 500));
            const active = document.querySelector('.tab.is-active .tab-label')?.textContent;
            return 'активна: ' + active;
        })()`
    );

/** Свернуть правую панель: в широком кадре она не нужна. */
const hideRightPanel = (win) =>
    ask(
        win,
        `(async () => {
            const root = document.querySelector('.app');
            if (!root) return 'нет корня';
            root.classList.add('is-right-hidden');
            await new Promise((resolve) => setTimeout(resolve, 400));
            const panel = document.querySelector('.right-panel');
            return 'панель: ' + (getComputedStyle(panel).display === 'none' ? 'скрыта' : 'всё ещё видна');
        })()`
    );

/** Ставим каретку в начало файла: в кадре не нужны случайные выделения. */
const resetCursor = (win) =>
    ask(
        win,
        `(async () => {
            const view = document.querySelector('.editor-host .view-lines, .editor-host .lines, .editor-host');
            view?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300, clientY: 120 }));
            view?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 300, clientY: 120 }));
            await new Promise((resolve) => setTimeout(resolve, 200));
            return 'ок';
        })()`
    );

const STATE = `(() => {
    const island = document.querySelector('.editor-island');
    return {
        активная_вкладка: document.querySelector('.tab.is-active .tab-label')?.textContent ?? null,
        вкладки: [...document.querySelectorAll('.tab')].map((tab) => tab.textContent.trim()),
        правая_панель: document.querySelector('.app')?.classList.contains('is-right-hidden') ? 'скрыта' : 'видна',
        строка_состояния: document.querySelector('.statusbar')?.innerText?.replace(/\\n/g, ' | ') ?? null,
        текста_в_редакторе: (island?.innerText ?? '').split('\\n').filter(Boolean).length,
    };
})()`;

registerAppScheme();

app.whenReady().then(async () => {
    nativeTheme.themeSource = "dark";

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chui-hero-"));
    const project = path.join(dir, "orderflow");
    await writeDemo(project);
    step(`проект: ${project}, режим: ${mode}, файл: ${outName}`);

    serveRenderer();
    const settings = new SettingsStore(path.join(dir, "settings.json"));
    const workspace = new WorkspaceService((topic, payload) => pushToRenderers(topic, payload));
    const git = new GitService(
        () => workspace.rootPath(),
        (topic, payload) => pushToRenderers(topic, payload)
    );
    const ai = new AiService(settings, workspace);
    const terminals = new TerminalService((topic, payload) => pushToRenderers(topic, payload));
    registerIpc({ settings, workspace, ai, terminals, git, host: new HostClient() });

    await workspace.open(project);
    step("проект открыт");

    const win = openIdeWindow();
    await wait(4000);

    for (const name of ["src", "tests"]) step(`раскрываю ${name}: ${await clickRow(win, name, "click")}`);
    for (const name of ["server.js", "order.js", "report.py"]) {
        step(`открываю ${name}: ${await clickRow(win, name, "dblclick")}`);
    }
    step(`вкладка: ${await activateTab(win, "order.js")}`);
    if (mode === "wide") step(`правая панель: ${await hideRightPanel(win)}`);
    await resetCursor(win);
    await wait(1800);

    step(`состояние: ${JSON.stringify(await ask(win, STATE))}`);

    const image = await win.capturePage();
    const target = path.join(SITE_ROOT, "src", "shots", outName);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, image.toPNG());
    const size = image.getSize();
    step(`снимок: ${target} (${size.width}×${size.height})`);

    terminals.dispose();
    workspace.dispose();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    app.exit(0);
});
