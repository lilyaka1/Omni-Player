#!/bin/bash

# Omni Player - Локальный запуск без Docker

echo "🚀 Запуск Omni Player (локально)"

# Функция для запуска backend
start_backend() {
    echo "📦 Установка зависимостей backend..."
    cd backend
    python3 -m venv venv 2>/dev/null || true
    source venv/bin/activate
    pip install --upgrade pip > /dev/null 2>&1
    pip install -r requirements.txt > /dev/null 2>&1
    echo "✅ Backend готов"
    echo "🔧 Запуск FastAPI сервера на http://localhost:3000..."
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
    BACKEND_PID=$!
}

# Функция для запуска frontend
start_frontend() {
    echo "📦 Установка зависимостей frontend..."
    cd frontend
    npm install > /dev/null 2>&1
    echo "✅ Frontend готов"
    echo "🎨 Запуск Vite на http://localhost:5173..."
    npm run dev &
    FRONTEND_PID=$!
}

# Главная функция
main() {
    echo ""
    echo "⚠️  ВАЖНО: Для полной функциональности нужна PostgreSQL БД"
    echo "   Или отредактируйте backend/app/core/config.py для использования SQLite"
    echo ""
    
    # Запуск backend в фоне
    start_backend
    
    # Ждем 2 секунды
    sleep 2
    
    # Запуск frontend в фоне
    start_frontend
    
    sleep 2
    
    echo ""
    echo "✅ Сервисы запущены!"
    echo ""
    echo "📍 Frontend:      http://localhost:5173"
    echo "📍 Backend API:   http://localhost:8000"
    echo "📍 API Docs:      http://localhost:8000/docs"
    echo ""
    echo "Для остановки: Ctrl+C"
    echo ""
    
    # Ждем завершения любого процесса
    wait
}

main
