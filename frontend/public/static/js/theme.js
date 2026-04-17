/**
 * theme.js — единое управление светлой/тёмной темой.
 * Подключается на всех страницах. Читает localStorage['theme'],
 * применяет класс .dark к <html> и <body>, вешает обработчик на #themeToggle.
 * Использует View Transition API для плавной анимации там, где поддерживается.
 */
(function () {
  'use strict';

  var darkMode = localStorage.getItem('theme') === 'dark';

  function applyTheme() {
    // Keep theme marker on both html/body to avoid transient style mismatches.
    document.documentElement.classList.toggle('dark', darkMode);
    if (document.body) document.body.classList.toggle('dark', darkMode);
    var icon = document.getElementById('themeIcon');
    if (icon) icon.className = darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }

  function toggleTheme() {
    darkMode = !darkMode;
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');

    if (!document.startViewTransition) {
      applyTheme();
      return;
    }

    // During view-transition, suppress glass property transitions to avoid
    // a delayed "muddiness" pass after the circle animation completes.
    document.documentElement.classList.add('theme-switching');

    var t = document.startViewTransition(applyTheme);
    var clearSwitching = function () {
      document.documentElement.classList.remove('theme-switching');
    };

    if (t.finished && typeof t.finished.finally === 'function') {
      t.finished.finally(clearSwitching);
    } else if (t.ready && typeof t.ready.finally === 'function') {
      t.ready.finally(clearSwitching);
    } else {
      setTimeout(clearSwitching, 1200);
    }
  }

  // Apply immediately to avoid flash; body will be toggled once available.
  applyTheme();

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme();

    var btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  });
})();
