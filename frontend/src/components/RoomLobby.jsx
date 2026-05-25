import { useEffect, useState } from 'react';

/**
 * Pre-join screen for a room.
 *
 * - Делает один лёгкий запрос /rooms/{id}/lobby (без подключения к WS / стримам)
 * - Если комната не существует / неактивна / переполнена — пользователя внутрь не пускает,
 *   показывает понятное сообщение и кнопку «Назад».
 * - Если ОК — рисует «карточку» с обложкой и кнопкой «Войти в комнату».
 *
 * Сетевой запрос делается только один раз. Никаких retry-loop'ов.
 */
export default function RoomLobby({ roomId, onJoin, onBack }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: null });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!roomId) {
      setState({ phase: 'error', error: 'Не указана комната', data: null });
      return undefined;
    }

    (async () => {
      try {
        const res = await fetch(`/rooms/${roomId}/lobby`);
        if (!res.ok) {
          // 4xx/5xx — показываем причину и НЕ ретраим
          let message = `Ошибка ${res.status}`;
          try {
            const body = await res.json();
            if (body?.detail) message = body.detail;
          } catch {}
          if (!cancelled) setState({ phase: 'error', error: message, data: null });
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (!data?.exists) {
          setState({ phase: 'blocked', data, error: data.message || 'Комната не найдена' });
          return;
        }
        if (!data.can_join) {
          setState({ phase: 'blocked', data, error: data.message || 'Комната недоступна' });
          return;
        }
        setState({ phase: 'ready', data, error: null });
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', error: 'Сервер недоступен', data: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const data = state.data || {};
  const cover = data.cover_url;
  const isLoading = state.phase === 'loading';
  const isReady = state.phase === 'ready';
  const blocked = state.phase === 'blocked' || state.phase === 'error';

  const handleJoinWithPassword = async () => {
    if (!password.trim()) {
      setPasswordError('Введите пароль');
      return;
    }

    setIsJoining(true);
    setPasswordError('');

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/rooms/${roomId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ password: password.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setPasswordError(err.detail || 'Неверный пароль');
        } else {
          setPasswordError(err.detail || 'Ошибка подключения');
        }
        setIsJoining(false);
        return;
      }

      // Успешно присоединились, вызываем onJoin
      if (onJoin) {
        onJoin();
      }
    } catch (error) {
      setPasswordError('Ошибка сети');
      setIsJoining(false);
    }
  };

  return (
    <div
      className="room-lobby"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="glass glass-primary"
        style={{
          width: '100%',
          maxWidth: 520,
          padding: 28,
          borderRadius: 24,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            aspectRatio: '16/9',
            borderRadius: 18,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          {cover ? (
            <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <i className="fa-solid fa-music" style={{ fontSize: '3rem', opacity: 0.45 }} />
          )}
        </div>

        {isLoading && (
          <>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            <div className="text-secondary">Подключаемся к комнате…</div>
          </>
        )}

        {isReady && (
          <>
            <h2 style={{ fontSize: '1.4rem', margin: '4px 0 6px' }}>{data.name}</h2>
            {data.description && (
              <p className="text-secondary" style={{ margin: '0 0 12px' }}>{data.description}</p>
            )}

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
                flexWrap: 'wrap',
                margin: '6px 0 18px',
              }}
            >
              {data.genre && (
                <span className="badge glass-tertiary">
                  <i className="fa-solid fa-tag" /> {data.genre}
                </span>
              )}
              <span className="badge glass-tertiary">
                <i className="fa-solid fa-user-group" /> {data.user_count || 0}/{data.max_users || 50}
              </span>
              <span className="badge glass-tertiary">
                <i className="fa-solid fa-list-music" /> {data.track_count || 0} треков
              </span>
              {data.is_playing && (
                <span className="badge glass-tertiary">
                  <i className="fa-solid fa-circle-play" /> в эфире
                </span>
              )}
            </div>

            {/* Поле пароля для приватных комнат */}
            {data.requires_password && (
              <div style={{ marginBottom: 16 }}>
                <div
                  className="glass-tertiary"
                  style={{
                    padding: '12px 16px',
                    borderRadius: 12,
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'rgba(255, 193, 7, 0.1)',
                    border: '1px solid rgba(255, 193, 7, 0.3)',
                  }}
                >
                  <i className="fa-solid fa-lock" style={{ color: '#ffc107' }} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Эта комната защищена паролем
                  </span>
                </div>
                <input
                  type="password"
                  className="input"
                  placeholder="Введите пароль..."
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password.trim()) {
                      handleJoinWithPassword();
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '0.95rem',
                  }}
                />
                {passwordError && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      fontSize: '0.85rem',
                      color: '#ef4444',
                    }}
                  >
                    <i className="fa-solid fa-circle-exclamation" /> {passwordError}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn" onClick={onBack} disabled={isJoining}>
                <i className="fa-solid fa-arrow-left" /> Назад
              </button>
              <button
                className="btn btn-accent"
                onClick={data.requires_password ? handleJoinWithPassword : onJoin}
                disabled={isJoining || (data.requires_password && !password.trim())}
                style={{ opacity: isJoining || (data.requires_password && !password.trim()) ? 0.6 : 1 }}
              >
                {isJoining ? (
                  <>
                    <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    Подключение...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-door-open" /> Войти в комнату
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {blocked && (
          <>
            <div
              style={{
                fontSize: '2rem',
                marginBottom: 8,
                color: 'var(--accent, #ff5050)',
              }}
            >
              <i className="fa-solid fa-circle-exclamation" />
            </div>
            <h2 style={{ fontSize: '1.2rem', margin: '4px 0 8px' }}>
              {state.data?.name || 'Комната недоступна'}
            </h2>
            <p className="text-secondary" style={{ margin: '0 0 18px' }}>
              {state.error || 'Не получится подключиться к этой комнате прямо сейчас.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn" onClick={onBack}>
                <i className="fa-solid fa-arrow-left" /> К списку комнат
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
