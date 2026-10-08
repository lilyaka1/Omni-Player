import { useRef, useState } from 'react';

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [8, 7, 4, 1, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 0, 2, 4, 6, 8],
  vocal: [-2, -2, 0, 2, 5, 5, 3, 1, 0, -1],
  rock: [4, 3, 2, -1, -1, 0, 1, 3, 4, 4],
  electronic: [6, 5, 1, 0, -2, 2, 1, 2, 5, 6],
  acoustic: [5, 4, 3, 1, 0, 0, 1, 2, 3, 4],
  laptop: [5, 5, 4, 1, -1, -1, 0, 2, 4, 5],
};

function labelFrequency(frequency) {
  return frequency >= 1000 ? `${frequency / 1000}k` : frequency;
}

export default function Equalizer({ audioRef }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState('flat');
  const [gains, setGains] = useState(PRESETS.flat);
  const audioContextRef = useRef(null);
  const filtersRef = useRef([]);

  function ensureAudioGraph() {
    if (audioContextRef.current || !audioRef.current) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const context = new AudioContext();
    const source = context.createMediaElementSource(audioRef.current);
    const filters = BANDS.map((frequency) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.4;
      return filter;
    });

    let previous = source;
    filters.forEach((filter) => {
      previous.connect(filter);
      previous = filter;
    });
    previous.connect(context.destination);
    audioContextRef.current = context;
    filtersRef.current = filters;
  }

  function setBand(index, value) {
    ensureAudioGraph();
    const numericValue = Math.max(-12, Math.min(12, Number(value)));
    const filter = filtersRef.current[index];
    if (filter) filter.gain.value = numericValue;
    setGains((previous) => previous.map((gain, i) => (i === index ? numericValue : gain)));
    setPreset('custom');
  }

  function applyPreset(name) {
    ensureAudioGraph();
    const next = PRESETS[name];
    if (!next) return;
    filtersRef.current.forEach((filter, index) => { filter.gain.value = next[index]; });
    setPreset(name);
    setGains(next);
  }

  return (
    <>
      <button className="eq-toggle-btn glass-tertiary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <i className="fa-solid fa-sliders" /> EQ
      </button>
      {open && (
        <div id="eqPanel" className="glass glass-secondary">
          <div className="eq-panel-header">
            <span><i className="fa-solid fa-sliders" /> Эквалайзер</span>
            <div className="eq-panel-actions">
              <select className="input eq-preset" value={preset} onChange={(event) => applyPreset(event.target.value)}>
                {Object.keys(PRESETS).map((name) => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}
              </select>
              <button className="btn" onClick={() => applyPreset('flat')}>Сброс</button>
            </div>
          </div>
          <div className="eq-bands">
            {BANDS.map((frequency, index) => (
              <label className="eq-band" key={frequency}>
                <span className="eq-value">{gains[index] > 0 ? '+' : ''}{gains[index]}dB</span>
                <input className="eq-slider" type="range" min="-12" max="12" step="0.5" value={gains[index]} onChange={(event) => setBand(index, event.target.value)} />
                <span className="eq-frequency">{labelFrequency(frequency)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
