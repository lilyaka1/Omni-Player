import React, { useState } from 'react';
import { formatDuration } from '../utils/format';
import QueueStore from '../utils/QueueStore';
import TrackItem from './TrackItem';

const TrackList = ({
  tracks,
  currentTrack,
  onPlay,
  onEdit,
  onRedownload,
  onRemove,
  redownloadingId
}) => {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const isCurrentTrack = (track) => {
    return currentTrack && currentTrack.id === track.id;
  };

  const canRedownload = (track) => {
    return track.source && track.source !== 'local' && track.url;
  };

  const getSourceBadge = (source) => {
    if (!source || source === 'local') return null;
    
    const badges = {
      youtube: { text: 'YouTube', class: 'source-youtube' },
      soundcloud: { text: 'SoundCloud', class: 'source-soundcloud' }
    };
    
    return badges[source] || null;
  };

  // Drag & Drop handlers
  const handleDragStart = (e, index, track) => {
    // Запретить drag для текущего играющего трека
    if (isCurrentTrack(track)) {
      e.preventDefault();
      return;
    }
    
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
    
    // Добавить класс для визуального эффекта
    e.currentTarget.style.opacity = '0.4';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e) => {
    // Проверяем, что мы действительно покинули элемент
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e, toIndex) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      // Вызываем метод QueueStore для перемещения трека
      QueueStore.moveTrack(draggedIndex, toIndex);
    }
    
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  if (!tracks || tracks.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎵</div>
        <h3>Библиотека пуста</h3>
        <p>Загрузите файлы или добавьте треки из поиска</p>
      </div>
    );
  }

  return (
    <div className="track-list">
      {tracks.map((track, index) => {
        const sourceBadge = getSourceBadge(track.source);
        const isActive = isCurrentTrack(track);
        const isRedownloading = redownloadingId === track.id;
        const isDragging = draggedIndex === index;
        const isDragOver = dragOverIndex === index;
        const isDraggable = !isActive; // Запретить drag для текущего трека

        return (
          <div
            key={track.id}
            className={`track-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
            draggable={isDraggable}
            onDragStart={(e) => handleDragStart(e, index, track)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            style={{
              cursor: isDraggable ? 'grab' : 'default'
            }}
          >
            <TrackItem
              track={track}
              isActive={isActive}
              isRedownloading={isRedownloading}
              onPlay={onPlay}
              onEdit={onEdit}
              onRedownload={onRedownload}
              onRemove={onRemove}
            />
          </div>
        );
      })}
    </div>
  );
};

export default TrackList;
