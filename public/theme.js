(function() {
  const stored = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');

  function updateIcons() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    document.querySelectorAll('.icon-sun').forEach(el => { el.style.display = isLight ? 'none' : 'block'; });
    document.querySelectorAll('.icon-moon').forEach(el => { el.style.display = isLight ? 'block' : 'none'; });
  }

  function init() {
    updateIcons();
    document.querySelectorAll('#themeToggle, .theme-toggle').forEach(btn => {
      if (btn && !btn.dataset.themeBound) {
        btn.dataset.themeBound = 'true';
        btn.addEventListener('click', () => {
          const isLight = document.documentElement.getAttribute('data-theme') === 'light';
          document.documentElement.setAttribute('data-theme', isLight ? '' : 'light');
          localStorage.setItem('theme', isLight ? 'dark' : 'light');
          updateIcons();
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
