import { markdownToSafeHtml } from './markdown.js';

if (!document.querySelector('link[data-markdown-ui]')) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/markdown.css';
  stylesheet.dataset.markdownUi = '1';
  document.head.append(stylesheet);
}

const chat = document.getElementById('chat');
const AI_BUBBLE_SELECTOR = '.message.a .bubble, .message.b .bubble';

function rawTextSource(bubble) {
  if (!(bubble instanceof HTMLElement)) return null;
  if (!bubble.matches(AI_BUBBLE_SELECTOR)) return null;
  if (bubble.childNodes.length !== 1 || bubble.firstChild?.nodeType !== Node.TEXT_NODE) return null;
  return bubble.firstChild.nodeValue ?? '';
}

function renderBubble(bubble) {
  if (!(bubble instanceof HTMLElement) || bubble.classList.contains('typing')) return;
  const raw = rawTextSource(bubble);
  if (raw === null) return;
  bubble.classList.add('markdown');
  bubble.innerHTML = markdownToSafeHtml(raw);
}

function scanNode(node) {
  if (node instanceof HTMLElement) {
    if (node.matches(AI_BUBBLE_SELECTOR)) renderBubble(node);
    for (const bubble of node.querySelectorAll(AI_BUBBLE_SELECTOR)) renderBubble(bubble);
    return;
  }
  if (node?.nodeType === Node.TEXT_NODE) renderBubble(node.parentElement);
}

if (chat) {
  for (const bubble of chat.querySelectorAll(AI_BUBBLE_SELECTOR)) renderBubble(bubble);

  const observer = new MutationObserver((mutations) => {
    const candidates = new Set();
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target instanceof HTMLElement && target.matches(AI_BUBBLE_SELECTOR) && !target.classList.contains('typing')) {
          candidates.add(target);
        }
        continue;
      }

      if (mutation.target instanceof HTMLElement && mutation.target.matches(AI_BUBBLE_SELECTOR)) {
        if (!mutation.target.classList.contains('typing')) candidates.add(mutation.target);
      } else if (mutation.target?.nodeType === Node.TEXT_NODE) {
        const parent = mutation.target.parentElement;
        if (parent?.matches?.(AI_BUBBLE_SELECTOR) && !parent.classList.contains('typing')) candidates.add(parent);
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && node.matches(AI_BUBBLE_SELECTOR) && !node.classList.contains('typing')) candidates.add(node);
        if (node instanceof HTMLElement) {
          for (const bubble of node.querySelectorAll(AI_BUBBLE_SELECTOR)) {
            if (!bubble.classList.contains('typing')) candidates.add(bubble);
          }
        }
      }
    }
    for (const bubble of candidates) renderBubble(bubble);
  });

  observer.observe(chat, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

export { rawTextSource, renderBubble, scanNode };
