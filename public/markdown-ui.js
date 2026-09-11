import { markdownToSafeHtml } from './markdown.js';

const chat = document.getElementById('chat');
const AI_BUBBLE_SELECTOR = '.message.a .bubble, .message.b .bubble';

function rawTextSource(bubble) {
  if (!(bubble instanceof HTMLElement)) return null;
  if (!bubble.matches(AI_BUBBLE_SELECTOR)) return null;
  if (bubble.childNodes.length !== 1 || bubble.firstChild?.nodeType !== Node.TEXT_NODE) return null;
  return bubble.firstChild.nodeValue ?? '';
}

function renderBubble(bubble) {
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
      if (mutation.target instanceof HTMLElement && mutation.target.matches(AI_BUBBLE_SELECTOR)) {
        candidates.add(mutation.target);
      } else if (mutation.target?.nodeType === Node.TEXT_NODE) {
        const parent = mutation.target.parentElement;
        if (parent?.matches?.(AI_BUBBLE_SELECTOR)) candidates.add(parent);
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && node.matches(AI_BUBBLE_SELECTOR)) candidates.add(node);
        if (node instanceof HTMLElement) {
          for (const bubble of node.querySelectorAll(AI_BUBBLE_SELECTOR)) candidates.add(bubble);
        }
      }
    }
    for (const bubble of candidates) renderBubble(bubble);
  });

  observer.observe(chat, { subtree: true, childList: true, characterData: true });
}

export { rawTextSource, renderBubble, scanNode };
