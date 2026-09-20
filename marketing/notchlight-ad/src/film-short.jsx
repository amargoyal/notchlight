// Frame-exact film. Every animated property is derived from seconds, never wall time.
const W=1080,H=1920,DURATION=15,NX=DW/2;
const K={stubs:0,open:.12,ask:99,row:99,allow:99,music:3.05,pause:99,play:99,scroll:[4.35,4.55,4.75],collapse1:5.5,pick:6.15,over:7.05,drop:7.72,clip:8.85,copy:10.1,leave:11.25,collapse2:11.55,veil:11.95,word:12.3,...(AD_TRACK?{pause:AD_TRACK.pause,play:AD_TRACK.play,scroll:AD_TRACK.scroll}:{})};
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const mix=(a,b,x)=>a+(b-a)*x;
const smooth=x=>x*x*x*(x*(x*6-15)+10);
const out=x=>1-Math.pow(1-x,4);
const progress=(t,s,d=.5,fn=out)=>fn(clamp((t-s)/d));
function keys(k,t,p){if(t<=k[0].t)return k[0][p];for(let i=1;i<k.length;i++){if(t<k[i].t)return mix(k[i-1][p],k[i][p],smooth((t-k[i-1].t)/(k[i].t-k[i-1].t)));}return k.at(-1)[p];}
function Pointer({press=0}){return <svg width="26" height="34" viewBox="0 0 26 34" style={{display:'block',transform:`scale(${1-.09*press})`,transformOrigin:'4px 3px',filter:'drop-shadow(0 2px 2px #0008)'}}><path d="M4 3V25L9.5 19.9L13.6 28.5L17.4 26.6L13.4 18.3L21 17.8Z" fill="#141210" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/></svg>}
function Logo({size=44,color="#F2EDE7"}){return <svg width={size} height={size} viewBox="0 0 100 100" style={{display:"block",flex:"none"}}><rect x="0" y="28" width="100" height="4" rx="2" fill={color} opacity=".4"/><path d="M16 30H84V50A16 16 0 0 1 68 66H32A16 16 0 0 1 16 50Z" fill={color}/><circle cx="34" cy="50" r="6.5" fill="#5FBE86"/></svg>}
const OPEN_FACES=new Set(['list','listAsk','panelAsk','panelOk','music','trayDrop','trayFull','clip','clipAfter']);
const dimensions={void:{w:190,h:34,l:0},stubs:{w:242,h:34,l:26},list:{w:472,h:255,l:141},listAsk:{w:472,h:285,l:141},panelAsk:{w:472,h:366,l:141},panelOk:{w:472,h:240,l:141},music:{w:472,h:191,l:141},trayDrop:{w:472,h:287,l:141},trayFull:{w:472,h:287,l:141},clip:{w:472,h:390,l:141},clipAfter:{w:472,h:390,l:141},resting:{w:430,h:34,l:141}};
const SEGMENTS=[{t:0,f:'resting'},{t:K.open,f:'list'},{t:K.music+.05,f:'music'},{t:K.collapse1,f:'resting'},{t:K.over,f:'trayDrop'},{t:K.drop+.24,f:'trayFull'},{t:K.clip+.05,f:'clip'},{t:K.copy,f:'clipAfter'},{t:K.collapse2,f:'resting'}];
const CAMERA=[{t:0,z:1.7,x:NX,y:590},{t:.8,z:1.82,x:NX,y:565},{t:2.85,z:1.82,x:NX,y:565},{t:3.5,z:1.86,x:NX,y:605},{t:5.15,z:1.86,x:NX,y:605},{t:6.12,z:1.28,x:NX+28,y:485},{t:6.4,z:1.28,x:NX+28,y:485},{t:7.8,z:1.8,x:NX,y:565},{t:8.65,z:1.8,x:NX,y:565},{t:9.2,z:1.82,x:NX,y:520},{t:11.25,z:1.82,x:NX,y:520},{t:12.05,z:1.65,x:NX,y:585}];
const TITLES=[{s:-1,e:2.95,lines:['Four tools.','One notch.']},{s:3.05,e:5.45,lines:['Music, within reach.']},{s:5.65,e:8.7,lines:['Drop it. Keep it.']},{s:8.95,e:11.6,lines:['Copy. Keep.','Find again.']}];

function Film({T}){
 const root=React.useRef(null);const [measured,setMeasured]=React.useState(null);
 const musicTime=T-Math.max(0,Math.min(T-K.pause,K.play-K.pause));
 const paused=T>=K.pause&&T<K.play;
 const volume=T>=K.scroll[0]&&T<K.scroll[2]+.85?(AD_TRACK?.initialVolume??60)+(AD_TRACK?.volumeStep??5)*K.scroll.filter(v=>T>=v).length:null;
 const sceneFaces={stubs:<FaceStubs/>,list:<FaceList T={T} asking={false}/>,listAsk:<FaceList T={T} asking hoverRow={T>K.row-.35}/>,panelAsk:<FacePanel T={T} phase="ask" hoverAllow={T>K.allow-.3}/>,panelOk:<FacePanel T={T} phase="ok" face={T<K.allow+1.7?'approved':'working'}/>,music:<FaceMusic T={musicTime} volume={volume} files={1} paused={paused}/>,resting:<FaceResting T={musicTime} paused={paused}/>,trayDrop:<FaceTray T={T} dropping count={1}/>,trayFull:<FaceTray T={T} dropping={false} count={2}/>,clip:<FaceClip T={T} after={false} hoverId={T>K.copy-.4?'hex':null} files={2}/>,clipAfter:<FaceClip T={T} after files={2}/>};
 React.useLayoutEffect(()=>{
  const collect=()=>{const dims={...dimensions},targets={};root.current.querySelectorAll('[data-face]').forEach(el=>{const wing=el.querySelector('[data-nl-leftwing]');const f=el.dataset.face;dims[f]={w:el.offsetWidth,h:el.offsetHeight,l:wing?.offsetWidth||0};});
   const screen=root.current.querySelector('[data-nl-screen]');const sr=screen.getBoundingClientRect(),scale=sr.width/DW;
   root.current.querySelectorAll('[data-target]').forEach(el=>{const face=el.closest('[data-face]');if(face&&['resting','clipAfter','panelOk','list','trayDrop'].includes(face.dataset.face))return;const r=el.getBoundingClientRect();const fr=face?.getBoundingClientRect();targets[el.dataset.target]=face?{x:NX-NL.NOTCH_W/2-dims[face.dataset.face].l+(r.x+r.width/2-fr.x)/scale,y:(r.y+r.height/2-fr.y)/scale}:{x:(r.x+r.width/2-sr.x)/scale,y:(r.y+r.height/2-sr.y)/scale};});
   setMeasured({dims,targets});window.__measurements={dims,targets};};collect();document.fonts.ready.then(collect);
 },[]);
 const dims=measured?.dims||dimensions;
 const target=name=>measured?.targets[name]||({notch:{x:NX,y:20},row:{x:NX,y:180}}[name])||{x:NX,y:150};
 const point=(t,name)=>({t,...(Array.isArray(name)?{x:name[0],y:name[1]}:target(name))});
 const path=[point(0,[NX+12,24]),point(2.45,[NX+12,24]),point(2.96,'tab-music'),point(3.3,'tab-music'),...(AD_TRACK?[point(3.68,'music-toggle'),point(4.31,'music-toggle'),point(4.58,'bars'),point(5.04,'bars')]:[point(4.23,'bars'),point(4.95,'bars')]),point(6.05,'finder-brief'),point(6.29,'finder-brief'),point(7.05,[NX+12,24]),point(7.2,[NX+12,24]),point(7.64,'tray-brief'),point(8.18,'tray-brief'),point(8.76,'tab-clipboard'),point(9.16,'tab-clipboard'),point(10.01,'clip-hex'),point(10.35,'clip-hex'),point(11.02,[NX+80,320]),point(11.65,[NX+70,490])];
 const cursorAt=t=>{let x=keys(path,t,'x'),y=keys(path,t,'y');if(t>6.29&&t<K.over)x+=24*Math.sin(Math.PI*clamp((t-6.29)/(K.over-6.29)));return{x,y};};
 const cur=cursorAt(T);const clicks=[K.music,...(AD_TRACK?[K.pause,K.play]:[]),K.pick,K.drop,K.clip,K.copy];
 const press=clicks.reduce((v,t)=>Math.max(v,T>=t&&T<t+.22?Math.sin(Math.PI*(T-t)/.22):0),0);
 const drag=T>=K.pick&&T<K.drop+.24;
 let si=SEGMENTS.findLastIndex(s=>T>=s.t);const seg=SEGMENTS[si],prev=SEGMENTS[Math.max(0,si-1)];
 const morphDur=seg.f==='list'?.44:OPEN_FACES.has(seg.f)?.32:.26;
 const p=progress(T,seg.t,morphDur),a=dims[prev.f],b=dims[seg.f];
 const shell={w:mix(a.w,b.w,p),h:mix(a.h,b.h,p),l:mix(a.l,b.l,p)};
 // Clipboard shares one list through the reorder instead of crossfading two copies.
 const copying=seg.f==='clipAfter';
 const incoming=progress(T,seg.t+.04,.24),outgoing=1-progress(T,seg.t,.12);
 const faceOpacity=name=>si===0?(name===seg.f?1:0):copying?(name==='clipAfter'?1:0):name===seg.f?(seg.f==='void'?0:incoming):name===prev.f?outgoing:0;
 const z=keys(CAMERA,T,'z'),cx=keys(CAMERA,T,'x'),top=keys(CAMERA,T,'y');
 const veil=progress(T,K.veil,.55);
 const focus=1-progress(T,5.05,.4)+progress(T,6.8,.5)*(1-progress(T,11.5,.4));
 const pointerOpacity=(1-progress(T,11.45,.35));
 const sheen=(T>=K.ask&&T<K.ask+.9)?Math.sin(Math.PI*(T-K.ask)/.9)*.6:0;
 window.__frame={T,face:seg.f,shell:{x:540+(NX-NL.NOTCH_W/2-shell.l-cx)*z,y:top,w:shell.w*z,h:shell.h*z},cursor:{x:540+(cur.x-cx)*z,y:top+cur.y*z},target:cur};
 return <div ref={root} style={{width:W,height:H,position:'relative',overflow:'hidden',background:'#0c0b0a'}}>
   <div style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',transform:`translate(540px,${top}px) scale(${z}) translate(${-cx}px,0)`}}>
    <Display T={T} lifted={drag} focus={focus}>
     <div style={{position:'absolute',left:NX-NL.NOTCH_W/2-shell.l,top:0,width:shell.w,height:shell.h,borderRadius:`0 0 ${mix(OPEN_FACES.has(prev.f)?26:15,OPEN_FACES.has(seg.f)?26:15,p)}px ${mix(OPEN_FACES.has(prev.f)?26:15,OPEN_FACES.has(seg.f)?26:15,p)}px`,background:'#000',boxShadow:`0 22px 48px -16px #000c,0 0 0 ${sheen}px #e0b04a`,overflow:'hidden'}}>
      {Object.entries(sceneFaces).map(([name,content])=>{const o=faceOpacity(name);const enter=name===seg.f&&OPEN_FACES.has(name)&&name!=='clipAfter'?(1-incoming)*7:0;return <div key={name} data-face={name} style={{position:'absolute',left:shell.l-dims[name].l,top:0,opacity:o,visibility:o>0?'visible':'hidden',transform:`translateY(${enter}px)`}}>{content}</div>})}
     </div>
     {drag&&(()=>{const settle=progress(T,K.drop,.24);const at=target('tray-brief');const lift=progress(T,K.pick,.22);const angle=T<K.over?-6*Math.sin(Math.PI*clamp((T-K.pick)/(K.over-K.pick))):0;return <div style={{position:'absolute',left:mix(cur.x+9,at.x-29,settle),top:mix(cur.y+10,at.y-31,settle),transform:`scale(${mix(.92,1.08,lift)*(1-.08*settle)}) rotate(${angle}deg)`,transformOrigin:'center',opacity:1,filter:'drop-shadow(0 10px 8px #0005)'}}><NLFileThumb kind="pdf"/></div>})()}
     {clicks.filter(t=>T>=t&&T<t+.42).map(t=>{const q=(T-t)/.42,r=mix(4,18,out(q)),at=cursorAt(t);return <div key={t} style={{position:'absolute',left:at.x-r,top:at.y-r,width:r*2,height:r*2,border:'1px solid #fff',borderRadius:'50%',opacity:.45*(1-q)}}/>})}
     <div style={{position:'absolute',left:cur.x-4,top:cur.y-3,opacity:pointerOpacity}}><Pointer press={drag?1:press}/></div>
    </Display>
   </div>
   <div style={{position:'absolute',left:0,right:0,bottom:0,height:410,background:'linear-gradient(transparent,#0c0b0a 90%)',pointerEvents:'none'}}/>
   <div style={{position:'absolute',left:80,right:80,top:200,display:'flex',alignItems:'center',gap:13,opacity:1-progress(T,K.veil,.5)}}><Logo size={34} color="#b4aaa0"/><span style={{font:`500 25px/1 ${NL.SANS}`,color:'#b4aaa0'}}>Notchlight</span></div>
   {TITLES.map(title=>{const pin=progress(T,title.s,.32);const pout=progress(T,title.e-.18,.18);return <div key={title.s} style={{position:'absolute',left:80,right:80,top:293,opacity:pin*(1-pout),transform:`translateY(${(1-pin)*16-pout*8}px)`,font:`500 68px/1.08 ${NL.SANS}`,letterSpacing:'-.032em',color:NL.C.text}}>{title.lines.map(line=><div key={line}>{line}</div>)}</div>})}
   <div style={{position:'absolute',inset:0,background:'#0c0b0a',opacity:veil}}/>
   <EndCard T={T}/>
 </div>
}
function EndCard({T}){
 const p=progress(T,12.04,.45),word=progress(T,K.word,.4),tag=progress(T,12.65,.35);
 return <div style={{position:'absolute',inset:0,pointerEvents:'none',opacity:p}}>
  <div style={{position:'absolute',top:640,left:0,right:0,display:'flex',justifyContent:'center',opacity:word,transform:`translateY(${(1-word)*20}px)`}}><Logo size={170}/></div>
  <div style={{position:'absolute',top:845,left:0,right:0,textAlign:'center',font:`600 108px/1.1 ${NL.SANS}`,letterSpacing:'-.04em',color:NL.C.text,opacity:word,transform:`translateY(${(1-word)*20}px)`}}>Notchlight</div>
  <div style={{position:'absolute',top:1008,left:90,right:90,textAlign:'center',font:`400 37px/1.4 ${NL.SANS}`,color:'#b4aaa0',opacity:tag}}>Your notch, a little more useful.</div>
  <div style={{position:'absolute',top:1130,left:90,right:90,display:'flex',justifyContent:'center',gap:20,color:'#a69c93',font:`400 23px/1.5 ${NL.SANS}`,opacity:tag}}>{['Agents','Music','Tray','Clipboard'].map((s,i)=><React.Fragment key={s}>{i>0&&<span style={{color:'#544b43'}}>·</span>}<span>{s}</span></React.Fragment>)}</div>
  <div style={{position:'absolute',top:1390,left:0,right:0,textAlign:'center',color:'#8a817a',font:`400 22px/1.5 ${NL.SANS}`,opacity:tag}}>Made for your Mac.</div>
 </div>
}
function Player(){
 const renderMode=new URLSearchParams(location.search).has('render');
 const [T,setT]=React.useState(0),[playing,setPlaying]=React.useState(false),[size,setSize]=React.useState({w:innerWidth,h:innerHeight});
 React.useLayoutEffect(()=>{window.seek=t=>flushSync(()=>setT(clamp(t,0,DURATION)));window.__ready=true;const resize=()=>setSize({w:innerWidth,h:innerHeight});addEventListener('resize',resize);return()=>removeEventListener('resize',resize);},[]);
 React.useEffect(()=>{if(!playing)return;let raf,zero=performance.now()-T*1000;const run=now=>{const t=(now-zero)/1000;if(t>=DURATION){setT(DURATION);setPlaying(false);return}setT(t);raf=requestAnimationFrame(run)};raf=requestAnimationFrame(run);return()=>cancelAnimationFrame(raf);},[playing]);
 React.useEffect(()=>{const key=e=>{if(e.target.tagName==='INPUT')return;if(e.code==='Space'){e.preventDefault();setPlaying(v=>!v)}if(e.code==='ArrowRight')setT(v=>Math.min(DURATION,v+1));if(e.code==='ArrowLeft')setT(v=>Math.max(0,v-1));};addEventListener('keydown',key);return()=>removeEventListener('keydown',key)},[]);
 const scale=renderMode?1:Math.min(size.w/W,(size.h-80)/H);
 return <><div style={{position:'absolute',left:'50%',top:renderMode?0:16,width:W,height:H,transform:`translateX(-50%) scale(${scale})`,transformOrigin:'top center'}}><Film T={T}/></div>{!renderMode&&<div id="controls"><button aria-label={playing?'Pause':'Play'} onClick={()=>{if(T>=DURATION)setT(0);setPlaying(!playing)}}>{playing?'Pause':'Play'}</button><input aria-label="Timeline" type="range" min="0" max={DURATION} step="0.01" value={T} onChange={e=>{setPlaying(false);setT(+e.target.value)}}/><output>{T.toFixed(1)} / 15s</output><button onClick={()=>{setPlaying(false);setT(0)}}>Restart</button></div>}</>
}
createRoot(document.getElementById('root')).render(<Player/>);
