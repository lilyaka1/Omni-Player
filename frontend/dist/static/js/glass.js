/**
 * glass.js — iOS 26 Liquid Glass specular highlight
 * Tracks cursor position and updates --_sx / --_sy on the nearest .glass
 * ancestor so the specular ellipse (::after in style.css) follows the light.
 *
 * Uses event delegation so dynamically-added cards work automatically.
 * Uses capture-phase 'mouseleave' to avoid false resets when cursor moves
 * between child elements inside the same glass panel.
 */
(function () {
  'use strict';

  var raf = null;

  function getGlassTarget(e) {
    var node = e.target;
    while (node && node !== document.documentElement) {
      if (node.classList && node.classList.contains('glass')) return node;
      node = node.parentElement;
    }
    return null;
  }

  // mousemove: update specular position on the glass panel under cursor
  document.addEventListener('mousemove', function (e) {
    var el = getGlassTarget(e);
    if (!el) return;

    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      var r = el.getBoundingClientRect();
      var x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      var y = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
      el.style.setProperty('--_sx', (x * 100) + '%');
      el.style.setProperty('--_sy', (y * 100) + '%');
    });
  });

  // mouseleave with capture: fires only when cursor truly leaves the element,
  // not when moving between its children (unlike mouseout which bubbles from children)
  document.addEventListener('mouseleave', function (e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('glass')) return;
    // Reset specular to ambient top-left position
    el.style.setProperty('--_sx', '32%');
    el.style.setProperty('--_sy', '20%');
  }, true /* capture */);

})();
