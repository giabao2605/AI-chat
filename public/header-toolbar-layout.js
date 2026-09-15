function ensureToolbarLayoutStyles() {
  if (document.querySelector('link[href="/header-toolbar-layout.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/header-toolbar-layout.css';
  document.head.append(link);
}

function ensureSidebarToolActions() {
  const monitor = document.querySelector('.control-monitor');
  if (!monitor) return null;
  let actions = document.getElementById('sidebarToolActions');
  if (!actions) {
    actions = document.createElement('div');
    actions.id = 'sidebarToolActions';
    actions.className = 'sidebar-tool-actions';
    actions.setAttribute('aria-label', 'Công cụ bộ nhớ và private context');
    const tokenPanel = document.getElementById('tokenPanel');
    if (tokenPanel?.parentElement === monitor) monitor.insertBefore(actions, tokenPanel);
    else monitor.prepend(actions);
  }
  return actions;
}

function moveSessionControlsToHeader() {
  const toolbar = document.querySelector('.toolbar-actions');
  if (!toolbar) return;

  const statusLine = document.querySelector('.control-status-line');
  const status = statusLine?.querySelector('.status-wrap');
  if (status) {
    status.classList.add('toolbar-session-status');
    status.setAttribute('aria-label', 'Trạng thái realtime của phiên');
    toolbar.append(status);
  }

  const history = document.getElementById('historyBtn');
  if (history) {
    history.classList.add('toolbar-history-button');
    toolbar.append(history);
  }

  if (statusLine && statusLine.children.length === 0) statusLine.remove();
}

function keepDebugToolsInSidebar() {
  const actions = ensureSidebarToolActions();
  if (!actions) return;
  for (const id of ['memoryInspectorBtn', 'privateContextInspectorBtn']) {
    const button = document.getElementById(id);
    if (button) actions.append(button);
  }
}

ensureToolbarLayoutStyles();
moveSessionControlsToHeader();
keepDebugToolsInSidebar();
