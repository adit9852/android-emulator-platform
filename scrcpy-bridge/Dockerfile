FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      scrcpy \
      adb \
      ffmpeg \
      ca-certificates \
      curl \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV EMU_HOSTS="android-emulator-1 android-emulator-2 android-emulator-3"
EXPOSE 8000
CMD ["node", "server.js"]
