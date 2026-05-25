export default function EditTrackModal({
  track,
  isOpen,
  onClose,
  onSave,
  onUploadCover,
  editForm,
  onFormChange,
  isSaving,
  isUploadingCover,
}) {
  if (!isOpen || !track) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isSaving && !isUploadingCover) {
      onClose();
    }
  };

  const handleCoverUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadCover(file);
      e.target.value = '';
    }
  };

  const handleFormChange = (field, value) => {
    onFormChange({ ...editForm, [field]: value });
  };

  return (
    <div
      style={{
        display: 'flex',
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        zIndex: 1100,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="glass glass-primary"
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 28,
          margin: 20,
          borderRadius: 16,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
            Редактировать трек
          </h3>
          <button
            className="btn btn-icon glass-tertiary"
            style={{ width: 30, height: 30 }}
            onClick={onClose}
            disabled={isSaving || isUploadingCover}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Cover Preview */}
        <label
          className="glass-tertiary"
          style={{
            cursor: isUploadingCover ? 'wait' : 'pointer',
            display: 'block',
            width: '100%',
            aspectRatio: '1/1',
            maxWidth: 200,
            margin: '0 auto 16px',
            borderRadius: 14,
            overflow: 'hidden',
            position: 'relative',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          {track.thumbnail ? (
            <img
              src={track.thumbnail}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                opacity: 0.7,
              }}
            >
              <i className="fa-solid fa-image" style={{ fontSize: '1.6rem' }} />
            </div>
          )}
          {isUploadingCover && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)',
              }}
            >
              <div className="spinner" />
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleCoverUpload}
            disabled={isUploadingCover}
          />
        </label>
        <div
          style={{
            textAlign: 'center',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            marginBottom: 16,
          }}
        >
          Кликните по обложке, чтобы загрузить новую
        </div>

        {/* Form Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="form-group">
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Название
            </label>
            <input
              className="input"
              type="text"
              value={editForm.title}
              onChange={(e) => handleFormChange('title', e.target.value)}
              maxLength={200}
              disabled={isSaving}
            />
          </div>

          <div className="form-group">
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Артист
            </label>
            <input
              className="input"
              type="text"
              value={editForm.artist}
              onChange={(e) => handleFormChange('artist', e.target.value)}
              maxLength={200}
              disabled={isSaving}
            />
          </div>

          <div className="form-group">
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Альбом
            </label>
            <input
              className="input"
              type="text"
              value={editForm.album}
              onChange={(e) => handleFormChange('album', e.target.value)}
              maxLength={200}
              disabled={isSaving}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
            <div className="form-group">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Жанр
              </label>
              <input
                className="input"
                type="text"
                value={editForm.genre}
                onChange={(e) => handleFormChange('genre', e.target.value)}
                maxLength={80}
                disabled={isSaving}
              />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Год
              </label>
              <input
                className="input"
                type="number"
                min={1900}
                max={2100}
                value={editForm.year}
                onChange={(e) => handleFormChange('year', e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            className="btn btn-accent w-full"
            onClick={onSave}
            disabled={isSaving || isUploadingCover}
          >
            {isSaving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            className="btn w-full"
            onClick={onClose}
            disabled={isSaving || isUploadingCover}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
