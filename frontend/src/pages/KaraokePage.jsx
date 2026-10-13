import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AudioManager from '../utils/AudioManager';
import QueueStore from '../utils/QueueStore';
import { formatTime } from '../utils/format';
import { searchLrc } from '../utils/lrc';
import '../styles/karaoke.css';

export default function KaraokePage() {
  const [track, setTrack] = useState(() => AudioManager.currentTrack || QueueStore.getCurrentTrack());
  const [title, setTitle] = useState(track?.title || '');
  const [artist, setArtist] = useState(track?.artist || '');
  const [matches, setMatches] = useState([]);
  const [selectedLyrics, setSelectedLyrics] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [currentTime, setCurrentTime] = useState(AudioManager.getCurrentTime());
  const [duration, setDuration] = useState(AudioManager.getDuration());
  const [isPlaying, setIsPlaying] = useState(AudioManager.isPlaying);
  const activeLineRef = useRef(null);
  const searchControllerRef = useRef(null);

  const lookupLyrics = useCallback(async (queryTrack) => {
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setIsSearching(true);
    setSearchError('');
    setMatches([]);
    setSelectedLyrics(null);

    try {
      const results = await searchLrc(queryTrack, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setMatches(results);
        setSelectedLyrics(results[0]);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setSearchError(error instanceof Error ? error.message : 'Не удалось найти LRC.');
      }
    } finally {
      if (searchControllerRef.current === controller) {
        searchControllerRef.current = null;
        setIsSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    function syncTrack() {
      const nextTrack = AudioManager.currentTrack || QueueStore.getCurrentTrack();
      setTrack(nextTrack);
      setCurrentTime(AudioManager.getCurrentTime());
      setDuration(AudioManager.getDuration());
      setIsPlaying(AudioManager.isPlaying);
    }

    function syncPlayback() {
      setCurrentTime(AudioManager.getCurrentTime());
      setDuration(AudioManager.getDuration());
      setIsPlaying(AudioManager.isPlaying);
    }

    function handlePlaybackError() {
      setPlaybackError('Не удалось воспроизвести выбранный трек.');
    }

    function handlePlaybackEnd() {
      setIsPlaying(false);
      setCurrentTime(AudioManager.getDuration());
    }

    AudioManager.on('trackchange', syncTrack);
    AudioManager.on('timeupdate', syncPlayback);
    AudioManager.on('loadedmetadata', syncPlayback);
    AudioManager.on('play', syncPlayback);
    AudioManager.on('pause', syncPlayback);
    AudioManager.on('error', handlePlaybackError);
    AudioManager.on('ended', handlePlaybackEnd);
    QueueStore.on('queuechange', syncTrack);
    QueueStore.on('indexchange', syncTrack);

    syncTrack();
    return () => {
      AudioManager.off('trackchange', syncTrack);
      AudioManager.off('timeupdate', syncPlayback);
      AudioManager.off('loadedmetadata', syncPlayback);
      AudioManager.off('play', syncPlayback);
      AudioManager.off('pause', syncPlayback);
      AudioManager.off('error', handlePlaybackError);
      AudioManager.off('ended', handlePlaybackEnd);
      QueueStore.off('queuechange', syncTrack);
      QueueStore.off('indexchange', syncTrack);
      searchControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setTitle(track?.title || '');
    setArtist(track?.artist || '');
    setPlaybackError('');
    if (track?.title) {
      lookupLyrics({ title: track.title, artist: track.artist, duration: track.duration });
    }
  }, [track?.id, track?.title, track?.artist, track?.duration, lookupLyrics]);

  const lyrics = selectedLyrics?.lines || [];
  const activeIndex = useMemo(() => {
    let low = 0;
    let high = lyrics.length - 1;
    let active = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (lyrics[middle].time <= currentTime) {
        active = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return active;
  }, [currentTime, lyrics]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  const audioTrack = AudioManager.currentTrack;
  const canControlPlayback = Boolean(
    audioTrack?.playUrl
      && audioTrack.id === track?.id
      && (!audioTrack.status || audioTrack.status === 'ready'),
  );

  function handleSearch(event) {
    event.preventDefault();
    lookupLyrics({ title, artist, duration: track?.duration });
  }

  async function togglePlayback() {
    if (!canControlPlayback) return;
    setPlaybackError('');
    if (AudioManager.isPlaying) {
      AudioManager.pause();
      return;
    }

    const started = await AudioManager.play();
    if (!started) {
      setPlaybackError('Не удалось запустить воспроизведение. Попробуйте ещё раз.');
    }
  }

  function seekTo(time) {
    if (!canControlPlayback || !Number.isFinite(time)) return;
    AudioManager.seek(Math.min(duration || time, Math.max(0, time)));
    setCurrentTime(AudioManager.getCurrentTime());
  }

  function skip(seconds) {
    seekTo(Math.min(duration, Math.max(0, currentTime + seconds)));
  }

  return (
    <main className="karaoke-page">
      <div className="karaoke-shell">
        <header className="karaoke-topbar">
          <a className="karaoke-brand" href="/" aria-label="Omni Player — главная">
            <span className="karaoke-brand-mark">♫</span>
            <span>OMNI PLAYER</span>
          </a>
          <a className="karaoke-library-link" href="/player">Медиатека <span aria-hidden="true">↗</span></a>
        </header>

        <section className="karaoke-heading">
          <p className="karaoke-eyebrow">LYRICS · SYNCED TO YOUR PLAYER</p>
          <h1>Пой в своём <span>ритме.</span></h1>
          <p>Синхронизированный текст для трека из медиатеки Omni Player.</p>
        </section>

        <section className="karaoke-grid" aria-label="Караоке-плеер">
          <article className="karaoke-track-card">
            <div className="karaoke-artwork" aria-hidden="true">
              {track?.thumbnail
                ? <img src={track.thumbnail} alt="" />
                : <div className="karaoke-vinyl"><span>♫</span></div>}
              <span className="karaoke-artwork-caption">OMNI PLAYER</span>
            </div>
            <div className="karaoke-track-info">
              <p className="karaoke-eyebrow">СЕЙЧАС ИГРАЕТ</p>
              <h2>{track?.title || 'Трек не выбран'}</h2>
              <p>{track?.artist || 'Откройте медиатеку и запустите трек'}</p>
            </div>
            <div className="karaoke-track-status">
              <span className={`karaoke-status-dot${isPlaying ? ' is-playing' : ''}`} />
              {isPlaying ? 'ИГРАЕТ' : canControlPlayback ? 'ГОТОВ К ВОСПРОИЗВЕДЕНИЮ' : 'НЕТ АКТИВНОГО ТРЕКА'}
            </div>
            {!canControlPlayback && (
              <a className="karaoke-open-library" href="/player">Выбрать трек в медиатеке <span aria-hidden="true">→</span></a>
            )}
          </article>

          <article className="karaoke-lyrics-card" aria-label="Синхронизированный текст песни">
            <div className="karaoke-lyrics-heading">
              <div>
                <p className="karaoke-eyebrow">LRCLIB · LRC SEARCH</p>
                <h2>Текст песни</h2>
              </div>
              <span className={`karaoke-sync-badge${lyrics.length ? ' is-synced' : ''}`}>
                <span /> {lyrics.length ? 'SYNC ON' : 'SYNC OFF'}
              </span>
            </div>

            <form className="karaoke-search" onSubmit={handleSearch}>
              <label>
                <span>Исполнитель</span>
                <input
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                  placeholder="Имя исполнителя"
                />
              </label>
              <label>
                <span>Название трека</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Название песни"
                />
              </label>
              <button type="submit" disabled={isSearching || (!title.trim() && !artist.trim())}>
                {isSearching ? 'Ищем…' : 'Найти LRC'}
              </button>
            </form>

            {matches.length > 1 && (
              <label className="karaoke-match-picker">
                <span>Найденные синхронизированные версии</span>
                <select
                  value={matches.indexOf(selectedLyrics)}
                  onChange={(event) => setSelectedLyrics(matches[Number(event.target.value)])}
                >
                  {matches.map((match, index) => (
                    <option value={index} key={`${match.trackName}-${match.artistName}-${index}`}>
                      {match.trackName} — {match.artistName}{match.albumName ? ` · ${match.albumName}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="karaoke-lyrics-window" aria-live="polite">
              {searchError ? (
                <p className="karaoke-message karaoke-error">{searchError}</p>
              ) : isSearching ? (
                <p className="karaoke-message">Ищем синхронизированный текст в LRCLIB…</p>
              ) : lyrics.length ? (
                <div className="karaoke-lyrics-list">
                  {lyrics.map((line, index) => (
                    <button
                      className={`karaoke-lyric-line${index === activeIndex ? ' active' : ''}${index < activeIndex ? ' sung' : ''}`}
                      key={`${line.time}-${index}`}
                      ref={index === activeIndex ? activeLineRef : null}
                      onClick={() => seekTo(line.time)}
                      disabled={!canControlPlayback}
                      type="button"
                    >
                      {line.text}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="karaoke-message">
                  {track?.title
                    ? 'Нажмите «Найти LRC», чтобы повторить поиск.'
                    : 'Запустите трек в медиатеке или введите исполнителя и название выше.'}
                </p>
              )}
            </div>

            <div className="karaoke-lyrics-footnote">
              <span>ПОИСК СИНХРОНИЗИРОВАННЫХ ТЕКСТОВ · LRCLIB</span>
              <span>{lyrics.length ? `${lyrics.length} строк` : ''}</span>
            </div>
          </article>
        </section>

        <section className="karaoke-controls" aria-label="Управление воспроизведением">
          <div className="karaoke-control-buttons">
            <button type="button" className="karaoke-skip-button" onClick={() => skip(-5)} disabled={!canControlPlayback} aria-label="Назад на 5 секунд">
              ↶<small>5</small>
            </button>
            <button type="button" className="karaoke-play-button" onClick={togglePlayback} disabled={!canControlPlayback} aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}>
              {isPlaying ? <span className="karaoke-pause-icon" /> : <span className="karaoke-play-icon" />}
            </button>
            <button type="button" className="karaoke-skip-button" onClick={() => skip(5)} disabled={!canControlPlayback} aria-label="Вперёд на 5 секунд">
              ↷<small>5</small>
            </button>
          </div>
          <div className="karaoke-timeline">
            <div className="karaoke-time-labels">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <input
              aria-label="Позиция воспроизведения"
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => seekTo(Number(event.target.value))}
              disabled={!canControlPlayback}
              style={{ '--karaoke-progress': `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
          <div className="karaoke-control-track">
            <span className="karaoke-mini-disc">♫</span>
            <span><b>{track?.title || 'Трек не выбран'}</b><small>{track?.artist || 'Omni Player'}</small></span>
          </div>
        </section>

        {playbackError && <p className="karaoke-playback-error" role="alert">{playbackError}</p>}
        <footer className="karaoke-footer">
          <span>OMNI PLAYER · KARAOKE MODE</span>
          <span>LYRICS PROVIDED BY LRCLIB</span>
        </footer>
      </div>
    </main>
  );
}
