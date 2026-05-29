/**
 * Cursor Agent SSE 对话式渲染：展示 assistant / thinking / tool_call 等事件。
 * 使用 `window.CursorSseRender.appendEvent(logEl, eventName, payload)`。
 */
(function (global) {
  function prettyJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  function scrollLog(logEl) {
    logEl.scrollTop = logEl.scrollHeight;
  }

  function createTurn(role) {
    var turn = el("div", "chat-turn chat-turn-" + role);
    var bubble = el("div", "chat-bubble");
    turn.appendChild(bubble);
    return { turn: turn, bubble: bubble };
  }

  function mountTurn(logEl, turnObj) {
    if (turnObj.bubble.childNodes.length > 0) {
      logEl.appendChild(turnObj.turn);
      scrollLog(logEl);
    }
  }

  function appendScrollPre(parent, text) {
    var s = text == null ? "" : String(text).trim();
    if (!s) return;
    parent.appendChild(el("pre", "chat-scroll-pre", s));
  }

  function formatToolBody(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return prettyJson(value);
  }

  /** 与 Claude 渲染一致：工具调用参数块 */
  function renderBlockToolUse(bubble, name, input) {
    var inputBody = formatToolBody(input).trim();
    if (!name && !inputBody) return;
    var wrap = el("div", "chat-tool chat-tool-use");
    wrap.appendChild(el("div", "chat-tool-label", "调用 · " + (name || "工具")));
    if (inputBody) appendScrollPre(wrap, inputBody);
    bubble.appendChild(wrap);
  }

  /** 与 Claude 渲染一致：工具结果块（可滚动收敛） */
  function renderBlockToolResult(bubble, result, isError) {
    var resultBody = formatToolBody(result).trim();
    if (!resultBody) return;
    var wrap = el("div", "chat-tool" + (isError ? " chat-tool-error" : " chat-tool-result"));
    wrap.appendChild(el("div", "chat-tool-label", isError ? "工具错误" : "工具结果"));
    appendScrollPre(wrap, resultBody);
    bubble.appendChild(wrap);
  }

  function textBlocks(content) {
    if (!Array.isArray(content)) return "";
    return content
      .map(function (b) {
        if (b && typeof b === "object" && b.type === "text" && typeof b.text === "string") return b.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function renderCursorPayload(logEl, inner) {
    if (!inner || typeof inner !== "object") return;
    var type = inner.type != null ? String(inner.type) : "unknown";

    if (type === "assistant") {
      var turn = createTurn("assistant");
      var text = textBlocks(inner.message && inner.message.content);
      if (text.trim()) turn.bubble.appendChild(el("div", "chat-text", text));
      mountTurn(logEl, turn);
      return;
    }

    if (type === "thinking") {
      var thinkTurn = createTurn("assistant");
      var thinkBody = inner.text != null ? String(inner.text).trim() : "";
      if (thinkBody) {
        var thinkWrap = el("div", "chat-thinking");
        thinkWrap.appendChild(el("div", "chat-thinking-label", "思考"));
        thinkWrap.appendChild(el("div", "chat-text chat-text-thinking", thinkBody));
        thinkTurn.bubble.appendChild(thinkWrap);
      }
      mountTurn(logEl, thinkTurn);
      return;
    }

    if (type === "tool_call") {
      var toolTurn = createTurn("assistant");
      var toolName = inner.name != null ? String(inner.name).trim() : "";
      if (inner.args != null) renderBlockToolUse(toolTurn.bubble, toolName, inner.args);
      if (inner.result != null) {
        var toolFailed = inner.status === "error" || inner.is_error === true;
        renderBlockToolResult(toolTurn.bubble, inner.result, toolFailed);
      }
      if (toolTurn.bubble.childNodes.length === 0) {
        renderBlockToolUse(toolTurn.bubble, toolName || "工具", null);
      }
      mountTurn(logEl, toolTurn);
      return;
    }

    if (type === "user") {
      var userTurn = createTurn("user");
      var userText = textBlocks(inner.message && inner.message.content);
      if (userText.trim()) userTurn.bubble.appendChild(el("div", "chat-text", userText));
      mountTurn(logEl, userTurn);
      return;
    }

    if (type === "status" || type === "system") {
      return;
    }
  }

  function appendSystemLine(logEl, text, variant) {
    var line = el("div", "chat-system" + (variant ? " chat-system-" + variant : ""), text);
    logEl.appendChild(line);
    scrollLog(logEl);
  }

  function appendEndMarker(logEl, failed) {
    if (!logEl || logEl.dataset.streamEnded === "1") return;
    logEl.dataset.streamEnded = "1";
    appendSystemLine(logEl, failed ? "— 执行结束（失败）—" : "— 执行结束 —", failed ? "error" : "done");
  }

  function appendEvent(logEl, eventName, payload) {
    if (!logEl) return;

    if (typeof payload === "string") {
      if (eventName === "error") appendSystemLine(logEl, payload, "error");
      return;
    }

    if (eventName === "done") {
      if (payload && payload.ok === false) {
        var msg = payload.message != null ? String(payload.message) : "执行未完成";
        appendSystemLine(logEl, msg, "error");
        appendEndMarker(logEl, true);
      } else {
        appendEndMarker(logEl, false);
      }
      return;
    }

    if (eventName === "error") {
      var errMsg =
        payload && typeof payload.message === "string"
          ? payload.message
          : payload
            ? prettyJson(payload)
            : "未知错误";
      if (String(errMsg).trim()) appendSystemLine(logEl, errMsg, "error");
      return;
    }

    if (payload && payload.type === "meta") return;

    var inner = payload;
    if (payload && payload.channel === "cursor" && payload.payload != null) {
      inner = payload.payload;
    }

    renderCursorPayload(logEl, inner);
  }

  function clearLog(logEl) {
    if (!logEl) return;
    logEl.innerHTML = "";
    delete logEl.dataset.streamEnded;
  }

  global.CursorSseRender = {
    appendEvent: appendEvent,
    appendSystemLine: appendSystemLine,
    appendEndMarker: appendEndMarker,
    clearLog: clearLog,
  };
})(typeof window !== "undefined" ? window : globalThis);
