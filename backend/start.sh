#!/bin/bash

# Omni Player Backend - Быстрый старт скрипт

echo "🎵 Omni Player Backend - Быстрый старт"
echo "======================================"

# Проверка Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 не установлен"
    exit 1
fi

echo "✅ Python 3 найден"

# Создание venv если не существует
if [ ! -d "venv" ]; then
    echo "📦 Создание виртуального окружения..."
    python3 -m venv venv
fi

# Активация venv
echo "🔌 Активация виртуального окружения..."
source venv/bin/activate

# Установка зависимостей
echo "📚 Установка зависимостей..."
pip install -q -r requirements.txt

# Проверка Docker
if command -v docker &> /dev/null; then
    echo "🐳 Docker найден. Запуск PostgreSQL..."
    docker-compose up -d db
    
    echo "⏳ Ожидание инициализации БД..."
    sleep 5
fi

# Запуск сервера
echo "🚀 Запуск FastAPI server на http://localhost:8000"
echo "📚 API документация: http://localhost:8000/docs"
echo "======================================"
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
