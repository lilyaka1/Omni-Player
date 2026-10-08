export function initGlobalTheme() {
  let darkMode = localStorage.getItem('theme') === 'dark';

  const applyTheme = () => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.body?.classList.toggle('dark', darkMode);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.className = darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  };

  const toggleTheme = () => {
    darkMode = !darkMode;
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');

    if (!document.startViewTransition) {
      applyTheme();
      return;
    }

    document.documentElement.classList.add('theme-switching');
    const transition = document.startViewTransition(applyTheme);
    const clearSwitching = () => document.documentElement.classList.remove('theme-switching');

    if (transition.finished?.finally) {
      transition.finished.finally(clearSwitching);
    } else if (transition.ready?.finally) {
      transition.ready.finally(clearSwitching);
    } else {
      setTimeout(clearSwitching, 1200);
    }
  };

  const onClick = (event) => {
    const button = event.target.closest('#themeToggle');
    if (button) toggleTheme();
  };

  applyTheme();
  document.addEventListener('click', onClick);

  return () => {
    document.removeEventListener('click', onClick);
  };
}
