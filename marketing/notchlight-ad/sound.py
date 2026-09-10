"""Original, deterministic, music-free stereo effects; no sampled third-party audio."""
from pathlib import Path
import json, wave
import numpy as np

ROOT=Path(__file__).resolve().parent
SR=48000
DURATION=36
rng=np.random.default_rng(421)
mix=np.zeros((SR*DURATION,2),dtype=np.float64)
cues=[]

def add(at,signal,level=.12,pan=0):
    signal=signal*level
    stereo=np.column_stack([signal*np.sqrt((1-pan)/2),signal*np.sqrt((1+pan)/2)])
    start=round(at*SR);end=min(len(mix),start+len(stereo))
    mix[start:end]+=stereo[:end-start]

def tone(freq,duration,decay=10):
    t=np.arange(round(SR*duration))/SR
    env=(1-np.exp(-t*650))*np.exp(-t*decay)
    return (np.sin(2*np.pi*freq*t)+.18*np.sin(2*np.pi*freq*2*t))*env

def click(at,level=.07,pan=0):
    t=np.arange(round(SR*.07))/SR
    noise=rng.normal(0,1,len(t));noise=np.convolve(noise,np.ones(7)/7,'same')
    sig=(noise*.35+np.sin(2*np.pi*1450*t)*.4+np.sin(2*np.pi*340*t)*.5)*np.exp(-t*90)*(1-np.exp(-t*2400))
    add(at,sig,level,pan)

def whoosh(at,duration=.42,level=.085,direction=1):
    n=round(SR*duration);t=np.arange(n)/SR
    noise=rng.normal(0,1,n)
    low=np.convolve(noise,np.ones(38)/38,'same')
    high=np.convolve(noise,np.ones(7)/7,'same')-low
    env=np.sin(np.pi*t/duration)**2
    sig=(.55*low+.45*high)*env
    pan=np.linspace(-.4,.4,n)*direction
    add(at,sig,level,pan)

def cue(at,name):cues.append({'seconds':at,'effect':name})

# Three restrained keystrokes establish the working desktop.
for t in [.32,.58,.81]:click(t,.045,-.15)
cue(.32,'Three quiet keyboard ticks')
add(1.05,tone(620,.13,30),.055);cue(1.05,'Notch wakes: muted tap')
whoosh(2.15,.5,.1);cue(2.15,'Hero unfold: soft air movement')
add(4.8,tone(830,.35,12),.072,.12);add(4.91,tone(1107,.28,15),.033,.12);cue(4.8,'Attention: gentle two-part signal')
click(6.1,.11,-.05);whoosh(6.16,.28,.05);cue(6.1,'Open approval: tactile click')
click(8.75,.11,-.3)
add(8.84,tone(523.25,.5,9),.075,-.15);add(8.94,tone(783.99,.55,8),.06,.15)
cue(8.75,'Allow once: click and warm confirmation')
for t,pan in [(11.25,-.3),(13.5,.12),(14.6,.12)]:click(t,.1,pan)
cue(11.25,'Music tab');cue(13.5,'Pause');cue(14.6,'Play')
for i,t in enumerate([15.65,15.95,16.25]):
    add(t,tone(700+i*120,.09,45),.04,.3)
    click(t,.04,.3)
cue(15.65,'Volume: three ascending wheel ticks')
whoosh(17.8,.27,.065,-1);cue(17.8,'Fold to resting notch')
click(18.85,.1,.15);add(18.85,tone(230,.16,22),.08,.15);cue(18.85,'File lifted')
whoosh(19.6,.65,.07);cue(19.6,'File carry: subtle air')
whoosh(20.3,.35,.075);cue(20.3,'Tray unfolds')
add(21.6,tone(145,.28,21),.15,-.2);click(21.6,.08,-.2);cue(21.6,'File lands: soft felt thud')
click(24.1,.11,.1);whoosh(24.16,.3,.045);cue(24.1,'Clipboard tab')
click(26.65,.085);add(26.68,tone(980,.22,23),.04);cue(26.65,'Copied: light pop')
whoosh(29.2,.3,.065,-1);cue(29.2,'Everything folds away')
whoosh(30.9,.65,.065)
add(31.2,tone(220,.9,5),.055);add(31.24,tone(660,.9,5),.022)
cue(31.2,'Wordmark: soft resonant settle')

# Preserve headroom for user-supplied music; apply a short end fade to every export.
peak=float(np.max(np.abs(mix)))
if peak>10**(-12/20):mix*=10**(-12/20)/peak
mix[-SR:]*=np.linspace(1,0,SR)[:,None]
output=ROOT/'exports'/'Notchlight-SFX-36s.wav'
with wave.open(str(output),'wb') as f:
    f.setnchannels(2);f.setsampwidth(3);f.setframerate(SR)
    pcm=np.clip(mix*8388607,-8388608,8388607).astype(np.int32).reshape(-1)
    data=np.column_stack([pcm&255,(pcm>>8)&255,(pcm>>16)&255]).astype(np.uint8)
    f.writeframes(data.tobytes())
(ROOT/'sfx-cues.json').write_text(json.dumps(cues,indent=2)+'\n')
print(json.dumps({'file':str(output),'duration':DURATION,'peak_dbfs':round(20*np.log10(np.max(np.abs(mix))),2),'cues':len(cues)}))
