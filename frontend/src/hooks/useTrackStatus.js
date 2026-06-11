import { useState, useEffect, useRef } from 'react';
import { authFetch } from '../utils/auth';

// Polling hook for a track's processing status
export default function useTrackStatus(trackId, { interval = 3000 } = {}) {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer = null;

    async function fetchStatus() {
      if (!trackId) return;
      // Skip polling for optimistic tracks (temp IDs)
      if (typeof trackId === 'string' && (trackId.startsWith('temp_') || trackId.startsWith('temp_'))) return;
      try {
        const resp = await authFetch(`/api/player/tracks/${trackId}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!mountedRef.current) return;
        setStatus(data.processing_status);
        setProgress(data.processing_progress);

        // stop polling if ready or failed
        if (data.processing_status === 'ready' || data.processing_status === 'failed') {
          clearInterval(timer);
          timer = null;
        }
      } catch (err) {
        // ignore network errors, keep polling
      }
    }

    fetchStatus();
    timer = setInterval(fetchStatus, interval);

    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [trackId, interval]);

  return { status, progress };
}
