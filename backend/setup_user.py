"""Script to create test user"""
from passlib.context import CryptContext
from app.database.session import SessionLocal
from app.database.models import User
from sqlalchemy import text

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

def setup_user():
    db = SessionLocal()
    try:
        # Проверяем есть ли пользователь
        existing = db.query(User).filter(User.username == 'testuser').first()
        hashed = pwd_context.hash('password')
        
        if existing:
            # Обновляем пароль и роль
            existing.password_hash = hashed
            existing.role = 'admin'
            db.commit()
            print('✅ Пароль и роль пользователя testuser обновлены (admin)')
        else:
            # Создаем нового администратора
            user = User(
                username='admin',
                email='admin@test.com',
                password_hash=hashed,
                role='admin',
                is_blocked=False
            )
            db.add(user)
            db.commit()
            print('✅ Администратор admin создан')
        print('   username: admin')
        print('   password: password')
        print('   role: admin')
    except Exception as e:
        print(f'❌ Ошибка: {e}')
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    setup_user()
