    // ---- CoverFlow + EQ wiring ----
    document.addEventListener('DOMContentLoaded', () => {
      const cfStage = document.getElementById('coverflowStage');

      /* --- Data helper --- */
      function getCFData() {
        const items = (typeof GLOBAL !== 'undefined' && Array.isArray(GLOBAL.queue)) ? GLOBAL.queue : [];
        let current = 0;
        if (GLOBAL.currentTrack && items.length) {
          const idx = items.findIndex(t => t.id === GLOBAL.currentTrack.id);
          if (idx >= 0) current = idx;
        }
        return { items, current };
      }

      /* --- Render covers --- */
      function renderCF() {
        if (!cfStage) return;
        const { items, current } = getCFData();

        if (!items.length) {
          cfStage.innerHTML = `<div class="cf-cover" data-pos="0" style="cursor:default;">
            <div class="cf-cover-img"><i class="fa-solid fa-music"></i></div>
          </div>`;
          const t = document.getElementById('cfTitle');
          const a = document.getElementById('cfArtist');
          if (t) t.textContent = 'Нет треков в очереди';
          if (a) a.textContent = 'Добавьте треки →';
          return;
        }

        cfStage.innerHTML = [-2, -1, 0, 1, 2].map(pos => {
          const idx = current + pos;
          if (idx < 0 || idx >= items.length) {
            return `<div class="cf-cover cf-cover-empty" data-pos="${pos}"></div>`;
          }
          const item  = items[idx];
          const thumb = item.thumb_url || item.thumbnail || null;
          const img   = thumb
            ? `<img src="${thumb}" alt="" />`
            : `<i class="fa-solid fa-music"></i>`;
          const safe = (item.title || '').replace(/"/g, '&quot;');
          return `<div class="cf-cover" data-pos="${pos}"
              onclick="window.__cfClick(${pos})"
              title="${safe}">
              <div class="cf-cover-img">${img}</div>
            </div>`;
        }).join('');

        const cur = items[current];
        if (cur) {
          const t = document.getElementById('cfTitle');
          const a = document.getElementById('cfArtist');
          if (t) t.textContent = cur.title || '—';
          if (a) a.textContent = cur.artist || cur.uploader || '—';
        }


      }

      /* Clicking a non-center cover navigates (skip N tracks) */
      window.__cfClick = function(pos) {
        if (pos === 0 || typeof PlayerModule === 'undefined') return;
        const fn    = pos < 0 ? () => PlayerModule.prevTrack() : () => PlayerModule.nextTrack();
        const steps = Math.abs(pos);
        for (let i = 0; i < steps; i++) fn();
      };



      /* Re-render on queue or track change */
      document.addEventListener('queuechange', renderCF);
      document.addEventListener('trackchange', renderCF);
      renderCF();

      /* EQ panel toggle */
      document.getElementById('eqToggleBtn')?.addEventListener('click', () => {
        const p = document.getElementById('eqPanel');
        if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
      });
    });
