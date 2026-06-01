# scrcpy-display: renders ONLY the Android screen (no emulator skin / QT chrome)
# of a budtmo emulator into an Xvfb via scrcpy --fullscreen, then serves that
# Xvfb over the proven x11vnc + noVNC pipeline. Browser input flows back
# natively: noVNC -> X pointer/keys -> scrcpy SDL window -> device over ADB.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      scrcpy adb xvfb x11vnc websockify git ca-certificates \
      matchbox-window-manager xdotool \
  && git clone --depth 1 https://github.com/novnc/noVNC /opt/novnc \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
# Custom minimal noVNC page that scales the framebuffer to fit (scaleViewport),
# with no status bar — the iframe loads this instead of vnc_lite.html.
COPY phone.html /opt/novnc/phone.html
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 6080
ENTRYPOINT ["/entrypoint.sh"]
