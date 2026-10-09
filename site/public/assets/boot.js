/* Arms the entrance states before first paint so nothing shows, hides and then animates in.
   home.js confirms with `motion-ready`; if it never does (a script failed to load) the class
   comes off after 4 s and the page simply shows as it is. */
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("motion");
  setTimeout(function () {
    if (!root.classList.contains("motion-ready")) root.classList.remove("motion");
  }, 4000);
})();
