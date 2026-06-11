import React from 'react';
import { formatDuration } from '../utils/format';
import useTrackStatus from '../hooks/useTrackStatus';
import TrackStatus from './TrackStatus';

export default function TrackItem({
  track,
  isActive,
  isRedownloading,
  onPlay,
  onEdit,
  onRedownload,
  onRemove,
}) {
  const { status } = useTrackStatus(track.id);
  const isPlayable = status === 'ready' && !!track.playUrl && (track.availability ? track.availability === 'FULL' : true);

  return (
    <>
      <div className="track-thumbnail">
        {track.thumbnail ? (
          <img src={track.thumbnail} alt={track.title} />
        ) : (
          <div className="track-thumbnail-placeholder">
            <span>🎵</span>
          </div>
        )}
        {isActive && (
          <div className="track-playing-indicator">
            <div className="equalizer">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      <div className="track-info">
        <div className="track-title">{track.title}</div>

        <div className="track-meta">
          {track.artist && (
            <span className="track-meta-artist" title={track.artist}>{track.artist}</span>
          )}
          {track.duration && (
            <span className="track-duration">{formatDuration(track.duration)}</span>
          )}
          {track.source && track.source !== 'local' && (
            <span className={`source-badge ${track.source}`}>{track.source}</span>
          )}
          {track.source === 'soundcloud' && track.availability && track.availability !== 'FULL' && (
            <span className={`badge glass-flat availability-${String(track.availability).toLowerCase()}`} title={
              track.availability === 'PREVIEW_ONLY' ? 'SoundCloud preview only' : (track.availability === 'RESTRICTED' ? 'Requires SoundCloud Go+' : 'Track unavailable')
            }>
              {track.availability === 'PREVIEW_ONLY' ? 'Preview only' : (track.availability === 'RESTRICTED' ? 'Restricted' : 'Unknown')}
            </span>
          )}
          <TrackStatus trackId={track.id} initialStatus={track.processing_status} initialProgress={track.processing_progress} />
        </div>
      </div>

      <div className="track-actions">
        <button
          className="btn-icon"
          onClick={() => isPlayable && onPlay(track)}
          title={isActive ? 'Играет' : (isPlayable ? 'Воспроизвести' : (track.availability && track.availability !== 'FULL' ? (track.availability === 'PREVIEW_ONLY' ? 'SoundCloud preview only' : (track.availability === 'RESTRICTED' ? 'Requires SoundCloud Go+' : 'Трек недоступен')) : 'Трек не готов'))}
          disabled={!isPlayable}
        >
          {isActive ? '⏸' : '▶'}
        </button>

        <button className="btn-icon" onClick={() => onEdit(track)} title="Редактировать">
          ✏️
        </button>

        {track.source && track.source !== 'local' && (
          <button
            className="btn-icon"
            onClick={() => onRedownload(track)}
            disabled={isRedownloading}
            title="Перезагрузить"
          >
            {isRedownloading ? <span className="spinner-small">⟳</span> : '🔄'}
          </button>
        )}

        <button className="btn-icon btn-danger" onClick={() => onRemove(track)} title="Удалить">
          🗑️
        </button>
      </div>
    </>
  );
}
