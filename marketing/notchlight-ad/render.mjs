import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
const dir=path.dirname(fileURLToPath(import.meta.url));
let require=createRequire(import.meta.url),pw;
try{pw=require('playwright')}catch{pw=createRequire(process.env.NOTCHLIGHT_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright')}
const ff=process.env.FFMPEG||execFileSync(path.join(dir,'.venv/bin/python'),['-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8'}).trim();
const review=process.argv.includes('--review'),fps=60,total=36*fps;
await fs.mkdir(path.join(dir,'review'),{recursive:true});await fs.mkdir(path.join(dir,'exports'),{recursive:true});
const browser=await pw.chromium.launch({headless:true});
const failures=[];
async function page(){const p=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});p.on('pageerror',e=>failures.push(e.message));await p.goto('http://127.0.0.1:4177/?render=1');await p.waitForFunction(()=>window.__ready&&window.__measurements);for(let k=0;k<6;k++){const bad=await p.evaluate(()=>[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>{const u=i.src.split('?')[0];i.src=u+'?retry='+Math.random().toString(36).slice(2);return u}));if(k&&bad.length)console.log('retrying images:',bad.join(', '));await p.waitForFunction(()=>[...document.images].every(i=>i.complete),null,{timeout:20000});if(!bad.length)break;await new Promise(r=>setTimeout(r,300));}
 const missing=await p.evaluate(()=>[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src));if(missing.length)throw new Error('images never loaded: '+missing.join(', '));
 await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));return p}
if(review){
 const p=await page();const times=[0,1.8,3.5,5.5,7.7,9.7,12.5,13.8,15.95,18.8,20.5,21.75,22.7,25,26.9,28,30,33.5,35.9];const report=[];
 for(const t of times){await p.evaluate(t=>window.seek(t),t);await p.screenshot({path:path.join(dir,'review',`frame-${t.toFixed(2)}.jpg`),type:'jpeg',quality:90});report.push(await p.evaluate(()=>window.__frame));}
 await fs.writeFile(path.join(dir,'review/frames.json'),JSON.stringify({failures,measurements:await p.evaluate(()=>window.__measurements),frames:report},null,2));
 console.log(JSON.stringify({failures,frames:report.length}));
}else{
 const workers=4,count=total/workers;
 await Promise.all(Array.from({length:workers},async(_,i)=>{
  const p=await page(),out=path.join(dir,'exports',`part-${i}.mp4`);
  const proc=spawn(ff,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-vf','scale=out_color_matrix=bt709:out_range=tv','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-threads','2',out],{stdio:['pipe','ignore','pipe']});
  let stderr='';proc.stderr.on('data',b=>stderr+=b);const done=once(proc,'close');
  for(let n=0;n<count;n++){await p.evaluate(t=>window.seek(t),(i*count+n)/fps);const png=await p.screenshot({type:'png'});if(!proc.stdin.write(png))await once(proc.stdin,'drain');if(n%120===0)console.log(`Render ${i+1}/4: ${Math.round(n/count*100)}%`);}
  proc.stdin.end();const [code]=await done;if(code)throw new Error(stderr);await p.close();
 }));
 if(failures.length)throw new Error(failures.join('\n'));
 const list=path.join(dir,'exports/concat.txt');await fs.writeFile(list,Array.from({length:4},(_,i)=>`file 'part-${i}.mp4'`).join('\n'));
 execFileSync(ff,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',path.join(dir,'exports/Notchlight-Silent-36s.mp4')]);
 console.log('Finished 36-second 1080 × 1920 / 60 fps silent master.');
}
await browser.close();
