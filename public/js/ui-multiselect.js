/**
 * 公用「多选下拉」：隐藏域（逗号分隔值）+ 触发器标签区 + checkbox 列表面板。
 * 页面引入后使用 `window.UiMultiselect.attach(root, options)`。
 *
 * 约定（均在 root 内）：
 * - `input[type="hidden"]`：当前值，如 `1,2,3`
 * - `.ui-multiselect-trigger`：role="combobox" 的触发区域
 * - `.ui-multiselect-tags`：展示已选标签（由组件渲染）
 * - `.ui-multiselect-list`：下拉面板（含 `hidden` 控制显隐）
 * - `label.ui-multiselect-opt` + `input[type="checkbox"][data-value]`
 * - 可选 `.ui-multiselect-footer`：预设 / 清空等快捷操作
 */
(function (global) {
  var SEL_HIDDEN = 'input[type="hidden"]';
  var SEL_TRIGGER = ".ui-multiselect-trigger";
  var SEL_TAGS = ".ui-multiselect-tags";
  var SEL_LIST = ".ui-multiselect-list";
  var SEL_OPT = "label.ui-multiselect-opt";
  var SEL_CHECKBOX = 'input[type="checkbox"][data-value]';

  /**
   * @param {HTMLElement} root
   * @param {object} [options]
   * @param {Record<string, string>} [options.labelMap] 值 → 触发器标签短文案
   * @param {string} [options.emptyLabel] 未选时占位文案
   * @param {function(string): void} [options.onChange] 勾选变化后触发（参数为逗号分隔值）
   */
  function attach(root, options) {
    if (!root) throw new Error("UiMultiselect.attach: root 不能为空");
    options = options || {};

    var hidden = root.querySelector(SEL_HIDDEN);
    var trigger = root.querySelector(SEL_TRIGGER);
    var tagsEl = root.querySelector(SEL_TAGS);
    var list = root.querySelector(SEL_LIST);
    if (!hidden || !trigger || !tagsEl || !list) {
      throw new Error("UiMultiselect.attach: 缺少 hidden / trigger / tags / list 节点");
    }

    var emptyLabel = options.emptyLabel != null ? String(options.emptyLabel) : "全部类型";

    function checkboxes() {
      return list.querySelectorAll(SEL_CHECKBOX);
    }

    function labelForValue(val) {
      if (options.labelMap && Object.prototype.hasOwnProperty.call(options.labelMap, val)) {
        return String(options.labelMap[val]);
      }
      var opt = list.querySelector(SEL_OPT + '[data-value="' + val + '"]');
      if (opt) {
        var text = opt.textContent.replace(/\s+/g, " ").trim();
        return text || val;
      }
      return val;
    }

    function parseValue(raw) {
      if (!raw || !String(raw).trim()) return [];
      return String(raw)
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }

    function getSelected() {
      var vals = [];
      checkboxes().forEach(function (cb) {
        if (cb.checked) vals.push(cb.getAttribute("data-value") || "");
      });
      return vals;
    }

    function renderTags(vals) {
      tagsEl.innerHTML = "";
      if (!vals.length) {
        var ph = document.createElement("span");
        ph.className = "ui-multiselect-placeholder";
        ph.textContent = emptyLabel;
        tagsEl.appendChild(ph);
        return;
      }
      vals.forEach(function (v) {
        var tag = document.createElement("span");
        tag.className = "ui-multiselect-tag";
        tag.textContent = labelForValue(v);
        tag.setAttribute("title", labelForValue(v));
        tagsEl.appendChild(tag);
      });
    }

    function syncCheckboxesFromHidden() {
      var set = {};
      parseValue(hidden.value).forEach(function (v) {
        set[v] = true;
      });
      checkboxes().forEach(function (cb) {
        var v = cb.getAttribute("data-value") || "";
        cb.checked = !!set[v];
      });
    }

    function sync() {
      var boxes = checkboxes();
      if (!boxes.length) {
        // 选项未渲染时不要用空 checkbox 列表覆盖 hidden
        renderTags(parseValue(hidden.value));
        return;
      }
      var vals = getSelected();
      hidden.value = vals.join(",");
      renderTags(vals);
      boxes.forEach(function (cb) {
        var opt = cb.closest(SEL_OPT);
        if (opt) opt.setAttribute("aria-selected", cb.checked ? "true" : "false");
      });
    }

    function applySelection(vals, fireChange) {
      var list = (vals || [])
        .map(function (v) {
          return String(v).trim();
        })
        .filter(Boolean);
      var set = {};
      list.forEach(function (v) {
        set[v] = true;
      });
      var boxes = checkboxes();
      if (boxes.length) {
        // 选项已渲染：按 checkbox 勾选后 sync 回写 hidden
        boxes.forEach(function (cb) {
          var v = cb.getAttribute("data-value") || "";
          cb.checked = !!set[v];
        });
        sync();
      } else {
        // 选项尚未渲染：直接写入 hidden，避免 sync 把已设值清空
        hidden.value = list.join(",");
        renderTags(list);
      }
      if (fireChange && options.onChange) options.onChange(hidden.value);
    }

    function positionList() {
      var rect = trigger.getBoundingClientRect();
      list.style.position = "fixed";
      list.style.left = rect.left + "px";
      list.style.top = rect.bottom + 4 + "px";
      list.style.width = Math.max(rect.width, 200) + "px";
      list.style.minWidth = rect.width + "px";
      list.style.right = "auto";
      list.style.zIndex = list.classList.contains("ui-multiselect-list-raised") ? "60" : "40";
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
        list.classList.remove("hidden");
        positionList();
        trigger.setAttribute("aria-expanded", "true");
      } else {
        list.classList.add("hidden");
        resetListPosition();
        trigger.setAttribute("aria-expanded", "false");
      }
    }

    function onDocClick() {
      setOpen(false);
    }

    function onRootClick(e) {
      e.stopPropagation();
    }

    function onTriggerClick(e) {
      e.stopPropagation();
      var willOpen = list.classList.contains("hidden");
      setOpen(willOpen);
    }

    function onTriggerKeydown(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var willOpen = list.classList.contains("hidden");
        setOpen(willOpen);
      } else if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown" && list.classList.contains("hidden")) {
        e.preventDefault();
        setOpen(true);
      }
    }

    function onListChange(e) {
      var cb = e.target;
      if (!cb.matches || !cb.matches(SEL_CHECKBOX)) return;
      sync();
      if (options.onChange) options.onChange(hidden.value);
    }

    function onFooterClick(e) {
      var preset = e.target.closest("[data-preset]");
      if (preset) {
        e.preventDefault();
        e.stopPropagation();
        applySelection(parseValue(preset.getAttribute("data-preset")), true);
        return;
      }
      var clearBtn = e.target.closest("[data-action='clear']");
      if (clearBtn) {
        e.preventDefault();
        e.stopPropagation();
        applySelection([], true);
      }
    }

    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKeydown);
    list.addEventListener("change", onListChange);
    list.addEventListener("click", onFooterClick);
    root.addEventListener("click", onRootClick);
    document.addEventListener("click", onDocClick);

    syncCheckboxesFromHidden();
    sync();

    return {
      getValue: function () {
        return hidden.value;
      },
      getValues: function () {
        // 优先读 hidden：setValue 在选项未渲染时也能保留值
        return parseValue(hidden.value);
      },
      setValue: function (val, extra) {
        applySelection(parseValue(val), !!(extra && extra.notify));
      },
      open: function () {
        setOpen(true);
      },
      close: function () {
        setOpen(false);
      },
      /** 选项 DOM 更新后调用：按 hidden 勾选 checkbox 并刷新标签 */
      syncFromHidden: function () {
        if (!checkboxes().length) {
          renderTags(parseValue(hidden.value));
          return;
        }
        syncCheckboxesFromHidden();
        sync();
      },
      sync: sync,
      destroy: function () {
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKeydown);
        list.removeEventListener("change", onListChange);
        list.removeEventListener("click", onFooterClick);
        root.removeEventListener("click", onRootClick);
        document.removeEventListener("click", onDocClick);
      },
    };
  }

  global.UiMultiselect = { attach: attach };
})(typeof window !== "undefined" ? window : globalThis);
