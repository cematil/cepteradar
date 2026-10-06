// Sağ tıklama, metin seçme ve geliştirici kısayollarını engelleyen koruma katmanı.
(function () {
  'use strict';
  const isFormField = (el) => el && el.closest && el.closest('select, input, textarea');

  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!isFormField(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    const k = e.keyCode;
    if (k === 123 ||
        (e.ctrlKey && e.shiftKey && (k === 73 || k === 74 || k === 67)) ||
        (e.ctrlKey && (k === 85 || k === 83))) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
})();
