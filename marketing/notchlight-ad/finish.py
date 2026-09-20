"""Mux generated sound with the silent render, without re-encoding picture."""
from pathlib import Path
import os, subprocess, sys
import imageio_ffmpeg

root=Path(__file__).resolve().parent
folder=root/'exports'
duration=15 if '--short' in sys.argv else 36
ff=os.environ.get('FFMPEG') or imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ff,'-hide_banner','-loglevel','error','-y',
    '-i',str(folder/f'Notchlight-Silent-{duration}s.mp4'),
    '-i',str(folder/f'Notchlight-SFX-{duration}s.wav'),
    '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k',
    '-t',str(duration),'-movflags','+faststart',str(folder/f'Notchlight-Final-{duration}s.mp4')],check=True)
print(folder/f'Notchlight-Final-{duration}s.mp4')
