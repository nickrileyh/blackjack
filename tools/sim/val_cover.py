# Checks the app's cover-play numbers against the simulator playing the same spread both ways from the same cards.
import json, subprocess, sys, concurrent.futures as cf
B1=[0,0,25,25,25,50,100,150,200,300]; S1=[1]*10
B2=[0,0,0,25,25,50,100,150,200,300]; S2=[1,1,1,1,1,1,2,2,2,2]
B3=[10,10,10,10,20,40,60,80,100,120]
NR=int(sys.argv[1]) if len(sys.argv)>1 else 150_000_000
# (label, decks,h17,sur, others, pen, bets, spots, COVER env, cover object, RULES env, extra rules)
C=[]
def add(lab,cfg,bets,spots,env,cov,rules_env=None,rules=None): C.append((lab,)+cfg+(bets,spots,env,cov,rules_env,rules or {}))
A=(6,1,1,2,0.75)
add('A no count plays',A,B1,S1,'nodev',{'skip_all_deviations':True})
add('A skip 16v10+12v3',A,B1,S1,'dev:0:1;dev:12:1',{'deviations':[{'play':'16v10'},{'play':'12v3'}]})
add('A always split 10s v4-6',A,B1,S1,'dev:5:2;dev:6:2;dev:7:2',{'deviations':[{'play':'TTv4','mode':'always_high'},{'play':'TTv5','mode':'always_high'},{'play':'TTv6','mode':'always_high'}]})
add('A insure always',A,B1,S1,'ins:1',{'insurance':'always'})
add('A even money always',A,B1,S1,'ins:7',{'insurance':'even_money_always'})
add('A no soft doubles',A,B1,S1,'flag:1',{'habits':['no_soft_doubles']})
add('A stand 15/16',A,B1,S1,'flag:3',{'habits':['stand_15_16']})
add('A no splits',A,B1,S1,'flag:4',{'habits':['no_splits']})
add('A slips 5%',A,B1,S1,'slip:1',{'slip_rate_pct':5})
add('A full-deck TC',A,B1,S1,'tcm:1',{'count_method':'full_deck'})
add('A exact TC',A,B1,S1,'tcm:2',{'count_method':'exact'})
add('A floor TC',A,B1,S1,'tcm:3',{'count_method':'floor'})
add('A miss 2%',A,B1,S1,'miss:1',{'missed_cards_pct':2})
add('A miss 5%',A,B1,S1,'miss:2',{'missed_cards_pct':5})
add('A combo nodev+ins always+no soft dbl',A,B1,S1,'nodev;ins:1;flag:1',{'skip_all_deviations':True,'insurance':'always','habits':['no_soft_doubles']})
Bc=(6,0,0,4,0.80)
add('B no count plays (sit out, 2 hands high)',Bc,B2,S2,'nodev',{'skip_all_deviations':True})
add('B slips 5%',Bc,B2,S2,'slip:1',{'slip_rate_pct':5})
add('B miss 5%',Bc,B2,S2,'miss:2',{'missed_cards_pct':5})
add('B full-deck TC',Bc,B2,S2,'tcm:1',{'count_method':'full_deck'})
add('B no splits',Bc,B2,S2,'flag:4',{'habits':['no_splits']})
Cc=(2,1,0,1,0.65)
add('C 2D no count plays',Cc,B3,S1,'nodev',{'skip_all_deviations':True})
add('C 2D insure always',Cc,B3,S1,'ins:1',{'insurance':'always'})
add('C 2D slips',Cc,B3,S1,'slip:1',{'slip_rate_pct':5})
add('C 2D full-deck TC',Cc,B3,S1,'tcm:1',{'count_method':'full_deck'})
add('C 2D miss 5%',Cc,B3,S1,'miss:2',{'missed_cards_pct':5})
Dc=(8,0,1,0,0.75)
add('D 8D heads-up no count plays',Dc,B3,S1,'nodev',{'skip_all_deviations':True})
add('D 8D heads-up stand 16',Dc,B3,S1,'flag:2',{'habits':['stand_16']})
add('D 8D heads-up miss 5%',Dc,B3,S1,'miss:2',{'missed_cards_pct':5})
Ec=(1,1,0,2,0.50)
add('E 1D no count plays',Ec,B3,S1,'nodev',{'skip_all_deviations':True})
add('E 1D slips',Ec,B3,S1,'slip:1',{'slip_rate_pct':5})
add('F noDAS D9-11: no count plays + no soft dbl',A,B1,S1,'nodev;flag:1',{'skip_all_deviations':True,'habits':['no_soft_doubles']},'0,1,0,4,1.5',{'double_after_split':False,'double_on':'9-11'})
import os
if os.environ.get('ONLY')=='grid':
    C=[]; GC=tuple(int(x) for x in os.environ.get('GC','6,0,0').split(','))
    for t in os.environ.get('GRID','0:0.75,2:0.6,2:0.75,2:0.85,4:0.75,6:0.75').split(','):
        oth=int(t.split(':')[0]); pen=float(t.split(':')[1])
        for env,cov,lab in (('nodev',{'skip_all_deviations':True},'no count plays'),('ins:1',{'insurance':'always'},'insure always'),('flag:3',{'habits':['stand_15_16']},'stand 15/16'),('slip:1',{'slip_rate_pct':5},'slips')):
            add(f'{GC} oth{oth} pen{pen} {lab}',GC+(oth,pen),B3 if oth==0 else B1,S1,env,cov)
if os.environ.get('ONLY')=='play': C=[c for c in C if not any(t in c[8] for t in ('tcm','miss'))]
if os.environ.get('ONLY')=='v1': C=[c for c in C if c[0].startswith('F ') or (c[0].startswith('A ') and any(t in c[8] for t in ('tcm','miss')))]
if os.environ.get('ONLY')=='count': C=[c for c in C if any(t in c[8] for t in ('tcm','miss'))]
def model(c):
    lab,d,h,s,oth,pen,bets,spots,env,cov,renv,rules=c
    sc={'rules':{**dict(decks=d,h17=bool(h),surrender=bool(s),penetration=round(pen*100),insurance=True,blackjack_pays='3:2',double_after_split=True,double_on='any',resplit_aces=False,split_to_hands=4),**rules},'players_at_table':oth+1,'replace_bets':True,'bets':{str(i-3):bets[i] for i in range(10)},'hands':{str(i-3):spots[i] for i in range(10)},'rounds_per_hour':100}
    return [sc,{**sc,'cover':cov}]
def sim(c):
    lab,d,h,s,oth,pen,bets,spots,env,cov,renv,rules=c
    e={'COVER':env}; 
    if renv: e['RULES']=renv
    o=json.loads(subprocess.check_output(['/home/claude/sim3/sim4v','sdelta',str(d),str(h),str(s),str(oth),str(NR),'31',str(pen),','.join(map(str,bets)),','.join(map(str,spots))],env=e))
    return o
js="""const store={};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.window={storage:{get:async()=>{throw 0},set:async()=>{}},addEventListener(){},dispatchEvent(){}};global.document={addEventListener(){}};global.atob=(s)=>Buffer.from(s,'base64').toString('binary');
const A=require(process.env.AI||'/home/claude/cmp/aitools.cjs');(async()=>{const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));const out=[];for(const sc of cases){const r=await A.runTool('calculate',{scenarios:sc});out.push([r.results[0].win_per_100_rounds/100,r.results[1].win_per_100_rounds/100,r.results[0].swing_per_hour_1sd/10,r.results[1].swing_per_hour_1sd/10,(r.results[1].notes||[]).join(' ')]);}console.log(JSON.stringify(out));})();"""
m=json.loads(subprocess.run(['node','-e',js],input=json.dumps([model(c) for c in C]).encode(),capture_output=True,check=True).stdout)
with cf.ThreadPoolExecutor(2) as ex: sims=list(ex.map(sim,C))
bad=0
for c,mm,o in zip(C,m,sims):
    dm=mm[1]-mm[0]; z=(dm-o['d'])/o['se'] if o['se']>0 else 0
    rel=(dm-o['d'])/abs(o['base']) if o['base'] else 0
    flag='' if abs(z)<3 or abs(rel)<0.01 else '  <-- check'
    if flag: bad+=1
    print(f"{c[0][:44]:44s} base sim {o['base']:+.4f} mdl {mm[0]:+.4f} | change sim {o['d']:+.4f}±{o['se']:.4f} mdl {dm:+.4f}  z={z:+.1f} err/base {100*rel:+.1f}% | sd sim {o['sdb']:.1f}->{o['sdv']:.1f} mdl {mm[2]:.1f}->{mm[3]:.1f}{flag} {mm[4][:60]}",flush=True)
print('flagged',bad,'of',len(C))
