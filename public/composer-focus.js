import './markdown-ui.js';

const form = document.getElementById('userForm');
const input = document.getElementById('userInput');

if (form && input) {
  function focusWhenComposerReady() {
    if (!input.disabled) {
      input.focus({ preventScroll: true });
      return;
    }

    const observer = new MutationObserver(() => {
      if (input.disabled) return;
      observer.disconnect();
      clearTimeout(timeout);
      input.focus({ preventScroll: true });
    });

    observer.observe(input, { attributes: true, attributeFilter: ['disabled'] });
    const timeout = setTimeout(() => observer.disconnect(), 30000);
  }

  form.addEventListener('submit', () => {
    // Run after every submit listener has completed its synchronous work.
    // app.js disables the input while the request is in flight, then re-enables it in finally.
    queueMicrotask(focusWhenComposerReady);
  });
}
