import { HISTORY_STORAGE_KEY, parseStoredHistory } from './history.js';
import { getHistoryResumePlan } from './history-resume.js';

const $ = (id) => document.getElementById(id);
const historyList = $('historyList');
const banner = $('historyViewBanner');
const returnLiveBtn = $('returnLiveBtn');
const maxTurnsInput = $('maxTurns');
const roomStatus = $('roomStatus');

if (historyList && banner && returnLiveBtn && maxTurnsInput && roomStatus) {
  let selectedRunId = null;
  let submitting = false;

  const resumeBtn = document.createElement('button');
  resumeBtn.id = 'continueHistoryBtn';
  resumeBtn.className = 'button primary';
  resumeBtn.type = 'button';
  resumeBtn.textContent = 'Tiếp tục';

  const info = document.createElement('small');
  info.id = 'historyResumeInfo';
  info.style.color = '#8290a4';
  info.style.fontSize = '10px';
  info.style.whiteSpace = 'nowrap';

  const titleBlock = banner.querySelector(':scope > div');
  if (titleBlock) {
    titleBlock.style.flex = '1 1 auto';
    titleBlock.append(info);
  }
  banner.insertBefore(resumeBtn, returnLiveBtn);

  function records() {
    return parseStoredHistory(localStorage.getItem(HISTORY_STORAGE_KEY));
  }

  function selectedSession() {
    if (!selectedRunId) return null;
    return records().find((item) => item.runId === selectedRunId) || null;
  }

  function selectFromItem(item) {
    if (!item) return;
    const items = [...historyList.querySelectorAll('.history-item')];
    const index = items.indexOf(item);
    const record = index >= 0 ? records()[index] : null;
    selectedRunId = record?.runId || null;
    queueMicrotask(refresh);
  }

  function statusMessage(plan) {
    if (plan.reason === 'live-room-active') return 'Dừng phiên hiện tại trước khi tiếp tục phiên cũ.';
    if (plan.reason === 'limit-reached') return `Đã dùng ${plan.usedTurns}/${plan.maxTurns} lượt. Tăng “Số lượt” lên ít nhất ${plan.requiredMinTurns}.`;
    if (plan.reason === 'not-resumable') return 'Phiên này chưa ở trạng thái có thể tiếp tục.';
    if (plan.extended) return `${plan.usedTurns}/${plan.maxTurns} lượt · còn ${plan.remainingTurns} lượt sau khi tăng trần.`;
    return `${plan.usedTurns}/${plan.maxTurns} lượt · còn ${plan.remainingTurns} lượt.`;
  }

  function refresh() {
    const hidden = banner.classList.contains('hidden');
    const session = hidden ? null : selectedSession();
    if (!session) {
      resumeBtn.disabled = true;
      info.textContent = '';
      return;
    }

    const plan = getHistoryResumePlan(session, {
      requestedMaxTurns: Number(maxTurnsInput.value),
      liveStatus: roomStatus.textContent.trim(),
    });
    resumeBtn.disabled = submitting || !plan.canResume;
    resumeBtn.textContent = submitting ? 'Đang tiếp tục…' : 'Tiếp tục';
    info.textContent = statusMessage(plan);
  }

  async function continueSession() {
    const session = selectedSession();
    if (!session || submitting) return;
    const plan = getHistoryResumePlan(session, {
      requestedMaxTurns: Number(maxTurnsInput.value),
      liveStatus: roomStatus.textContent.trim(),
    });
    if (!plan.canResume) {
      refresh();
      return;
    }

    submitting = true;
    refresh();
    try {
      const response = await fetch('/api/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session,
          maxTurns: plan.maxTurns,
          startSpeaker: $('startSpeaker')?.value || 'a',
          temperature: Number($('temperature')?.value),
          maxOutputTokens: Number($('maxOutputTokens')?.value),
          sharedPrompt: $('sharedPrompt')?.value || '',
          personaA: $('personaA')?.value || '',
          personaB: $('personaB')?.value || '',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      selectedRunId = null;
      returnLiveBtn.click();
    } catch (error) {
      info.textContent = error?.message || String(error);
    } finally {
      submitting = false;
      refresh();
    }
  }

  historyList.addEventListener('click', (event) => {
    if (event.target.closest('.history-delete')) return;
    selectFromItem(event.target.closest('.history-item'));
  }, true);

  historyList.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    selectFromItem(event.target.closest('.history-item'));
  }, true);

  resumeBtn.addEventListener('click', continueSession);
  maxTurnsInput.addEventListener('input', refresh);
  maxTurnsInput.addEventListener('change', refresh);

  const observer = new MutationObserver(() => {
    if (!selectedRunId && !banner.classList.contains('hidden')) {
      const activeItem = historyList.querySelector('.history-item.active');
      selectFromItem(activeItem);
    } else {
      refresh();
    }
  });
  observer.observe(historyList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  observer.observe(banner, { attributes: true, attributeFilter: ['class'] });
  observer.observe(roomStatus, { childList: true, characterData: true, subtree: true });

  refresh();
}
