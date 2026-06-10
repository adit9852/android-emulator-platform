#!/bin/bash
# EMU      — adb target of the budtmo emulator, e.g. android-emulator-1:5555
# XVFB_W/H — framebuffer size; portrait 720x1520 ~ matches a modern phone so the
#            phone nearly fills it (other devices letterbox cleanly on black).
EMU="${EMU:-android-emulator-1:5555}"
XW="${XVFB_W:-720}"
XH="${XVFB_H:-1520}"
MAXSIZE="${MAX_SIZE:-1080}"
export DISPLAY=:0

echo "[scrcpy-display] EMU=$EMU  Xvfb=${XW}x${XH}  max-size=$MAXSIZE"

# 1) Virtual framebuffer
Xvfb :0 -screen 0 "${XW}x${XH}x24" -nolisten tcp &
sleep 2

# 1b) Minimal WM (no titlebars) so the scrcpy window gets input focus —
#     without it, x11vnc-injected pointer/key events never reach scrcpy.
matchbox-window-manager -use_titlebar no >/var/log/mwm.log 2>&1 &
sleep 1

# 2) x11vnc on display :0 (low-latency flags, no password). -defer 1 sends
#    updates almost immediately; -threads parallelises encoding.
x11vnc -display :0 -forever -shared -nopw -rfbport 5900 \
       -noxdamage -defer 1 -wait 5 -threads \
       -bg -o /var/log/x11vnc.log

# 3) noVNC web + websockify on 6080  (serves vnc_lite.html, proxies /websockify -> :5900)
websockify --web /opt/novnc 6080 localhost:5900 >/var/log/websockify.log 2>&1 &

# 4) scrcpy in a restart loop — renders the device, fullscreen + borderless,
#    so the Xvfb contains ONLY the Android display (centered on black).
while true; do
  adb connect "$EMU" >/dev/null 2>&1
  adb -s "$EMU" wait-for-device >/dev/null 2>&1
  echo "[scrcpy-display] starting scrcpy for $EMU"
  scrcpy --serial "$EMU" \
         --window-x 0 --window-y 0 --window-width "$XW" --window-height "$XH" \
         --window-borderless --stay-awake \
         --max-size "$MAXSIZE" --max-fps 60 --render-driver=opengl \
         --window-title "$EMU" >/var/log/scrcpy.log 2>&1 &
  SPID=$!
  # Give the scrcpy window X input focus ONCE so SDL processes mouse drags
  # cleanly. windowfocus (not windowactivate) avoids the synthetic pointer
  # events that caused phantom taps, and it's a single shot — nothing repeats.
  for i in 1 2 3 4 5 6 7 8; do
    WID=$(xdotool search --class scrcpy 2>/dev/null | head -1)
    if [ -n "$WID" ]; then
      xdotool windowsize "$WID" "$XW" "$XH" >/dev/null 2>&1 || true
      xdotool windowmove "$WID" 0 0 >/dev/null 2>&1 || true
      xdotool windowfocus "$WID" >/dev/null 2>&1 || true
      break
    fi
    sleep 1
  done
  wait "$SPID"
  echo "[scrcpy-display] scrcpy exited; reconnecting in 3s"
  sleep 3
done
