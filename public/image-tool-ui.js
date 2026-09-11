import { HISTORY_STORAGE_KEY } from './history.js';
import { IMAGE_COMMAND, parseImageCommand, shouldSuggestImageCommand } from './image-command.js';

const COMMAND = IMAGE_COMMAND;
const form = document.getElementById('userForm');
const input = document.getElementById('userInput');
const chat = document.getElementById('chat');
const toastEl = document.getElementById('toast');
const attachmentCache = new Map();
let imageToolEnabled = false;
let imageToolConfigured = false;
let imagePending = false;
let toastTimer;

function ensureStylesheet() {
  if (document.querySelector('link[data-image-tool-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/image-tool.css';
  link.dataset.imageToolStyle = '1';
  document.head.append(link);
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

function createMenu() {
  if (!form) return null;
  const menu = document.createElement('div');
  menu.className = 'tool-command-menu hidden';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Công cụ chat');
  menu.innerHTML = `
    <button class="tool-command-item" type="button" data-command="${COMMAND}" role="option">
      <span class="tool-command-icon">IMG</span>
      <span class="tool-command-copy"><strong>${COMMAND}</strong><small>Tạo ảnh trực tiếp trong cuộc trò chuyện</small></span>
      <span class="tool-command-state"></span>
    </button>`;
  form.append(menu);
  return menu;
}

function setMenuAvailability(menu) {
  const item = menu?.querySelector('[data-command]');
  const state = menu?.querySelector('.tool-command-state');
  if (!item || !state) return;
  item.disabled = !imageToolEnabled;
  state.textContent = imageToolEnabled ? 'Sẵn sàng' : (imageToolConfigured ? 'Đang tắt' : 'Chưa cấu hình');
}

function openMenu(menu) {
  if (!menu) return;
  setMenuAvailability(menu);
  menu.classList.remove('hidden');
}

function closeMenu(menu) {
  menu?.classList.add('hidden');
}

function selectImageCommand(menu) {
  if (!input || !imageToolEnabled) return;
  input.value = `${COMMAND} `;
  closeMenu(menu);
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
}

async function loadToolConfig(menu) {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await response.json();
    imageToolEnabled = Boolean(config?.imageGen?.enabled);
    imageToolConfigured = Boolean(config?.imageGen?.configured);
  } catch {
    imageToolEnabled = false;
    imageToolConfigured = false;
  }
  setMenuAvailability(menu);
}

function safeImageUrl(value) {
  const raw = String(value || '');
  if (!raw.startsWith('/generated/')) return '';
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/generated/') ? url.href : '';
  } catch {
    return '';
  }
}

function readStoredEntry(messageId) {
  try {
    const records = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(records)) return null;
    for (const record of records) {
      const entry = Array.isArray(record?.history) ? record.history.find((item) => item?.id === messageId) : null;
      if (entry) return entry;
    }
  } catch {}
  return null;
}

function renderAttachments(article, entry) {
  if (!(article instanceof HTMLElement) || !entry) return;
  if (article.querySelector('.image-attachment-grid')) return;
  const attachments = Array.isArray(entry.attachments) ? entry.attachments.filter((item) => item?.type === 'image') : [];
  if (!attachments.length) return;
  const body = article.querySelector('.message-body');
  if (!body) return;

  const grid = document.createElement('div');
  grid.className = 'image-attachment-grid';
  for (const attachment of attachments) {
    const src = safeImageUrl(attachment.url);
    if (!src) continue;
    const link = document.createElement('a');
    link.className = 'image-attachment-link';
    link.href = src;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Mở ảnh kích thước đầy đủ';

    const image = document.createElement('img');
    image.className = 'chat-generated-image';
    image.src = src;
    image.alt = String(attachment.alt || attachment.prompt || 'Ảnh do AI tạo').slice(0, 1000);
    image.loading = 'lazy';
    image.decoding = 'async';
    link.append(image);
    grid.append(link);
  }
  if (grid.childElementCount) body.append(grid);
}

function decorateArticle(article) {
  if (!(article instanceof HTMLElement) || !article.matches('.message.tool[data-message-id]')) return;
  const id = article.dataset.messageId;
  const entry = attachmentCache.get(id) || readStoredEntry(id);
  renderAttachments(article, entry);
}

function scheduleDecorate(entry, attempt = 0) {
  if (!entry?.id || !chat) return;
  attachmentCache.set(entry.id, entry);
  const article = chat.querySelector(`[data-message-id="${CSS.escape(entry.id)}"]`);
  if (article) {
    decorateArticle(article);
    return;
  }
  if (attempt < 12) setTimeout(() => scheduleDecorate(entry, attempt + 1), 50 + attempt * 25);
}

function escapeText(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createPendingMessage(prompt) {
  if (!chat) return null;
  chat.querySelector('.empty-state')?.remove();
  const article = document.createElement('article');
  article.className = 'message tool image-tool-pending';
  article.innerHTML = `
    <div class="avatar">IMG</div>
    <div class="message-body">
      <div class="message-meta"><b>Image Generator</b><span class="usage">đang tạo ảnh</span></div>
      <div class="bubble"><span class="image-tool-spinner"></span>Đang render: ${escapeText(prompt)}</div>
    </div>`;
  chat.append(article);
  chat.scrollTop = chat.scrollHeight;
  return article;
}

async function runImageCommand(prompt) {
  if (!imageToolEnabled) {
    showToast(imageToolConfigured ? 'Tool tạo ảnh đang bị tắt trong .env.' : 'Chưa cấu hình IMAGE_GEN_API_KEY / IMAGE_GEN_MODEL / IMAGE_GEN_BASE_URL.');
    return;
  }
  if (imagePending) {
    showToast('Một ảnh đang được tạo. Chờ lượt đó xong đã.');
    return;
  }
  if (!prompt) {
    showToast('Gõ mô tả sau /img_gen, ví dụ: /img_gen bầu trời đầy sao.');
    return;
  }

  imagePending = true;
  const pending = createPendingMessage(prompt);
  try {
    const response = await fetch('/api/tools/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.entry) scheduleDecorate(data.entry);
  } catch (error) {
    if (input && !input.value) input.value = `${COMMAND} ${prompt}`;
    showToast(error?.message || 'Không thể tạo ảnh.');
  } finally {
    pending?.remove();
    imagePending = false;
    if (input && !input.disabled) input.focus({ preventScroll: true });
  }
}

function setupHistoryDecoration() {
  if (!chat) return;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches('.message.tool')) decorateArticle(node);
        for (const article of node.querySelectorAll?.('.message.tool[data-message-id]') || []) decorateArticle(article);
      }
    }
  });
  observer.observe(chat, { childList: true, subtree: true });
  for (const article of chat.querySelectorAll('.message.tool[data-message-id]')) decorateArticle(article);
}

if (form && input) {
  ensureStylesheet();
  const menu = createMenu();
  void loadToolConfig(menu);
  setupHistoryDecoration();

  input.addEventListener('input', () => {
    if (shouldSuggestImageCommand(input.value)) openMenu(menu);
    else closeMenu(menu);
  });

  input.addEventListener('keydown', (event) => {
    if (!menu || menu.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(menu);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      selectImageCommand(menu);
    }
  });

  menu?.addEventListener('mousedown', (event) => event.preventDefault());
  menu?.addEventListener('click', (event) => {
    const item = event.target.closest?.('[data-command="/img_gen"]');
    if (!item || item.disabled) return;
    selectImageCommand(menu);
  });

  document.addEventListener('click', (event) => {
    if (event.target === input || menu?.contains(event.target)) return;
    closeMenu(menu);
  });

  form.addEventListener('submit', (event) => {
    const command = parseImageCommand(input.value);
    if (!command.matched) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeMenu(menu);
    if (!command.prompt) {
      input.value = `${COMMAND} `;
      input.focus({ preventScroll: true });
      showToast('Thêm mô tả ảnh sau /img_gen.');
      return;
    }
    input.value = '';
    input.focus({ preventScroll: true });
    void runImageCommand(command.prompt);
  }, { capture: true });
}
