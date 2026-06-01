# Custom emulator image — extends budtmo with a higher-FPS x11vnc config.
# The upstream image launches x11vnc with default args (~30 fps, frame-skipping
# during drag). We patch the python CLI that spawns it so supervisord respawns
# x11vnc with these args on every container start.
FROM budtmo/docker-android:emulator_11.0

USER root
RUN sed -i \
    's|-forever -shared {last_arg}|-forever -shared {last_arg} -defer 5 -wait 5 -nodragging -threads -noxdamage|' \
    /home/androidusr/docker-android/cli/src/app.py \
 && grep -n 'defer 5' /home/androidusr/docker-android/cli/src/app.py
USER androidusr
