/**
 * Claude Agent SSE 对话式渲染：仅展示正文/思考/工具/结果，省略 meta、seq 等元数据。
 * 使用 `window.ClaudeSseRender.appendEvent(logEl, eventName, payload)`。
 */
(function (global) {
  function prettyJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  }

  function textOf(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
    }
    return "";
  }

  function thinkingText(block) {
    if (!block || typeof block !== "object") return "";
    if (typeof block.thinking === "string") return block.thinking;
    if (typeof block.text === "string") return block.text;
    if (Array.isArray(block.content)) {
      return block.content
        .map(function (c) {
          if (c && typeof c === "object" && c.type === "text") return c.text || "";
          if (c && typeof c === "object" && c.type === "thinking") return thinkingText(c);
          return textOf(c);
        })
        .filter(Boolean)
        .join("\n");
    }
    if (block.content != null) return textOf(block.content);
    return "";
  }

  function toolResultBody(block) {
    var resultBody = "";
    if (typeof block.content === "string") resultBody = block.content;
    else if (Array.isArray(block.content)) {
      resultBody = block.content
        .map(function (c) {
          if (c && typeof c === "object" && c.type === "text") return c.text || "";
          if (c && typeof c === "object" && c.type === "thinking") return thinkingText(c);
          return textOf(c);
        })
        .filter(Boolean)
        .join("\n");
    } else if (block.content != null) {
      var t = textOf(block.content);
      resultBody = t || prettyJson(block.content);
    }
    return resultBody;
  }

  function scrollLog(logEl) {
    logEl.scrollTop = logEl.scrollHeight;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  function appendScrollPre(parent, text) {
    var s = text == null ? "" : String(text).trim();
    if (!s) return;
    parent.appendChild(el("pre", "chat-scroll-pre", s));
  }

  /** 创建对话轮次容器 */
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

  function appendTextPart(bubble, text, extraClass) {
    var body = text == null ? "" : String(text).trim();
    if (!body) return;
    bubble.appendChild(el("div", "chat-text" + (extraClass ? " " + extraClass : ""), body));
  }

  function renderBlockText(bubble, block) {
    appendTextPart(bubble, block && block.text != null ? block.text : "");
  }

  function renderBlockThinking(bubble, block) {
    var body = thinkingText(block).trim();
    if (!body) return;
    var wrap = el("div", "chat-thinking");
    wrap.appendChild(el("div", "chat-thinking-label", "思考"));
    wrap.appendChild(el("div", "chat-text chat-text-thinking", body));
    bubble.appendChild(wrap);
  }

  function renderBlockToolUse(bubble, block) {
    var name = block.name != null ? String(block.name).trim() : "";
    var inputBody = block.input != null ? prettyJson(block.input).trim() : "";
    if (!name && !inputBody) return;
    var wrap = el("div", "chat-tool");
    wrap.appendChild(el("div", "chat-tool-label", "调用 · " + (name || "工具")));
    if (inputBody) appendScrollPre(wrap, inputBody);
    bubble.appendChild(wrap);
  }

  function renderBlockToolResult(bubble, block) {
    var resultBody = toolResultBody(block).trim();
    if (!resultBody) return;
    var wrap = el("div", "chat-tool" + (block.is_error ? " chat-tool-error" : " chat-tool-result"));
    wrap.appendChild(el("div", "chat-tool-label", block.is_error ? "工具错误" : "工具结果"));
    appendScrollPre(wrap, resultBody);
    bubble.appendChild(wrap);
  }

  function renderBlockUnknown(bubble, block) {
    var body = thinkingText(block).trim() || textOf(block).trim();
    if (body) {
      appendTextPart(bubble, body);
      return;
    }
    if (block && typeof block === "object" && block.input != null) {
      renderBlockToolUse(bubble, block);
    }
  }

  /**
   * 服务端 summarizeSdkMessage 返回 { type, message: <整条 SDK 消息> }；
   * Anthropic 正文在 SDK 信封的 message.message.content（BetaMessage / MessageParam）。
   */
  function resolveAnthropicBody(sdkEnvelope) {
    if (!sdkEnvelope || typeof sdkEnvelope !== "object") return null;
    var nested = sdkEnvelope.message;
    if (nested && typeof nested === "object" && nested.content !== undefined) {
      return nested;
    }
    if (sdkEnvelope.content !== undefined) {
      return sdkEnvelope;
    }
    return null;
  }

  function renderToolUseResultValue(bubble, value, isError) {
    if (value == null) return;
    if (typeof value === "string") {
      renderBlockToolResult(bubble, { type: "tool_result", content: value, is_error: isError });
      return;
    }
    if (typeof value === "object") {
      if (value.type === "tool_result") {
        renderBlockToolResult(bubble, value);
        return;
      }
      if (value.content !== undefined) {
        renderBlockToolResult(bubble, {
          type: "tool_result",
          content: value.content,
          is_error: isError || value.is_error,
        });
        return;
      }
      var asText = textOf(value);
      if (!asText) asText = prettyJson(value);
      if (asText.trim()) {
        renderBlockToolResult(bubble, { type: "tool_result", content: asText, is_error: isError });
      }
    }
  }

  function renderContentBlocks(bubble, content) {
    if (content == null) return;
    if (typeof content === "string") {
      renderBlockText(bubble, { type: "text", text: content });
      return;
    }
    if (!Array.isArray(content)) {
      renderBlockUnknown(bubble, content);
      return;
    }
    content.forEach(function (block) {
      if (block == null) return;
      if (typeof block === "string") {
        renderBlockText(bubble, { type: "text", text: block });
        return;
      }
      var type = block.type || "unknown";
      if (type === "text") {
        renderBlockText(bubble, block);
        return;
      }
      if (type === "thinking") {
        renderBlockThinking(bubble, block);
        return;
      }
      if (type === "tool_use") {
        renderBlockToolUse(bubble, block);
        return;
      }
      if (type === "tool_result") {
        renderBlockToolResult(bubble, block);
        return;
      }
      renderBlockUnknown(bubble, block);
    });
  }

  function renderMessageTurn(logEl, role, sdkEnvelope) {
    if (!sdkEnvelope || typeof sdkEnvelope !== "object") return;
    var turn = createTurn(role);
    var body = resolveAnthropicBody(sdkEnvelope);
    if (body) {
      if (body.content !== undefined) {
        renderContentBlocks(turn.bubble, body.content);
      } else if (typeof body.text === "string") {
        renderBlockText(turn.bubble, { type: "text", text: body.text });
      }
    }
    if (sdkEnvelope.tool_use_result !== undefined && sdkEnvelope.tool_use_result !== null) {
      renderToolUseResultValue(turn.bubble, sdkEnvelope.tool_use_result, false);
    }
    mountTurn(logEl, turn);
  }

  function renderClaudePayload(logEl, inner) {
    if (!inner || typeof inner !== "object") return;
    var type = inner.type != null ? String(inner.type) : "unknown";

    if (type === "assistant" || type === "user") {
      renderMessageTurn(logEl, type, inner.message || inner);
      return;
    }

    if (type === "result") {
      if (inner.is_error) {
        var errs = inner.errors;
        var errText = Array.isArray(errs) ? errs.join("\n") : errs != null ? String(errs) : "执行失败";
        if (String(errText).trim()) {
          var errTurn = createTurn("error");
          errTurn.bubble.appendChild(el("div", "chat-text", errText));
          mountTurn(logEl, errTurn);
        }
      } else if (inner.result != null && String(inner.result).trim()) {
        var resTurn = createTurn("assistant");
        resTurn.bubble.appendChild(el("div", "chat-text", String(inner.result)));
        mountTurn(logEl, resTurn);
      }
      return;
    }

    if (type === "system" && inner.subtype === "init") {
      return;
    }

    /* summarizeSdkMessage 对其余类型返回 { type, message: msg }，再尝试解析正文 */
    if (inner.message && typeof inner.message === "object") {
      var msg = inner.message;
      var msgType = msg.type != null ? String(msg.type) : "";
      if (msgType === "assistant" || msgType === "user") {
        renderMessageTurn(logEl, msgType, msg);
        return;
      }
      var body = resolveAnthropicBody(msg);
      if (body && body.content !== undefined) {
        renderMessageTurn(logEl, "assistant", msg);
      }
    }
  }

  function appendSystemLine(logEl, text, variant) {
    var line = el("div", "chat-system" + (variant ? " chat-system-" + variant : ""), text);
    logEl.appendChild(line);
    scrollLog(logEl);
  }

  /** 流结束标识（成功 / 失败），同一次订阅只展示一次 */
  function appendEndMarker(logEl, failed) {
    if (!logEl || logEl.dataset.streamEnded === "1") return;
    logEl.dataset.streamEnded = "1";
    appendSystemLine(logEl, failed ? "— 执行结束（失败）—" : "— 执行结束 —", failed ? "error" : "done");
  }

  function appendEvent(logEl, eventName, payload) {
    if (!logEl) return;

    if (typeof payload === "string") {
      if (eventName === "error") {
        appendSystemLine(logEl, payload, "error");
      }
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
            ? textOf(payload) || prettyJson(payload)
            : "未知错误";
      if (String(errMsg).trim()) {
        appendSystemLine(logEl, errMsg, "error");
      }
      return;
    }

    if (payload && payload.type === "meta") {
      return;
    }

    var inner = payload;
    if (payload && payload.channel === "claude" && payload.payload != null) {
      inner = payload.payload;
    }

    renderClaudePayload(logEl, inner);
  }

  function clearLog(logEl) {
    if (!logEl) return;
    logEl.innerHTML = "";
    delete logEl.dataset.streamEnded;
  }

  global.ClaudeSseRender = {
    appendEvent: appendEvent,
    appendSystemLine: appendSystemLine,
    appendEndMarker: appendEndMarker,
    clearLog: clearLog,
  };
})(typeof window !== "undefined" ? window : globalThis);
