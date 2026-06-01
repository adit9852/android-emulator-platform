# Custom emulator image — extends budtmo with a higher-FPS x11vnc config.
# The upstream image launches x11vnc with default args (~30 fps, frame-skipping
# during drag). We patch the python CLI that spawns it so supervisord respawns
# x11vnc with these args on every container start.
FROM budtmo/docker-android:emulator_11.0

USER root

# 1) High-FPS x11vnc args (persistent via this image)
RUN sed -i \
    's|-forever -shared {last_arg}|-forever -shared {last_arg} -defer 5 -wait 5 -nodragging -threads -noxdamage|' \
    /home/androidusr/docker-android/cli/src/app.py \
 && grep -n 'defer 5' /home/androidusr/docker-android/cli/src/app.py

# 2) Mesa GLES + Vulkan ICDs so `-gpu host` can talk to host /dev/dri/renderD128
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
      libgl1-mesa-dri \
      libegl-mesa0 \
      libgles2 \
      libglx-mesa0 \
      mesa-vulkan-drivers \
      mesa-utils \
      intel-media-va-driver \
      vainfo \
 && rm -rf /var/lib/apt/lists/*

USER androidusr
