"use strict";

// The inner pages: a headline that rises, sections that arrive as you reach them, and Non waving once.
// Only while boot.js has armed `motion`; with it off every block is simply visible.
(function () {
  var root = document.documentElement;
  var non = document.querySelector(".page__non .non");
  if (non && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setTimeout(function () { non.dataset.state = "greeting"; }, 500);
    setTimeout(function () { non.dataset.state = "idle"; }, 2700);
  }
  if (!("IntersectionObserver" in window)) return;
  var start = function () {
    if (!root.classList.contains("motion")) return;
    root.classList.add("motion-ready");
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(document.querySelectorAll("[data-reveal], .platform, .prose, .status-group"), function (el) { io.observe(el); });
  };
  // boot.js arms motion now, or later if the page loaded hidden
  if (root.classList.contains("motion")) start();
  else document.addEventListener("nonon:arm", start, { once: true });
})();
