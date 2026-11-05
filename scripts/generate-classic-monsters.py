"""Confirmed plan queue. Respects account concurrency; resume without duplicating clips."""
import os,json,time,urllib.request,re,pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
OUT=ROOT/'generation-records';OUT.mkdir(exist_ok=True)
CHARS=[('Bull Fighter','88f0a8e6-a227-4ff3-af68-6d70d10fe862','heavy axe overhead strike'),('Hound','b45625d2-31b9-473e-bff4-95f39090aa44','quick claw slash'),('Lich','05f6621d-3a21-4b64-891f-ea07544ab4df','raise staff then thrust forward releasing violet magic'),('Giant','4b0feb8e-8958-4902-b1eb-749c3b15c4a3','heavy overhead club smash'),('Goblin','765a1ab1-0538-4101-9520-bae405d3cbd4','quick strike using the held weapon'),('Hunter','32411b98-4eb5-43cc-b8bd-c9b6ed3732bf','swing the held axe forward'),('Forest Monster','5d23b8c8-d1bd-4e0e-94a9-facecd8f23c9','slam branch arms forward'),('Agon','e517606d-a1ba-4e77-9da6-2ba5af387ad1','heavy forward fist slam'),('Ice Monster','5da2797c-f831-489c-ad9b-344b39cd74ea','strike forward with icy fist'),('Assassin','399d4689-9706-4f1f-9a48-bedddb261866','quick forward dagger slash'),('Yeti','b636b0c1-bf91-40ab-9ad8-f89feef13a08','swing both powerful arms forward'),('Elite Yeti','dfbd2cd2-035e-4d98-97f1-7b64305ff6fe','heavy two arm overhead slam')]
DIRS=['south','south-west','west','north-west','north','north-east','east','south-east']
CLIPS=[('idle','breathing-idle'),('walk','walking-6-frames'),('run','running-6-frames'),('attack',None),('hurt','taking-punch'),('death','falling-back-death')]
def call(name,args):
 p={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}
 req=urllib.request.Request(os.environ['PIXELLAB_API_URL']+'/mcp',data=json.dumps(p).encode(),headers={'Authorization':'Bearer '+os.environ['PIXELLAB_API_TOKEN'],'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
 with urllib.request.urlopen(req,timeout=180) as r:s=r.read().decode()
 d=json.loads(next(l[6:] for l in s.splitlines() if l.startswith('data: ')))
 if 'error' in d:raise RuntimeError(str(d['error']))
 return '\n'.join(c.get('text','') for c in d['result'].get('content',[]) if c.get('type')=='text')
def main():
 tasks=[]
 for name,cid,action in CHARS:
  text=call('get_character',{'character_id':cid,'include_preview':False});(OUT/(cid+'-initial.txt')).write_text(text)
  for clip,template in CLIPS:
   record=OUT/(cid+'-'+clip+'.json')
   if record.exists():info=json.loads(record.read_text())
   else:
    pattern=rf'^  {clip} .*?\[group: ([^\]]+)\]'
    found=re.search(pattern,text,re.M)
    info={'group':found.group(1) if found else None,'submitted':list(DIRS) if found else [],'jobs':[]}
   for direction in DIRS:
    if direction not in info['submitted']:tasks.append((name,cid,action,clip,template,direction,record,info))
 print('Pending direction tasks',len(tasks),flush=True)
 while tasks:
  t=tasks[0];name,cid,action,clip,template,direction,record,info=t
  args={'character_id':cid,'animation_name':clip,'directions':[direction]}
  if info['group']:args['animation_group_id']=info['group']
  if template:args.update(mode='template',template_animation_id=template)
  else:args.update(mode='v3',frame_count=8,keep_first_frame=False,action_description=f'{action}. Clearly prepare, strike midway, and recover to starting stance. Preserve identity and weapon.')
  try:result=call('animate_character',args)
  except Exception as e:print('Transport',e,flush=True);time.sleep(20);continue
  if 'error:' in result.lower():
   if 'slot' in result or '429' in result:
    print('Waiting for free slots',flush=True);call('wait_for_jobs',{'timeout_seconds':120,'min_finished':1});continue
   print('STOP',result,flush=True);(OUT/'queue-error.txt').write_text(result);return
  match=re.search(r'^group: (\S+)',result,re.M)
  if not match:print('Unrecognized receipt',result,flush=True);return
  info['group']=match.group(1);info['submitted'].append(direction);info['jobs'].append(result);record.write_text(json.dumps(info,indent=2))
  tasks.pop(0);print(name,clip,direction,'remaining',len(tasks),flush=True)
 while True:
  text=call('list_jobs',{});
  if 'no active' in text.lower() or 'no running' in text.lower() or '0 active' in text.lower():break
  print('Finishing',text[:120],flush=True)
  result=call('wait_for_jobs',{'timeout_seconds':240,'min_finished':10})
  if 'none' in result.lower() and 'running' in result.lower():break
  if 'no ' in result.lower() and 'jobs' in result.lower():break
 for name,cid,_ in CHARS:(OUT/(cid+'-final.txt')).write_text(call('get_character',{'character_id':cid,'include_preview':False}))
 print('DONE',flush=True)
if __name__=='__main__':main()
