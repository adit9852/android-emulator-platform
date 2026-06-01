# ws-scrcpy server packaged with an ADB client that connects out to the
# three pre-warmed emulator containers on the shared docker network.
FROM node:18-bullseye AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run dist

# ---- runtime ----
FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      adb \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules

# Entrypoint: start ADB server, register each emulator over TCP, then launch
# the ws-scrcpy server on port 8000.
RUN printf '%s\n' \
  '#!/bin/bash' \
  'set -e' \
  'adb start-server' \
  'for host in $EMU_HOSTS; do' \
  '  echo "registering $host"' \
  '  for i in 1 2 3 4 5; do' \
  '    adb connect "$host:5555" && break' \
  '    sleep 2' \
  '  done' \
  'done' \
  'adb devices' \
  'cd /app/dist' \
  'exec node index.js' \
  > /entrypoint.sh && chmod +x /entrypoint.sh

ENV EMU_HOSTS="android-emulator-1 android-emulator-2 android-emulator-3"
EXPOSE 8000
CMD ["/entrypoint.sh"]
