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
    logEl.appendChild(turnObj.turn);
    scrollLog(logEl);
  }

  function appendScrollPre(parent, text) {
    var s = text == null ? "" : String(text).trim();
    if (!s) return;
    parent.appendChild(el("pre", "chat-scroll-pre", s));
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
      thinkTurn.bubble.appendChild(el("div", "chat-thinking-label", "思考"));
      appendScrollPre(thinkTurn.bubble, inner.text || "");
      mountTurn(logEl, thinkTurn);
      return;
    }

    if (type === "tool_call") {
      var toolTurn = createTurn("assistant");
      var label = "[tool] " + (inner.name || "?") + " — " + (inner.status || "");
      toolTurn.bubble.appendChild(el("div", "chat-tool-label", label));
      if (inner.args != null) appendScrollPre(toolTurn.bubble, prettyJson(inner.args));
      if (inner.result != null) appendScrollPre(toolTurn.bubble, prettyJson(inner.result));
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
