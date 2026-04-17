    const params = new URLSearchParams(location.search);
    const roomId = params.get('room_id');
    if (roomId) document.getElementById('liveRoomId').textContent = roomId;

    const legacyToken = localStorage.getItem('access_token');
    const storedToken = localStorage.getItem('token');
    const token = storedToken || legacyToken;
    if (!storedToken && legacyToken) {
      localStorage.setItem('token', legacyToken);
      localStorage.removeItem('access_token');
    }

    async function checkStatus() {
      if (!roomId) return;
      try {
        const res = await fetch(`/stream/room/${roomId}/status`);
        if (res.ok) {
          const data = await res.json();
          const active = !!(data.live || data.active || data.is_active);
          document.getElementById('liveStatus').textContent = active ? 'Статус: активно' : 'Статус: не активно';
          document.getElementById('startBtn').style.display = active ? 'none' : 'inline-flex';
          document.getElementById('stopBtn').style.display  = active ? 'inline-flex' : 'none';
        }
      } catch {}
    }

    document.getElementById('startBtn')?.addEventListener('click', async () => {
      if (!token) { window.location.replace('/login'); return; }
      try {
        const res = await fetch(`/stream/room/${roomId}/start`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          checkStatus();
        } else if (res.status === 404 || res.status === 405) {
          document.getElementById('liveStatus').textContent = 'Статус: управление запуском из комнаты';
        }
      } catch {}
    });

    document.getElementById('stopBtn')?.addEventListener('click', async () => {
      if (!token) return;
      try {
        const res = await fetch(`/stream/room/${roomId}/stop`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          checkStatus();
        } else if (res.status === 404 || res.status === 405) {
          document.getElementById('liveStatus').textContent = 'Статус: остановка из комнаты';
        }
      } catch {}
    });

    checkStatus();
