import { useState, useCallback } from 'react';
import { authFetch } from '../utils/auth';
import { showToast } from '../utils/toast';

/**
 * Хук для управления поиском треков на YouTube и SoundCloud
 * Обрабатывает поисковые запросы и результаты
 */
export default function useSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState('youtube'); // 'youtube' или 'soundcloud'
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  /**
   * Выполнение поиска треков
   */
  const doSearch = useCallback(async () => {
    const query = searchQuery.trim();
    
    if (!query) {
      showToast('Введите поисковый запрос', 'error');
      return;
    }

    setSearchLoading(true);
    setSearchResults([]);

    try {
      const response = await authFetch(
        `/api/player/search?q=${encodeURIComponent(query)}&source=${searchSource}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Search failed');
      }

      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        showToast('Ничего не найдено', 'info');
        setSearchResults([]);
      } else {
        setSearchResults(data.results);
      }
    } catch (error) {
      console.error('Error searching tracks:', error);
      showToast(`Ошибка поиска: ${error.message}`, 'error');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, searchSource]);

  return {
    searchQuery,
    setSearchQuery,
    searchSource,
    setSearchSource,
    searchResults,
    searchLoading,
    doSearch,
  };
}
