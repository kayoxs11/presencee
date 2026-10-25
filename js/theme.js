/* Restore before CSS loads to avoid a flash of the wrong theme. */
(() => {
  const key = 'presence:theme';
  const root = document.documentElement;
  let theme = 'light';
  try {
    if (localStorage.getItem(key) === 'dark') theme = 'dark';
  } catch (_) { /* The switch remains usable when storage is unavailable. */ }

  function apply(value, announce = false) {
    theme = value === 'dark' ? 'dark' : 'light';
    root.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro';
    }
    if (announce) {
      document.getElementById('theme-status').textContent =
        theme === 'dark' ? 'Modo escuro ativado' : 'Modo claro ativado';
    }
  }

  apply(theme);
  document.addEventListener('DOMContentLoaded', () => {
    apply(theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      apply(theme === 'dark' ? 'light' : 'dark', true);
      try { localStorage.setItem(key, theme); } catch (_) { /* Storage may be disabled. */ }
    });
    requestAnimationFrame(() => root.classList.add('theme-ready'));
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
