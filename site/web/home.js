"use strict";

/* ============================================================================
   home.js: the home page.

   Structure (the same as the Pragma site's home.js: GSAP + ScrollTrigger inside gsap.matchMedia):
   - Everything that is only motion (entrances, the pinned hero, the pinned steps, scrubbed text,
     the marquee, hover physics) lives inside matchMedia, so reduced motion gets a complete, static
     page and a change of preference reverts every tween.
   - Everything that is behaviour (the job tabs, the approval demo, the internet switch, the nav
     marker) works with no GSAP at all, and with reduced motion.
   - Nothing here may be load-bearing for visibility. boot.js adds `motion` (which hides the
     entrance states) only when motion is allowed, and takes it off again after 4 s if this file
     never confirms with `motion-ready`.
   - Animations touch transform and opacity only. Layout is read on events and on refresh, never
     inside a ticker or a pointermove handler.
   ========================================================================== */
(function () {
  var root = document.documentElement;
  var g = window.gsap;
  var ST = window.ScrollTrigger;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (n, a, b) { return Math.min(b, Math.max(a, n)); };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var haptic = function (p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } };

  /* ── press feedback on pointer-down, never on release ─────────────────── */
  $$("[data-press]").forEach(function (el) {
    var up = function () { el.classList.remove("is-pressed"); };
    el.addEventListener("pointerdown", function () { el.classList.add("is-pressed"); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { el.addEventListener(ev, up); });
  });

  /* ── Non pauses when it is off screen or the tab is hidden ────────────── */
  var seen = new Set();
  var nons = $$(".non");
  var syncNon = function (n) { n.dataset.paused = String(document.hidden || !seen.has(n)); };
  if ("IntersectionObserver" in window) {
    var nonIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); syncNon(e.target); });
    }, { rootMargin: "120px" });
    nons.forEach(function (n) { nonIO.observe(n); });
    document.addEventListener("visibilitychange", function () { nons.forEach(syncNon); });
  }
  var setNon = function (svg, state, back) {
    if (!svg) return;
    svg.dataset.state = state;
    if (back) setTimeout(function () { if (svg.dataset.state === state) svg.dataset.state = "idle"; }, back);
  };

  /* ============================================================================
     Sliding marker: one helper for the nav and the job list. The marker is placed from offsets
     (the container's own coordinates), so a scrolled or transformed container needs no fix-up.
     ========================================================================== */
  function marker(thumb, vertical) {
    var first = true;
    return function (el, instant) {
      if (!el || !el.offsetWidth) return;
      var to = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      var jump = instant || first || reduced.matches || !g;
      first = false;
      if (jump) {
        if (g) g.set(thumb, vertical ? { x: to.x, y: to.y, width: to.w, height: to.h } : { x: to.x, width: to.w });
        else {
          thumb.style.transform = "translate3d(" + to.x + "px," + (vertical ? to.y : 0) + "px,0)";
          thumb.style.width = to.w + "px";
          if (vertical) thumb.style.height = to.h + "px";
        }
      } else {
        g.to(thumb, vertical ? { x: to.x, y: to.y, width: to.w, height: to.h, duration: .55, ease: "expo.out", overwrite: true }
          : { x: to.x, width: to.w, duration: .5, ease: "expo.out", overwrite: true });
      }
    };
  }

  /* ── nav: marker on the section you are in (home only) ────────────────── */
  (function () {
    var links = $("#navLinks");
    var thumb = $("#navThumb");
    if (!links || !thumb) return;
    var place = marker(thumb, false);
    var items = $$("[data-nav]", links);
    var map = items.map(function (a) {
      var id = (a.getAttribute("href") || "").split("#")[1];
      return { a: a, el: id ? document.getElementById(id) : null };
    }).filter(function (s) { return s.el; });
    var setOn = function (a) {
      items.forEach(function (x) { x.classList.toggle("is-on", x === a); });
      links.classList.toggle("has-on", Boolean(a));
      if (a) place(a);
    };
    if ("IntersectionObserver" in window) {
      var live = new Set();
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) live.add(e.target); else live.delete(e.target); });
        var hit = map.filter(function (s) { return live.has(s.el); })[0];
        setOn(hit ? hit.a : null);
      }, { rootMargin: "-45% 0px -50% 0px" });
      map.forEach(function (s) { io.observe(s.el); });
    }
    window.addEventListener("resize", function () { var on = items.filter(function (x) { return x.classList.contains("is-on"); })[0]; if (on) place(on, true); });
  })();

  /* ============================================================================
     The jobs: radio inputs do the switching (works with no script); this adds the sliding marker,
     the keyboard step between jobs and the count-up on the comparison.
     ========================================================================== */
  var tally = (function () {
    var box = $("#tally");
    if (!box) return { run: function () {} };
    var nums = $$("[data-count]", box);
    var fmt = function (v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
    return {
      run: function () {
        if (reduced.matches || !g) return;
        nums.forEach(function (el) {
          var end = parseFloat(el.dataset.count), d = parseInt(el.dataset.decimals || "0", 10), o = { v: 0 };
          g.to(o, { v: end, duration: 1.4, ease: "power3.out", overwrite: true, onUpdate: function () { el.textContent = fmt(o.v, d); }, onComplete: function () { el.textContent = fmt(end, d); } });
        });
      },
    };
  })();

  (function () {
    var wrap = $("#jobs");
    var list = $("#contacts");
    var thumb = $("#contactsThumb");
    if (!wrap || !list || !thumb || !g) return;
    var place = marker(thumb, true);
    var radios = $$('input[name="job"]', wrap);
    var labels = $$(".contact", list);
    var current = function () { return labels[radios.findIndex(function (r) { return r.checked; })] || labels[0]; };
    var sync = function (instant) {
      var el = current();
      place(el, instant);
      // On a phone the list is a row that scrolls sideways: keep the choice in view without moving the page.
      if (list.scrollWidth > list.clientWidth) list.scrollTo({ left: el.offsetLeft - 20, behavior: instant || reduced.matches ? "auto" : "smooth" });
    };
    list.classList.add("has-thumb");
    sync(true);
    radios.forEach(function (r) {
      r.addEventListener("change", function () { sync(false); if (r.id === "job-compare") tally.run(); });
    });
    window.addEventListener("resize", function () { sync(true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { sync(true); });
  })();

  /* ============================================================================
     The approval demonstration. Four states, all the same size, so nothing around it moves.
     ========================================================================== */
  (function () {
    var ask = $("#ask");
    var grid = $("#controlGrid");
    if (!ask || !grid) return;
    var panes = $$(".ask__pane", ask);
    var doneNon = $('[data-pane="done"] .non', ask);
    var next = { yes: "done", no: "left", undo: "undone", again: "wait" };
    var show = function (state, focus) {
      ask.dataset.state = state;
      grid.dataset.demo = state;
      panes.forEach(function (p) {
        var on = p.dataset.pane === state;
        if (on) p.removeAttribute("inert"); else p.setAttribute("inert", "");
        p.setAttribute("aria-hidden", String(!on));
      });
      if (doneNon) setNon(doneNon, state === "done" ? "success" : "idle", state === "done" ? 1600 : 0);
      if (focus) {
        var b = $("button", $('[data-pane="' + state + '"]', ask));
        if (b) b.focus({ preventScroll: true });
      }
    };
    $$("[data-answer]", ask).forEach(function (b) {
      b.addEventListener("click", function () {
        var state = next[b.dataset.answer];
        haptic(state === "done" ? 12 : 8);
        show(state, true);
      });
    });
    show("wait", false);
  })();

  /* the pointer lamp on each tile (a CSS variable write per frame, nothing else) */
  if (window.matchMedia("(pointer: fine)").matches) {
    $$("[data-spot]").forEach(function (tile) {
      var raf = 0, ex = 0, ey = 0;
      tile.addEventListener("pointermove", function (e) {
        ex = e.clientX; ey = e.clientY;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = tile.getBoundingClientRect();
          tile.style.setProperty("--mx", (ex - r.left) + "px");
          tile.style.setProperty("--my", (ey - r.top) + "px");
        });
      });
    });
  }

  /* ============================================================================
     The internet switch. Pretend, to show what stays: nothing real is switched off.
     ========================================================================== */
  (function () {
    var section = $("#local");
    var btn = $("#cable");
    if (!section || !btn) return;
    var label = $("#cableLabel");
    var sub = $("#cableSub");
    var rows = $$(".survive li", section);
    var online = true;
    var paint = function () {
      section.dataset.online = String(online);
      btn.setAttribute("aria-pressed", String(!online));
      label.textContent = online ? "Turn the internet off" : "Turn the internet back on";
      sub.textContent = online ? "Pretend, just to see. Your real connection is not touched." : "No internet, in this demonstration.";
      rows.forEach(function (li, i) {
        $(".survive__state", li).textContent = online ? li.dataset.on : li.dataset.off;
        if (!reduced.matches) {
          setTimeout(function () { li.classList.add("is-bump"); setTimeout(function () { li.classList.remove("is-bump"); }, 260); }, 380 + i * 90);
        }
      });
    };
    btn.addEventListener("click", function () {
      // The dark opens from the switch itself.
      var s = section.getBoundingClientRect();
      var k = $(".cable__track", btn).getBoundingClientRect();
      section.style.setProperty("--cx", (k.left + k.width / 2 - s.left) + "px");
      section.style.setProperty("--cy", (k.top + k.height / 2 - s.top) + "px");
      online = !online;
      haptic(online ? 8 : [6, 30, 6]);
      paint();
    });
    paint();
  })();

  /* the download panel: Non stands up when you reach for the button */
  (function () {
    var panel = $("#ctaPanel");
    var peek = $("#peek .non");
    if (!panel) return;
    $$("[data-dl]", panel).forEach(function (b) {
      var on = function () { panel.classList.add("is-eager"); setNon(peek, "greeting", 2100); };
      var off = function () { panel.classList.remove("is-eager"); };
      b.addEventListener("pointerenter", on);
      b.addEventListener("pointerleave", off);
      b.addEventListener("focus", on);
      b.addEventListener("blur", off);
    });
  })();

  if (!g || !ST) return; // no GSAP: the page is complete without motion

  g.registerPlugin(ST);
  ST.config({ ignoreMobileResize: true });
  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

  /* Past the point where an entrance would have played (a reload half way down, a #link): shown as done. */
  var alreadyPast = function (el, at) { return el.getBoundingClientRect().top < window.innerHeight * (at || 0.9); };

  var mm = g.matchMedia();
  mm.add({
    ok: "(prefers-reduced-motion: no-preference)",
    wide: "(min-width: 1024px) and (min-height: 640px)",
    fine: "(pointer: fine)",
  }, function (ctx) {
    var c = ctx.conditions;
    if (!c.ok) { root.classList.remove("motion"); return; }
    var ENTER = root.classList.contains("motion");
    if (!ENTER) return; // boot.js already gave up waiting: show the page as it is
    root.classList.add("motion-ready");

    var heroST = null;

    /* ── hero: the headline is CSS; everything else follows it in ─────── */
    var copyRest = $$("#heroCopy > :not(h1)");
    var stageEls = { disc: $(".stage__disc"), ring: $(".stage__ring"), non: $("#nonBtn"), hello: $("#hello"), chips: $$(".chip") };
    var nonSvg = $("#nonBtn .non");
    var intro = g.timeline({ defaults: { ease: "expo.out" }, delay: .1 });
    intro
      .fromTo(copyRest, { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, stagger: .08 }, .35)
      .fromTo(stageEls.disc, { scale: .72, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 1.3 }, .15)
      .fromTo(stageEls.ring, { scale: .88, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 1.4 }, .25)
      .fromTo(stageEls.non, { y: 46, scale: .86, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 1.2 }, .3)
      .fromTo(stageEls.hello, { scale: .82, y: 8, autoAlpha: 0 }, { scale: 1, y: 0, autoAlpha: 1, duration: .9 }, .95)
      .fromTo(stageEls.chips, { y: 18, scale: .92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 1, stagger: .12 }, .85)
      .add(function () { setNon(nonSvg, "greeting", 2100); }, .9);
    var introDone = new Promise(function (r) { intro.eventCallback("onComplete", r); });

    // The chips drift while the hero is on screen; stopped otherwise so nothing runs unseen.
    introDone.then(function () {
      var drift = stageEls.chips.map(function (chip, i) {
        return g.to(chip, { y: (i % 2 ? -1 : 1) * 9, duration: 2.8 + i * .5, ease: "sine.inOut", yoyo: true, repeat: -1 });
      });
      ST.create({ trigger: "#top", start: "top bottom", end: "bottom top", onToggle: function (s) { drift.forEach(function (t) { s.isActive ? t.play() : t.pause(); }); } });
    });

    // Non and the pointer: it leans toward you, the files drift the other way. Pointer position only;
    // the stage's rectangle is measured once per resize, never in the handler.
    if (c.fine && stageEls.non) {
      var stage = $("#stage");
      var rect = null;
      var measure = function () { rect = stage.getBoundingClientRect(); };
      measure();
      ST.addEventListener("refresh", measure);
      var qx = g.quickTo(stageEls.non, "x", { duration: .9, ease: "power3.out" });
      var qy = g.quickTo(stageEls.non, "y", { duration: .9, ease: "power3.out" });
      var chipQ = stageEls.chips.map(function (el, i) { var d = (i + 1) * -7; return { x: g.quickTo(el, "x", { duration: 1.1, ease: "power3.out" }), y: g.quickTo(el, "y", { duration: 1.1, ease: "power3.out" }), d: d }; });
      var onMove = function (e) {
        if (!rect) return;
        var nx = clamp((e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2), -1.2, 1.2);
        var ny = clamp((e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2), -1.2, 1.2);
        qx(nx * 14); qy(ny * 10);
        chipQ.forEach(function (q) { q.x(nx * q.d); });
      };
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerleave", function () { qx(0); qy(0); chipQ.forEach(function (q) { q.x(0); }); });
    }

    // Click or tap: a hop, a greeting, and a new line.
    var lines = ["Hi, I'm Non.", "Tell me what you need.", "I ask before I change anything."];
    var li = 0;
    var hello = stageEls.hello;
    var greet = function () {
      li = (li + 1) % lines.length;
      hello.textContent = lines[li];
      setNon(nonSvg, "greeting", 2100);
      g.fromTo(stageEls.non, { y: 0 }, { y: -20, duration: .22, ease: "power2.out", yoyo: true, repeat: 1, overwrite: "auto" });
      g.fromTo(hello, { scale: .94 }, { scale: 1, duration: .6, ease: "expo.out" });
      haptic(8);
    };
    if (stageEls.non) stageEls.non.addEventListener("click", greet);

    /* ── hero, wide: the page holds still while the window takes the stage ─ */
    if (c.wide) {
      var copy = $("#heroCopy"), app = $("#app"), win = $("#win"), facts = $(".hero__facts"), hint = $(".win__hint", app), stageWrap = $("#heroStage");
      var startY = function () {
        var copyEnd = copy.offsetTop + facts.offsetTop + facts.offsetHeight + 36;
        return Math.max(window.innerHeight * .92, copyEnd) - win.offsetTop;
      };
      var tl = g.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: "#top", start: "top top", end: function () { return "+=" + Math.round(window.innerHeight * 1.5); },
          pin: "#heroPin", scrub: .8, anticipatePin: 1, invalidateOnRefresh: true,
        },
      });
      heroST = tl.scrollTrigger;
      tl.to(copy, { y: -140, autoAlpha: 0, ease: "power2.in", duration: .3 }, 0)
        .to(stageWrap, { y: -70, scale: .92, autoAlpha: 0, ease: "power2.in", duration: .34 }, 0)
        .fromTo(app, { y: startY, rotationX: 16, scale: .92, transformPerspective: 1800, transformOrigin: "50% 0%", autoAlpha: 1 },
          { y: 0, rotationX: 0, scale: 1, ease: "power3.out", duration: .56 }, .08)
        .fromTo(hint, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .08 }, .86)
        .to({}, { duration: .1 });
    } else {
      // Narrow: the window is already in the flow under the hero; it just arrives.
      var winEl = $("#app");
      if (winEl && !alreadyPast(winEl, .95)) {
        g.fromTo("#win", { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1, ease: "expo.out", scrollTrigger: { trigger: winEl, start: "top 90%", once: true } });
      } else g.set("#win", { autoAlpha: 1 });
    }

    /* ── headlines, reveals, stagger groups ─────────────────────────────── */
    $$('[data-split="mask"]:not(.display)').forEach(function (el) {
      var words = $$(".wi", el);
      if (alreadyPast(el, .88)) { g.set(words, { yPercent: 0, autoAlpha: 1 }); return; }
      g.fromTo(words, { yPercent: 112, autoAlpha: 0 }, {
        yPercent: 0, autoAlpha: 1, duration: 1.05, ease: "expo.out", stagger: .045,
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });
    $$("[data-reveal]").forEach(function (el) {
      if (alreadyPast(el)) { g.set(el, { autoAlpha: 1 }); return; }
      g.fromTo(el, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .9, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    $$("[data-stagger]").forEach(function (group) {
      var items = Array.prototype.slice.call(group.children);
      if (alreadyPast(group, .85)) { g.set(items, { autoAlpha: 1 }); return; }
      g.fromTo(items, { y: 36, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .95, ease: "expo.out", stagger: .08, scrollTrigger: { trigger: group, start: "top 86%", once: true } });
    });

    /* the comparison counts up the first time it comes into view */
    var tallyBox = $("#tally");
    if (tallyBox) {
      $$("[data-count]", tallyBox).forEach(function (el) { el.textContent = (parseInt(el.dataset.decimals || "0", 10) ? "0.00" : "0"); });
      ST.create({ trigger: "#jobs", start: "top 75%", once: true, onEnter: function () { tally.run(); } });
    }

    /* ── scrubbed: the statement inks in as you read it ───────────────── */
    $$('[data-split="ink"]').forEach(function (el) {
      g.fromTo($$(".w", el), { opacity: .46 }, {
        opacity: 1, ease: "none", stagger: .1,
        scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 52%", scrub: .6 },
      });
    });

    /* ── how it works ─────────────────────────────────────────────────────── */
    var how = $("#how");
    var steps = $$(".step", how);
    if (c.wide && how) {
      how.classList.add("is-pinned");
      var setStep = function (i) { steps.forEach(function (s, k) { s.classList.toggle("is-on", k === i); }); };
      setStep(0);
      var howST = ST.create({
        trigger: "#how", start: "top top", end: function () { return "+=" + Math.round(window.innerHeight * 2.2); },
        pin: "#howPin", anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: function (self) { setStep(clamp(Math.floor(self.progress * steps.length), 0, steps.length - 1)); },
      });
      steps.forEach(function (s, i) {
        var t = $(".step__text", s);
        t.style.cursor = "pointer";
        t.addEventListener("click", function () { window.scrollTo({ top: howST.start + ((i + .5) / steps.length) * (howST.end - howST.start), behavior: "smooth" }); });
      });
    } else {
      steps.forEach(function (s) {
        if (alreadyPast(s, .9)) { g.set(s, { autoAlpha: 1 }); return; }
        g.fromTo(s, { y: 36, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .95, ease: "expo.out", scrollTrigger: { trigger: s, start: "top 88%", once: true } });
      });
    }

    /* ── marquee: two rows drifting apart, pushed by the scroll ───────────── */
    var rows = $$("[data-marquee]");
    if (rows.length) {
      $(".marquee").classList.add("is-live");
      var ticks = rows.map(function (row) {
        var set = row.firstElementChild;
        row.appendChild(set.cloneNode(true));
        var dir = Number(row.dataset.marquee) || 1;
        return g.fromTo(row, { xPercent: dir > 0 ? 0 : -50 }, { xPercent: dir > 0 ? -50 : 0, duration: 46, ease: "none", repeat: -1, paused: true });
      });
      ST.create({
        trigger: ".marquee", start: "top bottom", end: "bottom top",
        onToggle: function (s) { ticks.forEach(function (t) { s.isActive ? t.play() : t.pause(); }); },
        onUpdate: function (s) {
          var v = Math.abs(s.getVelocity());
          ticks.forEach(function (t) { t.timeScale(clamp(1 + v / 380, 1, 6)); });
          g.to(ticks, { timeScale: 1, duration: .9, ease: "power2.out", overwrite: "auto" });
        },
      });
    }

    /* ── the buttons lean toward the pointer ───────────────────────────────── */
    if (c.fine) {
      $$("[data-magnet]").forEach(function (el) {
        var box = null;
        var qx = g.quickTo(el, "x", { duration: .6, ease: "elastic.out(1,.6)" });
        var qy = g.quickTo(el, "y", { duration: .6, ease: "elastic.out(1,.6)" });
        el.addEventListener("pointerenter", function () { box = el.getBoundingClientRect(); });
        el.addEventListener("pointermove", function (e) {
          if (!box) return;
          qx((e.clientX - (box.left + box.width / 2)) * .2);
          qy((e.clientY - (box.top + box.height / 2)) * .28);
        });
        el.addEventListener("pointerleave", function () { qx(0); qy(0); box = null; });
      });
    }

    // The lines are positioned from real measurements, so measure once the real face is in.
    fonts.then(function () { ST.refresh(); });

    return function () { if (how) how.classList.remove("is-pinned"); var m = $(".marquee"); if (m) m.classList.remove("is-live"); };
  });

  window.addEventListener("load", function () { ST.refresh(); });
})();
