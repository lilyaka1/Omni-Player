import React from 'react';

const SearchPanel = ({
  searchQuery,
  searchSource,
  searchResults,
  searchLoading,
  onSearchChange,
  onSourceChange,
  onSearch,
  onAddTrack
}) => {
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch();
    }
  };

  return (
    <div className="search-section">
      <h2>Поиск треков</h2>
      
      <form onSubmit={handleSearchSubmit} className="search-form">
        <input
          type="text"
          placeholder="Введите название трека или URL..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="search-input"
        />
        <button type="submit" className="search-button" disabled={searchLoading}>
          {searchLoading ? 'Поиск...' : 'Найти'}
        </button>
      </form>

      <div className="search-tabs">
        <button
          className={`search-tab ${searchSource === 'youtube' ? 'active' : ''}`}
          onClick={() => onSourceChange('youtube')}
          disabled={searchLoading}
        >
          YouTube
        </button>
        <button
          className={`search-tab ${searchSource === 'soundcloud' ? 'active' : ''}`}
          onClick={() => onSourceChange('soundcloud')}
          disabled={searchLoading}
        >
          SoundCloud
        </button>
      </div>

      {searchLoading && (
        <div className="search-loading">
          <div className="spinner"></div>
          <p>Поиск треков...</p>
        </div>
      )}

      {!searchLoading && searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((result) => (
            <div key={result.id} className="search-result-item">
              <div className="search-result-thumbnail">
                {result.thumbnail ? (
                  <img src={result.thumbnail} alt={result.title} />
                ) : (
                  <div className="search-result-thumbnail-placeholder">
                    <span>🎵</span>
                  </div>
                )}
              </div>
              <div className="search-result-info">
                <div className="search-result-title">{result.title}</div>
                {result.duration && (
                  <div className="search-result-duration">{result.duration}</div>
                )}
              </div>
              <button
                className="search-result-add-button"
                onClick={() => onAddTrack(result)}
                title="Добавить в библиотеку"
              >
                В библиотеку
              </button>
            </div>
          ))}
        </div>
      )}

      {!searchLoading && searchQuery && searchResults.length === 0 && (
        <div className="search-empty">
          <p>Ничего не найдено. Попробуйте изменить запрос.</p>
        </div>
      )}

      {!searchLoading && !searchQuery && searchResults.length === 0 && (
        <div className="search-empty">
          <p>Введите запрос для поиска треков на YouTube или SoundCloud</p>
        </div>
      )}
    </div>
  );
};

export default SearchPanel;
