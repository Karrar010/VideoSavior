FROM python:3.12-slim

# Node 22+ is required by yt-dlp's EJS challenge solver (Debian's own nodejs
# package is too old) to work around YouTube's "n" parameter obfuscation -
# https://github.com/yt-dlp/yt-dlp/wiki/EJS
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 5050
CMD ["python", "app.py"]
