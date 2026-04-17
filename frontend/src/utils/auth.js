export function getToken() {
  const legacyToken = localStorage.getItem('access_token');
  const token = localStorage.getItem('token') || legacyToken;

  if (!localStorage.getItem('token') && legacyToken) {
    localStorage.setItem('token', legacyToken);
    localStorage.removeItem('access_token');
  }

  return token;
}

export function clearToken() {
  localStorage.removeItem('token');
  localStorage.removeItem('access_token');
}

export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };

  if (!options.body || options.body instanceof FormData) {
    // keep headers as is
  } else if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    window.location.replace('/login');
    throw new Error('Unauthorized');
  }

  return response;
}
