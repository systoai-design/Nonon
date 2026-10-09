/* Arms the entrance states before first paint so nothing shows, hides and then animates in.
   home.js / inner.js confirm with `motion-ready`; if neither does (a script failed to load) the
   class comes off after 4 s and the page simply shows as it is.
   A page that loads hidden (a background tab, a hidden preview pane, a prerender) renders no frames,
   so its entrances would sit frozen on their first frame: words still in their masks. It stays
   static until it is actually shown, then arms. The scripts wait for the same `nonon:arm` event. */
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var arm = function () {
    root.classList.add("motion");
    document.dispatchEvent(new Event("nonon:arm"));
    setTimeout(function () {
      if (!root.classList.contains("motion-ready")) root.classList.remove("motion");
    }, 4000);
  };
  if (!document.hidden) { arm(); return; }
  var onShow = function () {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", onShow);
    arm();
  };
  document.addEventListener("visibilitychange", onShow);
})();
