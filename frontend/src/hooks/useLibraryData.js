import { useState, useCallback } from 'react';
import { authFetch } from '../utils/auth';
import { showToast } from '../utils/toast';
import QueueStore from '../utils/QueueStore';

/**
 * Хук для управления библиотекой треков
 * Обрабатывает загрузку, добавление, удаление и обновление треков
 */
export default function useLibraryData() {
  const [libraryTracks, setLibraryTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [redownloadingId, setRedownloadingId] = useState(null);
  const [downloadsDir, setDownloadsDir] = useState('');
  const [downloadsPath, setDownloadsPath] = useState('');

  /**
   * Загрузка библиотеки треков с сервера
   */
  const loadLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/player/library');
      if (!response.ok) {
        throw new Error('Failed to load library');
      }
      const data = await response.json();
      setLibraryTracks(data.tracks || []);
    } catch (error) {
      console.error('Error loading library:', error);
      showToast('Ошибка загрузки библиотеки', 'error');
      setLibraryTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Загрузка файлов в библиотеку
   * @param {FileList} files - Список файлов для загрузки
   */
  const uploadFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    // Валидация файлов
    const validFiles = [];
    const allowedExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
    const maxFileSize = 100 * 1024 * 1024; // 100MB

    for (const file of files) {
      const extension = '.' + file.name.split('.').pop().toLowerCase();
      
      if (!allowedExtensions.includes(extension)) {
        showToast(`Файл ${file.name} имеет неподдерживаемый формат`, 'error');
        continue;
      }
      
      if (file.size > maxFileSize) {
        showToast(`Файл ${file.name} слишком большой (макс. 100MB)`, 'error');
        continue;
      }
      
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      return;
    }

    // OPTIMISTIC UI: Создаем временные треки со status='uploading'
    const optimisticTracks = validFiles.map((file, index) => {
      const tempId = `temp_upload_${Date.now()}_${index}`;
      return {
        id: tempId,
        title: file.name.replace(/\.[^/.]+$/, ''), // Убираем расширение
        artist: 'Загрузка...',
        status: 'uploading',
        duration: 0,
        cover_url: null,
        playUrl: null,
        _isOptimistic: true,
        _fileName: file.name,
      };
    });

    // Добавляем временные треки в UI
    setLibraryTracks(prev => [...optimisticTracks, ...prev]);
    
    // Добавляем в QueueStore
    optimisticTracks.forEach(track => {
      QueueStore.addTrack(track);
    });

    const formData = new FormData();
    validFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await authFetch('/api/player/library/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Upload failed');
      }

      const data = await response.json();
      
      // Удаляем временные треки
      setLibraryTracks(prev => prev.filter(t => !t._isOptimistic));
      optimisticTracks.forEach(track => {
        QueueStore.removeTrack(track.id);
      });
      
      showToast(
        `Успешно загружено ${data.uploaded || validFiles.length} файл(ов)`,
        'success'
      );
      
      // Перезагружаем библиотеку для получения реальных треков
      await loadLibrary();
      
      // Обновляем статус реальных треков в QueueStore
      if (data.tracks && Array.isArray(data.tracks)) {
        data.tracks.forEach(track => {
          QueueStore.updateTrackStatus(track.id, 'ready');
        });
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      
      // Удаляем временные треки при ошибке
      setLibraryTracks(prev => prev.filter(t => !t._isOptimistic));
      optimisticTracks.forEach(track => {
        QueueStore.removeTrack(track.id);
      });
      
      showToast(`Ошибка загрузки: ${error.message}`, 'error');
    }
  }, [loadLibrary]);

  const loadDownloadSettings = useCallback(async () => {
    try {
      const response = await authFetch('/api/player/settings');
      if (!response.ok) {
        throw new Error('Failed to load player settings');
      }
      const data = await response.json();
      setDownloadsDir(data.downloads_dir || '');
      setDownloadsPath(data.downloads_path || '');
      return data;
    } catch (error) {
      console.error('Error loading download settings:', error);
      showToast('Не удалось загрузить настройки папки', 'error');
      throw error;
    }
  }, []);

  const saveDownloadSettings = useCallback(async (folder) => {
    try {
      const response = await authFetch('/api/player/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ downloads_dir: folder }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save player settings');
      }
      const data = await response.json();
      setDownloadsDir(data.downloads_dir || '');
      setDownloadsPath(data.downloads_path || '');
      showToast('Папка загрузки сохранена', 'success');
      return data;
    } catch (error) {
      console.error('Error saving download settings:', error);
      showToast(`Ошибка сохранения папки: ${error.message}`, 'error');
      throw error;
    }
  }, []);

  /**
   * Добавление трека по URL (YouTube/SoundCloud)
   * @param {string} url - URL трека
   */
  const addByUrl = useCallback(async (url) => {
    if (!url || !url.trim()) {
      showToast('Введите URL трека', 'error');
      return;
    }

    // OPTIMISTIC UI: Создаем временный трек со status='pending'
    const tempId = `temp_url_${Date.now()}`;
    const optimisticTrack = {
      id: tempId,
      title: 'Загрузка трека...',
      artist: 'Получение информации...',
      status: 'pending',
      duration: 0,
      cover_url: null,
      playUrl: null,
      source_url: url.trim(),
      _isOptimistic: true,
    };

    // Добавляем временный трек в UI
    setLibraryTracks(prev => [optimisticTrack, ...prev]);
    
    // Добавляем в QueueStore
    QueueStore.addTrack(optimisticTrack);

    try {
      const response = await authFetch('/api/player/add-by-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (e) {
          // ignore
        }
        const detail = (errorData.detail || '').toString();
        const m = /Track not allowed for ingestion: (\w+)/.exec(detail);
        if (m) {
          const code = m[1];
          let friendly = 'Трек не может быть добавлен';
          if (code === 'PREVIEW_ONLY') friendly = 'Этот трек доступен только как preview в SoundCloud';
          else if (code === 'RESTRICTED') friendly = 'Этот трек требует SoundCloud Go+ и не может быть добавлен';
          else friendly = 'Трек недоступен для добавления';
          throw new Error(friendly);
        }
        throw new Error(detail || 'Failed to add track');
      }

      const data = await response.json();
      
      // Удаляем временный трек
      setLibraryTracks(prev => prev.filter(t => t.id !== tempId));
      QueueStore.removeTrack(tempId);
      
      showToast('Трек успешно добавлен в библиотеку', 'success');
      
      // Перезагружаем библиотеку для получения реального трека
      await loadLibrary();
      
      // Обновляем статус реального трека в QueueStore
      if (data.track) {
        QueueStore.updateTrackStatus(data.track.id, 'ready');
      }
      
      return data;
    } catch (error) {
      console.error('Error adding track by URL:', error);
      
      // Удаляем временный трек при ошибке
      setLibraryTracks(prev => prev.filter(t => t.id !== tempId));
      QueueStore.removeTrack(tempId);
      
      showToast(`Ошибка добавления трека: ${error.message}`, 'error');
      throw error;
    }
  }, [loadLibrary]);

  /**
   * Удаление трека из библиотеки
   * @param {string} trackId - ID трека для удаления
   */
  const removeTrack = useCallback(async (trackId, trackToRemoveArg = null) => {
    if (!trackId) return;

    // OPTIMISTIC UI: Сохраняем трек для возможного восстановления
    const trackToRemove = trackToRemoveArg || libraryTracks.find(t => t.id === trackId);
    if (!trackToRemove) return;

    // Сразу удаляем из UI
    setLibraryTracks(prev => prev.filter(t => t.id !== trackId));
    
    // Удаляем из QueueStore
    QueueStore.removeTrack(trackId);

    try {
      const response = await authFetch(`/api/player/library/${trackId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to remove track');
      }

      showToast('Трек удален из библиотеки', 'success');
      await loadLibrary();
    } catch (error) {
      console.error('Error removing track:', error);
      
      // При ошибке возвращаем трек обратно
      setLibraryTracks(prev => {
        const newTracks = [...prev];
        const originalIndex = libraryTracks.findIndex(t => t.id === trackId);
        
        if (originalIndex >= 0 && originalIndex <= newTracks.length) {
          newTracks.splice(originalIndex, 0, trackToRemove);
        } else {
          newTracks.push(trackToRemove);
        }
        
        return newTracks;
      });
      
      // Возвращаем в QueueStore
      QueueStore.addTrack(trackToRemove);
      
      showToast(`Ошибка удаления трека: ${error.message}`, 'error');
      throw error;
    }
  }, [libraryTracks, loadLibrary]);

  /**
   * Обновление метаданных трека
   * @param {string} trackId - ID трека
   * @param {Object} metadata - Новые метаданные
   */
  const updateTrackMetadata = useCallback(async (trackId, metadata) => {
    if (!trackId || !metadata) return;

    try {
      const response = await authFetch(`/api/player/library/${trackId}/metadata`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to update metadata');
      }

      const data = await response.json();
      showToast('Метаданные обновлены', 'success');
      
      // Обновляем локальное состояние
      setLibraryTracks(prev =>
        prev.map(t => (t.id === trackId ? { ...t, ...data.track } : t))
      );
      
      return data.track;
    } catch (error) {
      console.error('Error updating metadata:', error);
      showToast(`Ошибка обновления метаданных: ${error.message}`, 'error');
      throw error;
    }
  }, []);

  /**
   * Загрузка обложки для трека
   * @param {string} trackId - ID трека
   * @param {File} file - Файл обложки
   */
  const uploadCover = useCallback(async (trackId, file) => {
    if (!trackId || !file) return;

    // Валидация файла обложки
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.type)) {
      showToast('Неподдерживаемый формат изображения. Используйте JPG, PNG или WebP', 'error');
      return;
    }

    if (file.size > maxSize) {
      showToast('Изображение слишком большое (макс. 5MB)', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('cover', file);

    try {
      const response = await authFetch(`/api/player/library/${trackId}/cover`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to upload cover');
      }

      const data = await response.json();
      showToast('Обложка обновлена', 'success');
      
      // Обновляем локальное состояние
      setLibraryTracks(prev =>
        prev.map(t => (t.id === trackId ? { ...t, cover_url: data.cover_url } : t))
      );
      
      return data.cover_url;
    } catch (error) {
      console.error('Error uploading cover:', error);
      showToast(`Ошибка загрузки обложки: ${error.message}`, 'error');
      throw error;
    }
  }, []);

  /**
   * Повторная загрузка трека с источника
   * @param {string} trackId - ID трека для перезагрузки
   */
  const redownloadTrack = useCallback(async (trackId) => {
    if (!trackId) return;

    setRedownloadingId(trackId);

    try {
      const response = await authFetch(`/api/player/library/${trackId}/redownload`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to redownload track');
      }

      const data = await response.json();
      showToast('Трек успешно перезагружен', 'success');
      
      // Обновляем локальное состояние
      setLibraryTracks(prev =>
        prev.map(t => (t.id === trackId ? { ...t, ...data.track } : t))
      );
      
      return data.track;
    } catch (error) {
      console.error('Error redownloading track:', error);
      showToast(`Ошибка перезагрузки трека: ${error.message}`, 'error');
      throw error;
    } finally {
      setRedownloadingId(null);
    }
  }, []);

  return {
    libraryTracks,
    loading,
    downloadsDir,
    downloadsPath,
    loadLibrary,
    loadDownloadSettings,
    saveDownloadSettings,
    uploadFiles,
    addByUrl,
    removeTrack,
    updateTrackMetadata,
    uploadCover,
    redownloadTrack,
    redownloadingId,
  };
}
