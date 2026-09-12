const MATHJAX_SCRIPT_ID = 'mathjax-v3-script';
const MATHJAX_SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';

let loadPromise = null;

function configureMathJax() {
  window.MathJax = window.MathJax || {};
  window.MathJax.tex = {
    ...(window.MathJax.tex || {}),
    inlineMath: [['\\(', '\\)'], ['$', '$']],
    displayMath: [['\\[', '\\]'], ['$$', '$$']],
    processEscapes: true,
  };
  window.MathJax.options = {
    ...(window.MathJax.options || {}),
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  };
}

export function ensureMathRenderer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (window.MathJax?.typesetPromise) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  configureMathJax();
  loadPromise = new Promise((resolve) => {
    const existing = document.getElementById(MATHJAX_SCRIPT_ID);
    const script = existing || document.createElement('script');

    const finish = () => {
      const startup = window.MathJax?.startup?.promise;
      if (startup?.then) startup.then(() => resolve(Boolean(window.MathJax?.typesetPromise))).catch(() => resolve(false));
      else resolve(Boolean(window.MathJax?.typesetPromise));
    };

    if (existing) {
      if (window.MathJax?.typesetPromise) finish();
      else {
        existing.addEventListener('load', finish, { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
      }
      return;
    }

    script.id = MATHJAX_SCRIPT_ID;
    script.src = MATHJAX_SRC;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.append(script);
  });

  return loadPromise;
}

export async function typesetMath(root) {
  if (!(root instanceof HTMLElement)) return false;
  if (!/[\\$]/.test(root.textContent || '')) return false;
  const ready = await ensureMathRenderer();
  if (!ready || !window.MathJax?.typesetPromise) return false;
  try {
    window.MathJax.typesetClear?.([root]);
    await window.MathJax.typesetPromise([root]);
    root.classList.add('math-rendered');
    return true;
  } catch {
    return false;
  }
}
