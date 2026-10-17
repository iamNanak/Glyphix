#!/bin/bash
# Test videos for the video/ASCII/export suites (needs ffmpeg). Output goes to scripts/fixtures/ (gitignored).
# The top 120 px of every frame encode the frame number in binary: 8 blocks of 240 px, bit k = block k
# (white = 1), so tests can read back exactly which source frame was drawn.
set -e
cd "$(dirname "$0")/fixtures"
code="if(lt(Y,120), 255*mod(floor(N/pow(2,floor(X/240))),2), lum(X,Y))"
chroma_y="if(lt(Y,120), 128, cb(X,Y))"
chroma_r="if(lt(Y,120), 128, cr(X,Y))"
[ -f clip-1080p30.mp4 ] || ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=5" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=5" \
  -vf "format=yuv420p,geq=lum='$code':cb='$chroma_y':cr='$chroma_r'" \
  -c:v libx264 -preset veryfast -crf 20 -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest clip-1080p30.mp4
[ -f clip-720p-vp9.webm ] || ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=3" -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=3" \
  -vf "format=yuv420p,geq=lum='$code':cb='$chroma_y':cr='$chroma_r'" \
  -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -g 60 -c:a libopus -shortest clip-720p-vp9.webm
[ -f clip-silent-2s.mp4 ] || ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=2" \
  -vf "format=yuv420p,geq=lum='$code':cb='$chroma_y':cr='$chroma_r'" -c:v libx264 -preset veryfast -g 30 -an clip-silent-2s.mp4
# Animated GIF: 320x180, 12 fps, 24 frames, 1 loop forever. The top 30 px encode the frame number in binary:
# 8 blocks of 40 px, bit k = block k (white = 1). Black/white blocks survive the 256-colour palette exactly.
gif_code="if(lt(Y,30), 255*mod(floor(N/pow(2,floor(X/40))),2), lum(X,Y))"
[ -f clip-12fps.gif ] || ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=320x180:rate=12:duration=2" \
  -vf "format=yuv420p,geq=lum='$gif_code':cb='if(lt(Y,30),128,cb(X,Y))':cr='if(lt(Y,30),128,cr(X,Y))',split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=dither=none" \
  -loop 0 clip-12fps.gif
ls -la
