/* Apply the saved theme before styles paint; controls work for guests and members. */
(() => {
  const key = 'checkpoint-theme';
  const root = document.documentElement;
  let current = 'dark';
  try {
    if (localStorage.getItem(key) === 'light') current = 'light';
  } catch { /* Storage may be disabled; switching still works for this page. */ }

  function apply(theme) {
    current = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = current;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current === 'light' ? '#f5f7fb' : '#05070c');
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const label = `Switch to ${current === 'light' ? 'dark' : 'light'} mode`;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.hidden = false;
    });
  }

  apply(current);
  document.addEventListener('DOMContentLoaded', () => {
    apply(current);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        apply(current === 'light' ? 'dark' : 'light');
        try { localStorage.setItem(key, current); } catch { /* Optional persistence. */ }
      });
    });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
