import { formatTime } from '../utils/format';
import TrackStatus from './TrackStatus';
import useTrackStatus from '../hooks/useTrackStatus';

export default function PlayerControls({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  shuffle,
  repeatMode,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onVolumeChange,
  onToggleShuffle,
  onToggleRepeat,
}) {
  const formatSeekLabel = (seconds) => {
    if (!seconds) return '0:00';
    return formatTime(seconds);
  };

  const { status } = useTrackStatus(currentTrack?.id);

  const isReady = status === 'ready';

  return (
    <section className="player-hero glass glass-secondary">
      <div className="player-hero-cover">
        {currentTrack?.thumbnail
          ? <img src={currentTrack.thumbnail} alt="" loading="lazy" />
          : <div className="player-hero-cover-placeholder"><i className="fa-solid fa-music" /></div>}
      </div>

      <div className="player-hero-body">
        <div className="player-kicker">Сейчас играет</div>
        <h3 className="player-title">{currentTrack?.title || 'Выберите трек из очереди'}</h3>
        <div className="player-artist">{currentTrack?.artist || 'Локальная библиотека'}</div>
        {currentTrack?.id && (
          <div style={{ marginTop: 6 }}>
            <TrackStatus trackId={currentTrack.id} initialStatus={currentTrack?.processing_status} initialProgress={currentTrack?.processing_progress} />
          </div>
        )}

        <div className="player-progress-row">
          <span>{formatSeekLabel(currentTime)}</span>
          <div className="player-progress">
            <input
              type="range"
              min="0"
              max={Math.max(duration || currentTrack?.duration || 1, 1)}
              value={Math.min(currentTime, duration || currentTrack?.duration || 1)}
              onChange={(e) => onSeek(e.target.value)}
              disabled={!currentTrack?.playUrl || !isReady}
            />
          </div>
          <span>{formatSeekLabel(duration || currentTrack?.duration || 0)}</span>
        </div>

        <div className="player-controls-row">
          <button 
            className="player-icon-btn" 
            onClick={onPrev} 
            disabled={!currentTrack} 
            title="Предыдущий"
          >
            <i className="fa-solid fa-backward-step" />
          </button>
          <button 
            className="player-main-btn" 
            onClick={onTogglePlay} 
            disabled={!currentTrack || !isReady} 
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`} />
          </button>
          <button 
            className="player-icon-btn" 
            onClick={onNext} 
            disabled={!currentTrack} 
            title="Следующий"
          >
            <i className="fa-solid fa-forward-step" />
          </button>
          <button 
            className={`player-chip ${shuffle ? 'active' : ''}`} 
            onClick={onToggleShuffle} 
            title="Случайный порядок"
          >
            <i className="fa-solid fa-shuffle" /> Shuffle
          </button>
          <button 
            className={`player-chip ${repeatMode ? 'active' : ''}`} 
            onClick={onToggleRepeat} 
            title="Повтор одного трека"
          >
            <i className="fa-solid fa-repeat" /> Repeat
          </button>
        </div>

        <div className="player-volume-row">
          <i className="fa-solid fa-volume-low" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
          />
          <i className="fa-solid fa-volume-high" />
        </div>
      </div>
    </section>
  );
}
