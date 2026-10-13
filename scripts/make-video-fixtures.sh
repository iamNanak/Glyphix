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
ls -la
