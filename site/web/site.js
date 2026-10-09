"use strict";

// Shared by every page, and every page works without it: the menu closing, the nav surface, the
// download buttons for this computer.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // The phone menu closes after a choice, or a tap anywhere else.
  var menu = $("details.nav__menu");
  if (menu) {
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) menu.removeAttribute("open"); });
    document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.removeAttribute("open"); });
  }

  // The nav bar becomes a surface once there is content under it.
  var nav = $("#nav");
  if (nav) {
    var sync = function () { nav.classList.toggle("is-stuck", window.scrollY > 16); };
    window.addEventListener("scroll", sync, { passive: true });
    sync();
  }

  var groups = $$("[data-dl-group]");
  if (!groups.length) return;

  // Put the button for this computer first.
  var ua = navigator.userAgent || "";
  var phone = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var mine = phone ? "other" : /Windows/i.test(ua) ? "windows" : /Macintosh|Mac OS X/i.test(ua) ? "macos" : "other";
  if (mine === "macos") groups.forEach(function (g) { g.classList.add("is-mac"); });
  if (phone) {
    document.documentElement.classList.add("is-phone");
    $$("[data-dl-note]").forEach(function (n) { n.textContent = "NONON is for Windows and Mac computers. Open this page on your computer to download it."; });
  }

  // Point the buttons at the real files and show version and size, from the same API as /download.
  function formatSize(bytes) {
    var mb = bytes / (1024 * 1024);
    return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
  }
  fetch("/api/latest", { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
    .then(function (data) {
      if (!data || data.available !== true || !Array.isArray(data.files)) return;
      var found = {};
      data.files.forEach(function (f) {
        var ext = f.name.slice(-4).toLowerCase();
        if (f.platform === "windows" && ext === ".exe" && !found.windows) found.windows = f;
        if (f.platform === "macos" && ext === ".dmg" && !found.macos) found.macos = f;
      });
      var parts = [];
      ["windows", "macos"].forEach(function (key) {
        var label = key === "windows" ? "Windows" : "Mac";
        var file = found[key];
        parts.push(file ? label + " " + formatSize(file.size) : label + " not published yet");
        if (!file || typeof file.url !== "string" || file.url.indexOf("/dl/") !== 0) return;
        $$('[data-dl="' + key + '"]').forEach(function (b) {
          b.setAttribute("href", file.url);
          b.setAttribute("download", file.name);
        });
        $$('[data-dl-sub="' + key + '"]').forEach(function (n) { n.textContent = "Download for " + (key === "windows" ? "Windows 10 or 11 (64-bit)" : "Macs with Apple silicon") + ". " + formatSize(file.size) + "."; });
      });
      $$("[data-dl-version]").forEach(function (l) {
        l.textContent = "Version " + data.version + ". " + parts.join(". ") + ".";
      });
    })
    .catch(function () { /* the buttons already lead to /download, which explains what is going on */ });
})();
