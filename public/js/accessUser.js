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
