"use strict";

(function () {
  var state = document.getElementById("dl-state");
  var platforms = document.getElementById("platforms");
  var releaseLine = document.getElementById("release-line");

  function showState(title, message, linkHref, linkText) {
    state.hidden = false;
    state.replaceChildren();
    var h = document.createElement("h2");
    h.textContent = title;
    var p = document.createElement("p");
    p.textContent = message;
    if (linkHref) {
      p.appendChild(document.createTextNode(" "));
      var a = document.createElement("a");
      a.href = linkHref;
      a.textContent = linkText;
      p.appendChild(a);
    }
    state.append(h, p);
    document.getElementById("windows").hidden = true;
    document.getElementById("mac").hidden = true;
    releaseLine.hidden = true;
    document.getElementById("verify").hidden = true;
  }

  function detectPlatform() {
    var ua = navigator.userAgent || "";
    var touch = navigator.maxTouchPoints > 1;
    if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touch)) return "mobile";
    if (/Windows/i.test(ua)) return "windows";
    if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
    return "other";
  }

  function formatSize(bytes) {
    var mb = bytes / 1000000; // Decimal MB, the same unit macOS Finder and GitHub show.
    if (mb >= 1000) return (mb / 1000).toFixed(2) + " GB";
    return mb.toFixed(mb >= 100 ? 0 : 1) + " MB";
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }

  function role(root, name) {
    return root.querySelector('[data-role="' + name + '"]');
  }

  function fillPlatform(id, file, version, isSigned) {
    var root = document.getElementById(id === "macos" ? "mac" : "windows");
    if (!root) return;
    var button = role(root, "button");
    var notes = root.querySelectorAll("[data-when]");
    for (var i = 0; i < notes.length; i++) {
      var wantsSigned = notes[i].getAttribute("data-when") === "signed";
      notes[i].hidden = wantsSigned !== isSigned;
    }
    if (!file) {
      button.removeAttribute("href");
      button.setAttribute("aria-disabled", "true");
      button.textContent = "Not available yet";
      return;
    }
    // The URL comes from our own API, but only same-site download paths are linked.
    if (typeof file.url === "string" && file.url.indexOf("/dl/") === 0) {
      button.href = file.url;
      button.setAttribute("download", file.name);
      button.removeAttribute("aria-disabled");
      button.textContent = "Download for " + (id === "windows" ? "Windows" : "Mac");
    }
    role(root, "name").textContent = file.name;
    var size = role(root, "size");
    size.textContent = formatSize(file.size);
    size.title = file.size.toLocaleString("en-US") + " bytes";
    role(root, "version").textContent = version;
    role(root, "sha").textContent = file.sha256;

    var copy = role(root, "copy");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      copy.hidden = false;
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(file.sha256).then(function () {
          copy.textContent = "Copied";
          setTimeout(function () { copy.textContent = "Copy"; }, 1800);
        });
      });
    }
    var fills = document.querySelectorAll('[data-fill="' + id + '-name"]');
    for (var j = 0; j < fills.length; j++) fills[j].textContent = file.name;
  }

  function render(data) {
    if (!data || data.available !== true || !Array.isArray(data.files)) {
      showState(
        "Downloads open soon",
        "The first installers are not published yet. You can see what works so far.",
        "/status",
        "See what works today"
      );
      return;
    }
    var win = null;
    var mac = null;
    data.files.forEach(function (f) {
      if (f.platform === "windows" && f.name.slice(-4).toLowerCase() === ".exe" && !win) win = f;
      if (f.platform === "macos" && f.name.slice(-4).toLowerCase() === ".dmg" && !mac) mac = f;
    });
    if (!win && !mac) {
      showState("Downloads open soon", "The first installers are not published yet.", "/status", "See what works today");
      return;
    }

    state.hidden = true;
    var strong = document.createElement("strong");
    strong.textContent = data.version;
    releaseLine.replaceChildren("Latest version ", strong, ", released " + formatDate(data.date) + ".");
    releaseLine.hidden = false;

    fillPlatform("windows", win, data.version, !!(win && win.signed));
    fillPlatform("macos", mac, data.version, !!(mac && mac.notarized));

    var mine = detectPlatform();
    if (mine === "windows" || mine === "macos") {
      var root = document.getElementById(mine === "macos" ? "mac" : "windows");
      root.classList.add("is-yours");
      if (mine === "macos") platforms.classList.add("is-mac-first");
    } else if (mine === "mobile") {
      // Same paragraph, not a new one: the line's height is reserved in CSS, so nothing below it moves.
      releaseLine.append(" NONON is for Windows and Mac computers. Open this page on your computer to download it.");
    }
  }

  function goToHash() {
    var target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target && !target.hidden && target.classList.contains("platform")) target.scrollIntoView();
  }

  fetch("/api/latest", { headers: { Accept: "application/json" } })
    .then(function (r) {
      if (!r.ok) throw new Error("bad status");
      return r.json();
    })
    .then(function (data) { render(data); goToHash(); })
    .catch(function () {
      showState(
        "We could not check for downloads",
        "Your connection may be down, or the site is busy. Reload this page to try again."
      );
    });
})();
