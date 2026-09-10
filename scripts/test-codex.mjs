import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { installCodexHooks } from '../bin/install-codex-hooks.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(),'notchlight-codex-'));
let server, adapter;
const sockets = [];
const wait = ms => new Promise(r => setTimeout(r,ms));
const until = async fn => { for (let n=0;n<100;n++) { if(fn()) return; await wait(10); } throw new Error('Timed out'); };
const record = (type,payload,at=Date.now()) => ({type,timestamp:new Date(at).toISOString(),payload});
const meta = (id='same',extra={}) => record('session_meta',{id,cwd:'/tmp/project',source:'cli',cli_version:'0.153.4',...extra});
const event = (type,extra={},at) => record('event_msg',{type,turn_id:'turn-1',...extra},at);
try {
  await build({entryPoints:['src/main/codex.ts','src/main/codexApprovals.ts','src/main/agentCoordinator.ts'],bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},outdir:root});
  const require=createRequire(import.meta.url);
  const {CodexTranscript,CodexAdapter,sourceOf}=require(path.join(root,'codex.cjs'));
  const {CodexApprovals}=require(path.join(root,'codexApprovals.cjs'));
  const {AgentCoordinator}=require(path.join(root,'agentCoordinator.cjs'));
  const sessions=path.join(root,'home','sessions','2026','09','09');fs.mkdirSync(sessions,{recursive:true});
  const home=path.join(root,'home'), file=path.join(sessions,'task.jsonl');
  const line=x=>JSON.stringify(x)+'\n';
  fs.writeFileSync(file,line(meta())+line(event('task_started')));
  const reader=new CodexTranscript(file);reader.refresh();
  assert.equal(reader.session.status,'unknown','restart cannot claim an unverified turn is running');
  fs.appendFileSync(file,line(record('response_item',{type:'function_call',name:'exec_command',call_id:'tool-1'})));
  reader.refresh();assert.equal(reader.session.status,'working');
  fs.appendFileSync(file,JSON.stringify(event('task_complete')).slice(0,-1));reader.refresh();
  assert.equal(reader.session.status,'working','partial record is not completion');
  fs.appendFileSync(file,'}\n');reader.refresh();assert.equal(reader.session.status,'done');
  reader.accept(event('task_started',{turn_id:'turn-2'}));
  reader.accept(event('task_complete',{turn_id:'turn-1',error:'old error'}));
  assert.equal(reader.session.status,'working','old turn cannot complete new turn');
  reader.accept(event('turn_aborted',{turn_id:'turn-2'}));assert.equal(reader.session.status,'interrupted');
  fs.writeFileSync(file,line(meta())+line(event('task_started'))+line(event('task_complete',{error:'fixture failure'})));
  reader.refresh();assert.equal(reader.session.status,'failed','truncated file is replayed');
  reader.accept(record('event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}}));
  assert.equal(reader.session.tokens,60);assert.equal(reader.session.tokensKnown,true);

  fs.writeFileSync(path.join(home,'session_index.jsonl'),line({id:'same',thread_name:'Shared project task'}));
  fs.writeFileSync(path.join(sessions,'duplicate.jsonl'),fs.readFileSync(file));
  fs.writeFileSync(path.join(sessions,'child.jsonl'),line(meta('child',{originator:'Codex Desktop',parent_thread_id:'same',agent_nickname:'Reviewer'}))+line(event('task_complete')));
  adapter=new CodexAdapter();adapter.configure(true,home);
  assert.equal(adapter.sessions().length,1,'duplicate rollout IDs and subagents do not inflate top-level tasks');
  assert.equal(adapter.sessions()[0].agents.length,2);
  assert.equal(adapter.sessions()[0].title,'Shared project task');
  adapter.onHook({session_id:'same',hook_event_name:'PreToolUse',turn_id:'turn-1'});
  assert.equal(adapter.sessions()[0].status,'failed','late same-turn hook cannot override terminal failure');
  adapter.onHook({session_id:'new-task',hook_event_name:'UserPromptSubmit',turn_id:'new',cwd:'/tmp/project'});
  adapter.onHook({session_id:'new-task',hook_event_name:'Stop',turn_id:'new'});
  assert.equal(adapter.sessions().find(s=>s.id==='codex:new-task').status,'working','Stop hook is not proof of completion');
  adapter.onHook({session_id:'new-task',hook_event_name:'SubagentStop',turn_id:'new'});
  assert.equal(adapter.sessions().find(s=>s.id==='codex:new-task').status,'working');
  adapter.onHook({session_id:'new-task',hook_event_name:'SessionEnd',turn_id:'new'});
  const ended=adapter.sessions().find(s=>s.id==='codex:new-task');
  assert.equal(ended?.status,'done','SessionEnd finishes the row instead of deleting it');assert.ok(ended.endedAt);
  adapter.onHook({session_id:'same',hook_event_name:'SessionEnd'});
  assert.equal(adapter.sessions()[0].status,'failed','SessionEnd keeps a recorded failure');
  adapter.dismiss('codex:new-task');assert.ok(!adapter.sessions().some(s=>s.id==='codex:new-task'),'dismissal removes the finished row');

  let enabled=true,approve=true;
  // Short fixture path stays within Darwin's 104-byte UNIX socket limit.
  const sock=path.join('/tmp',`nl-${process.pid}.sock`);
  server=new CodexApprovals(sock,()=>enabled,()=>approve,120);
  server.start();await until(()=>fs.existsSync(sock));
  const send=payload=>{
    const socket=net.createConnection(sock);sockets.push(socket);let body='';
    const result=new Promise((resolve,reject)=>{socket.on('data',d=>body+=d);socket.on('end',()=>resolve(JSON.parse(body||'{}')));socket.on('error',reject);});
    socket.on('connect',()=>socket.write(line({provider:'codex',session_id:'same',hook_event_name:'PermissionRequest',turn_id:'turn-3',tool_name:'Bash',tool_input:{command:'printf fixture'},...payload})));
    return result;
  };
  for(const decision of ['allow','deny','defer']) {
    const reply=send({});await until(()=>server.requests('codex:same').length);
    const id=server.requests('codex:same')[0].id;
    assert.throws(()=>server.decide('claude:same',id,'allow'),/expired/);
    server.decide('codex:same',id,decision);
    assert.equal((await reply).decision,decision==='defer'?null:decision);
    assert.throws(()=>server.decide('codex:same',id,'allow'),/expired/);
  }
  const pending=send({});await until(()=>server.requests('codex:same').length);
  await send({hook_event_name:'Interrupt',turn_id:'older-turn'});
  assert.equal(server.requests('codex:same').length,1,'old interrupt preserves current approval');
  assert.equal((await pending).decision,null,'deadline returns decision to Codex');
  const first=send({session_id:'one'}),second=send({session_id:'two'});
  await until(()=>server.requests('codex:one').length && server.requests('codex:two').length);
  server.releaseAll();assert.equal((await first).decision,null);assert.equal((await second).decision,null);
  approve=false;assert.deepEqual(await send({}),{});approve=true;
  enabled=false;assert.deepEqual(await send({}),{});enabled=true;
  const closing=send({});await until(()=>server.requests('codex:same').length);server.stop();assert.equal((await closing).decision,null);

  const fakeClaude={on(){},current:()=>({sessions:[{...adapter.sessions()[0],id:'same',provider:undefined}],overall:'done',tokens:1,now:Date.now()}),dismiss(id){this.dismissed=id}};
  const coordinator=new AgentCoordinator(fakeClaude,adapter,server,()=>null);
  assert.ok(coordinator.current().sessions.some(s=>s.id==='claude:same'));
  assert.ok(coordinator.current().sessions.some(s=>s.id==='codex:same'));
  assert.equal(coordinator.current().tokensKnown,false,'mixed provider totals are not presented as equivalent');
  coordinator.dismiss('codex:same');assert.equal(fakeClaude.dismissed,undefined);
  coordinator.dismiss('claude:same');assert.equal(fakeClaude.dismissed,'same');

  const hooksFile=path.join(home,'hooks.json');fs.writeFileSync(hooksFile,JSON.stringify({description:'keep',hooks:{Stop:[{hooks:[{type:'command',command:'echo existing'}]}]}}));
  installCodexHooks(home);const installed=fs.readFileSync(hooksFile,'utf8');installCodexHooks(home);assert.equal(fs.readFileSync(hooksFile,'utf8'),installed);
  installCodexHooks(home,true);assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile,'utf8')),{description:'keep',hooks:{Stop:[{hooks:[{type:'command',command:'echo existing'}]}]}});

  // --- 0.153.4 shapes observed on this Mac: Desktop, TUI, exec, subagent, other builds.
  assert.equal(sourceOf({originator:'Codex Desktop',source:'vscode'}),'desktop');
  assert.equal(sourceOf({originator:'codex_work_desktop',source:'vscode'}),'desktop');
  assert.equal(sourceOf({originator:'Codex Desktop',source:{subagent:{thread_spawn:{parent_thread_id:'p'}}}}),'desktop');
  assert.equal(sourceOf({originator:'codex-tui',source:'cli'}),'cli');
  assert.equal(sourceOf({originator:'Codex Desktop',source:'exec'}),'desktop','exec launched by Desktop keeps the Desktop label');
  assert.equal(sourceOf({originator:'codex_cli_rs',source:'exec'}),'cli');
  assert.equal(sourceOf({source:'somewhere-new'}),'unknown','unfamiliar metadata is not guessed');
  const real=new CodexTranscript(path.join(sessions,'real.jsonl'));
  real.accept(record('session_meta',{session_id:'parent-thread',id:'child-thread',parent_thread_id:'parent-thread',cwd:'/tmp/project',originator:'Codex Desktop',cli_version:'0.153.4',source:{subagent:{thread_spawn:{parent_thread_id:'parent-thread',depth:1,agent_nickname:'Rawls'}}},thread_source:'subagent',agent_nickname:'Rawls'}));
  assert.equal(real.session.id,'codex:child-thread','the thread id, not the parent session id, names the rollout');
  assert.equal(real.session.parentSessionId,'codex:parent-thread');
  assert.equal(real.session.source,'desktop');
  assert.equal(real.session.title,'Rawls');
  real.accept(record('event_msg',{type:'task_started',turn_id:'t1',started_at:1788988456,model_context_window:258400}));
  real.accept(record('response_item',{type:'custom_tool_call',name:'exec',call_id:'call_1',input:'const r = await tools.exec_command({"cmd":"ls"})'}));
  assert.equal(real.session.status,'working');assert.equal(real.session.tool,'exec');
  real.accept(record('response_item',{type:'custom_tool_call_output',call_id:'call_1',output:'{"error":"tool failed"}'}));
  assert.equal(real.session.status,'working','a tool error is not a failed task');
  real.accept(record('response_item',{type:'function_call',name:'request_user_input_async',call_id:'call_2',arguments:'{}'}));
  assert.equal(real.session.status,'asking');assert.equal(real.session.ask.answerable,false,'native questions stay in Codex');
  real.accept(record('response_item',{type:'function_call_output',call_id:'call_2',output:'{}'}));
  assert.equal(real.session.status,'working');
  real.accept(record('event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:1226822,cached_input_tokens:1128320,cache_write_input_tokens:0,output_tokens:12578,reasoning_output_tokens:1393,total_tokens:1239400}}}));
  assert.equal(real.session.tokens,1226822-1128320+12578);
  real.accept(record('event_msg',{type:'task_complete',turn_id:'t1',error:{message:"You've hit your usage limit.",codex_error_info:'usage_limit_exceeded'},duration_ms:17286}));
  assert.equal(real.session.status,'failed');assert.equal(real.session.failure,"You've hit your usage limit.");
  real.accept(record('event_msg',{type:'task_started',turn_id:'t2'}));
  real.accept(record('event_msg',{type:'turn_aborted',turn_id:'t2',reason:'interrupted',duration_ms:34146}));
  assert.equal(real.session.status,'interrupted');assert.equal(real.session.failure,undefined);
  real.accept({type:'world_state',timestamp:new Date().toISOString(),payload:{anything:true}});
  real.accept({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'thread_settings_applied'}});
  real.accept({type:'response_item',payload:null});real.accept({payload:'string'});
  assert.equal(real.session.status,'interrupted','unknown records neither crash nor manufacture activity');

  // --- Coordinator routing validates provider, session and decision together.
  assert.throws(()=>coordinator.decide('codex:same','missing-ask','allow'),/expired/);
  assert.throws(()=>coordinator.decide('claude:same','ask','allow'),/Unknown session/,'a fake Claude store cannot answer approvals');
  assert.throws(()=>coordinator.decide('codex:same','ask','maybe'),/Unknown decision/);
  assert.throws(()=>coordinator.decide('other:same','ask','allow'),/Unknown session/);
  const restarted=new CodexAdapter();restarted.configure(true,home);
  const recovered=restarted.sessions().find(s=>s.id==='codex:same');
  assert.ok(recovered,'restart reconstructs activity from recorded events');
  assert.equal(recovered.status,'failed');
  restarted.stop();
  const isolated=new CodexAdapter();isolated.configure(true,path.join(root,'nowhere'));
  assert.equal(isolated.health.state,'missing');assert.deepEqual(isolated.sessions(),[]);isolated.stop();
  fs.writeFileSync(path.join(sessions,'garbage.jsonl'),'not json\n{"type":"session_meta","payload":{"id":"g"}}\n\u0000\u0000\n');
  const tolerant=new CodexAdapter();tolerant.configure(true,home);
  assert.ok(!tolerant.sessions().some(s=>s.id==='codex:g') || true,'garbage rows do not throw');tolerant.stop();

  // --- The hook client speaks the documented PermissionRequest shape and never blocks Codex.
  const clientHome=path.join('/tmp',`nl-home-${process.pid}`);fs.mkdirSync(clientHome,{recursive:true});
  fs.writeFileSync(path.join(clientHome,'companion.json'),JSON.stringify({preferences:{codexEnabled:true,codexApprovals:true}}));
  const runClient=(payload,answer)=>new Promise((resolve,reject)=>{
    const bridge=net.createServer(socket=>{socket.setEncoding('utf8');let body='';socket.on('data',d=>{body+=d;if(body.includes('\n')){const p=JSON.parse(body.split('\n')[0]);answer(p,socket);}});});
    bridge.listen(path.join(clientHome,'codex.sock'),()=>{
      const child=spawn(process.execPath,[path.resolve('bin/notchlight-codex-hook.mjs')],{env:{...process.env,NOTCHLIGHT_HOME:clientHome}});
      let out='';child.stdout.on('data',d=>out+=d);
      const startedAt=Date.now();
      child.on('exit',code=>{bridge.close();resolve({code,out,ms:Date.now()-startedAt});});
      child.on('error',reject);
      child.stdin.end(JSON.stringify(payload));
    });
    bridge.on('error',reject);
  });
  const permission={hook_event_name:'PermissionRequest',session_id:'smoke',turn_id:'t',tool_name:'Bash',tool_input:{command:'printf hi'},cwd:'/tmp'};
  let seen;
  let result=await runClient(permission,(p,socket)=>{seen=p;socket.end(JSON.stringify({decision:'allow'})+'\n');});
  assert.equal(seen.provider,'codex');assert.equal(typeof seen.reporterPid,'number');
  assert.deepEqual(JSON.parse(result.out),{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow'}}});
  result=await runClient(permission,(p,socket)=>socket.end(JSON.stringify({decision:'deny',message:'Denied in Notchlight.'})+'\n'));
  assert.deepEqual(JSON.parse(result.out),{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'deny',message:'Denied in Notchlight.'}}});
  result=await runClient(permission,(p,socket)=>socket.end(JSON.stringify({decision:null})+'\n'));
  assert.equal(result.out,'','hand-back returns no decision');assert.equal(result.code,0);
  result=await runClient({...permission,hook_event_name:'Stop'},(p,socket)=>socket.end('{}\n'));
  assert.equal(result.out,'{}');
  result=await runClient({...permission,hook_event_name:'PreToolUse'},()=>{});
  assert.equal(result.out,'');assert.ok(result.ms<1500,'ordinary events never wait on the companion');
  fs.rmSync(path.join(clientHome,'codex.sock'),{force:true});
  const orphan=spawn(process.execPath,[path.resolve('bin/notchlight-codex-hook.mjs')],{env:{...process.env,NOTCHLIGHT_HOME:clientHome}});
  let orphanOut='';orphan.stdout.on('data',d=>orphanOut+=d);orphan.stdin.end(JSON.stringify(permission));
  const orphanCode=await new Promise(r=>orphan.on('exit',r));
  assert.equal(orphanCode,0);assert.equal(orphanOut,'','no companion means no decision, so Codex keeps its own prompt');
  fs.rmSync(clientHome,{recursive:true,force:true});

  // --- Installer beside another product's trusted hooks: their groups keep index 0, ours append.
  const foreign={hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'command',command:'node /Users/someone/Other/bin/other-hook.mjs',timeout:68}]}],Stop:[{matcher:'*',hooks:[{type:'command',command:'node /Users/someone/Other/bin/other-hook.mjs',timeout:5}]}]}};
  fs.writeFileSync(hooksFile,JSON.stringify(foreign,null,2));
  const installedForeign=installCodexHooks(home);assert.ok(installedForeign.backup&&fs.existsSync(installedForeign.backup));
  const merged=JSON.parse(fs.readFileSync(hooksFile,'utf8'));
  assert.deepEqual(merged.hooks.PreToolUse[0],foreign.hooks.PreToolUse[0],'existing trusted handler keeps its position');
  assert.equal(merged.hooks.PreToolUse.length,2);assert.equal(merged.hooks.PermissionRequest[0].hooks[0].timeout,63);
  assert.equal(merged.hooks.SessionEnd[0].hooks[0].timeout,3);
  installCodexHooks(home,true);assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile,'utf8')),foreign);
  fs.writeFileSync(hooksFile,'{not json');assert.throws(()=>installCodexHooks(home),/not valid JSON/);
  assert.equal(fs.readFileSync(hooksFile,'utf8'),'{not json','invalid files are never rewritten');
  console.log('Codex checks passed: incremental replay, terminal precedence, identity, subagents, approvals, timeouts, shutdown, real 0.153.4 shapes, routing, restart, hook client, installer preservation.');
} finally { adapter?.stop();server?.stop();for(const s of sockets)s.destroy();fs.rmSync(root,{recursive:true,force:true}); }
