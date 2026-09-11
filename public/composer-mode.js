const JOIN_STATUSES = new Set(['running', 'paused', 'pausing']);

export function getComposerMode({ status = 'idle', configured = false, viewingHistory = false, submitting = false } = {}) {
  if (viewingHistory) {
    return {
      enabled: false,
      action: 'disabled',
      placeholder: 'Đang xem lịch sử. Quay lại phiên hiện tại để chat...',
    };
  }

  if (!configured) {
    return {
      enabled: false,
      action: 'disabled',
      placeholder: 'Cần cấu hình đủ hai AI trước khi bắt đầu...',
    };
  }

  if (submitting || status === 'starting') {
    return {
      enabled: false,
      action: 'disabled',
      placeholder: 'Đang bắt đầu phiên...',
    };
  }

  if (JOIN_STATUSES.has(status)) {
    return {
      enabled: true,
      action: 'message',
      placeholder: 'Chen vào cuộc trò chuyện...',
    };
  }

  return {
    enabled: true,
    action: 'start',
    placeholder: 'Nhập chủ đề để bắt đầu một phiên mới...',
  };
}
