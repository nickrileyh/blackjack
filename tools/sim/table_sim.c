// Blackjack card-counting Monte Carlo — BJA basic strategy + Illustrious 18 + Fab 4 (H17/S17), Hi-Lo,
// half-deck true count truncated toward zero, insurance at TC >= +3, DAS, split to 4, aces once, peek, 3:2.
// Modes:
//   cal   decks h17 sur others rounds seed            -> calibration tables (user on 2 spots every round)
//   val   decks h17 sur ins others pen rounds seed bets(10 csv) spots(10 csv) [blk]  -> EV/SD of a spread
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
typedef uint64_t u64;
static u64 S[4];
static inline u64 rotl(u64 x,int k){return (x<<k)|(x>>(64-k));}
static inline u64 rnext(void){u64 r=rotl(S[1]*5,7)*9,t=S[1]<<17;S[2]^=S[0];S[3]^=S[1];S[1]^=S[2];S[0]^=S[3];S[2]^=t;S[3]=rotl(S[3],45);return r;}
static inline uint32_t rbelow(uint32_t n){return (uint32_t)(((rnext()>>32)*(u64)n)>>32);}
static void seedrng(u64 x){for(int i=0;i<4;i++){x+=0x9E3779B97F4A7C15ULL;u64 z=x;z=(z^(z>>30))*0xBF58476D1CE4E5B9ULL;z=(z^(z>>27))*0x94D049BB133111EBULL;S[i]=z^(z>>31);}}

static int H17=1,SUR=0,INS=1,DECKS=6,NOTH=3;
// table rules (defaults = the base game): double after split, double on (0 any two, 1 = 9-11, 2 = 10-11),
// resplit aces, most hands after splitting, blackjack payout
static int DAS=1,DBL=0,RSA=0,MAXH=4; static double BJP=1.5;
static void rules_env(const char*v){ if(!v)return; int a,b,c,d; double e; if(sscanf(v,"%d,%d,%d,%d,%lf",&a,&b,&c,&d,&e)==5){DAS=a;DBL=b;RSA=c;MAXH=d;BJP=e;} }
static inline int dbl_ok(int tot,int soft){ if(DBL==0)return 1; if(soft)return 0; return DBL==1?(tot>=9&&tot<=11):(tot>=10&&tot<=11); }
#define MAXN 416
static int8_t shoe[MAXN]; static int N,pos,lim,rstart,cutpos,rc,force_shuffle; static int tagv[12];
static long g_midshuffles=0;
// ---- cover plays (all 0 = the normal game) ----
static int V_DEVID=-1,V_DEVMODE=0;   // one count play forced: 1 = always basic strategy, 2 = always the high-count play, 3 = always the low-count play
static int V_INS=0;                  // insurance: 0 at TC>=+3 · 1 always · 2 at >=+1 · 3 at >=+2 · 4 at >=+4 · 5 at >=+5 · 7 even money always · 8 always with 20 or blackjack
static int V_FLAG=0;                 // 1 no soft doubles · 2 stand 16 v 7+ · 3 stand 15/16 v 7+ · 4 no splits but A,A and 8,8 · 5 never hit soft 18 · 6 never hit a stiff (no-bust)
static int V_SLIP=0;                 // 1 = apply "close-call" slips (5% of close decisions)
static int V_TCM=0;                  // true count: 0 half-deck, truncated · 1 full-deck · 2 exact decks · 3 half-deck, floored
static int USEP=0;                   // 1/2 = the player decides on a count that misses 2% / 5% of cards
static double MISSP[2]={0.02,0.05}; static int rc_pv[2]; static int MISS_ON=0;
static u64 MR[2]={0x9E3779B97F4A7C15ULL,0xD1B54A32D192ED03ULL}; static u64 SR=0x2545F4914F6CDD1DULL;
static inline double xr(u64*s){u64 x=*s;x^=x<<13;x^=x>>7;x^=x<<17;*s=x;return (double)(x>>11)*(1.0/9007199254740992.0);}
static u64 f_base,f_above,f_below; static int f_flag,f_slip;
static int g_iace,g_itc,g_itot[2],g_dbj;
static void fy(int n){for(int i=n-1;i>0;i--){int j=rbelow(i+1);int8_t t=shoe[i];shoe[i]=shoe[j];shoe[j]=t;}}
static void shuffle(void){fy(N);pos=0;lim=N;rc=0;rc_pv[0]=rc_pv[1]=0;force_shuffle=0;rstart=0;}
static inline int draw(void){
 if(pos>=lim){ // shoe ran out mid-round: dealer reshuffles the discards (cards on the table stay out)
  if(rstart<=0){fprintf(stderr,"shoe exhausted with no discards\n");exit(2);}
  fy(rstart);lim=rstart;pos=0;rc=0;rc_pv[0]=rc_pv[1]=0;force_shuffle=1;g_midshuffles++;}
 return shoe[pos++];}
static inline void see(int c){rc+=tagv[c];if(MISS_ON){for(int i=0;i<2;i++)if(xr(&MR[i])>=MISSP[i])rc_pv[i]+=tagv[c];}}
static inline int tc_now(void){double rem=(double)(lim-pos)/52.0,r;int c=USEP?rc_pv[USEP-1]:rc;
 if(V_TCM==1){r=floor(rem+0.5);if(r<1)r=1;}else if(V_TCM==2){r=rem;if(r<0.25)r=0.25;}else{r=floor(rem*2.0+0.5)/2.0;if(r<0.5)r=0.5;}
 double t=(double)c/r;return V_TCM==3?(int)floor(t):V_TCM==4?(int)floor(t+0.5):(int)t;}

typedef struct{int8_t c[16];int n,hard,aces,tot,soft;double bet;int sa,fs,bj,sur,bust;}Hand;
static inline void hadd(Hand*h,int c){h->c[h->n++]=c;h->hard+=(c==11)?1:c;if(c==11)h->aces++;if(h->aces&&h->hard+10<=21){h->tot=h->hard+10;h->soft=1;}else{h->tot=h->hard;h->soft=0;}if(h->tot>21)h->bust=1;}
typedef struct{Hand h[4];int nh,user,nc;}Spot;

#define NIL 9999
typedef struct{int ok,idx,id,edge;char above,below;}Dev;
static Dev dev[2][12][256];
typedef struct{int up,key,s17,h17;char below,above;int ls;int edge;}DevDef;
// identical to the app's DEV_TABLE (key: hard total, 100+k for soft A-k, 200 for 10,10)
static DevDef defs[]={
{10,16,0,0,'H','S',0,1},{9,16,4,4,'H','S',0},{11,16,NIL,3,'H','S',0},{10,15,4,4,'H','S',0},{11,15,NIL,5,'H','S',0},
{4,200,6,6,'S','P',-1},{5,200,5,5,'S','P',-1},{6,200,4,4,'S','P',-1},
{10,10,4,4,'H','D',-1},{11,10,4,3,'H','D',-1},{11,11,1,NIL,'H','D',-1},
{2,12,3,3,'H','S',-1},{3,12,2,2,'H','S',-1},{4,12,0,0,'H','S',-1,-1},{2,13,0,0,'H','S',-1},
{2,9,1,1,'H','D',-1},{7,9,3,3,'H','D',-1},{6,8,2,2,'H','D',-1},
{4,108,3,3,'S','D',-1},{5,108,1,1,'S','D',-1},{6,108,1,0,'S','D',-1,-1},{2,106,1,1,'H','D',-1},{2,107,1,0,'S','D',-1,-1},
{8,16,4,4,'H','R',1},{9,16,-1,-1,'H','R',1},{9,15,2,2,'H','R',1},{10,15,0,0,'H','R',1,-1},{11,15,2,-1,'H','R',1}};
static void devinit(void){memset(dev,0,sizeof dev);{const char*e=getenv("A7V2");if(e){int a=NIL,b=0;sscanf(e,"%d,%d",&a,&b);defs[22].h17=a;defs[22].edge=b;}}int nd=sizeof defs/sizeof defs[0];for(int e=0;e<2;e++)for(int i=0;i<nd;i++){DevDef*d=&defs[i];int idx=H17?d->h17:d->s17;if(idx==NIL)continue;if(d->ls!=-1&&d->ls!=e)continue;Dev*v=&dev[e][d->up][d->key];v->ok=1;v->idx=idx;v->id=i;v->edge=(idx==0&&!getenv("NOEDGE"))?d->edge:0;v->above=d->above;v->below=d->below;}}

static char hardRule(int t,int u,int sur){
 if(t>=18)return 'S'; if(t==17)return(u==11&&H17&&sur)?'R':'S';
 if(t==16)return u<=6?'S':(sur&&u>=9?'R':'H');
 if(t==15)return u<=6?'S':(sur&&(u==10||(u==11&&H17))?'R':'H');
 if(t>=13)return u<=6?'S':'H'; if(t==12)return(u>=4&&u<=6)?'S':'H';
 if(t==11)return(u<=10||H17)?'D':'H'; if(t==10)return u<=9?'D':'H'; if(t==9)return(u>=3&&u<=6)?'D':'H'; return 'H';}
static char softRule(int k,int u){
 if(k==9)return 'S'; if(k==8)return(u==6&&H17)?'D':'S';
 if(k==7)return((u>=3&&u<=6)||(u==2&&H17))?'D':(u<=8?'S':'H');
 if(k==6)return(u>=3&&u<=6)?'D':'H'; if(k>=4)return(u>=4&&u<=6)?'D':'H'; return(u>=5&&u<=6)?'D':'H';}
static char pairRule(int c,int u,int sur){
 if(c==11)return 'P';
 if(!DAS){ if(c==2||c==3)return(u>=4&&u<=7)?'P':'H'; if(c==4)return 'H'; if(c==6)return(u>=3&&u<=6)?'P':'H'; } if(c==8)return(u==11&&H17&&sur)?'R':'P'; if(c==10)return 'S';
 if(c==9)return(u<=6||u==8||u==9)?'P':'S'; if(c==7)return u<=7?'P':'H'; if(c==6)return u<=6?'P':'H';
 if(c==5)return hardRule(10,u,sur); if(c==4)return(u==5||u==6)?'P':'H'; return u<=7?'P':'H';}
static int P_KEY=0,P_UP=0,P_FORCE=0,g_probe=0,g_ptc=0,g_prc=0;static char P_A='D',P_B='S';
static int AUD_REC=0,g_uk=0;static char F_ACT=0;static u64 a_seen=0;static int a_tc[64],a_rc[64];
static struct{int valid,kind,idx,up,legal;char bs;}a_cell;
static char decide(const Hand*h,int up,int tc,int canD,int canP,int canS,int usedev){
 if(P_KEY&&usedev&&up==P_UP&&h->n==2&&!(h->c[0]==h->c[1])&&canD&&((P_KEY>100&&h->soft&&h->tot==P_KEY-100+11)||(P_KEY<100&&!h->soft&&h->tot==P_KEY))){
  if(!g_probe){g_probe=1;g_ptc=tc;g_prc=rc;} if(P_FORCE)return P_FORCE==1?P_A:P_B;}
 int sur=canS&&SUR; int tot=h->tot,soft=h->soft; char base; int key=0;
 if(canP&&h->n==2&&h->c[0]==h->c[1]){base=pairRule(h->c[0],up,sur);key=(h->c[0]==10)?200:0;}
 else if(soft&&tot>=13&&tot<=20){base=softRule(tot-11,up);key=100+(tot-11);}
 else if(soft&&tot==21){base='S';}
 else if(soft&&tot==12){base=(canP&&h->n==2)?'P':'H';}
 else {base=hardRule(tot>21?21:tot,up,sur);key=tot;}
 char act=base;
 if(usedev&&key){const Dev*d=&dev[sur][up][key];if(d->ok){if(!(d->above=='P'&&!canP)){
   if(AUD_REC&&!(d->above=='D'&&!canD)&&!((a_seen>>d->id)&1)){a_seen|=1ULL<<d->id;a_tc[d->id]=tc;a_rc[d->id]=rc;}
   int over=tc>=d->idx; if(d->edge&&tc==0){int r=USEP?rc_pv[USEP-1]:rc;over=d->edge>0?r>0:r>=0;} // 0+ / 0-: the running count's sign decides
   char nrm=over?d->above:d->below; u64 bit=1ULL<<d->id;
   if(nrm!=base)f_base|=bit; if(!over)f_above|=bit;else f_below|=bit;
   act=(d->id==V_DEVID)?(V_DEVMODE==1?base:V_DEVMODE==2?d->above:d->below):nrm;}}}
 if(act=='D'&&!canD)act=(soft&&(tot==18||tot==19))?'S':'H';
 if(act=='P'&&!canP)act=hardRule(tot,up,sur);
 if(act=='R'&&!canS)act='H';
 if(usedev){ // cover plays and slips apply to the counter only
  if(act=='D'&&soft){f_flag|=1<<1;if(V_FLAG==1)act=tot>=18?'S':'H';}
  if(!soft&&tot==16&&up>=7&&act=='H'){f_flag|=1<<2;if(V_FLAG==2)act='S';}
  if(!soft&&(tot==15||tot==16)&&up>=7&&act=='H'){f_flag|=1<<3;if(V_FLAG==3)act='S';}
  if(act=='P'&&h->c[0]!=11&&h->c[0]!=8){f_flag|=1<<4;if(V_FLAG==4)return decide(h,up,tc,canD,0,canS,usedev);}
  if(soft&&tot==18&&act=='H'){f_flag|=1<<5;if(V_FLAG==5)act='S';}
  if(!soft&&tot>=12&&act=='H'){f_flag|=1<<6;if(V_FLAG==6)act='S';}
  if(act=='P'&&h->c[0]==8&&up>=9){f_flag|=1<<7;if(V_FLAG==7)return decide(h,up,tc,canD,0,canS,usedev);}
  if(act=='P'&&h->c[0]==9){f_flag|=1<<8;if(V_FLAG==8)act='S';}
  if(act=='D'&&!soft&&tot==9){f_flag|=1<<9;if(V_FLAG==9)act='H';}
  if(act=='D'&&!soft&&(tot==10||tot==11)&&up>=10){f_flag|=1<<10;if(V_FLAG==10)act='H';}
  if(act=='D'){f_flag|=1<<11;if(V_FLAG==11)act=(soft&&tot>=18)?'S':'H';}
  if(soft&&tot==17&&act!='S'){f_flag|=1<<12;if(V_FLAG==12)act='S';}
  {char mim=(tot<17||(tot==17&&soft&&H17))?'H':'S';if(act!=mim){f_flag|=1<<13;if(V_FLAG==13)return mim;}}
  // close-call slips: forget a double / split / surrender, swap hit and stand on a stiff or soft 18, double a 9-11 that should be hit
  char alt=0;
  if(act=='D')alt=(soft&&tot>=18)?'S':'H';
  else if(act=='P'&&h->c[0]!=11&&h->c[0]!=8)alt='N';
  else if(act=='R')alt='H';
  else if(!soft&&tot>=12&&tot<=16)alt=act=='H'?'S':'H';
  else if(soft&&tot==18)alt=act=='H'?'S':'H';
  else if(!soft&&tot>=9&&tot<=11&&act=='H'&&canD)alt='D';
  if(alt){double u=xr(&SR);if(u<0.05){f_slip=1;if(V_SLIP){if(alt=='N'){int sv=V_SLIP;V_SLIP=0;u64 ss=SR;char a=decide(h,up,tc,canD,0,canS,usedev);SR=ss;V_SLIP=sv;return a;}act=alt;}}}
 }
 return act;}

static int g_flat=0; // 1 = plain basic strategy, flat, no insurance (house-edge benchmark)
static inline int dealto(Spot*sp,Hand*h){int c=draw();see(c);hadd(h,c);sp->nc++;return c;}
// a split ace that catches another ace: split again when the table allows it (and there's room for another hand)
static void resplit_aces(Spot*sp,Hand*h){
 while(RSA&&h->n==2&&h->c[1]==11&&sp->nh<MAXH){
  Hand*nh=&sp->h[sp->nh++];memset(nh,0,sizeof(Hand));nh->bet=h->bet;nh->fs=1;nh->sa=1;hadd(nh,11);
  double bet=h->bet;memset(h,0,sizeof(Hand));h->bet=bet;h->fs=1;h->sa=1;hadd(h,11);dealto(sp,h);}}
static void play_spot(Spot*sp,int up){
 int user=sp->user;int uk=user?g_uk++:-1;
 for(int i=0;i<sp->nh;i++){
  Hand*h=&sp->h[i];
  if(h->n==1){dealto(sp,h);if(h->sa){resplit_aces(sp,h);continue;}}
  if(h->n==2&&h->tot==21&&!h->fs){h->bj=1;continue;}
  for(;;){
   if(h->tot>=21)break;
   int canD=(h->n==2)&&(DAS||!h->fs)&&dbl_ok(h->tot,h->soft);
   int canP=(h->n==2&&h->c[0]==h->c[1]&&sp->nh<MAXH&&!h->sa);
   int canS=(h->n==2&&!h->fs&&sp->nh==1);
   int tcl=user?tc_now():0;
   char act=decide(h,up,tcl,canD,canP,canS,user&&!g_flat);
   if(uk==0&&i==0&&h->n==2&&!h->fs){ // your first decision of the round
    if(AUD_REC){a_cell.valid=1;a_cell.up=up;a_cell.legal=1|2|(canD?4:0)|(canP?8:0)|((canS&&SUR)?16:0);a_cell.bs=decide(h,up,tcl,canD,canP,canS,0);
     if(h->c[0]==h->c[1]){a_cell.kind=2;a_cell.idx=h->c[0];}else if(h->soft){a_cell.kind=1;a_cell.idx=h->tot;}else{a_cell.kind=0;a_cell.idx=h->tot;}}
    if(F_ACT)act=F_ACT;}
   if(act=='S')break;
   if(act=='H'){dealto(sp,h);continue;}
   if(act=='D'){h->bet*=2;dealto(sp,h);break;}
   if(act=='R'){h->sur=1;break;}
   if(act=='P'){
    Hand*nh=&sp->h[sp->nh++];memset(nh,0,sizeof(Hand));nh->bet=h->bet;nh->fs=1;
    int c0=h->c[0],c1=h->c[1];
    h->n=0;h->hard=0;h->aces=0;h->bust=0;hadd(h,c0);hadd(nh,c1);h->fs=1;
    if(c0==11){h->sa=1;nh->sa=1;}
    dealto(sp,h);
    if(h->sa){resplit_aces(sp,h);break;}
    continue;}
  }
 }}

static inline int ins_take(int v,int t,int ht){switch(v){case 1:return 1;case 2:return t>=1;case 3:return t>=2;case 4:return t>=4;case 5:return t>=5;case 6:return 0;case 7:return t>=3||ht==21;case 8:return t>=3||ht>=20;default:return t>=3;}}
// One round. nu user spots (0,1,2), each betting 1 unit. Fills res[k] (main hand(s) incl. splits/doubles) and ins[k]
// (insurance result, 0 if not taken) for user spot k, ucards[k] cards dealt to that spot. Returns total cards drawn.
static int g_pos_draws;
static int play_round(int nu,double*res,double*ins,int*ucards){
 Spot sp[9];int ns=0;int nb=NOTH>0?1:0;int uidx[2];int nuu=0;
 #define ADDSPOT(u) {memset(&sp[ns],0,sizeof(Spot));sp[ns].nh=1;sp[ns].user=(u);sp[ns].h[0].bet=1;if(u)uidx[nuu++]=ns;ns++;}
 if(nu==0){for(int i=0;i<NOTH;i++)ADDSPOT(0);}
 else{for(int i=0;i<nb;i++)ADDSPOT(0);for(int i=0;i<nu;i++)ADDSPOT(1);for(int i=0;i<NOTH-nb;i++)ADDSPOT(0);}
 long d0=0; int pos0=pos,lim0=lim; (void)pos0;(void)lim0;
 int drawn=0;
 #define DR() (drawn++,draw())
 for(int s=0;s<ns;s++){int c=DR();see(c);hadd(&sp[s].h[0],c);sp[s].nc++;}
 int up=DR();see(up);
 for(int s=0;s<ns;s++){int c=DR();see(c);hadd(&sp[s].h[0],c);sp[s].nc++;}
 int hole=DR();
 for(int k=0;k<nu;k++){res[k]=0;ins[k]=0;}
 int tk[2]={0,0};g_iace=0;
 if(nu&&up==11&&INS&&!g_flat){int t=tc_now();g_iace=1;g_itc=t;for(int k=0;k<nu;k++){int ht=sp[uidx[k]].h[0].tot;g_itot[k]=ht;tk[k]=ins_take(V_INS,t,ht);}}
 int dbj=(up==10&&hole==11)||(up==11&&hole==10);g_dbj=dbj;
 if(dbj){
  see(hole);
  for(int k=0;k<nu;k++){Hand*h=&sp[uidx[k]].h[0];int nat=(h->n==2&&h->tot==21);res[k]=nat?0:-1;if(tk[k])ins[k]=1;ucards[k]=sp[uidx[k]].nc;}
  return drawn;}
 for(int k=0;k<nu;k++)if(tk[k])ins[k]=-0.5;
 int before=0;(void)before;(void)d0;
 // play spots; count cards drawn during play via global counter
 int p0draws=0;(void)p0draws;
 for(int s=0;s<ns;s++){int nc0=sp[s].nc;play_spot(&sp[s],up);drawn+=sp[s].nc-nc0;}
 see(hole);
 int live=0;for(int s=0;s<ns;s++)for(int i=0;i<sp[s].nh;i++){Hand*h=&sp[s].h[i];if(!h->bust&&!h->sur&&!h->bj)live=1;}
 Hand d;memset(&d,0,sizeof d);hadd(&d,up);hadd(&d,hole);
 if(live){while(d.tot<17||(d.tot==17&&d.soft&&H17)){int c=DR();see(c);hadd(&d,c);}}
 for(int k=0;k<nu;k++){Spot*s=&sp[uidx[k]];double r=0;
  for(int i=0;i<s->nh;i++){Hand*h=&s->h[i];
   if(h->sur)r+=-0.5*h->bet;else if(h->bust)r+=-h->bet;else if(h->bj)r+=BJP*h->bet;
   else if(d.tot>21)r+=h->bet;else if(h->tot>d.tot)r+=h->bet;else if(h->tot<d.tot)r+=-h->bet;}
  res[k]=r;ucards[k]=s->nc;}
 return drawn;}

static void initshoe(void){
 for(int v=2;v<=6;v++)tagv[v]=1;for(int v=7;v<=9;v++)tagv[v]=0;tagv[10]=-1;tagv[11]=-1;
 N=52*DECKS;{int k=0;for(int d=0;d<DECKS;d++)for(int s=0;s<4;s++){for(int r=2;r<=9;r++)shoe[k++]=r;for(int t=0;t<4;t++)shoe[k++]=10;shoe[k++]=11;}}
 shuffle();}
static inline int bucket(int tc){return tc<-3?0:(tc>6?9:tc+3);}

// ---------------- calibration ----------------
#define NP 9
static int run_cal(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);NOTH=atoi(argv[5]);long NR=atol(argv[6]);seedrng(atoll(argv[7]));INS=1;
 devinit();initshoe();
 int cuts[NP];for(int p=0;p<NP;p++)cuts[p]=(int)((0.50+0.05*p)*N);cutpos=cuts[NP-1];
 static double n[NP][10],se[NP][10],sm2[NP][10],sm2n[NP][10],sc12[NP][10],sc12n[NP][10],sins[NP][10],sk0[NP][10],sku[NP][10];
 static double surv[NP][10][10]; // [p][X+3][b]: rounds whose shoe-to-date minimum bucket (incl. this round) > X
 static double eflat[NP];static double bn[104][10],be[104][10];int NB=DECKS<=2?N:18;
 int mn=99;
 for(long r=0;r<NR;r++){
  if(pos>=cutpos||force_shuffle){shuffle();mn=99;}
  rstart=pos;int s0=pos;int fs0=0;(void)fs0;
  int b=bucket(tc_now());if(b<mn)mn=b;
  double res[2],ins[2];int uc[2];
  int k=play_round(2,res,ins,uc);
  double x1=res[0]+ins[0],x2=res[1]+ins[1];
  double y1=res[0],y2=res[1];
  for(int p=0;p<NP;p++){if(s0>=cuts[p])continue;
   n[p][b]+=1;se[p][b]+=0.5*(x1+x2);sm2[p][b]+=0.5*(x1*x1+x2*x2);sm2n[p][b]+=0.5*(y1*y1+y2*y2);sc12[p][b]+=x1*x2;sc12n[p][b]+=y1*y2;
   sins[p][b]+=0.5*(ins[0]+ins[1]);sk0[p][b]+=k-uc[0]-uc[1];sku[p][b]+=0.5*(uc[0]+uc[1]);
   for(int X=0;X<9;X++)if(mn>X)surv[p][X][b]+=1;}
  {int bin=DECKS<=2?s0:s0*20/N;if(bin<NB){bn[bin][b]+=1;be[bin][b]+=0.5*(x1+x2);}}
 }
 (void)eflat;
 printf("{\"decks\":%d,\"h17\":%d,\"sur\":%d,\"others\":%d,\"rounds\":%ld,\"mid\":%ld,\"pens\":{",DECKS,H17,SUR,NOTH,NR,g_midshuffles);
 for(int p=0;p<NP;p++){printf("%s\"%d\":{",p?",":"",50+5*p);
  const char*nm[]={"n","e","m2","m2n","c12","c12n","ins","k0","ku"};
  for(int q=0;q<9;q++){printf("%s\"%s\":[",q?",":"",nm[q]);for(int b=0;b<10;b++){double v,nn=n[p][b];
    switch(q){case 0:v=nn;break;case 1:v=nn?se[p][b]/nn:0;break;case 2:v=nn?sm2[p][b]/nn:0;break;case 3:v=nn?sm2n[p][b]/nn:0;break;case 4:v=nn?sc12[p][b]/nn:0;break;case 5:v=nn?sc12n[p][b]/nn:0;break;case 6:v=nn?sins[p][b]/nn:0;break;case 7:v=nn?sk0[p][b]/nn:0;break;default:v=nn?sku[p][b]/nn:0;}
    printf("%s%.9g",b?",":"",v);}printf("]");}
  printf(",\"surv\":[");for(int X=0;X<9;X++){printf("%s[",X?",":"");for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",surv[p][X][b]);printf("]");}printf("]}");}
 printf("},\"bins\":{\"n\":[");for(int i=0;i<NB;i++){printf("%s[",i?",":"");for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",bn[i][b]);printf("]");}
 printf("],\"se\":[");for(int i=0;i<NB;i++){printf("%s[",i?",":"");for(int b=0;b<10;b++)printf("%s%.3f",b?",":"",be[i][b]);printf("]");}
 printf("]}}\n");return 0;}

// ---------------- validation: play a given spread ----------------
static int cmpd(const void*a,const void*b){double x=*(double*)a,y=*(double*)b;return(x>y)-(x<y);}
static int run_val(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);INS=atoi(argv[5]);NOTH=atoi(argv[6]);double PEN=atof(argv[7]);long NR=atol(argv[8]);seedrng(atoll(argv[9]));
 double BET[10];int SP[10];{char*p=argv[10];for(int i=0;i<10;i++){BET[i]=strtod(p,&p);if(*p==',')p++;}}{char*p=argv[11];for(int i=0;i<10;i++){SP[i]=(int)strtol(p,&p,10);if(*p==',')p++;}}
 int BLK=argc>12?atoi(argv[12]):0; g_flat=getenv("FLAT")?1:0;
 {const char*c=getenv("COVER");if(c){char buf[400];strncpy(buf,c,399);buf[399]=0;for(char*t=strtok(buf,";");t;t=strtok(0,";")){int a,b;
   if(sscanf(t,"dev:%d:%d",&a,&b)==2){V_DEVID=a;V_DEVMODE=b;}else if(sscanf(t,"ins:%d",&a)==1)V_INS=a;else if(sscanf(t,"flag:%d",&a)==1)V_FLAG=a;
   else if(sscanf(t,"slip:%d",&a)==1)V_SLIP=a;else if(sscanf(t,"tcm:%d",&a)==1)V_TCM=a;else if(sscanf(t,"miss:%d",&a)==1){USEP=a;MISS_ON=1;}}}}
 devinit();initshoe();cutpos=(int)(PEN*N);
 int exitmode=(NOTH==0); // heads-up: a zero bet means you leave and start a fresh shoe
 if(exitmode&&BET[3]<=0){printf("{\"error\":\"heads-up exit at TC 0 never plays\"}\n");return 0;}
 double tn=0,tn2=0,act=0;long played=0,counted=0;
 static long nb[10];
 double*blk=BLK?malloc(sizeof(double)*(NR/BLK+2)):0,*bmin=BLK?malloc(sizeof(double)*(NR/BLK+2)):0,*bdd=BLK?malloc(sizeof(double)*(NR/BLK+2)):0;long nblk=0;double bs=0,bm=0,bpk=0,bdmax=0;int bk=0;
 // shoe-level aggregates for bankroll paths
 FILE*fo=getenv("SHOEOUT")?fopen(getenv("SHOEOUT"),"wb"):0;double sh_net=0,sh_min=0,sh_max=0;int sh_r=0;
 for(long r=0;counted<NR;r++){
  if(pos>=cutpos||force_shuffle){shuffle();if(fo&&sh_r){float rec[4]={(float)sh_net,(float)sh_min,(float)sh_max,(float)sh_r};fwrite(rec,4,4,fo);}sh_net=sh_min=sh_max=0;sh_r=0;}
  rstart=pos;int b=bucket(tc_now());double bet=BET[b];int nu=bet>0?SP[b]:0;
  if(nu==0&&exitmode){force_shuffle=1;continue;}
  double res[2],ins[2];int uc[2];play_round(nu,res,ins,uc);
  double net=0;for(int k=0;k<nu;k++)net+=bet*(res[k]+ins[k]);
  counted++;nb[b]++;if(nu){played++;act+=bet*nu;}
  tn+=net;tn2+=net*net;
  sh_net+=net;if(sh_net<sh_min)sh_min=sh_net;if(sh_net>sh_max)sh_max=sh_net;sh_r++;
  if(BLK){bs+=net;if(bs<bm)bm=bs;if(bs>bpk)bpk=bs;if(bpk-bs>bdmax)bdmax=bpk-bs;if(++bk==BLK){blk[nblk]=bs;bmin[nblk]=bm;bdd[nblk]=bdmax;nblk++;bs=0;bm=0;bk=0;bpk=0;bdmax=0;}}
 }
 double m=tn/counted,sd=sqrt(tn2/counted-m*m);
 printf("{\"ev\":%.6f,\"sd\":%.5f,\"se\":%.6f,\"played\":%.6f,\"act\":%.5f,\"rounds\":%ld,\"mid\":%ld,\"f\":[",m,sd,sd/sqrt((double)counted),(double)played/counted,act/counted,counted,g_midshuffles);
 for(int b=0;b<10;b++)printf("%s%.6f",b?",":"",(double)nb[b]/counted);printf("]");
 if(BLK){qsort(blk,nblk,8,cmpd);qsort(bmin,nblk,8,cmpd);printf(",\"blk\":%d,\"nblk\":%ld,\"q\":{",BLK,nblk);
  double qs[]={.005,.01,.025,.05,.1,.25,.5,.75,.9,.95};for(int i=0;i<10;i++)printf("%s\"%g\":%.1f",i?",":"",qs[i],blk[(long)(qs[i]*(nblk-1))]);
  printf("},\"qmin\":{");for(int i=0;i<10;i++)printf("%s\"%g\":%.1f",i?",":"",qs[i],bmin[(long)(qs[i]*(nblk-1))]);printf("}");
  long neg=0;for(long i=0;i<nblk;i++)if(blk[i]<0)neg++;printf(",\"pneg\":%.5f",(double)neg/nblk);qsort(bdd,nblk,8,cmpd);printf(",\"dd50\":%.1f,\"dd90\":%.1f",bdd[nblk/2],bdd[(long)(0.9*(nblk-1))]);}
 printf("}\n");if(fo)fclose(fo);return 0;}


// ---------------- frequencies for a pattern of hands (0 = sit out / leave heads-up, 1, 2) ----------------
static int run_freq(int argc,char**argv){
 DECKS=atoi(argv[2]);NOTH=atoi(argv[3]);long NR=atol(argv[4]);seedrng(atoll(argv[5]));const char*pat=argv[6];
 H17=getenv("FH17")?atoi(getenv("FH17")):1;SUR=getenv("FSUR")?atoi(getenv("FSUR")):0;INS=1;devinit();initshoe();
 int SP[10];for(int i=0;i<10;i++)SP[i]=pat[i]-'0';
 int cuts[NP];for(int p=0;p<NP;p++)cuts[p]=(int)((0.50+0.05*p)*N);cutpos=cuts[NP-1];
 int exitmode=(NOTH==0);static double n[NP][10],hh[NP][10],sx[NP][10],bh[104][10];long counted=0;int NB=DECKS<=2?N:18;
 if(exitmode&&SP[3]==0){printf("{\"decks\":%d,\"others\":0,\"pat\":\"%s\",\"rounds\":0,\"degenerate\":1,\"pens\":{",DECKS,pat);for(int p=0;p<NP;p++)printf("%s\"%d\":[0,0,0,0,0,0,0,0,0,0]",p?",":"",50+5*p);printf("}}\n");return 0;}
 while(counted<NR){
  if(pos>=cutpos||force_shuffle)shuffle();
  rstart=pos;int s0=pos;int b=bucket(tc_now());int nu=SP[b];
  if(nu==0&&exitmode){force_shuffle=1;continue;}
  double res[2],ins[2];int uc[2];play_round(nu,res,ins,uc);counted++;
  double xs=0;for(int k=0;k<nu;k++)xs+=res[k]+ins[k];
  for(int p=0;p<NP;p++)if(s0<cuts[p]){n[p][b]+=1;hh[p][b]+=nu;sx[p][b]+=xs;}
  {int bin=DECKS<=2?s0:s0*20/N;if(bin<NB)bh[bin][b]+=nu;}}
 printf("{\"decks\":%d,\"others\":%d,\"pat\":\"%s\",\"rounds\":%ld,\"pens\":{",DECKS,NOTH,pat,NR);
 for(int p=0;p<NP;p++){printf("%s\"%d\":[",p?",":"",50+5*p);for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",n[p][b]);printf("]");}
 printf("},\"edge\":{");for(int p=0;p<NP;p++){printf("%s\"%d\":[",p?",":"",50+5*p);for(int b=0;b<10;b++)printf("%s%.7f",b?",":"",hh[p][b]>0?sx[p][b]/hh[p][b]:0);printf("]");}
 printf("},\"hands\":{");for(int p=0;p<NP;p++){printf("%s\"%d\":[",p?",":"",50+5*p);for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",hh[p][b]);printf("]");}
 printf("},\"binh\":[");for(int i=0;i<NB;i++){printf("%s[",i?",":"");for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",bh[i][b]);printf("]");}
 printf("]}\n");return 0;}
// ---------------- rule deltas: every round is played twice from the same shoe — once with the variant rules,
// once with the base rules (which then advances the shoe) — so the per-count difference is measured very precisely
static int run_rdelta(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);NOTH=atoi(argv[5]);long NR=atol(argv[6]);seedrng(atoll(argv[7]));INS=1;
 const char*var=argv[8]; double PEN=argc>9?atof(argv[9]):0.75;
 devinit();initshoe();cutpos=(int)(PEN*N);
 static double n[10],de[10],dm2[10],dm2n[10],dc12[10],dc12n[10],eb[10];
 static int8_t sv_shoe[MAXN]; u64 sv_S[4];
 for(long r=0;r<NR;r++){
  if(pos>=cutpos||force_shuffle)shuffle();
  rstart=pos;int b=bucket(tc_now());
  memcpy(sv_shoe,shoe,N);int s_pos=pos,s_lim=lim,s_rc=rc,s_fs=force_shuffle,s_rstart=rstart;long s_mid=g_midshuffles;memcpy(sv_S,S,sizeof S);
  double rv[2],iv[2],rb[2],ib[2];int uc[2];
  DAS=1;DBL=0;RSA=0;MAXH=4;BJP=1.5;rules_env(var);
  play_round(2,rv,iv,uc);
  memcpy(shoe,sv_shoe,N);pos=s_pos;lim=s_lim;rc=s_rc;force_shuffle=s_fs;rstart=s_rstart;g_midshuffles=s_mid;memcpy(S,sv_S,sizeof S);
  DAS=1;DBL=0;RSA=0;MAXH=4;BJP=1.5;
  play_round(2,rb,ib,uc);
  double xv1=rv[0]+iv[0],xv2=rv[1]+iv[1],xb1=rb[0]+ib[0],xb2=rb[1]+ib[1];
  n[b]+=1;de[b]+=0.5*((xv1-xb1)+(xv2-xb2));eb[b]+=0.5*(xb1+xb2);
  dm2[b]+=0.5*((xv1*xv1-xb1*xb1)+(xv2*xv2-xb2*xb2));dm2n[b]+=0.5*((rv[0]*rv[0]-rb[0]*rb[0])+(rv[1]*rv[1]-rb[1]*rb[1]));
  dc12[b]+=xv1*xv2-xb1*xb2;dc12n[b]+=rv[0]*rv[1]-rb[0]*rb[1];}
 printf("{\"decks\":%d,\"h17\":%d,\"sur\":%d,\"others\":%d,\"rounds\":%ld,\"var\":\"%s\"",DECKS,H17,SUR,NOTH,NR,var);
 const char*nm[]={"n","e","m2","m2n","c12","c12n","base"};double*arr[]={n,de,dm2,dm2n,dc12,dc12n,eb};
 for(int q=0;q<7;q++){printf(",\"%s\":[",nm[q]);for(int b=0;b<10;b++){double v=q==0?n[b]:(n[b]?arr[q][b]/n[b]:0);printf("%s%.9g",b?",":"",v);}printf("]");}
 printf("}\n");return 0;}
// ---------------- cover plays: per-count cost of each one, measured on the same shoes as the normal game ----------------
// A round is first played normally; a cover play is replayed from the same cards only when the situation it changes came up.
#define NDEF 28
#define NVAR (NDEF*3+7+13+1)
#define NQ 9
static int g_cuts[NQ];static int g_s0;
typedef struct{int8_t shoe[MAXN];int pos,lim,rc,fs,rstart,rp[2];long mid;u64 S[4],MR[2],SR;}Snap;
static void snap_save(Snap*z){memcpy(z->shoe,shoe,N);z->pos=pos;z->lim=lim;z->rc=rc;z->fs=force_shuffle;z->rstart=rstart;z->rp[0]=rc_pv[0];z->rp[1]=rc_pv[1];z->mid=g_midshuffles;memcpy(z->S,S,sizeof S);z->MR[0]=MR[0];z->MR[1]=MR[1];z->SR=SR;}
static void snap_load(const Snap*z){memcpy(shoe,z->shoe,N);pos=z->pos;lim=z->lim;rc=z->rc;force_shuffle=z->fs;rstart=z->rstart;rc_pv[0]=z->rp[0];rc_pv[1]=z->rp[1];g_midshuffles=z->mid;memcpy(S,z->S,sizeof S);MR[0]=z->MR[0];MR[1]=z->MR[1];SR=z->SR;}
static double A_e[NVAR][NQ][10],A_m2[NVAR][10],A_m2n[NVAR][10],A_c12[NVAR][10],A_c12n[NVAR][10],A_fire[NVAR];
static inline void accum(int v,int b,const double*rv,const double*iv,const double*rb,const double*ib){
 double xv1=rv[0]+iv[0],xv2=rv[1]+iv[1],xb1=rb[0]+ib[0],xb2=rb[1]+ib[1];
 double de=0.5*((xv1-xb1)+(xv2-xb2));for(int p=0;p<NQ;p++)if(g_s0<g_cuts[p])A_e[v][p][b]+=de;
 if(g_s0<g_cuts[5]){A_m2[v][b]+=0.5*((xv1*xv1-xb1*xb1)+(xv2*xv2-xb2*xb2));
 A_m2n[v][b]+=0.5*((rv[0]*rv[0]-rb[0]*rb[0])+(rv[1]*rv[1]-rb[1]*rb[1]));A_c12[v][b]+=xv1*xv2-xb1*xb2;A_c12n[v][b]+=rv[0]*rv[1]-rb[0]*rb[1];}A_fire[v]+=1;}
static int run_cdelta(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);NOTH=atoi(argv[5]);long NR=atol(argv[6]);seedrng(atoll(argv[7]));INS=1;
 devinit();initshoe();for(int p=0;p<NQ;p++)g_cuts[p]=(int)((0.50+0.05*p)*N);cutpos=g_cuts[NQ-1];
 static double n[NQ][10],eb[NQ][10];Snap pre,post;long replays=0;
 static const int insv[7]={1,2,3,4,5,7,8};
 for(long r=0;r<NR;r++){
  if(pos>=cutpos||force_shuffle)shuffle();
  rstart=pos;g_s0=pos;int b=bucket(tc_now());
  snap_save(&pre);
  double rb[2],ib[2],rv[2],iv[2];int uc[2];
  f_base=f_above=f_below=0;f_flag=0;f_slip=0;
  play_round(2,rb,ib,uc);
  for(int p=0;p<NQ;p++)if(g_s0<g_cuts[p]){n[p][b]+=1;eb[p][b]+=0.5*(rb[0]+ib[0]+rb[1]+ib[1]);}
  u64 fb=f_base,fa=f_above,fl=f_below;int ff=f_flag,fsl=f_slip;
  if(g_iace){for(int q=0;q<7;q++){int any=0;for(int k=0;k<2;k++){int t=ins_take(insv[q],g_itc,g_itot[k]);iv[k]=t?(g_dbj?1:-0.5):0;if(iv[k]!=ib[k])any=1;}if(any)accum(NDEF*3+q,b,rb,iv,rb,ib);}}
  if(fb|fa|fl|(u64)ff|(u64)fsl){
   snap_save(&post);
   for(int id=0;id<NDEF;id++){u64 bit=1ULL<<id;for(int m=1;m<=3;m++){if(!((m==1?fb:m==2?fa:fl)&bit))continue;
     snap_load(&pre);V_DEVID=id;V_DEVMODE=m;play_round(2,rv,iv,uc);V_DEVID=-1;V_DEVMODE=0;replays++;accum(id*3+m-1,b,rv,iv,rb,ib);}}
   for(int f=1;f<=13;f++)if(ff&(1<<f)){snap_load(&pre);V_FLAG=f;play_round(2,rv,iv,uc);V_FLAG=0;replays++;accum(NDEF*3+7+f-1,b,rv,iv,rb,ib);}
   if(fsl){snap_load(&pre);V_SLIP=1;play_round(2,rv,iv,uc);V_SLIP=0;replays++;accum(NDEF*3+20,b,rv,iv,rb,ib);}
   snap_load(&post);}
 }
 printf("{\"decks\":%d,\"h17\":%d,\"sur\":%d,\"others\":%d,\"rounds\":%ld,\"replays\":%ld,\"n\":[",DECKS,H17,SUR,NOTH,NR,replays);
 for(int p=0;p<NQ;p++){printf("%s[",p?",":"");for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",n[p][b]);printf("]");}
 printf("],\"v\":{");
 int first=1;for(int v=0;v<NVAR;v++){if(A_fire[v]==0)continue;char nm[24];
  if(v<NDEF*3)sprintf(nm,"d%d_%d",v/3,v%3+1);else if(v<NDEF*3+7)sprintf(nm,"i%d",insv[v-NDEF*3]);else if(v<NDEF*3+20)sprintf(nm,"f%d",v-NDEF*3-7+1);else sprintf(nm,"slip");
  printf("%s\"%s\":{\"e\":[",first?"":",",nm);first=0;
  for(int p=0;p<NQ;p++){printf("%s[",p?",":"");for(int bb=0;bb<10;bb++)printf("%s%.8g",bb?",":"",n[p][bb]?A_e[v][p][bb]/n[p][bb]:0);printf("]");}printf("]");
  const char*q[]={"m2","m2n","c12","c12n"};double(*arr[])[10]={A_m2,A_m2n,A_c12,A_c12n};
  for(int k=0;k<4;k++){printf(",\"%s\":[",q[k]);for(int bb=0;bb<10;bb++)printf("%s%.8g",bb?",":"",n[5][bb]?arr[k][v][bb]/n[5][bb]:0);printf("]");}printf("}");}
 printf("}}\n");return 0;}
// ---------------- counting shortcuts and errors: these move which count you think you're at, so both the mix of counts and
// the edge at each one change. Each round is played by the normal counter and by each variant from the same cards.
#define NCE 6
static int run_cerr(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);NOTH=atoi(argv[5]);long NR=atol(argv[6]);seedrng(atoll(argv[7]));INS=1;
 devinit();initshoe();for(int p=0;p<NQ;p++)g_cuts[p]=(int)((0.50+0.05*p)*N);cutpos=g_cuts[NQ-1];MISS_ON=1;
 static double nb[NQ][10],sb[NQ][3][10],nv[NCE][NQ][10],sv[NCE][NQ][3][10];Snap pre;
 for(long r=0;r<NR;r++){
  if(pos>=cutpos||force_shuffle)shuffle();
  rstart=pos;int s0=pos;int b=bucket(tc_now());
  snap_save(&pre);double rr[2],ii[2];int uc[2];
  for(int v=0;v<NCE;v++){
   if(v<2){USEP=v+1;V_TCM=0;}else{USEP=0;V_TCM=v-1;}
   int bv=bucket(tc_now());play_round(2,rr,ii,uc);
   double x1=rr[0]+ii[0],x2=rr[1]+ii[1];
   for(int p=0;p<NQ;p++)if(s0<g_cuts[p]){nv[v][p][bv]+=1;sv[v][p][0][bv]+=0.5*(x1+x2);sv[v][p][1][bv]+=0.5*(x1*x1+x2*x2);sv[v][p][2][bv]+=x1*x2;}
   snap_load(&pre);}
  USEP=0;V_TCM=0;play_round(2,rr,ii,uc);
  {double x1=rr[0]+ii[0],x2=rr[1]+ii[1];for(int p=0;p<NQ;p++)if(s0<g_cuts[p]){nb[p][b]+=1;sb[p][0][b]+=0.5*(x1+x2);sb[p][1][b]+=0.5*(x1*x1+x2*x2);sb[p][2][b]+=x1*x2;}}
 }
 const char*vn[NCE]={"miss2","miss5","tcfull","tcexact","tcfloor","tcround"};const char*q[]={"e","m2","c12"};
 #define PR3(NN,SS) {printf("\"n\":[");for(int p=0;p<NQ;p++){printf("%s[",p?",":"");for(int b=0;b<10;b++)printf("%s%.0f",b?",":"",NN[p][b]);printf("]");}printf("]");for(int k=0;k<3;k++){printf(",\"%s\":[",q[k]);for(int p=0;p<NQ;p++){printf("%s[",p?",":"");for(int b=0;b<10;b++)printf("%s%.8g",b?",":"",NN[p][b]?SS[p][k][b]/NN[p][b]:0);printf("]");}printf("]");}}
 printf("{\"decks\":%d,\"h17\":%d,\"sur\":%d,\"others\":%d,\"rounds\":%ld,",DECKS,H17,SUR,NOTH,NR);PR3(nb,sb);
 printf(",\"v\":{");for(int v=0;v<NCE;v++){printf("%s\"%s\":{",v?",":"",vn[v]);PR3(nv[v],sv[v]);printf("}");}
 printf("}}\n");return 0;}
// ---------------- index finder: every time the chosen hand comes up, it is played both ways from the same cards ----------------
// PROBE="key,up,A,B" (key: hard total, or 100+k for soft A-k). Prints, by the true count at the moment of the decision, how
// much better play A does than play B per unit bet. The index is where that changes sign.
static int run_idx(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);NOTH=atoi(argv[5]);long NR=atol(argv[6]);seedrng(atoll(argv[7]));INS=1;double PEN=argc>8?atof(argv[8]):0.75;
 {const char*e=getenv("PROBE");if(!e||sscanf(e,"%d,%d,%c,%c",&P_KEY,&P_UP,&P_A,&P_B)!=4){fprintf(stderr,"PROBE=key,up,A,B\n");return 1;}}
 devinit();initshoe();cutpos=(int)(PEN*N);Snap pre,post;
 static double n[24],sd[24],sd2[24];double ra[2],ia[2],rb[2],ib[2];int uc[2];
 for(long r=0;r<NR;r++){
  if(pos>=cutpos||force_shuffle)shuffle();
  rstart=pos;snap_save(&pre);g_probe=0;P_FORCE=0;
  play_round(2,ra,ia,uc);
  if(g_probe){int t=g_ptc,rc0=g_prc;snap_save(&post);
   snap_load(&pre);P_FORCE=1;play_round(2,ra,ia,uc);snap_load(&pre);P_FORCE=2;play_round(2,rb,ib,uc);P_FORCE=0;snap_load(&post);
   double d=(ra[0]+ra[1])-(rb[0]+rb[1]);int k=t<-8?0:t>8?16:t+8;n[k]+=1;sd[k]+=d;sd2[k]+=d*d;
   if(t==0){int z=17+(rc0<0?0:rc0==0?1:2);n[z]+=1;sd[z]+=d;sd2[z]+=d*d;}}
 }
 printf("{\"decks\":%d,\"h17\":%d,\"sur\":%d,\"others\":%d,\"pen\":%.2f,\"rounds\":%ld,\"tc\":{",DECKS,H17,SUR,NOTH,PEN,NR);
 for(int k=0;k<20;k++){char nm[12];if(k<17)sprintf(nm,"%d",k-8);else sprintf(nm,k==17?"0neg":k==18?"0zero":"0pos");double m=n[k]?sd[k]/n[k]:0;
  printf("%s\"%s\":[%.0f,%.6f,%.6f]",k?",":"",nm,n[k],m,n[k]>1?sqrt((sd2[k]/n[k]-m*m)/n[k]):0);}
 printf("}}\n");return 0;}
static int run_audit(int argc,char**argv){
 DECKS=atoi(argv[2]);H17=atoi(argv[3]);SUR=atoi(argv[4]);NOTH=atoi(argv[5]);long NR=atol(argv[6]);seedrng(atoll(argv[7]));INS=1;double PEN=argc>8?atof(argv[8]):0.75;
 devinit();initshoe();cutpos=(int)(PEN*N);Snap pre,post;
 static double BN[3][22][12][5],BX[3][22][12][5],BD[3][22][12][5],BD2[3][22][12][5];static char BS[3][22][12];
 static double DN[32][20],DS[32][20],DS2[32][20];
 const char ACTS[5]={'H','S','D','P','R'};double rr[2],ii[2],ra[2],ia[2];int uc[2];
 for(long r=0;r<NR;r++){
  if(pos>=cutpos||force_shuffle)shuffle();
  rstart=pos;snap_save(&pre);AUD_REC=1;a_seen=0;a_cell.valid=0;g_uk=0;F_ACT=0;
  play_round(2,rr,ii,uc);AUD_REC=0;
  if(!a_cell.valid&&!a_seen)continue;
  snap_save(&post);
  if(a_cell.valid){int k=a_cell.kind,i=a_cell.idx,u=a_cell.up;double x[5];int bi=-1;BS[k][i][u]=a_cell.bs;
   for(int a=0;a<5;a++){if(!(a_cell.legal&(1<<a)))continue;snap_load(&pre);g_uk=0;F_ACT=ACTS[a];play_round(2,ra,ia,uc);F_ACT=0;x[a]=ra[0];if(ACTS[a]==a_cell.bs)bi=a;}
   if(bi>=0)for(int a=0;a<5;a++){if(!(a_cell.legal&(1<<a)))continue;double d=x[a]-x[bi];BN[k][i][u][a]+=1;BX[k][i][u][a]+=x[a];BD[k][i][u][a]+=d;BD2[k][i][u][a]+=d*d;}}
  for(int id=0;id<32;id++){if(!((a_seen>>id)&1))continue;
   snap_load(&pre);g_uk=0;V_DEVID=id;V_DEVMODE=2;play_round(2,ra,ia,uc);double xa=ra[0]+ra[1];
   snap_load(&pre);g_uk=0;V_DEVMODE=3;play_round(2,ra,ia,uc);double xb=ra[0]+ra[1];V_DEVID=-1;V_DEVMODE=0;
   double d=xa-xb;int t=a_tc[id];int k=t<-8?0:t>8?16:t+8;DN[id][k]+=1;DS[id][k]+=d;DS2[id][k]+=d*d;
   if(t==0){int z=17+(a_rc[id]<0?0:a_rc[id]==0?1:2);DN[id][z]+=1;DS[id][z]+=d;DS2[id][z]+=d*d;}}
  snap_load(&post);
 }
 printf("{\"decks\":%d,\"h17\":%d,\"sur\":%d,\"others\":%d,\"rounds\":%ld,\"cells\":[",DECKS,H17,SUR,NOTH,NR);int first=1;
 for(int k=0;k<3;k++)for(int i=0;i<22;i++)for(int u=2;u<12;u++){if(!BS[k][i][u])continue;
  printf("%s{\"kind\":%d,\"hand\":%d,\"up\":%d,\"bs\":\"%c\"",first?"":",",k,i,u,BS[k][i][u]);first=0;
  for(int a=0;a<5;a++){double n=BN[k][i][u][a];if(n<1)continue;double m=BD[k][i][u][a]/n;printf(",\"%c\":[%.0f,%.6f,%.6f,%.6f]",ACTS[a],n,BX[k][i][u][a]/n,m,n>1?sqrt((BD2[k][i][u][a]/n-m*m)/n):0);}
  printf("}");}
 printf("],\"devs\":{");first=1;
 for(int id=0;id<32;id++){double tot=0;for(int k=0;k<17;k++)tot+=DN[id][k];if(tot<1)continue;printf("%s\"%d\":{",first?"":",",id);first=0;
  for(int k=0;k<20;k++){char nm[12];if(k<17)sprintf(nm,"%d",k-8);else sprintf(nm,k==17?"0neg":k==18?"0zero":"0pos");double n=DN[id][k],m=n?DS[id][k]/n:0;printf("%s\"%s\":[%.0f,%.6f,%.6f]",k?",":"",nm,n,m,n>1?sqrt((DS2[id][k]/n-m*m)/n):0);}
  printf("}");}
 printf("}}\n");return 0;}
int main(int argc,char**argv){
 rules_env(getenv("RULES"));
 if(argc<2){fprintf(stderr,"mode?\n");return 1;}
 if(!strcmp(argv[1],"cal"))return run_cal(argc,argv);
 if(!strcmp(argv[1],"val"))return run_val(argc,argv);
 if(!strcmp(argv[1],"freq"))return run_freq(argc,argv);
 if(!strcmp(argv[1],"rdelta"))return run_rdelta(argc,argv);
 if(!strcmp(argv[1],"cdelta"))return run_cdelta(argc,argv);
 if(!strcmp(argv[1],"cerr"))return run_cerr(argc,argv);
 if(!strcmp(argv[1],"idx"))return run_idx(argc,argv);
 if(!strcmp(argv[1],"audit"))return run_audit(argc,argv);
 return 1;}
