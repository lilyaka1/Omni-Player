import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLrc, searchLrc } from './lrc.js';

test('parses metadata and timestamped lyric lines', () => {
  const result = parseLrc(
    '[ti:Apple Pie]\n[ar:Travis Scott]\n[00:15.61] First line\n[00:19.610] Second line',
  );

  assert.deepEqual(result.metadata, { ti: 'Apple Pie', ar: 'Travis Scott' });
  assert.deepEqual(result.lines, [
    { time: 15.61, text: 'First line' },
    { time: 19.61, text: 'Second line' },
  ]);
});

test('supports offsets, repeated timestamps, and out-of-order lines', () => {
  const result = parseLrc(
    '[offset:500]\n[00:02.00][00:01.50] Later and earlier\n[00:00.25] First',
  );

  assert.deepEqual(result.lines, [
    { time: 0.75, text: 'First' },
    { time: 2, text: 'Later and earlier' },
    { time: 2.5, text: 'Later and earlier' },
  ]);
});

test('searches LRCLIB and ranks exact title and artist matches first', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => [
        { trackName: 'Other Song', artistName: 'Artist', syncedLyrics: '[00:01] Other' },
        { trackName: 'Target Song', artistName: 'Artist', syncedLyrics: '[00:02] Target' },
        { trackName: 'Target Song', artistName: 'Artist', plainLyrics: 'Not synced' },
      ],
    };
  };

  try {
    const matches = await searchLrc({ title: 'Target Song', artist: 'Artist' });
    assert.match(requestedUrl, /^https:\/\/lrclib\.net\/api\/search\?/);
    assert.equal(matches[0].trackName, 'Target Song');
    assert.deepEqual(matches[0].lines, [{ time: 2, text: 'Target' }]);
    assert.equal(matches.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports when LRCLIB has no synchronized lyrics', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{ trackName: 'Target Song', plainLyrics: 'Plain text only' }],
  });

  try {
    await assert.rejects(
      searchLrc({ title: 'Target Song' }),
      /Синхронизированный LRC/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports LRCLIB HTTP failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  try {
    await assert.rejects(
      searchLrc({ title: 'Target Song' }),
      /LRCLIB не выполнил поиск \(HTTP 503\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requires a track title or artist', async () => {
  await assert.rejects(
    searchLrc({ title: ' ', artist: '' }),
    /Укажите название трека или исполнителя/,
  );
});
