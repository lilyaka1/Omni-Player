import React from 'react';
import useTrackStatus from '../hooks/useTrackStatus';

const STATUS_LABELS = {
  queued: 'В очереди',
  downloading: 'Скачивание…',
  processing: 'Обработка…',
  ready: 'Готово',
  failed: 'Ошибка',
};

export default function TrackStatus({ trackId, initialStatus = null, initialProgress = null }) {
  const { status, progress } = useTrackStatus(trackId);
  const s = status ?? initialStatus;
  const p = progress ?? initialProgress;

  if (!s) return null;

  return (
    <div className={`track-status status-${s}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="status-label" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {STATUS_LABELS[s] || s}
      </span>
      {(['downloading', 'processing'].includes(s) && typeof p === 'number') && (
        <div className="status-progress" style={{ width: 120, height: 6, background: 'rgba(0,0,0,0.06)', borderRadius: 3 }}>
          <div style={{ width: `${Math.max(0, Math.min(100, p))}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
        </div>
      )}
    </div>
  );
}
