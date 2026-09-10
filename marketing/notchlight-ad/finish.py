"""Mux generated sound with the silent render, without re-encoding picture."""
from pathlib import Path
import os, subprocess
import imageio_ffmpeg

root=Path(__file__).resolve().parent
folder=root/'exports'
ff=os.environ.get('FFMPEG') or imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ff,'-hide_banner','-loglevel','error','-y',
    '-i',str(folder/'Notchlight-Silent-36s.mp4'),
    '-i',str(folder/'Notchlight-SFX-36s.wav'),
    '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k',
    '-t','36','-movflags','+faststart',str(folder/'Notchlight-Final-36s.mp4')],check=True)
print(folder/'Notchlight-Final-36s.mp4')
