/**
 * QueueStore - Управление очередью треков с track status
 * Immutable updates, persist в localStorage
 */
class QueueStore {
  constructor() {
    if (QueueStore.instance) {
      return QueueStore.instance;
    }

    this.queue = [];
    this.currentIndex = 0;
    this.shuffle = false;
    this.repeatMode = 'off'; // 'off' | 'one' | 'all'
    this.listeners = new Map();
    this.shuffleHistory = [];

    // Восстановить состояние из localStorage
    this._restoreState();

    QueueStore.instance = this;
  }

  _restoreState() {
    try {
      const saved = localStorage.getItem('omni_queue_state');
      if (saved) {
        const state = JSON.parse(saved);
        this.shuffle = state.shuffle || false;
        this.repeatMode = state.repeatMode || 'off';
        this.currentIndex = state.currentIndex || 0;
      }
    } catch (error) {
      console.warn('Failed to restore queue state:', error);
    }
  }

  _persistState() {
    try {
      const state = {
        shuffle: this.shuffle,
        repeatMode: this.repeatMode,
        currentIndex: this.currentIndex,
      };
      localStorage.setItem('omni_queue_state', JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to persist queue state:', error);
    }
  }

  setQueue(tracks) {
    this.queue = tracks.map((track, index) => ({
      ...track,
      queueIndex: index,
      status: track.status ?? track.processing_status ?? (track.playUrl ? 'ready' : 'pending'),
    }));
    
    // Сбросить индекс если он вышел за границы
    if (this.currentIndex >= this.queue.length) {
      this.currentIndex = 0;
    }
    
    this._emit('queuechange', { queue: this.queue });
    this._persistState();
  }

  addTrack(track) {
    const newTrack = {
      ...track,
      queueIndex: this.queue.length,
      status: track.status ?? track.processing_status ?? (track.playUrl ? 'ready' : 'pending'),
    };
    this.queue = [...this.queue, newTrack];
    this._emit('queuechange', { queue: this.queue });
    this._emit('trackadded', { track: newTrack });
  }

  addTracks(tracks) {
    const newTracks = tracks.map((track, index) => ({
      ...track,
      queueIndex: this.queue.length + index,
      status: track.status ?? track.processing_status ?? (track.playUrl ? 'ready' : 'pending'),
    }));
    this.queue = [...this.queue, ...newTracks];
    this._emit('queuechange', { queue: this.queue });
  }

  removeTrack(trackId) {
    const index = this.queue.findIndex((t) => t.id === trackId);
    if (index === -1) return;

    // Если удаляем текущий трек
    if (index === this.currentIndex) {
      this._emit('currentremoved');
    }

    // Если удаляем трек до текущего, сдвигаем индекс
    if (index < this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    }

    this.queue = this.queue.filter((t) => t.id !== trackId);
    
    // Пересчитать queueIndex
    this.queue = this.queue.map((track, idx) => ({
      ...track,
      queueIndex: idx,
    }));

    // Проверить границы
    if (this.currentIndex >= this.queue.length) {
      this.currentIndex = Math.max(0, this.queue.length - 1);
    }

    this._emit('queuechange', { queue: this.queue });
    this._persistState();
  }

  clearQueue() {
    this.queue = [];
    this.currentIndex = 0;
    this.shuffleHistory = [];
    this._emit('queuechange', { queue: this.queue });
    this._emit('queuecleared');
    this._persistState();
  }

  updateTrackStatus(trackId, status) {
    const index = this.queue.findIndex((t) => t.id === trackId);
    if (index === -1) return;

    this.queue = this.queue.map((track) =>
      track.id === trackId ? { ...track, status } : track
    );

    this._emit('queuechange', { queue: this.queue });
    this._emit('trackstatuschange', { trackId, status });
  }

  updateTrack(trackId, updates) {
    const index = this.queue.findIndex((t) => t.id === trackId);
    if (index === -1) return;

    this.queue = this.queue.map((track) =>
      track.id === trackId ? { ...track, ...updates } : track
    );

    this._emit('queuechange', { queue: this.queue });
  }

  moveTrack(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex >= this.queue.length) return;

    const newQueue = [...this.queue];
    const [movedTrack] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, movedTrack);

    // Обновить currentIndex если нужно
    if (fromIndex === this.currentIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }

    // Пересчитать queueIndex
    this.queue = newQueue.map((track, idx) => ({
      ...track,
      queueIndex: idx,
    }));

    this._emit('queuechange', { queue: this.queue });
    this._persistState();
  }

  getCurrentTrack() {
    return this.queue[this.currentIndex] || null;
  }

  getQueue() {
    return this.queue;
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  setCurrentIndex(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this._emit('indexchange', { index });
    this._persistState();
  }

  getPlayableTracks() {
    return this.queue.filter((track) => track.status === 'ready' && track.playUrl);
  }

  findNextPlayableIndex(direction = 1) {
    if (!this.queue.length) return -1;

    const playable = this.getPlayableTracks();
    if (!playable.length) return -1;

    if (this.shuffle && playable.length > 1) {
      // Shuffle mode - выбрать случайный трек кроме текущего
      const currentTrack = this.getCurrentTrack();
      const pool = playable.filter((t) => t.id !== currentTrack?.id);
      if (!pool.length) return this.currentIndex;
      
      const picked = pool[Math.floor(Math.random() * pool.length)];
      return this.queue.findIndex((t) => t.id === picked.id);
    }

    // Обычный режим - следующий/предыдущий playable
    const start = this.currentIndex;
    for (let step = 1; step <= this.queue.length; step++) {
      const nextIndex = (start + direction * step + this.queue.length) % this.queue.length;
      const track = this.queue[nextIndex];
      if (track && track.status === 'ready' && track.playUrl) {
        return nextIndex;
      }
    }

    return -1;
  }

  next() {
    const nextIndex = this.findNextPlayableIndex(1);
    if (nextIndex >= 0) {
      this.setCurrentIndex(nextIndex);
      return this.queue[nextIndex];
    }
    return null;
  }

  previous() {
    const prevIndex = this.findNextPlayableIndex(-1);
    if (prevIndex >= 0) {
      this.setCurrentIndex(prevIndex);
      return this.queue[prevIndex];
    }
    return null;
  }

  setShuffle(enabled) {
    this.shuffle = enabled;
    if (enabled) {
      this.shuffleHistory = [this.currentIndex];
    } else {
      this.shuffleHistory = [];
    }
    this._emit('shufflechange', { shuffle: enabled });
    this._persistState();
  }

  setRepeatMode(mode) {
    if (!['off', 'one', 'all'].includes(mode)) return;
    this.repeatMode = mode;
    this._emit('repeatchange', { repeatMode: mode });
    this._persistState();
  }

  getRepeatMode() {
    return this.repeatMode;
  }

  isShuffle() {
    return this.shuffle;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  _emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    });
  }

  destroy() {
    this.queue = [];
    this.listeners.clear();
    QueueStore.instance = null;
  }
}

export default new QueueStore();
