/** 从 Keycloak tokenParsed 解析汉字姓名：姓 + 名（family_name + given_name） */
function resolveRealNameFromTokenParsed(tokenParsed) {
  if (!tokenParsed) return null;
  var family = String(tokenParsed.family_name || "").trim();
  var given = String(tokenParsed.given_name || "").trim();
  if (family && given) return family + given;
  if (family) return family;
  if (given) return given;
  return null;
}

/** 将 localStorage.userName 同步到 Cookie，并在 fetch 请求中附带 X-User-Name */
(function () {
  function syncUserNameCookie() {
    try {
      var u = localStorage.getItem("userName");
      if (u) {
        document.cookie = "userName=" + encodeURIComponent(u) + "; path=/; SameSite=Lax";
      }
    } catch (e) {}
  }

  syncUserNameCookie();

  var origFetch = window.fetch;
  if (!origFetch) return;

  window.fetch = function (input, init) {
    init = init || {};
    var headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    try {
      var u = localStorage.getItem("userName");
      if (u && !headers.has("X-User-Name")) {
        headers.set("X-User-Name", u);
      }
    } catch (e) {}
    init.headers = headers;
    return origFetch.call(this, input, init);
  };
})();
