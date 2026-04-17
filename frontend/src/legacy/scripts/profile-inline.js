    const legacyToken = localStorage.getItem('access_token');
    const storedToken = localStorage.getItem('token');
    const token = storedToken || legacyToken;
    if (!storedToken && legacyToken) {
      localStorage.setItem('token', legacyToken);
      localStorage.removeItem('access_token');
    }
    if (!token) window.location.replace('/login');

    async function loadProfile() {
      try {
        const res = await fetch('/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) { window.location.replace('/login'); return; }
        const u = await res.json();

        document.getElementById('profileAvatar').textContent = u.username[0].toUpperCase();
        document.getElementById('profileName').textContent = u.username;
        document.getElementById('profileEmail').textContent = u.email || '';
        document.getElementById('profileId').textContent = u.id;
        document.getElementById('profileUsername').textContent = u.username;
        document.getElementById('profileRole').textContent = u.is_admin ? 'Администратор' : 'Пользователь';
        document.getElementById('profileCanCreate').textContent = (u.can_create_rooms || u.is_admin) ? 'Да' : 'Нет';
        document.title = `${u.username} — Omni Player`;

        const badges = document.getElementById('profileBadges');
        if (u.is_admin) badges.innerHTML += `<span class="badge glass-tertiary"><i class="fa-solid fa-shield-halved"></i> Admin</span>`;
        if (u.can_create_rooms) badges.innerHTML += `<span class="badge glass-tertiary"><i class="fa-solid fa-door-open"></i> Creator</span>`;
      } catch {}
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
      if (confirm('Выйти из аккаунта?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('access_token');
        window.location.replace('/login');
      }
    });

    loadProfile();
