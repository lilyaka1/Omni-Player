const PROXYABLE_HOSTS = [
  'sndcdn.com',
  'soundcloud.com',
  'ytimg.com',
  'youtube.com',
  'googleusercontent.com',
];

export function getImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    const hostname = parsed.hostname.toLowerCase();
    const allowed = PROXYABLE_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );

    if (parsed.protocol === 'https:' && allowed) {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }

  return url;
}