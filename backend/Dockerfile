FROM mirror.gcr.io/library/python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    ffmpeg \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install piper-tts binary
RUN curl -L -o /usr/local/bin/piper https://github.com/rhasspy/piper/releases/download/2023.11.14-1/piper_linux_amd64.tar.gz \
    && tar -xzf /usr/local/bin/piper -C /usr/local/bin/ --strip-components=1 piper \
    && chmod +x /usr/local/bin/piper \
    && rm -f /usr/local/bin/piper.tar.gz 2>/dev/null || true

# Copy requirements and install Python dependencies
COPY requirements.txt ./
ENV PIP_DEFAULT_TIMEOUT=120
RUN pip install --no-cache-dir --retries 10 --default-timeout 120 -r requirements.txt

# Copy application
COPY . .

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# Run application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
