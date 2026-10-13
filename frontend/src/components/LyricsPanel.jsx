import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchLrc } from '../utils/lrc';

export default function LyricsPanel({ track, currentTime, onSeek }) {
  const [title, setTitle] = useState(track?.title || '');
  const [artist, setArtist] = useState(track?.artist || '');
  const [matches, setMatches] = useState([]);
  const [selectedLyrics, setSelectedLyrics] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
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
    setTitle(track?.title || '');
    setArtist(track?.artist || '');
    if (track?.title || track?.artist) {
      lookupLyrics({ title: track.title, artist: track.artist, duration: track.duration });
    } else {
      searchControllerRef.current?.abort();
      setMatches([]);
      setSelectedLyrics(null);
      setSearchError('');
      setIsSearching(false);
    }

    return () => searchControllerRef.current?.abort();
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

  function handleSearch(event) {
    event.preventDefault();
    lookupLyrics({ title, artist, duration: track?.duration });
  }

  return (
    <section className="library-lyrics glass glass-secondary" aria-label="Текст песни">
      <div className="library-lyrics-heading">
        <div>
          <div className="section-panel-title"><i className="fa-solid fa-microphone-lines" /> Текст песни</div>
          <p className="library-lyrics-source">Синхронизированный текст · LRCLIB</p>
        </div>
        <span className={`library-lyrics-status${lyrics.length ? ' active' : ''}`}>
          <span /> {lyrics.length ? 'SYNC ON' : 'SYNC OFF'}
        </span>
      </div>

      <form className="library-lyrics-search" onSubmit={handleSearch}>
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
        <button className="btn btn-accent" type="submit" disabled={isSearching || (!title.trim() && !artist.trim())}>
          <i className={`fa-solid ${isSearching ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`} />
          {isSearching ? 'Ищем…' : 'Найти LRC'}
        </button>
      </form>

      {matches.length > 1 && (
        <label className="library-lyrics-picker">
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

      <div className="library-lyrics-window" aria-live="polite">
        {searchError ? (
          <p className="library-lyrics-message error">{searchError}</p>
        ) : isSearching ? (
          <p className="library-lyrics-message">Ищем синхронизированный текст в LRCLIB…</p>
        ) : lyrics.length ? (
          <div className="library-lyrics-list">
            {lyrics.map((line, index) => (
              <button
                className={`library-lyric-line${index === activeIndex ? ' active' : ''}${index < activeIndex ? ' sung' : ''}`}
                key={`${line.time}-${index}`}
                ref={index === activeIndex ? activeLineRef : null}
                onClick={() => onSeek(line.time)}
                disabled={!track?.playUrl || (track.status && track.status !== 'ready')}
                type="button"
              >
                {line.text}
              </button>
            ))}
          </div>
        ) : (
          <p className="library-lyrics-message">
            {searchError || (track?.title || track?.artist
              ? 'Попробуйте изменить запрос или выбрать другую версию.'
              : 'Запустите трек из медиатеки, чтобы найти синхронизированный текст.')}
          </p>
        )}
      </div>

      <div className="library-lyrics-footnote">
        <span>НАЖМИТЕ НА СТРОКУ, ЧТОБЫ ПЕРЕЙТИ К НЕЙ В ТРЕКЕ</span>
        <span>{lyrics.length ? `${lyrics.length} строк` : ''}</span>
      </div>
    </section>
  );
}
