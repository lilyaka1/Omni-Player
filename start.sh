#!/bin/bash

# Omni Player - Быстрый старт скрипт для всего проекта

echo "Omni Player - Быстрый старт"

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "Docker не установлен"
    exit 1
fi

echo "Docker найден"

# Проверка Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "Docker Compose не установлен"
    exit 1
fi

echo "Docker Compose найден"

# Запуск всех сервисов
echo "Запуск всех сервисов..."
docker-compose up


echo ""
echo "Приложение запущено!"
echo ""
echo "Frontend:      http://localhost:5173"
echo "Backend API:   http://localhost:3000"
echo "API Docs:      http://localhost:3000/docs"
echo "PostgreSQL:    localhost:5432"
echo ""
