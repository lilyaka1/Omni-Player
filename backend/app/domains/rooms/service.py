"""
Бизнес-логика для комнат — DB-операции, вынесенные из router.py.
"""
from sqlalchemy.orm import Session
from app.database.models import Room, RoomTrack, SourceEnum, User


def create_room(db: Session, name: str, description: str, creator: User) -> Room:
    room = Room(creator_id=creator.id, name=name, description=description)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


def add_track(
    db: Session,
    room_id: int,
    user_id: int,
    *,
    source: SourceEnum,
    source_track_id: str,
    title: str,
    artist: str,
    duration: int,
    stream_url: str,
    thumbnail: str,
    genre: str,
) -> RoomTrack:
    max_order = db.query(RoomTrack).filter(RoomTrack.room_id == room_id).count()
    track = RoomTrack(
        room_id=room_id,
        source=source,
        source_track_id=source_track_id,
        title=title,
        artist=artist,
        duration=duration,
        stream_url=stream_url,
        thumbnail=thumbnail,
        genre=genre,
        order=max_order + 1,
        added_by_id=user_id,
    )
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


def clear_queue(db: Session, room: Room) -> int:
    room.now_playing_track_id = None
    room.is_playing = False
    db.flush()
    deleted = (
        db.query(RoomTrack)
        .filter(RoomTrack.room_id == room.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def reorder_tracks(db: Session, room_id: int, order_list: list[int]) -> None:
    for idx, track_id in enumerate(order_list):
        db.query(RoomTrack).filter(
            RoomTrack.id == track_id,
            RoomTrack.room_id == room_id,
        ).update({"order": idx + 1})
    db.commit()


def remove_track(db: Session, track: RoomTrack) -> None:
    db.delete(track)
    db.commit()


def update_room(db: Session, room: Room, name: str | None, description: str | None) -> Room:
    if name is not None:
        room.name = name
    if description is not None:
        room.description = description
    db.commit()
    db.refresh(room)
    return room


def delete_room(db: Session, room: Room) -> None:
    """Мягкое удаление — деактивация комнаты."""
    room.is_active = False
    room.is_playing = False
    db.commit()


def get_room_or_404(db: Session, room_id: int) -> Room:
    from fastapi import HTTPException, status
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room
