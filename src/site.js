/* Поведение сайта: мобильное меню, поиск по руководству, оглавление раздела,
   прогресс чтения, кнопка «наверх», копирование примеров кода.
   Зависимостей нет и запросов в сеть нет: поисковый индекс — это assets/search-index.js. */
(function () {
    "use strict";

    var body = document.body;

    /* ── отступ якоря под шапку ───────────────────────────────────────── */

    /* Переход по `#якорю` не должен прятать заголовок под липкую шапку. Высота
       шапки не постоянная: на узком экране у страниц без бокового меню разделы
       сайта уезжают во вторую строку, и `--topbar_height` из CSS отстаёт на
       сорок пикселей. Поэтому меряем фактическую высоту — при загрузке и после
       изменения размера окна. */
    var topbar = document.querySelector(".topbar");

    function fitScrollPadding() {
        if (!topbar) return;
        var height = Math.round(topbar.getBoundingClientRect().height);
        document.documentElement.style.scrollPaddingTop = height + 16 + "px";
    }

    fitScrollPadding();
    window.addEventListener("resize", fitScrollPadding);

    /* ── мобильное меню ───────────────────────────────────────────────── */

    var navToggle = document.getElementById("nav_toggle");
    var sidebar = document.getElementById("sidebar");

    if (navToggle && sidebar) {
        navToggle.addEventListener("click", function () {
            var open = sidebar.classList.toggle("is_open");
            navToggle.setAttribute("aria-expanded", open ? "true" : "false");
        });
    }

    /* ── поиск по руководству ─────────────────────────────────────────── */

    var searchIndex = (window.CHUI_SEARCH_INDEX && window.CHUI_SEARCH_INDEX.entries) || [];
    var input = document.getElementById("search_input");
    var list = document.getElementById("search_results");
    var items = [];
    var cursor = -1;

    function escapeHtml(text) {
        return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function markHit(text, query) {
        var at = text.toLowerCase().indexOf(query);
        if (at < 0) return escapeHtml(text);
        return (
            escapeHtml(text.slice(0, at)) +
            "<mark>" +
            escapeHtml(text.slice(at, at + query.length)) +
            "</mark>" +
            escapeHtml(text.slice(at + query.length))
        );
    }

    /* Слова запроса ищутся как подстрока; если так не вышло — по началам слов
       («пкф» находит «поиск по проекту…»). Заголовок весит больше описания. */
    function score(entry, words) {
        var title = entry.t.toLowerCase();
        var text = (entry.d || "").toLowerCase();
        var total = 0;
        for (var position = 0; position < words.length; position += 1) {
            var word = words[position];
            if (!word) continue;
            if (title.indexOf(word) === 0) total += 6;
            else if (title.indexOf(word) > 0) total += 4;
            else if (text.indexOf(word) >= 0) total += 2;
            else {
                var initials = title
                    .split(/[^a-zа-я0-9]+/i)
                    .map(function (part) {
                        return part.charAt(0);
                    })
                    .join("");
                if (word.length > 1 && initials.indexOf(word) >= 0) total += 1;
                else return -1;
            }
        }
        return total;
    }

    function closeResults() {
        if (!list) return;
        list.hidden = true;
        list.innerHTML = "";
        items = [];
        cursor = -1;
        if (input) input.setAttribute("aria-expanded", "false");
    }

    function paint() {
        if (!list) return;
        for (var index = 0; index < items.length; index += 1) {
            items[index].classList.toggle("is_active", index === cursor);
        }
    }

    function runSearch(query) {
        if (!input || !list) return;
        var clean = query.trim().toLowerCase();
        if (clean.length < 2) {
            closeResults();
            return;
        }
        var words = clean.split(/\s+/);
        var found = [];
        for (var position = 0; position < searchIndex.length; position += 1) {
            var value = score(searchIndex[position], words);
            if (value >= 0) found.push({ entry: searchIndex[position], value: value });
        }
        found.sort(function (left, right) {
            return right.value - left.value || left.entry.t.length - right.entry.t.length;
        });
        found = found.slice(0, 12);

        list.innerHTML = "";
        items = [];
        if (!found.length) {
            var empty = document.createElement("li");
            empty.className = "search_empty";
            empty.textContent = "Ничего не нашлось — попробуйте другое слово.";
            list.appendChild(empty);
            list.hidden = false;
            input.setAttribute("aria-expanded", "true");
            return;
        }

        found.forEach(function (hit, position) {
            var item = document.createElement("li");
            var link = document.createElement("a");
            link.href = hit.entry.u;
            link.innerHTML =
                "<b>" + markHit(hit.entry.t, words[0]) + "</b><small>" + escapeHtml(hit.entry.p) + "</small>";
            link.addEventListener("mouseenter", function () {
                cursor = position;
                paint();
            });
            item.appendChild(link);
            list.appendChild(item);
            items.push(link);
        });
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        cursor = -1;
        paint();
    }

    if (input && list) {
        input.addEventListener("input", function () {
            runSearch(input.value);
        });
        input.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeResults();
                input.blur();
                return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!items.length) return;
                event.preventDefault();
                cursor = (cursor + (event.key === "ArrowDown" ? 1 : -1) + items.length + 1) % (items.length + 1 || 1);
                if (cursor === items.length) cursor = event.key === "ArrowDown" ? 0 : items.length - 1;
                paint();
                return;
            }
            if (event.key === "Enter" && cursor >= 0 && items[cursor]) {
                event.preventDefault();
                window.location.href = items[cursor].href;
            }
        });
        document.addEventListener("click", function (event) {
            if (event.target !== input && !list.contains(event.target)) closeResults();
        });
    }

    document.addEventListener("keydown", function (event) {
        var tag = (event.target.tagName || "").toLowerCase();
        var typing = tag === "input" || tag === "textarea" || event.target.isContentEditable;
        if (typing) return;
        if (event.key === "/" && input) {
            event.preventDefault();
            input.focus();
            input.select();
        }
    });

    /* ── копирование примеров кода ────────────────────────────────────── */

    var blocks = document.querySelectorAll("pre");
    for (var blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        (function (pre) {
            var text = pre.textContent;
            var button = document.createElement("button");
            button.type = "button";
            button.className = "copy_button";
            button.textContent = "Копировать";
            /* Кнопка встаёт в полосу над кодом, если она есть: там же подпись языка. */
            var head = pre.parentElement && pre.parentElement.querySelector(".code_head");
            button.addEventListener("click", function () {
                var done = function () {
                    button.textContent = "Скопировано";
                    button.classList.add("is_done");
                    window.setTimeout(function () {
                        button.textContent = "Копировать";
                        button.classList.remove("is_done");
                    }, 1600);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, function () {});
                }
            });
            if (head) head.appendChild(button);
            else pre.appendChild(button);
        })(blocks[blockIndex]);
    }

    /* ── оглавление раздела: подсветка текущего пункта ────────────────── */

    /* Подразделы живут в правой колонке «На этой странице». */
    var tocLinks = document.querySelectorAll(".page_toc a, .nav_sub a");
    var headings = [];
    for (var linkIndex = 0; linkIndex < tocLinks.length; linkIndex += 1) {
        var id = (tocLinks[linkIndex].getAttribute("href") || "").slice(1);
        var heading = id ? document.getElementById(id) : null;
        if (heading) headings.push({ id: id, element: heading });
    }

    function markCurrent() {
        if (!headings.length) return;
        var active = headings[0];
        for (var headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
            if (headings[headingIndex].element.getBoundingClientRect().top <= 120) active = headings[headingIndex];
        }
        for (var position = 0; position < tocLinks.length; position += 1) {
            tocLinks[position].classList.toggle(
                "is_active",
                tocLinks[position].getAttribute("href") === "#" + active.id
            );
        }
    }

    /* ── прогресс чтения и кнопка «наверх» ────────────────────────────── */

    var progress = null;
    if (document.body.getAttribute("data-page") === "guide") {
        progress = document.createElement("div");
        progress.className = "progress";
        document.body.appendChild(progress);
    }

    var backTop = document.createElement("button");
    backTop.type = "button";
    backTop.className = "back_top";
    backTop.textContent = "↑";
    backTop.setAttribute("aria-label", "Наверх");
    backTop.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.body.appendChild(backTop);

    function onScroll() {
        var height = document.documentElement.scrollHeight - window.innerHeight;
        var ratio = height > 0 ? Math.min(window.scrollY / height, 1) : 0;
        if (progress) progress.style.width = (ratio * 100).toFixed(2) + "%";
        backTop.classList.toggle("is_visible", window.scrollY > 600);
        markCurrent();
    }

    var scheduled = false;
    window.addEventListener(
        "scroll",
        function () {
            if (scheduled) return;
            scheduled = true;
            window.requestAnimationFrame(function () {
                scheduled = false;
                onScroll();
            });
        },
        { passive: true }
    );
    onScroll();
})();
