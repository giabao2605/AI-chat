import './history-resume-ui.js';

const statusNode = document.getElementById('researchStatus');

if (statusNode) {
  let activeSpeaker = null;
  let clearTimer = null;

  function showStatus(text, mode = 'searching') {
    clearTimeout(clearTimer);
    statusNode.textContent = text;
    statusNode.className = `research-status ${mode}`;
  }

  function clearStatus(delay = 0) {
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      statusNode.textContent = '';
      statusNode.className = 'research-status hidden';
      activeSpeaker = null;
    }, delay);
  }

  const events = new EventSource('/api/events');

  events.addEventListener('research:start', (event) => {
    const data = JSON.parse(event.data);
    activeSpeaker = data.speaker;
    const count = Array.isArray(data.queries) ? data.queries.length : 0;
    showStatus(`${data.name} đang tìm kiếm web${count ? ` · ${count} truy vấn` : ''}…`, 'searching');
  });

  events.addEventListener('research:done', (event) => {
    const data = JSON.parse(event.data);
    activeSpeaker = data.speaker;
    const count = Array.isArray(data.sources) ? data.sources.length : 0;
    showStatus(`${data.name} đã lấy ${count} nguồn · đang tổng hợp câu trả lời…`, 'grounded');
  });

  events.addEventListener('research:error', (event) => {
    const data = JSON.parse(event.data);
    activeSpeaker = data.speaker;
    showStatus(`${data.name} tìm web thất bại · đang tiếp tục với dữ liệu hiện có`, 'failed');
  });

  events.addEventListener('message:done', (event) => {
    const data = JSON.parse(event.data);
    if (data.speaker === activeSpeaker) clearStatus(900);
  });

  events.addEventListener('message:failed', (event) => {
    const data = JSON.parse(event.data);
    if (data.speaker === activeSpeaker) clearStatus(900);
  });

  events.addEventListener('message:cancelled', (event) => {
    const data = JSON.parse(event.data);
    if (data.speaker === activeSpeaker) clearStatus();
  });
}
