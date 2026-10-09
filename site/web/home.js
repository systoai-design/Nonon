/* ============================================================================
   home.js: the home page.

   Structure (the Pragma site's home.js): GSAP + ScrollTrigger inside gsap.matchMedia, Lenis for
   the scroll, springs (lib/motion.js) for every gesture, three.js for the stage (lib/stage3d.js).
   - Everything that is only motion lives inside matchMedia, so reduced motion gets a complete,
     static page and a change of preference reverts every tween.
   - Everything that is behaviour (the job tabs, the approval demo, the internet switch, the film,
     the nav marker) works with no GSAP at all, and with reduced motion.
   - Nothing here is load-bearing for visibility. boot.js adds `motion` (which hides the entrance
     states) only when motion is allowed, and takes it off after 4 s if this never confirms.
   ========================================================================== */
import { Spring, clamp, onTick } from "./lib/motion.js";
import { startStage } from "./lib/stage3d.js";

const root = document.documentElement;
const g = window.gsap;
const ST = window.ScrollTrigger;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const fine = window.matchMedia("(pointer: fine)");
const haptic = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* unsupported */ } };
const MOTION = Boolean(g && ST && !reduced.matches);

/* ── press feedback on pointer-down, never on release ───────────────────── */
$$("[data-press]").forEach((el) => {
  const up = () => el.classList.remove("is-pressed");
  el.addEventListener("pointerdown", () => el.classList.add("is-pressed"));
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => el.addEventListener(ev, up));
});

/* ── the inline Non faces pause when off screen or the tab is hidden ────── */
const seen = new Set();
const nons = $$(".non");
const syncNon = (n) => { n.dataset.paused = String(document.hidden || !seen.has(n)); };
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); syncNon(e.target); });
  }, { rootMargin: "120px" });
  nons.forEach((n) => io.observe(n));
  document.addEventListener("visibilitychange", () => nons.forEach(syncNon));
}
const setNon = (svg, state, back) => {
  if (!svg) return;
  svg.dataset.state = state;
  if (back) setTimeout(() => { if (svg.dataset.state === state) svg.dataset.state = "idle"; }, back);
};

/* ============================================================================
   Spring thumbs (Pragma's thumbFor): four critically damped springs, x y w h, read from offsets
   (the container's own coordinates), so a scrolled or transformed container needs no fix-up.
   ========================================================================== */
function thumbFor(thumb, response = 0.4) {
  const s = { x: new Spring(0, { response }), y: new Spring(0, { response }), w: new Spring(0, { response }), h: new Spring(0, { response }) };
  let first = true, live = false;
  const paint = () => {
    thumb.style.transform = `translate3d(${s.x.v}px,${s.y.v}px,0)`;
    thumb.style.width = `${s.w.v}px`;
    thumb.style.height = `${s.h.v}px`;
  };
  onTick((dt) => {
    if (!live) return;
    for (const k in s) s[k].step(dt);
    paint();
    if (s.x.settled && s.y.settled && s.w.settled && s.h.settled) live = false;
  });
  return (el, instant) => {
    if (!el || !el.offsetWidth) return;
    const to = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    if (instant || first || reduced.matches) {
      first = false;
      for (const k in s) s[k].jump(to[k]);
      paint();
      return;
    }
    for (const k in s) s[k].set(to[k]);
    live = true;
  };
}

/* ── nav: marker on the section you are in ─────────────────────────────── */
(function () {
  const links = $("#navLinks");
  const thumb = $("#navThumb");
  if (!links || !thumb) return;
  const place = thumbFor(thumb, 0.42);
  const items = $$("[data-nav]", links);
  const map = items.map((a) => {
    const id = (a.getAttribute("href") || "").split("#")[1];
    return { a, el: id ? document.getElementById(id) : null };
  }).filter((s) => s.el);
  const setOn = (a) => {
    items.forEach((x) => x.classList.toggle("is-on", x === a));
    links.classList.toggle("has-on", Boolean(a));
    if (a) place(a);
  };
  if ("IntersectionObserver" in window) {
    const live = new Set();
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) live.add(e.target); else live.delete(e.target); });
      const hit = map.find((s) => live.has(s.el));
      setOn(hit ? hit.a : null);
    }, { rootMargin: "-45% 0px -50% 0px" });
    map.forEach((s) => io.observe(s.el));
  }
  addEventListener("resize", () => { const on = items.find((x) => x.classList.contains("is-on")); if (on) place(on, true); });
})();

/* ============================================================================
   The jobs: radio inputs do the switching (works with no script). This adds the sliding thumb,
   Non changing pose with a hop, his line typing out, and the count-up on the comparison.
   ========================================================================== */
const tally = (function () {
  const box = $("#tally");
  if (!box) return { run() {} };
  const nums = $$("[data-count]", box);
  const fmt = (v, d) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return {
    run() {
      if (reduced.matches || !g) return;
      nums.forEach((el) => {
        const end = parseFloat(el.dataset.count), d = parseInt(el.dataset.decimals || "0", 10), o = { v: 0 };
        g.to(o, { v: end, duration: 1.6, ease: "expo.out", overwrite: true, onUpdate: () => { el.textContent = fmt(o.v, d); }, onComplete: () => { el.textContent = fmt(end, d); } });
      });
    },
  };
})();

(function () {
  const wrap = $("#jobs");
  const list = $("#contacts");
  const thumb = $("#contactsThumb");
  if (!wrap || !list || !thumb) return;
  const place = thumbFor(thumb, 0.4);
  const radios = $$('input[name="job"]', wrap);
  const labels = $$(".contact", list);
  const art = $("#jobsArt");
  const say = $("#say");
  const current = () => labels[radios.findIndex((r) => r.checked)] || labels[0];
  let typing = 0;
  const type = (text) => {
    if (!say) return;
    clearTimeout(typing);
    if (reduced.matches) { say.textContent = text; return; }
    say.classList.add("is-typing");
    let i = 0;
    const step = () => {
      say.textContent = text.slice(0, ++i);
      if (i < text.length) typing = setTimeout(step, 14 + Math.random() * 18);
      else typing = setTimeout(() => say.classList.remove("is-typing"), 900);
    };
    say.textContent = "";
    step();
  };
  const sync = (instant) => {
    const el = current();
    place(el, instant);
    // On a phone the list is a row that scrolls sideways: keep the choice in view without moving the page.
    if (list.scrollWidth > list.clientWidth) list.scrollTo({ left: el.offsetLeft - 20, behavior: instant || reduced.matches ? "auto" : "smooth" });
    if (art && el.dataset.pose) art.dataset.pose = el.dataset.pose;
    if (!instant) {
      type(el.dataset.say || "");
      if (g && !reduced.matches) {
        const pose = art && $(`[data-p="${el.dataset.pose}"]`, art);
        if (pose) g.fromTo(pose, { y: 0 }, { y: -26, duration: 0.2, ease: "power2.out", yoyo: true, repeat: 1, overwrite: "auto" });
        if (say) g.fromTo(say, { scale: 0.9 }, { scale: 1, duration: 0.6, ease: "elastic.out(1,.6)" });
      }
    }
  };
  list.classList.add("has-thumb");
  sync(true);
  radios.forEach((r) => r.addEventListener("change", () => { sync(false); haptic(6); if (r.id === "job-compare") tally.run(); }));
  addEventListener("resize", () => sync(true));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => sync(true));
})();

/* ============================================================================
   The approval demonstration. Four states, all the same size, so nothing around it moves.
   ========================================================================== */
(function () {
  const ask = $("#ask");
  const grid = $("#controlGrid");
  if (!ask || !grid) return;
  const panes = $$(".ask__pane", ask);
  const doneNon = $('[data-pane="done"] .non', ask);
  const next = { yes: "done", no: "left", undo: "undone", again: "wait" };
  const show = (state, focus) => {
    ask.dataset.state = state;
    grid.dataset.demo = state;
    panes.forEach((p) => {
      const on = p.dataset.pane === state;
      if (on) p.removeAttribute("inert"); else p.setAttribute("inert", "");
      p.setAttribute("aria-hidden", String(!on));
    });
    if (doneNon) setNon(doneNon, state === "done" ? "success" : "idle", state === "done" ? 1600 : 0);
    if (focus) {
      const b = $("button", $(`[data-pane="${state}"]`, ask));
      if (b) b.focus({ preventScroll: true });
    }
  };
  $$("[data-answer]", ask).forEach((b) => {
    b.addEventListener("click", () => {
      const state = next[b.dataset.answer];
      haptic(state === "done" ? 12 : 8);
      show(state, true);
    });
  });
  show("wait", false);
})();

/* ── the pointer lamp on each tile (a CSS variable write per frame, nothing else) ── */
if (fine.matches) {
  $$("[data-spot]").forEach((tile) => {
    let raf = 0, ex = 0, ey = 0;
    tile.addEventListener("pointermove", (e) => {
      ex = e.clientX; ey = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = tile.getBoundingClientRect();
        tile.style.setProperty("--mx", `${ex - r.left}px`);
        tile.style.setProperty("--my", `${ey - r.top}px`);
      });
    });
  });
}

/* ============================================================================
   The internet switch. Pretend, to show what stays: nothing real is switched off.
   ========================================================================== */
(function () {
  const section = $("#local");
  const btn = $("#cable");
  if (!section || !btn) return;
  const label = $("#cableLabel");
  const sub = $("#cableSub");
  const rows = $$(".survive li", section);
  let online = true;
  const paint = () => {
    section.dataset.online = String(online);
    btn.setAttribute("aria-pressed", String(!online));
    label.textContent = online ? "Turn the internet off" : "Turn the internet back on";
    sub.textContent = online ? "Pretend, just to see. Your real connection is not touched." : "No internet, in this demonstration.";
    rows.forEach((li, i) => {
      $(".survive__state", li).textContent = online ? li.dataset.on : li.dataset.off;
      if (!reduced.matches) {
        setTimeout(() => { li.classList.add("is-bump"); setTimeout(() => li.classList.remove("is-bump"), 260); }, 380 + i * 90);
      }
    });
  };
  btn.addEventListener("click", () => {
    // the dark opens from the switch itself
    const s = section.getBoundingClientRect();
    const k = $(".cable__track", btn).getBoundingClientRect();
    section.style.setProperty("--cx", `${k.left + k.width / 2 - s.left}px`);
    section.style.setProperty("--cy", `${k.top + k.height / 2 - s.top}px`);
    online = !online;
    haptic(online ? 8 : [6, 30, 6]);
    paint();
  });
  paint();
})();

/* ============================================================================
   The film: a real recording. The play button drifts toward the pointer (a spring per axis).
   ========================================================================== */
(function () {
  const frame = $("#filmFrame");
  const video = $("#filmVideo");
  const play = $("#filmPlay");
  if (!frame || !video || !play) return;
  video.controls = false;
  play.addEventListener("click", () => {
    frame.classList.add("is-playing");
    video.controls = true;
    if (video.readyState === 0) video.load();
    const p = video.play();
    if (p && p.catch) p.catch(() => { /* the native controls are there to retry */ });
    video.focus({ preventScroll: true });
  });
  video.addEventListener("ended", () => { frame.classList.remove("is-playing"); video.controls = false; });
  if (!fine.matches || reduced.matches) return;
  const sx = new Spring(0, { response: 0.6, damping: 0.8 }), sy = new Spring(0, { response: 0.6, damping: 0.8 });
  let inside = false, box = null;
  frame.addEventListener("pointerenter", () => { inside = true; box = frame.getBoundingClientRect(); });
  frame.addEventListener("pointerleave", () => { inside = false; sx.set(0); sy.set(0); });
  frame.addEventListener("pointermove", (e) => {
    if (!box) return;
    sx.set((e.clientX - (box.left + box.width / 2)) * 0.16);
    sy.set((e.clientY - (box.top + box.height / 2)) * 0.16);
  });
  addEventListener("scroll", () => { if (inside) box = frame.getBoundingClientRect(); }, { passive: true });
  onTick((dt) => {
    if (sx.settled && sy.settled && !inside) return;
    play.style.translate = `calc(-50% + ${sx.step(dt).toFixed(2)}px) calc(-50% + ${sy.step(dt).toFixed(2)}px)`;
  });
})();

/* ── the download panel: the three Nons stand up when you reach for a button ── */
(function () {
  const panel = $("#ctaPanel");
  if (!panel) return;
  const peeks = $$(".peek__non", panel);
  $$("[data-dl]", panel).forEach((b) => {
    const on = () => {
      panel.classList.add("is-eager");
      if (g && !reduced.matches) peeks.forEach((p, i) => g.fromTo(p, { y: 0 }, { y: -18, duration: 0.17, ease: "power2.out", yoyo: true, repeat: 1, delay: 0.06 + i * 0.07, overwrite: "auto" }));
    };
    const off = () => panel.classList.remove("is-eager");
    b.addEventListener("pointerenter", on);
    b.addEventListener("pointerleave", off);
    b.addEventListener("focus", on);
    b.addEventListener("blur", off);
  });
})();

/* ── magnetic buttons: a spring per axis, written to `translate` so the press `scale` never fights it ── */
if (fine.matches && !reduced.matches) {
  $$("[data-magnet]").forEach((el) => {
    const sx = new Spring(0, { response: 0.4, damping: 0.6 }), sy = new Spring(0, { response: 0.4, damping: 0.6 });
    let box = null, live = false;
    el.addEventListener("pointerenter", () => { box = el.getBoundingClientRect(); live = true; });
    el.addEventListener("pointermove", (e) => {
      if (!box) return;
      sx.set((e.clientX - (box.left + box.width / 2)) * 0.22);
      sy.set((e.clientY - (box.top + box.height / 2)) * 0.32);
    });
    el.addEventListener("pointerleave", () => { box = null; sx.set(0); sy.set(0); });
    onTick((dt) => {
      if (!live) return;
      el.style.translate = `${sx.step(dt).toFixed(2)}px ${sy.step(dt).toFixed(2)}px`;
      if (!box && sx.settled && sy.settled) live = false;
    });
  });
}

/* ============================================================================
   The stage: Non and your files in 3D. Started on every layout; on a wide screen the pinned hero
   then flies the files into the app window and Non onto the window's title mark.
   ========================================================================== */
const stageEl = $("#stage3d");
const hint = $("#stageHint");
const PIN_MQ = window.matchMedia("(min-width: 1024px) and (min-height: 600px)");
const WIDE = window.matchMedia("(min-width: 1024px)").matches;
const PINNED = MOTION && PIN_MQ.matches;
const winMark = $("#winMark");
const stageReady = stageEl ? startStage({
  stage: stageEl,
  surface: WIDE ? $("#heroPin") : stageEl,
  layout: WIDE ? "wide" : "compact",
  target: PINNED ? () => ({ files: $("#winBody"), non: winMark }) : null,
  onReady: () => {
    stageEl.classList.add("is-3d");
    if (hint) hint.classList.add("is-on");
  },
}) : Promise.resolve(null);
stageReady.then((s) => {
  // the window's own mark hands over to the 3D Non as it lands; hidden only once the 3D is really there
  if (s && PINNED && winMark) winMark.style.opacity = "0";
  if (!s && hint) hint.remove();
});

/* ============================================================================
   Motion. Nothing below is needed to read or use the page.
   ========================================================================== */
// boot.js arms motion at once, or only when the page is first shown if it loaded hidden
const whenArmed = (fn) => {
  if (root.classList.contains("motion") || reduced.matches) fn();
  else document.addEventListener("nonon:arm", fn, { once: true });
};

if (g && ST) whenArmed(() => {
  g.registerPlugin(ST);
  ST.config({ ignoreMobileResize: true });
  const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  const alreadyPast = (el, at) => el.getBoundingClientRect().top < window.innerHeight * (at || 0.9);

  /* ── Lenis: the scroll itself, on GSAP's ticker so everything reads the same frame ── */
  let lenis = null;
  if (MOTION && window.Lenis) {
    lenis = new window.Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", ST.update);
    g.ticker.add((time) => lenis.raf(time * 1000), false, true);
    g.ticker.lagSmoothing(0);
    $$('a[href^="#"], a[href^="/#"]').forEach((a) => {
      const id = a.getAttribute("href").split("#")[1];
      if (!id || a.id === "seeIt") return;
      a.addEventListener("click", (e) => {
        const t = document.getElementById(id);
        if (!t) return;
        e.preventDefault();
        lenis.scrollTo(t, { offset: id === "top" ? 0 : -72, duration: 1.4 });
        history.replaceState(null, "", `#${id}`);
      });
    });
  }

  const mm = g.matchMedia();
  mm.add({
    ok: "(prefers-reduced-motion: no-preference)",
    wide: "(min-width: 1024px) and (min-height: 600px)",
    howWide: "(min-width: 1024px) and (min-height: 640px)",
  }, (ctx) => {
    const c = ctx.conditions;
    if (!c.ok) { root.classList.remove("motion"); return; }
    if (!root.classList.contains("motion")) return; // boot.js already gave up waiting
    root.classList.add("motion-ready");

    /* ── hero: the headline is CSS; everything else follows it in ─────── */
    const copyRest = $$("#heroCopy > :not(h1)");
    g.timeline({ defaults: { ease: "expo.out" }, delay: 0.1 })
      .fromTo(copyRest, { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, stagger: 0.08 }, 0.35)
      .fromTo(".hero__glow", { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 0.9, duration: 1.8 }, 0.1);

    /* ── hero, wide: the page holds still while the window takes the stage ─ */
    let heroST = null;
    if (c.wide) {
      const copy = $("#heroCopy"), app = $("#app"), win = $("#win"), facts = $(".hero__facts"), winHint = $(".win__hint", app);
      $(".hero").classList.add("is-pinned");
      const startY = () => {
        const copyEnd = copy.offsetTop + facts.offsetTop + facts.offsetHeight + 36;
        return Math.max(window.innerHeight * 0.92, copyEnd) - win.offsetTop;
      };
      const flight = { v: 0 };
      const tl = g.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: "#top", start: "top top", end: () => `+=${Math.round(window.innerHeight * 1.7)}`,
          pin: "#heroPin", scrub: 0.8, anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: (self) => { if (hint) hint.classList.toggle("is-away", self.progress > 0.02); },
        },
      });
      heroST = tl.scrollTrigger;
      tl.to(copy, { y: -150, autoAlpha: 0, ease: "power2.in", duration: 0.3 }, 0)
        .to(".hero__glow", { scale: 0.5, autoAlpha: 0, ease: "power2.in", duration: 0.4 }, 0.05)
        .fromTo(app, { y: startY, rotationX: 16, scale: 0.92, transformPerspective: 1800, transformOrigin: "50% 0%", autoAlpha: 1 },
          { y: 0, rotationX: 0, scale: 1, ease: "power3.out", duration: 0.56 }, 0.08)
        .to(flight, { v: 1, duration: 0.56, onUpdate: () => stageReady.then((s) => s && s.setFly(flight.v)) }, 0.3)
        .to(".stage3d__flat", { y: -60, autoAlpha: 0, ease: "power2.in", duration: 0.3 }, 0)
        .fromTo(winHint, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.08 }, 0.86)
        .to({}, { duration: 0.1 });
    } else {
      const appEl = $("#app");
      if (appEl && !alreadyPast(appEl, 0.95)) {
        g.fromTo("#win", { y: 60, rotationX: 12, transformPerspective: 1400, transformOrigin: "50% 0%", autoAlpha: 0 }, { y: 0, rotationX: 0, autoAlpha: 1, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: appEl, start: "top 90%", once: true } });
      }
    }
    const seeIt = $("#seeIt");
    const goSee = (e) => {
      e.preventDefault();
      if (heroST && lenis) lenis.scrollTo(heroST.end, { duration: 1.8 });
      else if (heroST) window.scrollTo({ top: heroST.end, behavior: "smooth" });
      else if (lenis) lenis.scrollTo("#app", { offset: -90, duration: 1.4 });
      else $("#app").scrollIntoView({ behavior: "smooth" });
    };
    if (seeIt) seeIt.addEventListener("click", goSee);

    /* ── headlines: each word rides up out of its own mask ─────────────── */
    $$('[data-split="mask"]:not(.display)').forEach((el) => {
      const words = $$(".wi", el);
      if (alreadyPast(el, 0.88)) { g.set(words, { visibility: "visible" }); return; }
      g.fromTo(words, { yPercent: 112, rotate: 4, visibility: "visible" }, {
        yPercent: 0, rotate: 0, duration: 1.1, ease: "expo.out", stagger: 0.05,
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });
    $$("[data-reveal]").forEach((el) => {
      if (alreadyPast(el)) { g.set(el, { autoAlpha: 1 }); return; }
      g.fromTo(el, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    $$("[data-stagger]").forEach((group) => {
      const items = Array.from(group.children);
      if (alreadyPast(group, 0.85)) { g.set(items, { autoAlpha: 1 }); return; }
      g.fromTo(items, { y: 48, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: "expo.out", stagger: 0.09, scrollTrigger: { trigger: group, start: "top 86%", once: true } });
    });

    /* the comparison counts up the first time it comes into view */
    const tallyBox = $("#tally");
    if (tallyBox) {
      $$("[data-count]", tallyBox).forEach((el) => { el.textContent = parseInt(el.dataset.decimals || "0", 10) ? "0.00" : "0"; });
      ST.create({ trigger: "#jobs", start: "top 75%", once: true, onEnter: () => tally.run() });
    }

    /* ── scrubbed: the manifesto inks in as you read it ───────────────── */
    $$('[data-split="ink"]').forEach((el) => {
      g.fromTo($$(".w", el), { opacity: 0.16 }, {
        opacity: 1, ease: "none", stagger: 0.1,
        scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 52%", scrub: 0.6 },
      });
    });

    /* ── the film scales into its frame ───────────────────────────────── */
    const filmFrame = $("#filmFrame");
    if (filmFrame) {
      g.fromTo(filmFrame, { scale: 0.84, borderRadius: 72 }, {
        scale: 1, borderRadius: 36, ease: "none",
        scrollTrigger: { trigger: filmFrame, start: "top bottom", end: "top 22%", scrub: 0.6 },
      });
    }

    /* ── the jobs card and Non's poses lift in with a little depth ─────── */
    const panel = $(".jobs__panel");
    if (panel && !alreadyPast(panel, 0.9)) {
      g.fromTo(panel, { y: 80, rotationX: 10, transformPerspective: 1600, transformOrigin: "50% 100%" }, {
        y: 0, rotationX: 0, ease: "none",
        scrollTrigger: { trigger: panel, start: "top bottom", end: "top 55%", scrub: 0.6 },
      });
    }

    /* ── how it works: pinned, the window changes as you scroll ────────── */
    const how = $("#how");
    const steps = $$(".step", how);
    if (c.howWide && how) {
      how.classList.add("is-pinned");
      const setStep = (i) => steps.forEach((s, k) => s.classList.toggle("is-on", k === i));
      setStep(0);
      const howST = ST.create({
        trigger: "#how", start: "top top", end: () => `+=${Math.round(window.innerHeight * 2.2)}`,
        pin: "#howPin", anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (self) => setStep(clamp(Math.floor(self.progress * steps.length), 0, steps.length - 1)),
      });
      steps.forEach((s, i) => {
        const t = $(".step__text", s);
        t.style.cursor = "pointer";
        t.addEventListener("click", () => {
          const y = howST.start + ((i + 0.5) / steps.length) * (howST.end - howST.start);
          if (lenis) lenis.scrollTo(y, { duration: 1.2 }); else window.scrollTo({ top: y, behavior: "smooth" });
        });
      });
    } else {
      steps.forEach((s) => {
        if (alreadyPast(s, 0.9)) return;
        g.fromTo(s, { y: 36, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.95, ease: "expo.out", scrollTrigger: { trigger: s, start: "top 88%", once: true } });
      });
    }

    /* ── the band: two rows drifting apart, pushed by the scroll (Pragma's engines rows) ── */
    const band = $(".band");
    const rows = $$("[data-marquee]");
    let stopBand = null;
    if (band && rows.length) {
      band.classList.add("is-live");
      const tracks = rows.map((row) => {
        const set = row.firstElementChild;
        row.appendChild(set.cloneNode(true));
        return { row, set, dir: Number(row.dataset.marquee) || 1, off: 0, w: set.offsetWidth };
      });
      const measure = () => tracks.forEach((t) => { t.w = t.set.offsetWidth; });
      ST.addEventListener("refresh", measure);
      let inView = false, lastY = window.scrollY, vel = 0;
      const bandIO = new IntersectionObserver((es) => { inView = es[0].isIntersecting; }, { rootMargin: "80px" });
      bandIO.observe(band);
      stopBand = onTick((dt) => {
        if (!inView || !dt) return;
        const y = window.scrollY;
        vel += ((y - lastY) / dt - vel) * 0.12;
        lastY = y;
        const push = clamp(Math.abs(vel) / 900, 0, 4);
        const drift = Math.sign(vel || 1);
        for (const t of tracks) {
          if (!t.w) continue;
          t.off -= t.dir * drift * (40 + push * 160) * dt;
          if (t.off <= -t.w) t.off += t.w;
          if (t.off > 0) t.off -= t.w;
          t.row.style.transform = `translate3d(${t.off.toFixed(1)}px,0,0)`;
        }
      });
      g.fromTo(".band__strip--orange", { rotate: -5 }, { rotate: -2.4, ease: "none", scrollTrigger: { trigger: band, start: "top bottom", end: "bottom top", scrub: 0.6 } });
      g.fromTo(".band__strip--ink", { rotate: 4 }, { rotate: 1.6, ease: "none", scrollTrigger: { trigger: band, start: "top bottom", end: "bottom top", scrub: 0.6 } });
    }

    /* ── the footer word: each letter rises into place as the page ends ── */
    const letters = $$("#footWord span");
    if (letters.length) {
      g.fromTo(letters, { yPercent: 70, rotate: (i) => (i % 2 ? 8 : -8) }, {
        yPercent: 0, rotate: 0, ease: "none", stagger: 0.06,
        scrollTrigger: { trigger: "#footWord", start: "top bottom", end: "bottom bottom", scrub: 0.6 },
      });
    }

    // positions come from real measurements, so measure again once the real face is in
    fonts.then(() => ST.refresh());

    return () => {
      if (how) how.classList.remove("is-pinned");
      $(".hero").classList.remove("is-pinned");
      if (band) band.classList.remove("is-live");
      if (stopBand) stopBand();
    };
  });

  if (document.readyState === "complete") ST.refresh();
  else addEventListener("load", () => ST.refresh());
});
else root.classList.remove("motion");
