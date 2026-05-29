/**
 * 公用「自定义下拉」：隐藏域 + combobox 触发器 + listbox，点击外部关闭。
 * 页面引入后使用 `window.UiCombobox.attach(root, options)`。
 *
 * 约定（均在 root 内）：
 * - `input[type="hidden"]`：当前值（可与表单 id 保留）
 * - `.ui-combobox-trigger`：role="combobox" 的触发区域（建议 `flex`，内含展示文案 + 箭头）
 * - `.ui-combobox-value`：展示当前选中项文案
 * - `.ui-combobox-list`：下拉面板（含 `hidden` 控制显隐）
 * - `.ui-combobox-opt`：每项，带 `data-value`（空字符串表示占位如「全部」）
 *
 * 可选：`options.filterable === true` 时，打开后在触发器内与箭头之间显示无边框输入（类 Element UI filterable），按文案与 `data-value` 子串匹配（忽略大小写）。
 */
(function (global) {
  var SEL_HIDDEN = 'input[type="hidden"]';
  var SEL_TRIGGER = ".ui-combobox-trigger";
  var SEL_VALUE = ".ui-combobox-value";
  var SEL_LIST = ".ui-combobox-list";
  var SEL_OPT = ".ui-combobox-opt";
  var LEGACY_LIST_FILTER = ".ui-combobox-filter";

  /**
   * @param {HTMLElement} root
   * @param {object} [options]
   * @param {Record<string, string>|function(string): string} [options.labelMap] 值 → 展示文案（优先于 option 文本）
   * @param {function(string): void} [options.onChange] 用户从列表选择后触发
   * @param {boolean} [options.filterable] 为 true 时在触发器内联筛选（打开时）
   * @param {string} [options.filterPlaceholder] 内联筛选 placeholder，默认「搜索」
   * @returns {{ getValue: function(): string, setValue: function(string, {notify?: boolean}): void, open: function(): void, close: function(): void, sync: function(): void, destroy: function(): void }}
   */
  function attach(root, options) {
    if (!root) throw new Error("UiCombobox.attach: root 不能为空");
    options = options || {};

    var hidden = root.querySelector(SEL_HIDDEN);
    var trigger = root.querySelector(SEL_TRIGGER);
    var display = root.querySelector(SEL_VALUE);
    var list = root.querySelector(SEL_LIST);
    if (!hidden || !trigger || !display || !list) {
      throw new Error("UiCombobox.attach: 缺少 hidden / trigger / value / list 节点");
    }

    var filterInput = null;
    var onFilterClick = null;
    var onFilterInput = null;
    var onFilterKeydown = null;

    function labelForValue(val) {
      if (options.labelMap) {
        if (typeof options.labelMap === "function") {
          var t = options.labelMap(val);
          if (t != null && String(t)) return String(t);
        } else if (Object.prototype.hasOwnProperty.call(options.labelMap, val)) {
          return String(options.labelMap[val]);
        }
      }
      var nodes = list.querySelectorAll(SEL_OPT);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if ((el.getAttribute("data-value") || "") === val) {
          return el.textContent.replace(/\s+/g, " ").trim();
        }
      }
      return "";
    }

    /** 与展示一致：优先 labelMap，否则 option 文本 */
    function optionSearchText(el) {
      var val = el.getAttribute("data-value") || "";
      var fromMap = labelForValue(val);
      var raw = el.textContent.replace(/\s+/g, " ").trim();
      var label = fromMap || raw;
      return (label + " " + val).toLowerCase();
    }

    function applyFilter() {
      if (!filterInput) return;
      var q = filterInput.value.trim().toLowerCase();
      list.querySelectorAll(SEL_OPT).forEach(function (el) {
        var ok = !q || optionSearchText(el).indexOf(q) !== -1;
        el.classList.toggle("hidden", !ok);
      });
    }

    /** 移除旧版「列表顶独立输入框」结构，避免升级后残留 */
    function removeLegacyListFilter() {
      var wrap = list.querySelector(LEGACY_LIST_FILTER);
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    function ensureFilterInline() {
      if (!options.filterable || filterInput) return;
      removeLegacyListFilter();

      var inp = document.createElement("input");
      inp.type = "text";
      inp.setAttribute("inputmode", "search");
      inp.setAttribute("autocomplete", "off");
      inp.setAttribute("aria-label", "搜索选项");
      inp.placeholder = options.filterPlaceholder != null ? String(options.filterPlaceholder) : "搜索";
      inp.className =
        "ui-combobox-filter-inline hidden min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:outline-none focus:ring-0";
      var chevron = trigger.querySelector("svg");
      if (chevron) {
        trigger.insertBefore(inp, chevron);
      } else {
        trigger.appendChild(inp);
      }
      filterInput = inp;

      onFilterClick = function (e) {
        e.stopPropagation();
      };
      onFilterInput = function () {
        applyFilter();
      };
      onFilterKeydown = function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          try {
            trigger.focus();
          } catch (err) {}
        }
      };
      inp.addEventListener("click", onFilterClick);
      inp.addEventListener("input", onFilterInput);
      inp.addEventListener("keydown", onFilterKeydown);
    }

    function setFilterMode(open) {
      if (!options.filterable || !filterInput) return;
      if (open) {
        display.classList.add("hidden");
        filterInput.classList.remove("hidden");
        filterInput.value = "";
        applyFilter();
        requestAnimationFrame(function () {
          try {
            filterInput.focus();
          } catch (e) {}
        });
      } else {
        filterInput.classList.add("hidden");
        display.classList.remove("hidden");
        filterInput.value = "";
        applyFilter();
        try {
          filterInput.blur();
        } catch (e) {}
      }
    }

    function positionList() {
      var rect = trigger.getBoundingClientRect();
      list.style.position = "fixed";
      list.style.left = rect.left + "px";
      list.style.top = rect.bottom + 4 + "px";
      list.style.width = Math.max(rect.width, 120) + "px";
      list.style.minWidth = rect.width + "px";
      list.style.right = "auto";
      list.style.zIndex = list.classList.contains("ui-combobox-list-raised") ? "60" : "40";
    }

    function resetListPosition() {
      list.style.position = "";
      list.style.left = "";
      list.style.top = "";
      list.style.width = "";
      list.style.minWidth = "";
      list.style.right = "";
      list.style.zIndex = "";
    }

    function setOpen(open) {
      if (open) {
        ensureFilterInline();
        list.classList.remove("hidden");
        positionList();
        trigger.setAttribute("aria-expanded", "true");
        setFilterMode(true);
      } else {
        list.classList.add("hidden");
        resetListPosition();
        trigger.setAttribute("aria-expanded", "false");
        setFilterMode(false);
      }
    }

    function sync() {
      var v = hidden.value;
      var nodes = list.querySelectorAll(SEL_OPT);
      nodes.forEach(function (el) {
        var sel = (el.getAttribute("data-value") || "") === v;
        el.setAttribute("aria-selected", sel ? "true" : "false");
        if (sel) {
          el.classList.add("bg-blue-50", "font-medium", "text-blue-900");
        } else {
          el.classList.remove("bg-blue-50", "font-medium", "text-blue-900");
        }
      });
      var text = labelForValue(v);
      if (!text && v !== "") text = labelForValue("");
      display.textContent = text || "—";
    }

    function applyValue(val, fireChange) {
      hidden.value = val;
      sync();
      if (fireChange && options.onChange) options.onChange(val);
    }

    function onDocClick() {
      setOpen(false);
    }

    function onRootClick(e) {
      e.stopPropagation();
    }

    function onTriggerClick(e) {
      e.stopPropagation();
      if (options.filterable && filterInput && (e.target === filterInput || filterInput.contains(e.target))) {
        return;
      }
      var willOpen = list.classList.contains("hidden");
      setOpen(willOpen);
      if (willOpen && !options.filterable) {
        try {
          trigger.focus();
        } catch (err) {}
      }
    }

    function onTriggerKeydown(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var willOpen = list.classList.contains("hidden");
        setOpen(willOpen);
        if (willOpen && !options.filterable) {
          try {
            trigger.focus();
          } catch (err) {}
        }
      } else if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown" && list.classList.contains("hidden")) {
        e.preventDefault();
        setOpen(true);
      }
    }

    function onListClick(e) {
      var opt = e.target.closest(SEL_OPT);
      if (!opt || !list.contains(opt)) return;
      e.stopPropagation();
      applyValue(opt.getAttribute("data-value") || "", true);
      setOpen(false);
    }

    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKeydown);
    list.addEventListener("click", onListClick);
    root.addEventListener("click", onRootClick);
    document.addEventListener("click", onDocClick);

    if (options.filterable) ensureFilterInline();

    sync();

    return {
      getValue: function () {
        return hidden.value;
      },
      /** @param {string} val @param {{notify?: boolean}} [extra] notify 为 true 时同步触发 onChange */
      setValue: function (val, extra) {
        applyValue(val, !!(extra && extra.notify));
      },
      open: function () {
        setOpen(true);
      },
      close: function () {
        setOpen(false);
      },
      sync: sync,
      destroy: function () {
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKeydown);
        list.removeEventListener("click", onListClick);
        root.removeEventListener("click", onRootClick);
        document.removeEventListener("click", onDocClick);
        if (filterInput) {
          if (onFilterClick) filterInput.removeEventListener("click", onFilterClick);
          if (onFilterInput) filterInput.removeEventListener("input", onFilterInput);
          if (onFilterKeydown) filterInput.removeEventListener("keydown", onFilterKeydown);
          if (filterInput.parentNode) filterInput.parentNode.removeChild(filterInput);
          filterInput = null;
        }
        display.classList.remove("hidden");
      },
    };
  }

  global.UiCombobox = { attach: attach };
})(typeof window !== "undefined" ? window : globalThis);
