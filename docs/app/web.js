// RD SK on the web (and installed on a computer as an app): stands in for the phone's native bridge where a browser
// can do the same job — Google sign-in (Google Identity Services, the "RD SK Web" client), Google's file picker for
// shared sheets, opening Gemini — and leaves everything else to the app's normal browser fallbacks.
(function () {
  window.RDSK_WEB = true;
  var CLIENT_ID = "147860100026-3kvu6654t14hgmg0c3v9l85oqifocts8.apps.googleusercontent.com";
  var SCOPE = "https://www.googleapis.com/auth/drive.file email";
  var ACC_KEY = "rdsk.web.account", TOK_KEY = "rdsk.web.token";
  var gisReady = null, client = null, pending = null;

  function load(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement("script"); s.src = src; s.async = true; s.onload = ok;
      s.onerror = function () { bad(new Error("Couldn't load " + src.replace(/^https:\/\//, "").split("/")[0])); };
      document.head.appendChild(s);
    });
  }
  function gis() {
    if (!gisReady) gisReady = load("https://accounts.google.com/gsi/client").then(function () {
      client = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: function (r) {
        var p = pending; pending = null; if (!p) return;
        if (r.error) p.reject(new Error(r.error_description || r.error)); else p.resolve(r);
      }, error_callback: function (e) { var p = pending; pending = null; if (p) p.reject(new Error(e && e.type === "popup_closed" ? "cancelled" : (e && e.message) || "Sign-in window closed")); } });
    });
    return gisReady;
  }
  function saved() { try { var t = JSON.parse(sessionStorage.getItem(TOK_KEY) || localStorage.getItem(TOK_KEY) || "null"); return t && t.exp > Date.now() + 60e3 ? t : null; } catch (e) { return null; } }
  function keep(r) {
    var t = { token: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000 };
    try { localStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch (e) {}
    return t.token;
  }
  /** Opens Google's sign-in window (must follow a tap: browsers block pop-ups otherwise). */
  function ask(prompt) {
    return gis().then(function () {
      return new Promise(function (resolve, reject) {
        pending = { resolve: resolve, reject: reject };
        var acc = localStorage.getItem(ACC_KEY) || "";
        client.requestAccessToken({ prompt: prompt, login_hint: prompt === "select_account" ? undefined : acc || undefined });
      });
    });
  }
  function email(token) {
    return fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + token } })
      .then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) { return j.email || ""; }).catch(function () { return ""; });
  }
  function done(id, ok, val, acc) { if (window.rdGoogleDone) window.rdGoogleDone(id, ok, val, acc || localStorage.getItem(ACC_KEY) || ""); }

  window.Android = {
    // Google sign-in: pick an account, then remember it for this browser
    googleChooseAccount: function (id) {
      ask("select_account").then(function (r) {
        var tok = keep(r);
        return email(tok).then(function (em) { if (em) localStorage.setItem(ACC_KEY, em); done(id, true, tok, em); });
      }).catch(function (e) { done(id, false, e.message === "cancelled" ? "cancelled" : "setup|" + e.message); });
    },
    // A token: the saved one while valid; otherwise only with a tap (interactive), as browsers require
    googleToken: function (id, interactive) {
      var t = saved(); if (t) return done(id, true, t.token);
      if (!localStorage.getItem(ACC_KEY)) return done(id, false, "not-signed-in");
      if (!interactive) return done(id, false, "consent-needed");
      ask("").then(function (r) { done(id, true, keep(r)); }).catch(function (e) { done(id, false, e.message === "cancelled" ? "cancelled" : e.message); });
    },
    googleAccount: function () { return localStorage.getItem(ACC_KEY) || ""; },
    googleSignOut: function () {
      var t = saved(); try { if (t && window.google && google.accounts) google.accounts.oauth2.revoke(t.token, function () {}); } catch (e) {}
      localStorage.removeItem(ACC_KEY); localStorage.removeItem(TOK_KEY);
    },
    googleClearToken: function () { localStorage.removeItem(TOK_KEY); },
    // Google's file picker, straight in the page (for a sheet a co-author shared with you)
    pickSharedSheet: function (id, token) {
      var cfgReady = window.RDSK_PICKER ? Promise.resolve() : load("../picker-config.js");
      cfgReady.then(function () { return load("https://apis.google.com/js/api.js"); }).then(function () {
        gapi.load("picker", function () {
          var cfg = window.RDSK_PICKER || {};
          var view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setOwnedByMe(false).setMode(google.picker.DocsViewMode.LIST);
          new google.picker.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId)
            .setTitle("Choose the RD SK sheet shared with you").setCallback(function (d) {
              if (d.action === google.picker.Action.PICKED) window.rdPicked(id, d.docs[0].id, d.docs[0].name, "");
              else if (d.action === google.picker.Action.CANCEL) window.rdPicked(id, "", "", "");
            }).build().setVisible(true);
        });
      }).catch(function (e) { window.rdPicked(id, "", "", "The file picker couldn't load: " + e.message); });
    },
    openGemini: function () { window.open("https://gemini.google.com/app", "_blank"); return "link"; },
    openInBrowser: function (u) { window.open(u, "_blank"); },
    openUrl: function (u) { window.open(u, "_blank"); }
  };

  // installable app: offline cache + "Install RD SK" on computers
  window.RDSK_INSTALL = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); window.RDSK_INSTALL = e; if (window.render) try { render(); } catch (x) {} });
  window.addEventListener("appinstalled", function () { window.RDSK_INSTALL = null; if (window.toast) toast("RD SK is installed: find it in your Start menu / Launchpad"); });
  if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
})();
