/**
 * equalizer-ui.js — UI эквалайзера (ползунки + пресеты).
 *
 * Зависимости: globals.js, equalizer.js (EqualizerModule)
 * Рендерит в #eqPanel (который показывается/скрывается кнопкой EQ в топбаре).
 */

(function () {

  function render() {
    const panel = document.getElementById('eqPanel');
    if (!panel) return;

    const bands   = EqualizerModule.getBands();
    const presets = EqualizerModule.getPresets();

    panel.className += ' glass';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <span style="font-size:0.85rem;font-weight:700;color:var(--text-primary);">
          <i class="fa-solid fa-sliders" style="color:var(--accent);margin-right:6px;"></i>Эквалайзер
        </span>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="eqPresetSelect" style="
            background:var(--input-bg);
            border:1px solid var(--input-border);
            border-radius:var(--radius-sm);
            color:var(--text-primary);
            font-size:0.78rem;
            padding:4px 8px;
            outline:none;
          ">
            ${presets.map(p => `<option value="${p}">${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
          </select>
          <button id="eqResetBtn" style="
            background:var(--btn-bg);
            border:1px solid var(--btn-border);
            border-radius:var(--radius-sm);
            color:var(--text-muted);
            font-size:0.75rem;
            padding:5px 10px;
            cursor:pointer;
          ">Сброс</button>
        </div>
      </div>

      <div id="eqBands" style="display:flex;gap:10px;align-items:flex-end;justify-content:center;height:130px;">
        ${bands.map((freq, i) => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
            <span style="font-size:0.6rem;color:var(--text-muted);min-width:30px;text-align:center;">
              <span id="eqVal${i}">0</span>dB
            </span>
            <input
              type="range"
              id="eqSlider${i}"
              min="-12"
              max="12"
              step="0.5"
              value="0"
              orient="vertical"
              style="
                writing-mode: vertical-lr;
                direction: rtl;
                -webkit-appearance: slider-vertical;
                width: 24px;
                height: 90px;
                accent-color: var(--accent);
                cursor: pointer;
              "
            />
            <span style="font-size:0.6rem;color:var(--text-muted);text-align:center;">
              ${freq >= 1000 ? (freq / 1000) + 'k' : freq}
            </span>
          </div>
        `).join('')}
      </div>
    `;

    // Инициализировать EQ при первом взаимодействии (требование браузера)
    function ensureInit() {
      if (!EqualizerModule.isInitialized()) {
        const audio = document.getElementById('audioPlayer');
        if (audio) EqualizerModule.initialize(audio);
      }
    }

    // Ползунки
    bands.forEach((_, i) => {
      const slider = document.getElementById(`eqSlider${i}`);
      const valEl  = document.getElementById(`eqVal${i}`);
      slider?.addEventListener('input', () => {
        ensureInit();
        const v = parseFloat(slider.value);
        EqualizerModule.setBand(i, v);
        if (valEl) valEl.textContent = v > 0 ? `+${v}` : `${v}`;
      });
    });

    // Пресеты
    document.getElementById('eqPresetSelect')?.addEventListener('change', (e) => {
      ensureInit();
      EqualizerModule.setPreset(e.target.value);
      syncSliders();
    });

    // Сброс
    document.getElementById('eqResetBtn')?.addEventListener('click', () => {
      ensureInit();
      EqualizerModule.reset();
      document.getElementById('eqPresetSelect').value = 'flat';
      syncSliders();
    });
  }

  function syncSliders() {
    EqualizerModule.getBands().forEach((_, i) => {
      const v  = EqualizerModule.getBand(i);
      const sl = document.getElementById(`eqSlider${i}`);
      const vl = document.getElementById(`eqVal${i}`);
      if (sl) sl.value = v;
      if (vl) vl.textContent = v > 0 ? `+${v}` : `${v}`;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

})();
