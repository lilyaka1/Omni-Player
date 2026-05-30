/**
 * Skeleton component for loading states
 */

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-img" />
      <div className="skeleton skeleton-text skeleton-title" />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text short" />
    </div>
  );
}

export function SkeletonCardGrid({ count = 4 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonProfileCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton" style={{ width: '100px', height: '100px', borderRadius: '50%', margin: '0 auto' }} />
      <div className="skeleton skeleton-text skeleton-title" />
      <div className="skeleton skeleton-text short" style={{ margin: '0 auto' }} />
      <div className="skeleton skeleton-text" style={{ marginTop: '16px' }} />
      <div className="skeleton skeleton-text short" />
    </div>
  );
}

export function SkeletonRoomCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-img" style={{ height: '150px' }} />
      <div className="skeleton skeleton-text skeleton-title" />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text short" />
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <div className="skeleton" style={{ flex: 1, height: '32px', borderRadius: '6px' }} />
        <div className="skeleton" style={{ flex: 1, height: '32px', borderRadius: '6px' }} />
      </div>
    </div>
  );
}

export function SkeletonRoomGrid({ count = 6 }) {
  return (
    <div className="skeleton-list" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRoomCard key={i} />
      ))}
    </div>
  );
}
