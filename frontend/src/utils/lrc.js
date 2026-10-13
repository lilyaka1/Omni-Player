const TIMESTAMP_PATTERN = /\[(\d+):([0-5]?\d)(?:[.,](\d{1,3}))?\]/g;

function parseTimestamp(minutes, seconds, fraction = '') {
  return Number(minutes) * 60
    + Number(seconds)
    + Number(fraction.padEnd(3, '0')) / 1000;
}

export function parseLrc(content) {
  const lines = [];
  const metadata = {};
  let offset = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timestamps = [...line.matchAll(TIMESTAMP_PATTERN)];
    if (timestamps.length) {
      const text = line.replace(TIMESTAMP_PATTERN, '').trim();
      for (const [, minutes, seconds, fraction = ''] of timestamps) {
        lines.push({
          time: Math.max(0, parseTimestamp(minutes, seconds, fraction) + offset),
          text,
        });
      }
      continue;
    }

    const tag = line.match(/^\[([a-z]+):(.*)\]$/i);
    if (tag) {
      const key = tag[1].toLowerCase();
      metadata[key] = tag[2].trim();
      if (key === 'offset' && Number.isFinite(Number(tag[2]))) {
        offset = Number(tag[2]) / 1000;
      }
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return { metadata, lines };
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function matchScore(result, track) {
  let score = 0;
  if (normalize(result.trackName) === normalize(track.title)) score += 2;
  if (normalize(result.artistName) === normalize(track.artist)) score += 1;
  return score;
}

export async function searchLrc(track, { signal } = {}) {
  const title = String(track.title || '').trim();
  const artist = String(track.artist || '').trim();
  const query = [artist, title].filter(Boolean).join(' ');
  if (!query) {
    throw new Error('Укажите название трека или исполнителя для поиска.');
  }

  const response = await fetch(
    `https://lrclib.net/api/search?${new URLSearchParams({ q: query })}`,
    { headers: { Accept: 'application/json' }, signal },
  );
  if (!response.ok) {
    throw new Error(`LRCLIB не выполнил поиск (HTTP ${response.status}).`);
  }

  const results = await response.json();
  if (!Array.isArray(results)) {
    throw new Error('LRCLIB вернул ответ в неизвестном формате.');
  }

  const matches = results
    .filter((result) => typeof result?.syncedLyrics === 'string')
    .map((result) => ({ ...result, ...parseLrc(result.syncedLyrics) }))
    .filter((result) => result.lines.length > 0)
    .sort((a, b) => matchScore(b, { title, artist }) - matchScore(a, { title, artist }));

  if (!matches.length) {
    throw new Error('Синхронизированный LRC для этого трека не найден.');
  }

  return matches;
}
