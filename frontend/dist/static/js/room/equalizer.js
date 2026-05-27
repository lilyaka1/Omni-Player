/**
 * equalizer.js — 10-полосный эквалайзер Web Audio API.
 *
 * Зависимости: globals.js
 *
 * Использование:
 *   EqualizerModule.initialize(audioElement);  // в обработчике пользовательского жеста!
 *   EqualizerModule.setBand(index, gainDb);
 *   EqualizerModule.setPreset(name);
 */

const EqualizerModule = (function () {

  const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  const PRESETS = {
    'flat':     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'bass':     [8, 7, 4, 1, 0, 0, 0, 0, 0, 0],
    'treble':   [0, 0, 0, 0, 0, 0, 2, 4, 6, 8],
    'vocal':    [-2, -2, 0, 2, 5, 5, 3, 1, 0, -1],
    'rock':     [4, 3, 2, -1, -1, 0, 1, 3, 4, 4],
    'electronic': [6, 5, 1, 0, -2, 2, 1, 2, 5, 6],
    'acoustic': [5, 4, 3, 1, 0, 0, 1, 2, 3, 4],
    'laptop':   [5, 5, 4, 1, -1, -1, 0, 2, 4, 5],
  };

  let context = null;
  let source  = null;
  let filters = [];
  let audioEl = null;
  let initialized = false;

  function initialize(el) {
    if (initialized || !el) return;
    audioEl = el;

    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      source  = context.createMediaElementSource(el);

      // Создать цепочку BiquadFilter для каждой полосы
      filters = BANDS.map(freq => {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4;
        filter.gain.value = 0;
        return filter;
      });

      // Соединить цепочку: source → f0 → f1 → … → destination
      let prev = source;
      filters.forEach(f => { prev.connect(f); prev = f; });
      prev.connect(context.destination);

      initialized = true;
      console.log('[EQ] Инициализирован');
    } catch (e) {
      console.warn('[EQ] Ошибка инициализации:', e);
    }
  }

  function setBand(idx, gainDb) {
    if (!initialized || !filters[idx]) return;
    filters[idx].gain.value = Math.max(-12, Math.min(12, gainDb));
  }

  function getBand(idx) {
    if (!filters[idx]) return 0;
    return filters[idx].gain.value;
  }

  function setPreset(name) {
    const gains = PRESETS[name];
    if (!gains) return;
    gains.forEach((g, i) => setBand(i, g));
  }

  function reset() {
    filters.forEach((f, i) => setBand(i, 0));
  }

  function getBands() { return BANDS; }
  function getPresets() { return Object.keys(PRESETS); }
  function isInitialized() { return initialized; }

  return { initialize, setBand, getBand, setPreset, reset, getBands, getPresets, isInitialized };

})();

window.EqualizerModule = EqualizerModule;
