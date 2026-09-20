"""Build the chosen audition soundtrack from the same events as the animation.

Input is the public catalog preview in review/music/ganja.wav. No publishing
license is supplied by this script. See dynamic-track.json for provenance.
"""
from pathlib import Path
import json, re, subprocess, sys, wave
import numpy as np
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parent
FF=imageio_ffmpeg.get_ffmpeg_exe()
TRACK=json.loads((ROOT/'dynamic-track.json').read_text())
SR=48000
DURATION=15
OUT=ROOT/'exports'

def run(args, **kwargs):
    return subprocess.run([FF,'-hide_banner','-loglevel','error','-y']+args,check=True,**kwargs)

def wav(path,a):
    with wave.open(str(path),'wb') as w:
        w.setnchannels(2);w.setsampwidth(3);w.setframerate(SR)
        pcm=np.clip(a*8388607,-8388608,8388607).astype(np.int32).reshape(-1)
        w.writeframes(np.column_stack([pcm&255,(pcm>>8)&255,(pcm>>16)&255]).astype(np.uint8).tobytes())

if '--mux' in sys.argv:
    run(['-i',str(OUT/'Notchlight-Dynamic-Silent-15s.mp4'),'-i',str(OUT/'Notchlight-Ganja-Dynamic-Mix.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-t','15','-movflags','+faststart',str(OUT/'Notchlight-Ganja-Dynamic-15s.mp4')])
    print(OUT/'Notchlight-Ganja-Dynamic-15s.mp4')
    sys.exit()

source=ROOT/'review/music/ganja.wav'
# Apply a constant gain based on measured loudness, preserving the song dynamics.
r=subprocess.run([FF,'-hide_banner','-ss',str(TRACK['offset']),'-i',str(source),'-t','15','-af','loudnorm=I=-24:TP=-4:LRA=7:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
measurement=json.loads(re.findall(r'\{\s*"input_i".*?\}',r.stderr,re.S)[-1])
gain=10**((-24-float(measurement['input_i']))/20)
raw=run(['-ss',str(TRACK['offset']),'-i',str(source),'-t','15','-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True).stdout
song=np.frombuffer(raw,np.float32).reshape(-1,2).astype(np.float64)*gain
assert len(song)==DURATION*SR
# Five measured frequency bands drive the on-screen equalizer in song time.
mono=song.mean(axis=1);freq=np.fft.rfftfreq(2048,1/SR)
bounds=[(45,180),(180,500),(500,1400),(1400,4000),(4000,12000)]
padded=np.pad(mono,(1024,1024))
energy=[]
for frame in range(900):
    at=round(frame*SR/60)
    fft=np.abs(np.fft.rfft(padded[at:at+2048]*np.hanning(2048)))
    energy.append([np.sqrt(np.mean(fft[(freq>=lo)&(freq<hi)]**2)) for lo,hi in bounds])
energy=np.array(energy)
energy=np.clip(energy/np.maximum(np.percentile(energy,95,axis=0),1e-8),0,1)
for i in range(1,len(energy)):
    energy[i]=energy[i-1]*.35+energy[i]*.65
(ROOT/'assets/ganja-levels.json').write_text(json.dumps(np.round(.18+.82*energy,3).tolist(),separators=(',',':'))+'\n')

# Freeze source position during pause; resume from exactly that sample.
pause=round(TRACK['pause']*SR);play=round(TRACK['play']*SR);n=DURATION*SR
music=np.zeros((n,2));music[:pause]=song[:pause];music[play:]=song[pause:pause+n-play]
ramp=round(.008*SR)
music[pause-ramp:pause]*=np.linspace(1,0,ramp)[:,None]
music[play:play+ramp]*=np.linspace(0,1,ramp)[:,None]
# A gentle nonlinear volume curve makes 60 -> 75 a perceptible +3.88 dB.
volume=np.ones(n)
previous=1.0
for i,t in enumerate(TRACK['scroll']):
    at=round(t*SR);level=TRACK['initialVolume']+(i+1)*TRACK['volumeStep']
    target=(level/TRACK['initialVolume'])**2
    volume[at:at+ramp]=np.linspace(previous,target,ramp)
    volume[at+ramp:]=target
    previous=target
music*=volume[:,None]
music[:round(.04*SR)]*=np.linspace(0,1,round(.04*SR))[:,None]
fade=round(13.65*SR);music[fade:]*=np.linspace(1,0,n-fade)[:,None]
wav(OUT/'Notchlight-Ganja-Dynamic-Music.wav',music)
run(['-i',str(OUT/'Notchlight-Dynamic-SFX-15s.wav'),'-ar',str(SR),'-ac','2','-f','f32le',str(ROOT/'review/music/dynamic-sfx.f32')])
sfx=np.fromfile(ROOT/'review/music/dynamic-sfx.f32',np.float32).reshape(-1,2)
mixed=music+sfx*1.15
assert np.max(np.abs(mixed))<.891, 'Insufficient mix headroom'
wav(OUT/'Notchlight-Ganja-Dynamic-Mix.wav',mixed)
assert np.max(np.abs(music[pause:play]))==0
# Post-pause audio has the same source position, after the 8ms de-click ramp.
assert np.allclose(music[play+ramp:round(4.5*SR)],song[pause+ramp:pause+round(.25*SR)])
report=dict(duration=15,source_offset=TRACK['offset'],pause=TRACK['pause'],resume=TRACK['play'],pause_music_peak=0,volume_steps=TRACK['scroll'],volume_lift_db=round(20*np.log10(previous),2),mix_peak_dbfs=round(20*np.log10(np.max(np.abs(mixed))),2),source_resumes_without_skipping=True)
(ROOT/'review/music/dynamic-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
