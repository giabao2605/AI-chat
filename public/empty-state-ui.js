const $ = (id) => document.getElementById(id);

const TEMPLATE_TOPICS = {
  explain: 'Giải thích một khái niệm theo cách dễ hiểu, có ví dụ minh họa.',
  ideate: 'Cùng brainstorm một chủ đề mới và đề xuất nhiều góc nhìn khác nhau.',
  summarize: 'Tóm tắt một chủ đề thành các ý chính ngắn gọn, dễ nắm bắt.',
};

const EMPTY_MARKUP = `
  <div class="empty-state-inner">
    <div class="empty-kicker">Sẵn sàng</div>
    <h2>Bắt đầu cuộc trò chuyện</h2>
    <p class="empty-description">Đặt câu hỏi, trò chuyện, khám phá ý tưởng mới.</p>
    <div class="empty-actions">
      <button class="empty-action primary" type="button" data-empty-action="auto-topic" data-default-label="Để AI tự chọn chủ đề">
        <span data-empty-label>Để AI tự chọn chủ đề</span><span class="empty-arrow" aria-hidden="true">→</span>
      </button>
      <button class="empty-action" type="button" data-empty-action="settings">Mở thiết lập</button>
    </div>
    <div class="empty-suggestions" aria-label="Gợi ý bắt đầu">
      <button class="empty-chip" type="button" data-empty-template="explain">Giải thích</button>
      <button class="empty-chip" type="button" data-empty-template="ideate">Lên ý tưởng</button>
      <button class="empty-chip" type="button" data-empty-template="summarize">Tóm tắt</button>
    </div>
  </div>`;

function enhanceEmptyState(empty) {
  if (!empty || empty.dataset.emptyV2 === '1') return;
  empty.dataset.emptyV2 = '1';
  empty.classList.add('empty-state-v2');
  empty.innerHTML = EMPTY_MARKUP;
  syncActionState();
}

function hydrateEmptyStates() {
  document.querySelectorAll('#chat .empty-state').forEach(enhanceEmptyState);
}

function roomIsBusy() {
  const startBtn = $('startBtn');
  return Boolean(startBtn?.disabled);
}

function syncActionState() {
  const busy = roomIsBusy();
  document.querySelectorAll('#chat [data-empty-action="auto-topic"], #chat [data-empty-template]').forEach((button) => {
    if (button.dataset.loading === '1') return;
    button.disabled = busy;
  });
}

function restoreAutoButton(button) {
  if (!button) return;
  button.dataset.loading = '0';
  const label = button.querySelector('[data-empty-label]');
  if (label) label.textContent = button.dataset.defaultLabel || 'Để AI tự chọn chủ đề';
  button.disabled = roomIsBusy();
}

function setAutoLoading(button) {
  button.dataset.loading = '1';
  button.disabled = true;
  const label = button.querySelector('[data-empty-label]');
  if (label) label.textContent = 'Đang bắt đầu…';

  window.setTimeout(() => {
    if (button.isConnected && !roomIsBusy()) restoreAutoButton(button);
  }, 2500);
}

function startAutoTopic(button) {
  const topicMode = $('topicMode');
  const startBtn = $('startBtn');
  if (!topicMode || !startBtn || startBtn.disabled) return;

  topicMode.value = 'auto';
  topicMode.dispatchEvent(new Event('change', { bubbles: true }));
  setAutoLoading(button);
  startBtn.click();
}

function openSettings() {
  const workspace = $('workspace');
  const expandBtn = $('expandControlBtn');
  if (workspace?.classList.contains('controls-collapsed') && expandBtn) expandBtn.click();

  requestAnimationFrame(() => {
    const target = $('conversationMode') || $('topicMode');
    target?.focus({ preventScroll: true });
  });
}

function applyTemplate(kind) {
  const text = TEMPLATE_TOPICS[kind];
  if (!text || roomIsBusy()) return;

  const topicMode = $('topicMode');
  const topic = $('topic');
  const userInput = $('userInput');

  if (topicMode) {
    topicMode.value = 'manual';
    topicMode.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (topic) {
    topic.value = text;
    topic.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (userInput && !userInput.disabled) {
    userInput.value = text;
    userInput.dispatchEvent(new Event('input', { bubbles: true }));
    userInput.focus();
  } else {
    topic?.focus();
  }
}

const chat = $('chat');
if (chat) {
  chat.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-empty-action]');
    if (actionButton && chat.contains(actionButton)) {
      const action = actionButton.dataset.emptyAction;
      if (action === 'auto-topic') startAutoTopic(actionButton);
      if (action === 'settings') openSettings();
      return;
    }

    const templateButton = event.target.closest('[data-empty-template]');
    if (templateButton && chat.contains(templateButton)) applyTemplate(templateButton.dataset.emptyTemplate);
  });

  const observer = new MutationObserver(() => hydrateEmptyStates());
  observer.observe(chat, { childList: true, subtree: true });
}

const startBtn = $('startBtn');
if (startBtn) {
  const startObserver = new MutationObserver(() => {
    syncActionState();
    if (!startBtn.disabled) {
      document.querySelectorAll('#chat [data-empty-action="auto-topic"][data-loading="1"]').forEach(restoreAutoButton);
    }
  });
  startObserver.observe(startBtn, { attributes: true, attributeFilter: ['disabled'] });
}

hydrateEmptyStates();
