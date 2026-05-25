/**
 * AudioManager - Singleton для управления воспроизведением
 * Обеспечивает стабильный audio element без remount
 */
class AudioManager {
  constructor() {
    if (AudioManager.instance) {
      return AudioManager.instance;
    }

    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.listeners = new Map();
    this.currentTrack = null;
    this.isPlaying = false;
    this.volume = 0.85;
    this.playbackRate = 1.0;

    // Восстановить громкость из localStorage
    const savedVolume = localStorage.getItem('omni_volume');
    if (savedVolume) {
      this.volume = parseFloat(savedVolume);
    }
    this.audio.volume = this.volume;

    this._setupEventListeners();
    this._setupMediaSession();

    AudioManager.instance = this;
  }

  _setupEventListeners() {
    this.audio.addEventListener('loadedmetadata', () => {
      this._emit('loadedmetadata', {
        duration: this.audio.duration,
      });
    });

    this.audio.addEventListener('timeupdate', () => {
      this._emit('timeupdate', {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
      });
    });

    this.audio.addEventListener('ended', () => {
      this._emit('ended');
    });

    this.audio.addEventListener('error', (e) => {
      this._emit('error', { error: e });
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._emit('play');
      this._updateMediaSession();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this._emit('pause');
      this._updateMediaSession();
    });

    this.audio.addEventListener('waiting', () => {
      this._emit('waiting');
    });

    this.audio.addEventListener('canplay', () => {
      this._emit('canplay');
    });
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      this.play();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      this.pause();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this._emit('previoustrack');
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      this._emit('nexttrack');
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime) {
        this.seek(details.seekTime);
      }
    });
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.currentTrack.title || 'Unknown Track',
      artist: this.currentTrack.artist || 'Unknown Artist',
      album: this.currentTrack.album || '',
      artwork: this.currentTrack.thumbnail
        ? [{ src: this.currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });

    navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
  }

  loadTrack(track) {
    if (!track || !track.playUrl) {
      this.audio.removeAttribute('src');
      this.audio.load();
      this.currentTrack = null;
      this._emit('trackchange', { track: null });
      return;
    }

    this.currentTrack = track;
    this.audio.src = track.playUrl;
    this.audio.load();
    this._emit('trackchange', { track });
    this._updateMediaSession();
  }

  async play() {
    try {
      await this.audio.play();
      return true;
    } catch (error) {
      console.error('Play failed:', error);
      this._emit('error', { error });
      return false;
    }
  }

  pause() {
    this.audio.pause();
  }

  async togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  seek(time) {
    if (!isFinite(time)) return;
    const maxTime = this.audio.duration || 0;
    this.audio.currentTime = Math.max(0, Math.min(time, maxTime));
  }

  setVolume(value) {
    const vol = Math.max(0, Math.min(1, value));
    this.volume = vol;
    this.audio.volume = vol;
    localStorage.setItem('omni_volume', vol.toString());
    this._emit('volumechange', { volume: vol });
  }

  setPlaybackRate(rate) {
    const validRate = Math.max(0.25, Math.min(2, rate));
    this.playbackRate = validRate;
    this.audio.playbackRate = validRate;
    this._emit('ratechange', { rate: validRate });
  }

  getCurrentTime() {
    return this.audio.currentTime || 0;
  }

  getDuration() {
    return this.audio.duration || 0;
  }

  getVolume() {
    return this.volume;
  }

  getPlaybackRate() {
    return this.playbackRate;
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
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.listeners.clear();
    AudioManager.instance = null;
  }
}

export default new AudioManager();
