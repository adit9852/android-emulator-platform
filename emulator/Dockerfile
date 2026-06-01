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

# 3) Replace the budtmo "DOCKER ANDROID" branded X background with a solid black
#    PNG, so when EMULATOR_NO_SKIN is on, the Xvfb framebuffer behind the
#    emulator window is pure black instead of a logo.
RUN printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10\x08\x02\x00\x00\x00\x90\x91h6\x00\x00\x00\x1fIDATx\x9cc`\x18\x05\xa3`\x14\x8c\x82Q0\nF\xc1(\x18\x05\xa3`\x14\x8c\x82Q0\nF\x01\x00\x00\x00\xff\xff\x03\x00\x00\x10\x00\x01\x97}{i\x00\x00\x00\x00IEND\xaeB`\x82' \
    > /home/androidusr/docker-android/mixins/configs/display/background.png \
 && chown androidusr:androidusr /home/androidusr/docker-android/mixins/configs/display/background.png

USER androidusr
