// The Doorway v3 — UI. Compiled in-browser by @babel/standalone (preset react).
// Talks only to window.DW (engine.js) and window.DW_CASES (cases.js).
const {useState,useEffect,useLayoutEffect,useRef,useMemo,useCallback}=React;

// ── TOKENS ──────────────────────────────────────────────────────────────────
const MONO="'JetBrains Mono',ui-monospace,monospace";
const SERIF="'Source Serif 4',Georgia,serif";
const DISPLAY="'Instrument Serif',Georgia,serif";
const EASE="cubic-bezier(0.2,0.8,0.2,1)";
const C={
  bg:"#0a0a0a",bg2:"#141414",bg3:"#1a1a1a",
  text:"#f5f1e8",dim:"rgba(245,241,232,0.75)",faint:"#9a9488",
  border:"rgba(245,241,232,0.12)",
  red:"#8B0000",redBright:"#a51c1c",redDim:"rgba(139,0,0,0.4)",redText:"#e05a5a",
  amber:"#d4a04a",amberBg:"rgba(180,120,40,0.10)",amberBorder:"rgba(212,160,74,0.45)",
  slateBg:"rgba(80,95,120,0.12)",slateBorder:"rgba(122,133,153,0.30)",
  indigo:"#9098c4",indigoBg:"rgba(90,100,140,0.10)",indigoBorder:"rgba(144,152,196,0.35)",
  docBg:"rgba(60,80,72,0.30)",docBorder:"rgba(120,160,140,0.40)",doc:"#cfd9d2",
  good:"#10b981",goodMuted:"rgba(16,185,129,0.75)",goodBg:"rgba(16,185,129,0.07)",goodBorder:"rgba(16,185,129,0.4)",
  badBg:"rgba(139,0,0,0.12)",badBorder:"rgba(139,0,0,0.6)"
};

const CSS=`
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${C.bg};color:${C.text};font-family:${SERIF};-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}
#root{min-height:100dvh}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit;padding:0;transition:background-color 200ms ${EASE},border-color 200ms ${EASE},color 200ms,opacity 200ms,transform 120ms}
button:disabled{cursor:default}
button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid ${C.amber};outline-offset:2px}
input,textarea{font-family:inherit}
input[type=range]{accent-color:${C.amber};width:100%;height:44px}
.scrollx::-webkit-scrollbar{display:none}.scrollx{scrollbar-width:none}
.display{font-family:${DISPLAY};font-style:normal;font-weight:400}
.display-i{font-family:${DISPLAY};font-style:italic;font-weight:400}
.mono{font-family:${MONO}}
details>summary{list-style:none;cursor:pointer}details>summary::-webkit-details-marker{display:none}
@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes pulse-slow{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes flash-once{0%,65%{background:#8B0000}100%{background:rgba(245,241,232,0.02)}}
@keyframes ekg-sweep{0%{stroke-dashoffset:2400}100%{stroke-dashoffset:0}}
@keyframes hr-flicker{0%,40%,100%{opacity:1}45%,55%{opacity:.55}}
@keyframes bubble-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes case-fade{from{opacity:0}to{opacity:1}}
@keyframes sheet-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes banner-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.bubble{animation:bubble-in 380ms ${EASE} both}
.case-fade{animation:case-fade 600ms ${EASE} both}
.sheet-up{animation:sheet-up 180ms ${EASE} both}
.banner-in{animation:banner-in 220ms ${EASE} both}
.flash-once{animation:flash-once 900ms ${EASE} 1}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.rise{animation:rise 420ms ${EASE} both}
.door-close{transition:transform 600ms ${EASE},opacity 600ms ${EASE}}
.pulse-slow{animation:pulse-slow 2.6s ease-in-out infinite}
.chip:active{transform:scale(0.96)}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
const GlobalStyle=()=><style dangerouslySetInnerHTML={{__html:CSS}}/>;

// ── SMALL UTILITIES ─────────────────────────────────────────────────────────
const DW_=()=>window.DW||null;
const CASES_=()=>window.DW_CASES||{};
const lsGet=k=>{try{return localStorage.getItem(k)}catch{return null}};
const lsSet=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}};
const errMsg=e=>(e&&e.message)||String(e||"Something went wrong");
const haptic=ms=>{try{navigator.vibrate&&navigator.vibrate(ms)}catch{}};
const round=v=>v==null||isNaN(v)?"—":Math.round(Number(v));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const useReducedMotion=()=>{
  const q="(prefers-reduced-motion: reduce)";
  const [r,setR]=useState(()=>{try{return window.matchMedia(q).matches}catch{return false}});
  useEffect(()=>{let m;try{m=window.matchMedia(q)}catch{return}
    const h=e=>setR(e.matches);m.addEventListener?m.addEventListener("change",h):m.addListener(h);
    return()=>{m.removeEventListener?m.removeEventListener("change",h):m.removeListener(h)}},[]);
  return r;
};

// Settings: tolerate DW.settings as {get,set}, as a getter/setter function, or as a plain object.
const getSettings=()=>{try{const d=DW_();const s=d&&d.settings;
  if(s&&typeof s.get==="function")return s.get()||{};
  if(typeof s==="function")return s()||{};
  if(d&&typeof d.getSettings==="function")return d.getSettings()||{};
  return s||{}}catch{return{}}};
const setSettings=patch=>{try{const d=DW_();const s=d&&d.settings;
  if(s&&typeof s.set==="function")return s.set(patch);
  if(typeof s==="function")return s(patch);
  if(d&&typeof d.setSettings==="function")return d.setSettings(patch);
  if(s)Object.assign(s,patch)}catch{}};
const safeStats=()=>{try{return(DW_()&&DW_().stats())||{}}catch{return{}}};
const prefetchReady=()=>{try{const d=DW_();if(d&&typeof d.hasPrefetched==="function")return!!d.hasPrefetched();return lsGet("dw_next")!=null}catch{return false}};
let prefetchPromise=null; // shared so Home can light the ready dot when a debrief prefetch lands
const startPrefetch=mode=>{try{const p=DW_().prefetch({mode});prefetchPromise=p&&p.then?p.catch(()=>null):null}catch{prefetchPromise=null}};

const caseOf=enc=>(enc&&enc.case)||{};
const seedOf=enc=>caseOf(enc).seed||{};
const persona=enc=>caseOf(enc).persona||{};
const dispoFamily=d=>!d?null:/transfer/i.test(d)?"Transfer":/admit/i.test(d)?"Admit":"Discharge";
// Acuity is ESI: 1 = resuscitation (sickest) … 5 = non-urgent.
const ACUITY_WORD=["","resus","emergent","urgent","less urgent","non-urgent"];
const acuityText=n=>n>=1&&n<=5?`${n} · ${ACUITY_WORD[n]}`:"—";

// ── VITALS MODEL (display only) ─────────────────────────────────────────────
const VITALS=[{k:"HR",l:"HR"},{k:"BP",l:"BP"},{k:"RR",l:"RR"},{k:"SpO2",l:"SpO₂"},{k:"Temp",l:"T"},{k:"GCS",l:"GCS"}];
const FALLBACK_NORMS={HR:[60,100],SBP:[90,160],RR:[12,20],SpO2:[94,100],Temp:[96.8,100.4],GCS:[15,15]};
const rangeOf=(norms,key)=>{
  const r=norms&&norms[key];
  if(Array.isArray(r))return[r[0],r[1]];
  if(r&&typeof r==="object")return[r.min??r.lo??r.low??-Infinity,r.max??r.hi??r.high??Infinity];
  if(typeof r==="number")return(key==="SpO2"||key==="GCS")?[r,Infinity]:[-Infinity,r];
  return FALLBACK_NORMS[key]||[-Infinity,Infinity];
};
// DW.NORMALS[band] = {range:{HR:[lo,hi],...}, alarm:{...}}; tiles use the range.
const normsFor=band=>{try{const N=DW_()&&DW_().NORMALS;const n=N&&(N[band]||N.adult);return(n&&(n.range||n))||FALLBACK_NORMS}catch{return FALLBACK_NORMS}};
const numOf=(v,k)=>v?Number(k==="BP"?v.SBP:v[k]):NaN;
const isAbn=(v,k,norms)=>{const raw=numOf(v,k);const n=k==="Temp"?Math.round(raw*10)/10:Math.round(raw);if(isNaN(n))return false;const[lo,hi]=rangeOf(norms,k==="BP"?"SBP":k);return n<lo||n>hi};
const fmtVital=(v,k)=>{if(!v)return"—";
  if(k==="BP")return`${round(v.SBP)}/${round(v.DBP)}`;
  if(k==="Temp")return v.Temp==null?"—":Number(v.Temp).toFixed(1);
  if(k==="SpO2")return`${round(v.SpO2)}%`;return String(round(v[k]))};
const tileKeyFor=vital=>/BP|MAP/i.test(vital||"")?"BP":vital==="O2"?"SpO2":vital;
const vitalsNow=enc=>{try{return DW_().vitalsAt(enc,enc.simMin||0)}catch{const h=enc&&enc.vitalsHistory;return(h&&h.length&&h[h.length-1].vitals)||caseOf(enc).vitals0||null}};
const historyOf=enc=>{const h=enc&&enc.vitalsHistory;if(h&&h.length)return h;const v=vitalsNow(enc);return v?[{t:(enc&&enc.simMin)||0,vitals:v}]:[]};

// ── SHARED UI ───────────────────────────────────────────────────────────────
const Label=({children,color=C.faint,style})=><div className="mono" style={{fontSize:12,letterSpacing:"0.18em",textTransform:"uppercase",color,...style}}>{children}</div>;
const Card=({children,style,accent})=><div style={{padding:14,background:C.bg2,border:`1px solid ${C.border}`,borderLeft:accent?`2px solid ${accent}`:undefined,borderRadius:4,...style}}>{children}</div>;
// Red is for a patient getting worse or a wrong call. Primary actions are bone; only Lock and Submit keep the red fill.
const BTN={
  primary:{background:C.text,color:C.bg,border:`1px solid ${C.text}`},
  lock:{background:C.red,color:C.text,border:`1px solid ${C.redText}`},
  light:{background:C.text,color:C.bg,border:`1px solid ${C.text}`},
  line:{background:"transparent",color:C.text,border:`1px solid ${C.border}`},
  ghost:{background:"transparent",color:C.dim,border:"1px solid transparent"}
};
// Disabled is a visible state (outline, dim text), never a faded copy of the enabled button.
const Btn=({kind="line",children,style,disabled,...p})=><button disabled={disabled} {...p} style={{minHeight:44,padding:"0 16px",borderRadius:4,fontFamily:MONO,fontSize:12,letterSpacing:"0.14em",textTransform:"uppercase",fontWeight:500,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:10,...(disabled?{background:"transparent",color:C.faint,border:`1px solid ${C.border}`}:BTN[kind]),...style}}>{children}</button>;
const IconBtn=({label,children,style,...p})=><button aria-label={label} title={label} {...p} style={{minWidth:44,minHeight:44,display:"inline-flex",alignItems:"center",justifyContent:"center",color:C.dim,fontSize:18,borderRadius:4,...style}}>{children}</button>;
// Line icons in the text colour; the only full-colour objects on the page should be the patient and the monitor.
const ICONS={
  settings:<><path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12M20 17h0"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="17" r="2"/></>,
  mic:<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
  lock:<><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  warn:<><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/></>,
  close:<path d="M6 6l12 12M18 6 6 18"/>,
  back:<path d="M15 5l-7 7 7 7"/>,
};
const Icon=({name,size=18,color="currentColor",style})=><svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,...style}}>{ICONS[name]}</svg>;
// Section titles are larger than what they head; the 12px tracked caption is for tile keys and stamps only.
const SectionTitle=({children,style,size=18,color=C.text})=><div style={{fontSize:size,fontWeight:600,letterSpacing:"-0.01em",lineHeight:1.25,color,...style}}>{children}</div>;

// Choice grid: options = [{v,label,sub?}]
const Choice=({options,value,onChange,cols,activeColor=C.text,activeText=C.bg,activeBorder,big,label,fontSize})=>(
  <div role="radiogroup" aria-label={label} style={{display:"grid",gridTemplateColumns:`repeat(${cols||options.length},1fr)`,gap:6}}>
    {options.map(o=>{const on=value===o.v;return(
      <button key={String(o.v)} role="radio" aria-checked={on} aria-label={o.aria||(o.sub?`${o.label} ${o.sub}`:undefined)} className="chip" onClick={()=>{onChange(o.v);haptic(8)}}
        style={{minHeight:big?64:48,padding:"6px 4px",borderRadius:4,background:on?activeColor:C.bg3,color:on?activeText:C.dim,border:`1px solid ${on?(activeBorder||activeColor):C.border}`,fontFamily:MONO,fontSize:fontSize||(big?15:13),letterSpacing:"0.06em",fontWeight:on?600:500,lineHeight:1.2}}>
        {o.label}{o.sub&&<div style={{fontSize:12,opacity:0.8,fontWeight:400,marginTop:3,letterSpacing:"0.02em",textTransform:"lowercase"}}>{o.sub}</div>}
      </button>)})}
  </div>);

const Toggle=({on,onChange,label,hint})=>(
  <button role="switch" aria-checked={on} onClick={()=>onChange(!on)} style={{display:"flex",width:"100%",alignItems:"center",justifyContent:"space-between",gap:12,minHeight:48,textAlign:"left"}}>
    <span><span style={{fontSize:15,display:"block"}}>{label}</span>{hint&&<span style={{fontSize:12,color:C.faint}}>{hint}</span>}</span>
    <span aria-hidden style={{width:44,height:26,borderRadius:13,background:on?C.red:C.bg3,border:`1px solid ${on?C.red:C.border}`,position:"relative",flexShrink:0}}>
      <span style={{position:"absolute",top:2,left:on?20:2,width:20,height:20,borderRadius:10,background:C.text,transition:`left 160ms ${EASE}`}}/></span>
  </button>);

const Sheet=({title,onClose,children,maxH="88dvh"})=>{
  useEffect(()=>{const k=e=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",k);return()=>window.removeEventListener("keydown",k)},[onClose]);
  return(<div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div role="dialog" aria-modal="true" aria-label={title} className="sheet-up" style={{width:"100%",maxWidth:560,maxHeight:maxH,overflowY:"auto",background:C.bg2,border:`1px solid ${C.border}`,borderBottom:"none",borderRadius:"14px 14px 0 0",padding:"8px 18px calc(20px + env(safe-area-inset-bottom))"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <SectionTitle size={22}>{title}</SectionTitle>
        <IconBtn label="Close" onClick={onClose}><Icon name="close" size={20}/></IconBtn>
      </div>
      {children}
    </div>
  </div>);
};

const ErrorBox=({error,onRetry,onSettings,style})=>{
  if(!error)return null;
  const limit=/limit/i.test(error);
  return(<div role="alert" style={{padding:12,background:C.badBg,border:`1px solid ${C.badBorder}`,borderRadius:4,fontSize:14,lineHeight:1.5,...style}}>
    <div>{error}</div>
    <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
      {onRetry&&<Btn kind="line" onClick={onRetry} style={{minHeight:44}}>Retry</Btn>}
      {limit&&onSettings&&<Btn kind="ghost" onClick={onSettings} style={{color:C.amber}}>Add API key →</Btn>}
    </div>
  </div>);
};

// ── CONDITIONS ──────────────────────────────────────────────────────────────
const conditionParts=cond=>{
  if(!cond)return[];
  const p=[];
  if(cond.hour!=null)p.push({t:`${String(cond.hour).padStart(2,"0")}:${String(cond.minute??0).padStart(2,"0")}`});
  if(cond.ctAvailable!=null)p.push({t:cond.ctAvailable?"CT up":"CT down",bad:!cond.ctAvailable});
  if(cond.flight)p.push({t:cond.flight==="available"?"Flight available":cond.flight==="weather"?"Flight weathered out":"Flight in use",bad:cond.flight!=="available"});
  if(cond.groundEta!=null)p.push({t:`Ground ${cond.groundEta} min`});
  if(cond.obNegUnits!=null)p.push({t:`${cond.obNegUnits} unit${cond.obNegUnits===1?"":"s"} O-neg`,bad:cond.obNegUnits===0});
  if(cond.nurseCount!=null)p.push({t:`${cond.nurseCount} nurse${cond.nurseCount===1?"":"s"}`});
  return p;
};
const ConditionsStrip=({cond,compact})=>{
  const parts=conditionParts(cond);if(!parts.length)return null;
  return(<div className="mono" aria-label="Conditions" style={{fontSize:12,color:C.dim,letterSpacing:"0.04em",lineHeight:1.6,whiteSpace:compact?"nowrap":"normal",overflow:compact?"hidden":"visible",textOverflow:"ellipsis"}}>
    {parts.map((x,i)=><span key={i}>{i>0&&<span style={{color:C.faint}}> · </span>}<span style={{color:x.bad?C.amber:C.dim}}>{x.t}</span></span>)}
  </div>);
};

// ── AVATAR (ported from v2; text annotations moved to PhysTags) ─────────────
const FITZ_RGB=[[245,220,196],[232,197,163],[212,163,115],[176,125,90],[138,90,60],[74,44,26]];
const lerpRGB=(a,b,t)=>[Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t)];
const rgb=r=>`rgb(${r[0]},${r[1]},${r[2]})`;
const applyPallor=(base,i)=>{if(i<=0)return base;const t=Math.min(1,i*0.18);const lum=0.299*base[0]+0.587*base[1]+0.114*base[2];const ash=base[0]<150?[Math.min(255,lum+10),Math.min(255,lum+12),Math.min(255,lum+18)]:[lum,lum,lum];return lerpRGB(base,ash,t)};
const scleraCol=j=>{const b=[245,240,232];return j<=0?rgb(b):rgb(lerpRGB(b,[250,225,110],Math.min(1,j*0.28)))};
const lipCol=(base,c)=>{const dl=[Math.max(60,base[0]-60),Math.max(40,base[1]-65),Math.max(50,base[2]-50)];return c<=0?rgb(dl):rgb(lerpRGB(dl,[78,70,130],Math.min(1,c*0.28)))};
const nailCol=c=>c<=0?"rgb(220,180,170)":rgb(lerpRGB([220,180,170],[70,80,140],Math.min(1,c*0.32)));

// A posture silhouette, no face: the shape in the doorway. Five outlines (upright, slumped, tripod,
// fetal, supine) filled by the skin/pallor engine; cyanosis and jaundice are washes at the edges,
// diaphoresis a sheen; the only motion is breathing at the patient's rate. A face can lie about
// affect; a shape reads posture, which is what a doorway glance gives.
const SIL={
  upright:{head:[120,74,34],body:"M104 112h32l4 16c30 10 48 34 52 64v48H48v-48c4-30 22-54 52-64l4-16z"},
  slumped:{head:[112,98,32],body:"M96 132h34l6 14c28 12 42 32 44 56v38H56v-44c2-26 16-46 38-56l2-8z"},
  tripod:{head:[100,98,30],body:"M86 130h30l8 12c26 12 40 30 44 54v44H60v-44c2-26 12-46 28-58l-2-8z",arms:"M78 186L64 252M162 186L178 252"},
  fetal:{head:[70,160,28],body:"M94 140c34-16 76-10 100 14 16 16 20 40 12 60-8 18-28 24-48 18-14-4-22-14-26-26-10 8-24 10-36 4-12-8-16-24-10-36 2-12 4-24 8-34z"},
  supine:{head:[72,150,28],body:"M100 134h128c10 0 16 8 16 18v30c0 8-6 14-14 14H98c-8 0-12-6-12-14v-30c0-10 6-18 14-18z"}
};
const Avatar=({phys,still})=>{
  const gid=React.useId().replace(/:/g,"");
  if(!phys)return null;
  const{fitz=3,rrRate=16,pallor=0,diaphoresis=0,cyanosis=0,jaundice=0,eyeState="open",positioning="supine",distressLevel=0}=phys;
  const fz=clamp(Math.round(fitz),1,6);const skin=rgb(applyPallor(FITZ_RGB[fz-1],pallor));
  const pose=positioning==="tripod"?"tripod":positioning==="fetal"?"fetal":positioning==="supine"?"supine":(distressLevel>=2||eyeState!=="open")?"slumped":"upright";
  const s=SIL[pose];const breath=`${(60/Math.max(8,rrRate)).toFixed(2)}s`;
  const cy=Math.min(1,cyanosis*0.3),ja=Math.min(1,jaundice*0.3),dia=Math.min(1,diaphoresis*0.3);
  const shape=(fill,extra)=><g {...extra}><circle cx={s.head[0]} cy={s.head[1]} r={s.head[2]} fill={fill}/><path d={s.body} fill={fill}/></g>;
  return(<svg viewBox="0 0 240 280" role="img" aria-label={`Patient, ${pose}`} data-pose={pose} data-diaphoresis={diaphoresis} data-pallor={pallor} data-cyanosis={cyanosis} style={{width:"100%",height:"100%",display:"block"}}>
    <defs>
      <radialGradient id={`${gid}bg`} cx="50%" cy="40%"><stop offset="0%" stopColor="#1a2333"/><stop offset="100%" stopColor="#06090f"/></radialGradient>
      <linearGradient id={`${gid}cy`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5a6cc0" stopOpacity="0"/><stop offset="100%" stopColor="#5a6cc0" stopOpacity={cy}/></linearGradient>
      <linearGradient id={`${gid}ja`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e2c04a" stopOpacity={ja}/><stop offset="100%" stopColor="#e2c04a" stopOpacity="0"/></linearGradient>
      <linearGradient id={`${gid}sh`} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#dff0ff" stopOpacity="0"/><stop offset="38%" stopColor="#dff0ff" stopOpacity={dia*0.5}/><stop offset="62%" stopColor="#dff0ff" stopOpacity="0"/></linearGradient>
    </defs>
    <rect width="240" height="280" fill={`url(#${gid}bg)`}/>
    <rect x="0" y="252" width="240" height="28" fill="#0c1320"/>
    <g transform="translate(120 180)"><g>{!still&&<animateTransform attributeName="transform" type="scale" values="1 1;1.012 1.028;1 1" dur={breath} repeatCount="indefinite"/>}<g transform="translate(-120 -180)">
      {s.arms&&<path d={s.arms} stroke={skin} strokeWidth="14" strokeLinecap="round" fill="none"/>}
      {shape(skin,{fillOpacity:0.94,stroke:C.text,strokeWidth:1.2,strokeLinejoin:"round"})}
      {cy>0&&shape(`url(#${gid}cy)`)}
      {ja>0&&shape(`url(#${gid}ja)`)}
      {dia>0&&shape(`url(#${gid}sh)`)}
    </g></g></g>
  </svg>);
};
const PhysTags=({phys})=>{
  if(!phys)return null;
  const t=[];
  if(phys.cyanosis>=2)t.push(["Cyanosis · lips/nails","#a8b8e8"]);
  if(phys.jaundice>=2)t.push(["Jaundice · sclera","#e8d878"]);
  if(phys.pallor>=2)t.push(["Pallor","#cfd6d2"]);
  if(phys.diaphoresis>=2)t.push(["Diaphoretic","#bfe0ff"]);
  if(phys.rashNote)t.push([`Rash · ${String(phys.rashNote).slice(0,40)}`,"#d8a880"]);
  if(!t.length)return null;
  return(<div style={{display:"flex",flexWrap:"wrap",gap:6}}>{t.map(([s,c])=><span key={s} className="mono" style={{fontSize:12,color:c,border:`1px solid ${C.border}`,borderRadius:3,padding:"3px 7px"}}>{s}</span>)}</div>);
};

// ── VITALS TILES + TREND SHEET ──────────────────────────────────────────────
// Abnormal is a red number and a red edge, not a red box; a newly crossed limit flashes solid once
// and settles. The third line is the change since the last reading, not the old reading.
const VitalTiles=({vitals,prev,band,onTap,flash,reduced,big})=>{
  const norms=normsFor(band);
  return(<div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:4}}>
    {VITALS.map(({k,l})=>{
      const bad=isAbn(vitals,k,norms);
      const cur=numOf(vitals,k),pv=numOf(prev,k);
      const d=!prev||isNaN(cur)||isNaN(pv)?0:cur-pv;
      const thr=k==="Temp"?0.2:1;
      const delta=Math.abs(d)>=thr?(d>0?"+":"−")+(k==="Temp"?Math.abs(d).toFixed(1):Math.round(Math.abs(d))):"";
      const flashing=flash&&flash[k]&&!reduced;
      const content=(<>
        <div className="mono" style={{fontSize:12,color:C.faint,letterSpacing:"0.06em"}}>{l}</div>
        <div className="mono" style={{fontSize:k==="BP"?(big?16:15):(big?20:19),color:bad?C.redText:C.text,fontWeight:500,marginTop:2,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{fmtVital(vitals,k)}</div>
        {prev&&<div className="mono" style={{fontSize:12,color:delta?C.amber:C.faint,whiteSpace:"nowrap",marginTop:1}}>{delta||"·"}</div>}
      </>);
      const st={minHeight:big?64:60,padding:"6px 1px",borderRadius:4,border:`1px solid ${bad?C.red:C.border}`,background:"rgba(245,241,232,0.02)",textAlign:"center",width:"100%"};
      return onTap
        ?<button key={k+(flashing?flash[k]:"")} className={flashing?"flash-once":""} onClick={()=>onTap(k)} aria-label={`${l} ${fmtVital(vitals,k)}${bad?", abnormal":""}${delta?`, ${delta}`:""}. Show trend`} style={st}>{content}</button>
        :<div key={k} style={st}>{content}</div>;
    })}
  </div>);
};

// The curve is the model sampled every 5 simulated minutes, so a 45-minute CT shows the slide,
// not two dots; the readings he actually saw are listed underneath.
const TrendSheet=({k,enc,band,onClose})=>{
  const hist=historyOf(enc);const label=(VITALS.find(x=>x.k===k)||{}).l||k;
  const norms=normsFor(band);const[lo,hi]=rangeOf(norms,k==="BP"?"SBP":k);
  const pts=useMemo(()=>{
    const d=DW_();const end=Number(enc&&enc.simMin)||0;const out=[];
    if(d&&typeof d.vitalsAt==="function"){try{for(let m=0;m<=end;m+=5){const v=d.vitalsAt(enc,m);out.push({t:m,v:numOf(v,k),v2:k==="BP"?Number(v.DBP):null})}if(end%5){const v=d.vitalsAt(enc,end);out.push({t:end,v:numOf(v,k),v2:k==="BP"?Number(v.DBP):null})}}catch{out.length=0}}
    if(out.length<2)return hist.map(h=>({t:Number(h.t)||0,v:numOf(h.vitals,k),v2:k==="BP"?Number(h.vitals&&h.vitals.DBP):null}));
    return out;
  },[enc,k]).filter(p=>!isNaN(p.v));
  const W=340,H=150,P=28;
  const all=pts.flatMap(p=>p.v2!=null&&!isNaN(p.v2)?[p.v,p.v2]:[p.v]).concat([lo,hi].filter(isFinite));
  let mn=Math.min(...all),mx=Math.max(...all);if(mx-mn<4){mx+=2;mn-=2}
  const tMax=Math.max(1,...pts.map(p=>p.t));
  const x=t=>P+(t/tMax)*(W-2*P),y=v=>H-P+((mn-v)/(mx-mn))*(H-2*P)+0;
  const path=key=>pts.filter(p=>p[key]!=null&&!isNaN(p[key])).map((p,i)=>`${i?"L":"M"} ${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const last=pts[pts.length-1];
  return(<Sheet title={`${label} trend`} onClose={onClose}>
    {pts.length<2?<div style={{fontSize:14,color:C.dim,padding:"8px 0 16px"}}>One reading so far: <span className="mono" style={{color:C.text}}>{last?fmtVital(hist[hist.length-1].vitals,k):"—"}</span> at T+{last?last.t:0}. The trend fills in as the clock moves.</div>:
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}} role="img" aria-label={`${label} from T+0 to T+${tMax} minutes`}>
      {isFinite(lo)&&isFinite(hi)&&<rect x={P} y={y(Math.min(hi,mx))} width={W-2*P} height={Math.max(0,y(Math.max(lo,mn))-y(Math.min(hi,mx)))} fill="rgba(16,185,129,0.07)"/>}
      <line x1={P} y1={H-P} x2={W-P} y2={H-P} stroke={C.border}/>
      <text x={P} y={H-8} fontSize="12" fill={C.faint} fontFamily={MONO}>T+0</text>
      <text x={W-P} y={H-8} fontSize="12" fill={C.faint} fontFamily={MONO} textAnchor="end">T+{tMax}</text>
      <text x={4} y={y(mx)+4} fontSize="12" fill={C.faint} fontFamily={MONO}>{Math.round(mx)}</text>
      <text x={4} y={y(mn)+4} fontSize="12" fill={C.faint} fontFamily={MONO}>{Math.round(mn)}</text>
      {k==="BP"&&<path d={path("v2")} fill="none" stroke={C.dim} strokeWidth="1.5" strokeDasharray="3 3"/>}
      <path d={path("v")} fill="none" stroke={C.amber} strokeWidth="2"/>
      {pts.map((p,i)=><circle key={i} cx={x(p.t)} cy={y(p.v)} r="3" fill={(p.v<lo||p.v>hi)?C.redText:C.amber}/>)}
    </svg>}
    <div className="mono" style={{fontSize:12,color:C.faint,marginTop:8,lineHeight:1.6}}>
      {isFinite(lo)||isFinite(hi)?`Normal for ${band||"adult"}: ${isFinite(lo)?lo:"—"}–${isFinite(hi)?hi:"—"}${k==="BP"?" systolic (solid); diastolic dashed":""}`:""}
    </div>
    <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:"4px 12px"}}>{hist.slice(-8).map((h,i)=><span key={i} className="mono" style={{fontSize:12,color:C.dim}}>T+{h.t}: <span style={{color:C.text}}>{fmtVital(h.vitals,k)}</span></span>)}</div>
  </Sheet>);
};

// ── LOG ─────────────────────────────────────────────────────────────────────
const BUBBLE={
  doc:{background:C.docBg,color:C.doc,border:`1px solid ${C.docBorder}`,marginLeft:"auto"},
  patient:{background:C.amberBg,color:"#f0d8a4",border:`1px solid ${C.amberBorder}`,borderLeft:`2px solid ${C.amber}`},
  clinical:{background:C.slateBg,color:"#dfe5ee",border:`1px solid ${C.slateBorder}`},
  obs:{background:C.indigoBg,color:"#cdd2ee",border:`1px solid ${C.indigoBorder}`,borderLeft:`2px solid ${C.indigo}`}
};
const LogEntry=({e,name,showLabel=true})=>{
  if(e.k==="time")return<div className="mono bubble" style={{fontSize:12,color:C.dim,letterSpacing:"0.04em",padding:"8px 0 2px",borderTop:`1px solid ${C.border}`}}>{e.t}</div>;
  if(e.k==="sent")return<div className="mono bubble" style={{fontSize:12,color:C.faint,padding:"5px 0"}}>{e.t}</div>;
  if(e.k==="event")return(<div className="bubble" role="status" style={{padding:"8px 12px",background:"rgba(139,0,0,0.22)",border:`1px solid ${C.red}`,borderLeft:`3px solid ${C.red}`,borderRadius:4}}>
    <Label color={C.redText} style={{letterSpacing:"0.14em"}}>Event</Label>
    <div style={{fontSize:15,lineHeight:1.45,marginTop:2}}>{e.t}</div></div>);
  const st=BUBBLE[e.k]||BUBBLE.clinical;
  const lbl={doc:"You",patient:name||"Patient",clinical:"Clinical",obs:"You see"}[e.k]||e.k;
  return(<div className="bubble" style={{display:"flex",justifyContent:e.k==="doc"?"flex-end":"flex-start"}}>
    <div style={{maxWidth:"94%",padding:"7px 11px",borderRadius:4,opacity:e.pending?0.55:1,...st}}>
      {showLabel&&<div className="mono" style={{fontSize:12,textTransform:"uppercase",opacity:0.7,letterSpacing:"0.12em",marginBottom:2}}>{lbl}</div>}
      <div style={{fontSize:e.k==="obs"?16:15,lineHeight:1.45,fontFamily:e.mono?MONO:(e.k==="obs"?DISPLAY:SERIF),whiteSpace:"pre-wrap"}}>{e.t}</div>
    </div>
  </div>);
};

// The log in segments: each send and everything that came back from it. The clock line leads the
// segment ("T+38 → T+83 · CT head"), tick rows show the patient during a long wait, and every
// entry carries its own minute in the gutter, so a troponin back at +15 no longer looks like the
// CBC that took 45.
const Row=({t,children})=><div style={{display:"grid",gridTemplateColumns:"46px 1fr",gap:6,alignItems:"start"}}><span className="mono" style={{fontSize:12,color:C.faint,paddingTop:9,whiteSpace:"nowrap"}}>{t!=null?`T+${t}`:""}</span><div style={{minWidth:0}}>{children}</div></div>;
const TickRow=({m,vitals,norms})=>{
  const cell=(k,label)=>{const bad=isAbn(vitals,k,norms);return<span key={k} style={{color:bad?C.redText:C.dim}}>{label} {fmtVital(vitals,k)}</span>};
  return<Row t={m}><div className="mono" style={{fontSize:12,padding:"6px 0 2px",borderTop:`1px dashed ${C.border}`,display:"flex",gap:10,flexWrap:"wrap"}}>{cell("HR","HR")}{cell("BP","BP")}{cell("SpO2","SpO₂")}{cell("RR","RR")}{cell("GCS","GCS")}</div></Row>;
};
const buildSegments=log=>{
  const segs=[];let cur=null;
  (log||[]).forEach(e=>{
    if(e.k==="doc"||!cur){cur={doc:e.k==="doc"?e:null,items:e.k==="doc"?[]:[e],time:null};segs.push(cur);return}
    if(e.k==="time")cur.time=e;else cur.items.push(e);
  });
  segs.forEach(s=>{s.items=s.items.map((e,i)=>({e,i})).sort((a,b)=>((a.e.atMin??0)-(b.e.atMin??0))||(a.i-b.i)).map(x=>x.e)});
  return segs;
};
const LogView=({log,enc,name,band})=>{
  const norms=normsFor(band);
  const segs=useMemo(()=>buildSegments(log),[log]);
  const out=[];
  segs.forEach((s,si)=>{
    if(s.doc)out.push(<Row key={`d${si}`} t={s.doc.atMin}><LogEntry e={s.doc} name={name}/></Row>);
    const t=s.time;
    if(t&&t.from!=null){
      const label=String(t.t).split(" — ")[1]||t.t;
      out.push(<Row key={`t${si}`}><div className="mono" style={{fontSize:12,color:C.dim,letterSpacing:"0.04em",padding:"8px 0 2px",borderTop:`1px solid ${C.border}`}}>T+{t.from} → T+{t.atMin} · {label}</div></Row>);
      if(enc&&t.atMin-t.from>=15){for(let m=t.from+15;m<t.atMin;m+=15){let v=null;try{v=DW_().vitalsAt(enc,m)}catch{}if(v)out.push(<TickRow key={`k${si}-${m}`} m={m} vitals={v} norms={norms}/>)}}
    }
    let last=null;
    s.items.forEach((e,i)=>{out.push(<Row key={`e${si}-${i}`} t={e.k==="obs"&&!e.atMin?null:e.atMin}><LogEntry e={e} name={name} showLabel={e.k!==last}/></Row>);last=e.k});
    if(t&&t.from==null)out.push(<Row key={`t${si}`}><LogEntry e={t}/></Row>);
  });
  return out;
};

// ── LANDING (v2 copy) ───────────────────────────────────────────────────────
const VitalsStrip=({onSettings})=>{
  const d=new Date();const stamp=`${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.${d.getFullYear()}`;
  return(<div className="mono" style={{position:"sticky",top:0,zIndex:30,height:44,background:"#000",borderBottom:`1px solid ${C.redDim}`,display:"flex",alignItems:"center",padding:"0 6px 0 14px",gap:14,fontSize:12,letterSpacing:"0.05em"}}>
    <span style={{color:C.redText,display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:6,height:6,borderRadius:"50%",background:C.red,animation:"pulse-dot 1.1s infinite"}}/>LIVE</span>
    <span style={{color:C.dim}}>HR <span style={{color:C.text}}>72</span></span>
    <span style={{color:C.dim}}>BP <span style={{color:C.text}}>118/76</span></span>
    <span style={{color:C.dim}}>SpO₂ <span style={{color:C.text}}>98</span></span>
    <span style={{marginLeft:"auto",color:C.faint}}>{stamp}</span>
    {onSettings&&<IconBtn label="Settings" onClick={onSettings} style={{color:C.faint}}><Icon name="settings"/></IconBtn>}
  </div>);
};
const EKGTrace=()=>{
  const W=2400,H=80,mid=H/2;let d=`M 0 ${mid}`;
  for(let x=0;x<W;x+=200){d+=` L ${x+50} ${mid} L ${x+58} ${mid-3} L ${x+66} ${mid+2} L ${x+80} ${mid} L ${x+86} ${mid+6} L ${x+92} ${mid-28} L ${x+100} ${mid+14} L ${x+108} ${mid} L ${x+130} ${mid-4} L ${x+150} ${mid} L ${x+200} ${mid}`}
  return(<svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0.18,pointerEvents:"none"}}><path d={d} fill="none" stroke={C.red} strokeWidth="1.2" strokeDasharray="2400" style={{animation:"ekg-sweep 9s linear infinite"}}/></svg>);
};
const StepBlock=({n,title,body,delay})=>{
  const ref=useRef(null);const [vis,setVis]=useState(false);
  useEffect(()=>{if(!ref.current||!window.IntersectionObserver){setVis(true);return}const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setVis(true);io.disconnect()}},{threshold:0.2});io.observe(ref.current);return()=>io.disconnect()},[]);
  return(<div ref={ref} style={{display:"flex",gap:24,marginBottom:56,opacity:vis?1:0,transform:vis?"none":"translateY(20px)",transition:`all 900ms ${EASE} ${delay}ms`}}><div style={{flexShrink:0,fontSize:42,fontFamily:MONO,fontWeight:700,color:`${C.red}`,letterSpacing:"-0.04em",lineHeight:1}}>{n}</div><div><h3 style={{fontSize:24,fontWeight:600,margin:"0 0 10px",letterSpacing:"-0.02em",lineHeight:1.15}}>{title}</h3><p style={{fontSize:15,color:C.dim,margin:0,lineHeight:1.6}}>{body}</p></div></div>);
};
const CASES_LIST=[
  ["Aortic dissection","presenting as MI or stroke"],["Subarachnoid hemorrhage","as the headache that's 'better now'"],
  ["Early septic shock","with a normal blood pressure"],["Mesenteric ischemia","pain wildly out of proportion"],
  ["Atypical STEMI","in women, in diabetics, in the elderly"],["PE","in the patient dismissed as anxious"],
  ["Necrotizing fasciitis","that looked like cellulitis"],["Temporal arteritis","the headache in the 72-year-old"],
  ["Testicular torsion","presenting as abdominal pain"],["Cauda equina","the back pain with subtle retention"],
];
const kicker={fontSize:12,letterSpacing:"0.32em",textTransform:"uppercase",color:C.amber};
const Landing=({onEnter,onSettings,returning})=>{
  const [m,setM]=useState(false);useEffect(()=>{setM(true)},[]);
  return(<div style={{minHeight:"100dvh",background:C.bg,color:C.text,fontFamily:SERIF}}>
    <VitalsStrip onSettings={onSettings}/>
    <section style={{position:"relative",padding:"96px 24px 80px",overflow:"hidden"}}>
      <EKGTrace/>
      <div style={{position:"relative",zIndex:1,opacity:m?1:0,transform:m?"none":"translateY(12px)",transition:`all 900ms ${EASE}`}}>
        <div className="mono" style={{...kicker,marginBottom:36}}>An ER Gestalt Trainer</div>
        <h1 style={{fontSize:"clamp(72px,17vw,124px)",lineHeight:0.84,fontWeight:700,letterSpacing:"-0.045em",margin:0}}>The<br/><span className="display" style={{fontWeight:400,letterSpacing:"-0.04em"}}>Doorway.</span></h1>
        <div style={{height:1,width:72,background:C.red,margin:"36px 0"}}/>
        <p style={{fontSize:19,lineHeight:1.55,color:C.dim,maxWidth:480,margin:0}}>Every ER doctor develops a sixth sense — the read from the hallway, the hunch before the labs come back.</p>
        <p style={{fontSize:19,lineHeight:1.55,maxWidth:480,marginTop:18}}>It's called clinical gestalt. The hardest thing in medicine to teach.</p>
        <p className="display" style={{fontSize:22,lineHeight:1.45,maxWidth:480,marginTop:22}}>This is the place you practice it.</p>
      </div>
      <button onClick={onEnter} style={{position:"relative",zIndex:1,marginTop:20,display:"inline-flex",alignItems:"center",gap:14,padding:"20px 34px",background:C.text,color:C.bg,fontFamily:MONO,fontSize:13,letterSpacing:"0.14em",textTransform:"uppercase",fontWeight:500}}>
        <span style={{width:8,height:8,background:C.red,borderRadius:"50%"}}/>{returning?"Back to the floor":"Walk through the doorway"}<span>→</span>
      </button>
      <div className="mono" style={{position:"relative",zIndex:1,marginTop:14,fontSize:12,color:C.faint}}>No signup. A patient is waiting.</div>
    </section>
    <section style={{padding:"72px 24px",borderTop:`1px solid ${C.border}`}}>
      <div className="mono" style={{...kicker,marginBottom:54}}>How it works</div>
      {[["01","A patient arrives.","Chief complaint. Vitals. How they look. Two seconds to form your read — sick or not sick."],["02","You work the problem.","Ask history. Examine. Order labs. The patient answers in character. Type freely — compound actions work."],["03","You stabilize. You decide. You learn.","DDx ranked. Disposition. Were you packaged for transfer? A senior attending grades you on the decisions that actually matter in rural EM."]].map(([n,t,b],i)=>(<StepBlock key={n} n={n} title={t} body={b} delay={i*120}/>))}
    </section>
    <section style={{padding:"80px 24px",borderTop:`2px solid ${C.red}`,background:C.bg2}}>
      <div className="mono" style={{...kicker,marginBottom:28}}>Why this exists</div>
      <blockquote className="display" style={{fontSize:26,lineHeight:1.32,fontWeight:400,margin:0,letterSpacing:"-0.005em"}}>"Rural ER docs are the last generalists in medicine. Resuscitationist, generalist, and transport medicine specialist — all in one shift, often alone, often at 3 AM."</blockquote>
      <div style={{height:1,width:48,background:C.red,margin:"28px 0"}}/>
      <p style={{fontSize:15,color:C.dim,lineHeight:1.7,margin:0}}>No commercial simulator trains the gestalt itself. None teaches the rural-specific decision: recognize → stabilize → package → transfer. None lives on your phone for ninety seconds between patients.</p>
      <p style={{fontSize:15,lineHeight:1.7,fontWeight:600,marginTop:14,marginBottom:0}}>This one does.</p>
    </section>
    <section style={{padding:"72px 24px",borderTop:`1px solid ${C.border}`}}>
      <div className="mono" style={{...kicker,marginBottom:32}}>The cases you'll see</div>
      {CASES_LIST.map(([a,b])=>(<div key={a} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:16,padding:"12px 0",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:15,fontWeight:600,letterSpacing:"-0.01em",flexShrink:0}}>{a}</span><span className="display" style={{fontSize:14,color:C.faint,textAlign:"right"}}>{b}</span></div>))}
      <p style={{marginTop:18,fontSize:13,color:C.faint,fontStyle:"italic",lineHeight:1.65}}>Plus everything else — the ear infections, the sprained ankles, the nursing home transfers, the unplanned delivery, the farm injury, the kid with RSV at 2 AM. Rural medicine in full.</p>
    </section>
    <section style={{padding:"64px 24px",borderTop:`1px solid ${C.border}`}}>
      <div className="mono" style={{...kicker,marginBottom:28}}>What this is not</div>
      {[["Not a quiz.","You don't pick A, B, C, D. You ask, examine, and order — the way you actually work."],["Not a textbook.","Every case has a hidden truth. The model plays the patient. You play the doctor."],["Not a simulator.","It's a calibration tool. Over cases, it surfaces your personal blind spots."],["Not for sale.","Open source. Free. Your data stays in your browser."]].map(([t,b])=>(<div key={t} style={{paddingTop:16,marginBottom:18,borderTop:`1px solid ${C.red}`}}><div style={{fontSize:19,fontWeight:600,letterSpacing:"-0.015em",marginBottom:5}}>{t}</div><div style={{fontSize:14,color:C.dim,lineHeight:1.55}}>{b}</div></div>))}
    </section>
    <section style={{padding:"110px 24px 90px",borderTop:`1px solid ${C.border}`,textAlign:"center"}}>
      <p style={{fontSize:"clamp(40px,9vw,56px)",lineHeight:1.02,fontWeight:700,letterSpacing:"-0.04em",maxWidth:480,margin:"0 auto 44px"}}>What's<br/>coming through<br/>the <span className="display" style={{fontWeight:400,color:C.redText}}>door</span>?</p>
      <button onClick={onEnter} style={{display:"inline-flex",alignItems:"center",gap:14,padding:"22px 42px",background:C.red,color:C.text,fontFamily:MONO,fontSize:13,letterSpacing:"0.14em",textTransform:"uppercase",fontWeight:500,boxShadow:`0 24px 60px -22px ${C.red}`}}>{returning?"Back to the floor":"Accept your first patient"}<span>→</span></button>
      <div className="mono" style={{marginTop:60,fontSize:12,color:C.faint,letterSpacing:"0.16em",textTransform:"uppercase",lineHeight:1.8}}>By Ted Delicath · Open source · MIT · github.com/adamb3d3/doorway</div>
      <div style={{marginTop:14,fontSize:12,color:C.faint}}>A training tool, not medical advice.</div>
    </section>
  </div>);
};

// ── HOME ────────────────────────────────────────────────────────────────────
const AcuityGrid=({grid})=>{
  const g=Array.isArray(grid)&&grid.length===5?grid:[...Array(5)].map(()=>[0,0,0,0,0]);
  let n=0,err=0,max=0;g.forEach((row,i)=>(row||[]).forEach((c,j)=>{c=Number(c)||0;n+=c;err+=c*Math.abs(i-j);max=Math.max(max,c)}));
  const mae=n?(err/n).toFixed(2):null;
  const cell={height:40,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,fontSize:12,borderRadius:2};
  const rowSt={display:"grid",gridTemplateColumns:"48px repeat(5,1fr)",gap:3};
  return(<div>
    <div role="table" aria-label="Your doorway acuity (rows) against true acuity (columns), ESI 1 resus to 5 non-urgent" style={{display:"flex",flexDirection:"column",gap:3}}>
      <div role="row" style={rowSt}><div role="columnheader" aria-label="Your call"/>{[1,2,3,4,5].map(j=><div key={j} role="columnheader" aria-label={`True ESI ${j}`} className="mono" style={{fontSize:12,color:C.faint,textAlign:"center"}}>{j}</div>)}</div>
      {g.map((row,i)=><div key={"r"+i} role="row" style={rowSt}>
        <div role="rowheader" className="mono" style={{...cell,fontSize:12,color:C.faint,justifyContent:"flex-start"}}>you {i+1}</div>
        {[0,1,2,3,4].map(j=>{const c=Number((row||[])[j])||0;const diag=i===j;return(
          <div key={j} role="cell" aria-label={`You ${i+1}, true ${j+1}: ${c}`} style={{...cell,background:c?(diag?`rgba(16,185,129,${0.12+0.5*c/max})`:`rgba(139,0,0,${0.15+0.6*c/max})`):"rgba(245,241,232,0.03)",border:diag?`1px solid ${C.goodBorder}`:`1px solid transparent`,color:c?C.text:C.faint}}>{c||"·"}</div>)})}
      </div>)}
    </div>
    <div className="mono" style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:"2px 10px",fontSize:12,color:C.faint,marginTop:8}}>
      <span>ESI: 1 resus · 5 non-urgent · columns = truth</span><span>{mae!=null?<>mean abs error <span style={{color:C.text}}>{mae}</span> · n={n}</>:"no cases yet"}</span>
    </div>
  </div>);
};
const GutVsFinal=({g})=>{
  g=g||{};const cell=(k,good,label)=>(<div style={{padding:"10px 8px",borderRadius:3,background:good?C.goodBg:"rgba(245,241,232,0.03)",border:`1px solid ${good?C.goodBorder:C.border}`}}>
    <div className="mono" style={{fontSize:20,color:C.text}}>{g[k]||0}</div><div style={{fontSize:12,color:C.dim,marginTop:2}}>{label}</div></div>);
  return(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
    {cell("rr",true,"Gut right, final right")}{cell("rw",false,"Gut right, talked out of it")}
    {cell("wr",false,"Gut wrong, workup saved it")}{cell("ww",false,"Gut wrong, final wrong")}
  </div>);
};

// What his read is doing over time, not just where it stands. Shift cases only; Drill reports speed.
const Line=({children})=><div style={{fontSize:15,lineHeight:1.5,color:C.dim}}>{children}</div>;
const Insights=({stats,mode})=>{
  const cal=stats.calibration||{};const rs=stats.readSpeed||{};const cm=stats.cantMiss||{};const dr=stats.drill||{};
  const conf=(stats.confidence||[]).filter(b=>b.n>=3);
  const weak=Object.entries(stats.byDomain||{}).filter(([,d])=>d&&d.n>=3).sort((a,b)=>a[1].avg-b[1].avg).slice(0,3);
  return(<>
    <SectionTitle style={{marginTop:28,marginBottom:10}}>Acuity calibration <span style={{fontWeight:400,color:C.dim}}>· Shift cases</span></SectionTitle>
    <Card><AcuityGrid grid={stats.acuityGrid}/></Card>
    <div style={{marginTop:10,display:"grid",gap:4}}>
      {cal.recent&&cal.recent.mae!=null&&cal.previous&&cal.previous.mae!=null&&<Line>Last 10 reads: acuity error <b style={{color:C.text,fontWeight:600}}>{cal.recent.mae}</b>, was {cal.previous.mae}.</Line>}
      {rs.fast&&rs.fast.n>=3&&rs.slow&&rs.slow.n>=3&&<Line>Reads under 15 s: error {rs.fast.mae} · over 30 s: {rs.slow.mae}.</Line>}
      {conf.map(b=><Line key={b.label}>When you said {b.label}%, your #1 was right {b.right} of {b.n} times.</Line>)}
      {cm.serious>=5&&<Line>Can't-miss diagnoses caught: {cm.caught} of {cm.serious} serious cases.</Line>}
      {(mode==="drill"||dr.n>0)&&dr.firstCritMedian!=null&&<Line>Drill · time to first critical action: median {dr.firstCritMedian} min{dr.firstCritRecent!=null?` (last five: ${dr.firstCritRecent})`:""}.</Line>}
    </div>
    <SectionTitle style={{marginTop:28,marginBottom:10}}>Gut vs final</SectionTitle>
    <GutVsFinal g={stats.gutVsFinal}/>
    <SectionTitle style={{marginTop:28,marginBottom:10}}>Weak spots</SectionTitle>
    {weak.length?<div style={{display:"grid",gap:6}}>{weak.map(([d,v])=><div key={d} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:4}}>
      <span style={{fontSize:15}}>{d}</span><span className="mono" style={{fontSize:12,color:C.dim}}>avg <span style={{color:v.avg<60?C.amber:C.text}}>{Math.round(v.avg)}</span> · n={v.n}</span></div>)}</div>
    :<Line>A domain needs three cases before it counts.</Line>}
    {(stats.movedDomains||[]).length>0&&<div style={{marginTop:8,display:"grid",gap:2}}>{stats.movedDomains.map(m=><Line key={m.domain}>{m.domain}: {m.from} → <b style={{color:m.to>m.from?C.good:C.amber,fontWeight:600}}>{m.to}</b> over {m.n} cases.</Line>)}</div>}
  </>);
};

const Home=({onNext,onResume,onSettings,onOpenHistory,refresh})=>{
  const [settings,setS]=useState(getSettings);
  const [ready,setReady]=useState(prefetchReady);
  const [tip,setTip]=useState(()=>!lsGet("dw_ui_tip_done"));
  const stats=useMemo(safeStats,[refresh,settings]);
  const active=useMemo(()=>{try{return DW_().loadActive()}catch{return null}},[refresh]);
  useEffect(()=>{let live=true;if(!ready&&prefetchPromise)prefetchPromise.then(()=>{if(live)setReady(prefetchReady())});return()=>{live=false}},[ready]);
  // Cold start: write the next case while he reads his stats, so the first tap of the session is not a minute's wait.
  useEffect(()=>{let live=true;if(!ready&&!active){startPrefetch(settings.mode==="drill"?"drill":"shift");if(prefetchPromise)prefetchPromise.then(()=>{if(live)setReady(prefetchReady())})}return()=>{live=false}},[]);
  const mode=settings.mode==="drill"?"drill":"shift";
  const setMode=m=>{setSettings({mode:m});setS(getSettings())};
  const hist=(stats.history||[]).slice().reverse();
  const re=stats.reexposures||{total:0};
  const rules=(stats.rules||[]).slice(0,5);
  const ap=active&&persona(active);
  return(<div style={{minHeight:"100dvh",padding:"0 16px calc(32px + env(safe-area-inset-bottom))",maxWidth:560,margin:"0 auto"}}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
      <div style={{fontSize:22,fontWeight:700,letterSpacing:"-0.03em"}}>The <span className="display-i" style={{fontWeight:400}}>Doorway.</span></div>
      <IconBtn label="Settings" onClick={onSettings}><Icon name="settings"/></IconBtn>
    </header>
    {active&&<button onClick={()=>onResume(active)} style={{width:"100%",textAlign:"left",marginBottom:12,padding:"12px 14px",minHeight:56,background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:4}}>
      <Label color={C.amber}>Patient in progress · T+{active.simMin||0} min</Label>
      <div style={{fontSize:15,marginTop:4}}>{ap.name||"Patient"}{ap.age!=null?`, ${ap.age}${ap.sex||""}`:""} — {ap.chiefComplaint||"resume"} <span style={{color:C.amber}}>→</span></div>
    </button>}
    <button onClick={()=>onNext(mode)} aria-label={`Next patient${ready?", ready":""}`} style={{width:"100%",minHeight:84,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 22px",background:C.text,color:C.bg,borderRadius:4}}>
      <span style={{textAlign:"left"}}><span className="mono" style={{display:"block",fontSize:14,letterSpacing:"0.16em",textTransform:"uppercase",fontWeight:600}}>Next patient</span>
        <span className="mono" style={{display:"flex",alignItems:"center",gap:6,fontSize:12,marginTop:6,color:"rgba(10,10,10,0.7)"}}><span aria-hidden style={{width:7,height:7,borderRadius:4,background:ready?C.good:"rgba(10,10,10,0.3)"}}/>{ready?"ready":"generates on tap"}</span></span>
      <span style={{fontSize:22}} aria-hidden>→</span>
    </button>
    <div style={{marginTop:10}}>
      <Choice label="Mode" activeColor="#262626" activeText={C.text} activeBorder={C.text} value={mode} onChange={setMode} options={[{v:"shift",label:"Shift",sub:"calibration · 3 in 4 benign"},{v:"drill",label:"Drill",sub:"speed · timer on, nights, lookalikes"}]}/>
    </div>
    {tip&&<div style={{marginTop:12}}><Card accent={C.amber} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
      <div style={{flex:1,fontSize:14,lineHeight:1.5,color:C.dim}}>Your history lives only in this browser. Add The Doorway to your Home Screen, and export your data now and then from Settings — Safari can clear site data it thinks you've abandoned.</div>
      <IconBtn label="Dismiss tip" onClick={()=>{lsSet("dw_ui_tip_done","1");setTip(false)}}><Icon name="close" size={20}/></IconBtn>
    </Card></div>}
    {re.total>0&&<div className="mono" style={{marginTop:12,fontSize:12,color:C.dim}}>{re.month?`${re.month} missed pattern${re.month===1?"":"s"} came back this month · ${re.monthCaught} caught`:`${re.total} missed pattern${re.total===1?"":"s"} ${re.total===1?"has":"have"} come back · ${re.caught} caught`}</div>}

    {stats.cases>=10?<Insights stats={stats} mode={mode}/>
      :<div style={{marginTop:24,fontSize:15,lineHeight:1.5,color:C.dim}}>Your calibration appears after ten cases{stats.cases?` — ${10-stats.cases} to go`:""}.</div>}

    {rules.length>0&&<>
      <SectionTitle style={{marginTop:28,marginBottom:10}}>Rules you are carrying</SectionTitle>
      <div style={{display:"grid",gap:6}}>{rules.map((r,i)=><div key={r.caseId||i} style={{padding:"10px 12px",borderLeft:`2px solid ${C.amber}`,background:C.amberBg,borderRadius:4}}>
        <div style={{fontSize:15,lineHeight:1.4}}>{r.rule}</div>
        <div className="mono" style={{fontSize:12,color:C.faint,marginTop:3}}>{r.dx}{r.date?` · ${new Date(r.date).toLocaleDateString()}`:""}</div></div>)}</div>
    </>}

    <SectionTitle style={{marginTop:28,marginBottom:10}}>Recent cases{stats.cases?<span style={{fontWeight:400,color:C.dim}}> · {stats.cases} total</span>:null}</SectionTitle>
    {hist.length?<div style={{display:"grid",gap:4}}>{hist.slice(0,10).map((h,i)=><button key={h.caseId||i} onClick={()=>onOpenHistory(h)} style={{display:"flex",alignItems:"center",gap:10,minHeight:52,padding:"8px 12px",textAlign:"left",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:4}}>
      <span aria-label={h.caught?"caught":"missed"} style={{width:8,height:8,borderRadius:4,flexShrink:0,background:h.caught?C.good:C.red}}/>
      <span style={{flex:1,minWidth:0}}><span style={{display:"block",fontSize:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.dx||"Case"}</span>
        <span className="mono" style={{display:"block",fontSize:12,color:C.faint,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.domain||""}{h.date?` · ${new Date(h.date).toLocaleDateString()}`:""}{h.mode==="drill"?" · drill":""}{h.reexposureOf?" · came back":""}</span>
        {h.carryForward&&<span style={{display:"block",fontSize:13,color:C.dim,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{h.carryForward}</span>}</span>
      <span aria-hidden style={{color:C.faint}}>→</span></button>)}</div>
    :<div style={{fontSize:14,color:C.faint}}>Your first patient is waiting.</div>}
    <div style={{marginTop:32,fontSize:12,color:C.faint,textAlign:"center"}}>A training tool, not medical advice.</div>
  </div>);
};

// ── SETTINGS ────────────────────────────────────────────────────────────────
const SettingsSheet=({onClose,onAbout,onChanged})=>{
  const [s,setS]=useState(getSettings);
  const [key,setKey]=useState(s.apiKey||"");
  const [msg,setMsg]=useState(null);
  const fileRef=useRef(null);
  const upd=p=>{setSettings(p);const n=getSettings();setS(n);onChanged&&onChanged()};
  const saveKey=()=>{upd({apiKey:key.trim()||""});setMsg(key.trim()?"Key saved in this browser.":"Key cleared.")};
  const doExport=()=>{try{const json=DW_().exportData();const blob=new Blob([json],{type:"application/json"});const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`doorway-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);setMsg("Export downloaded.")}catch(e){setMsg("Export failed: "+errMsg(e))}};
  const doImport=async ev=>{const f=ev.target.files&&ev.target.files[0];if(!f)return;try{const txt=await f.text();const r=await Promise.resolve(DW_().importData(txt));
    setMsg(r&&r.ok?`Imported ${r.count??""} item${r.count===1?"":"s"}.`:"Import failed: "+((r&&r.error)||"file not recognised."));const n=getSettings();setS(n);setKey(n.apiKey||"");onChanged&&onChanged()}catch(e){setMsg("Import failed: "+errMsg(e))}ev.target.value=""};
  return(<Sheet title="Settings" onClose={onClose}>
    <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>Your Anthropic API key</div>
    <div style={{fontSize:13,color:C.dim,lineHeight:1.6,marginBottom:10}}>Optional. Without one, a free daily allowance applies. Get one at <a href="https://console.anthropic.com" target="_blank" rel="noopener" style={{color:C.amber}}>console.anthropic.com</a>. Stored only in this browser.</div>
    <input value={key} onChange={e=>setKey(e.target.value)} placeholder="sk-ant-api03-…" autoComplete="off" spellCheck={false} aria-label="API key" style={{width:"100%",minHeight:44,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:4,padding:"10px 12px",fontSize:16,color:C.text,outline:"none",fontFamily:MONO}}/>
    <div style={{display:"flex",gap:8,marginTop:8}}>
      <Btn kind="primary" onClick={saveKey} style={{flex:1}}>Save key</Btn>
      {s.apiKey&&<Btn kind="line" onClick={()=>{setKey("");upd({apiKey:""});setMsg("Key cleared.")}}>Clear</Btn>}
    </div>
    <div style={{height:1,background:C.border,margin:"18px 0 8px"}}/>
    <Toggle on={!!s.timePressure} onChange={v=>upd({timePressure:v})} label="Time pressure" hint="20 seconds at the doorway, then your read locks."/>
    <div style={{height:1,background:C.border,margin:"8px 0 14px"}}/>
    <div style={{fontSize:15,fontWeight:600,marginBottom:8}}>Your data</div>
    <div style={{display:"flex",gap:8}}>
      <Btn kind="line" onClick={doExport} style={{flex:1}}>Export</Btn>
      <Btn kind="line" onClick={()=>fileRef.current&&fileRef.current.click()} style={{flex:1}}>Import</Btn>
      <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{display:"none"}} aria-label="Import file"/>
    </div>
    {msg&&<div role="status" className="mono" style={{fontSize:12,color:C.amber,marginTop:10}}>{msg}</div>}
    <div style={{height:1,background:C.border,margin:"18px 0 6px"}}/>
    <Btn kind="ghost" onClick={onAbout} style={{width:"100%",justifyContent:"space-between",padding:"0 2px"}}>About The Doorway <span aria-hidden>→</span></Btn>
  </Sheet>);
};

// ── LOADING ─────────────────────────────────────────────────────────────────
const STAGE_TEXT={case:"Writing the case",review:"Checking the medicine",results:"Writing the results sheet"};
const Loading=({cond,stage,error,onRetry,onHome,onSettings})=>(
  <div style={{minHeight:"100dvh",display:"flex",flexDirection:"column",padding:"0 16px",maxWidth:560,margin:"0 auto"}}>
    <header style={{height:56,display:"flex",alignItems:"center"}}><IconBtn label="Home" onClick={onHome}><Icon name="back"/></IconBtn></header>
    <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:18,paddingBottom:80}}>
      {cond?<ConditionsStrip cond={cond}/>:<div className="mono" style={{fontSize:12,color:C.faint,letterSpacing:"0.06em"}}>Rolling tonight's conditions…</div>}
      {!error&&<div className="display pulse-slow" role="status" aria-live="polite" style={{fontSize:40,lineHeight:1.1}}>Patient arriving…</div>}
      {!error&&<div style={{fontSize:14,color:C.dim,lineHeight:1.6}}>{STAGE_TEXT[stage]||"The case is being written"}… A new case takes a minute or two; the next one is written while you read the debrief.</div>}
      <ErrorBox error={error} onRetry={onRetry} onSettings={onSettings}/>
    </div>
  </div>);

// ── DOORWAY ─────────────────────────────────────────────────────────────────
const CountdownRing=({total=20,onDone})=>{
  const [left,setLeft]=useState(total);const done=useRef(false);const t0=useRef(Date.now());
  useEffect(()=>{const i=setInterval(()=>{const l=Math.max(0,total-(Date.now()-t0.current)/1000);setLeft(l);
    if(l<=0&&!done.current){done.current=true;clearInterval(i);onDone()}},200);return()=>clearInterval(i)},[]);
  const r=20,circ=2*Math.PI*r,frac=left/total;
  return(<div role="timer" aria-label={`${Math.ceil(left)} seconds left`} style={{width:52,height:52,position:"relative",flexShrink:0}}>
    <svg viewBox="0 0 52 52" style={{width:52,height:52,transform:"rotate(-90deg)"}}><circle cx="26" cy="26" r={r} fill="none" stroke={C.border} strokeWidth="4"/>
      <circle cx="26" cy="26" r={r} fill="none" stroke={left<6?C.redText:C.amber} strokeWidth="4" strokeDasharray={circ} strokeDashoffset={circ*(1-frac)} strokeLinecap="round"/></svg>
    <div className="mono" style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:left<6?C.redText:C.text}}>{Math.ceil(left)}</div>
  </div>);
};

// The look, then the monitor: the patient fills the top of the screen with the name and complaint
// over the lower edge and the impression beneath; the vitals rise into place a beat later, in the
// order a doctor perceives a doorway. Nothing here describes the case (no re-exposure label, no
// domain): every word on this screen is a prior he did not earn. On Lock the patient slides away.
const Doorway=({enc,onLock,onHome})=>{
  const reduced=useReducedMotion();
  const c=caseOf(enc),p=c.persona||{},seed=c.seed||{};
  const [sick,setSick]=useState(null),[acuity,setAcuity]=useState(null),[dispo,setDispo]=useState(null),[err,setErr]=useState(null);
  const [monitor,setMonitor]=useState(reduced);const [closing,setClosing]=useState(false);
  const timed=!!getSettings().timePressure||seed.mode==="drill";
  const v=vitalsNow(enc);
  const all=sick!=null&&acuity!=null&&dispo!=null;
  const rule=useMemo(()=>{const r=(safeStats().rules||[])[0];return r&&r.rule?r:null},[]);
  useEffect(()=>{if(reduced){setMonitor(true);return}const t=setTimeout(()=>setMonitor(true),450);return()=>clearTimeout(t)},[reduced]);
  const lock=(timedOut)=>{
    const gut={sick,acuity:acuity??null,gutDispo:dispo,timedOut:!!timedOut};
    const go=()=>{try{onLock(gut)}catch(e){setClosing(false);setErr(errMsg(e))}};
    if(reduced||closing){go();return}
    setClosing(true);setTimeout(go,600);
  };
  const latest=useRef();latest.current=lock;
  const phys={...(c.physicality||{}),...(enc.physicality||{}),age:(c.physicality&&c.physicality.age)||p.age};
  const missing=[sick==null&&"sick",acuity==null&&"acuity",dispo==null&&"dispo"].filter(Boolean);
  const ageLine=[seed.ageLabel||(p.age!=null?`${p.age} y`:null),p.sex].filter(Boolean).join(" ");
  return(<div className="case-fade" style={{minHeight:"100dvh",maxWidth:560,margin:"0 auto",display:"flex",flexDirection:"column",overflowX:"hidden"}}>
    <header style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px 4px 4px",borderBottom:`1px solid ${C.border}`}}>
      <IconBtn label="Home" onClick={onHome}><Icon name="back"/></IconBtn>
      <div style={{flex:1,minWidth:0}}><ConditionsStrip cond={seed.conditions}/></div>
    </header>
    <div className="door-close" style={{flex:1,padding:"10px 16px 12px",display:"flex",flexDirection:"column",gap:10,transform:closing?"translateX(-110%)":"none",opacity:closing?0:1}}>
      {rule&&<div style={{padding:"8px 10px",borderLeft:`2px solid ${C.amber}`,background:C.amberBg,fontSize:15,lineHeight:1.4}}><span className="mono" style={{fontSize:12,color:C.amber,letterSpacing:"0.08em",marginRight:8}}>YOUR RULE</span>{rule.rule}</div>}
      <div style={{position:"relative",height:208,borderRadius:4,overflow:"hidden",border:`1px solid ${C.border}`,background:"#0a0f18"}}>
        <Avatar phys={phys} still={reduced}/>
        <div style={{position:"absolute",left:0,right:0,bottom:0,padding:"28px 12px 10px",background:"linear-gradient(to top, rgba(6,9,15,0.96) 55%, rgba(6,9,15,0))"}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}><span style={{fontSize:22,fontWeight:600,letterSpacing:"-0.015em",lineHeight:1.1}}>{p.name||"Unknown patient"}</span><span className="mono" style={{fontSize:12,color:C.dim}}>{ageLine}{p.arrivalMode?` · ${p.arrivalMode}`:""}</span></div>
          <div style={{marginTop:4,fontSize:17,lineHeight:1.3}} aria-label={`Chief complaint: ${p.chiefComplaint||"—"}`}>{p.chiefComplaint||"—"}</div>
        </div>
      </div>
      {p.doorwayImpression&&<div className="display" style={{fontSize:20,lineHeight:1.35,color:"#cdd2ee",borderLeft:`2px solid ${C.indigo}`,paddingLeft:10}}>{p.doorwayImpression}</div>}
      {p.emsHandoff&&<div style={{fontSize:15,color:C.dim,lineHeight:1.4}}>EMS: “{p.emsHandoff}”</div>}
      <PhysTags phys={phys}/>
      {monitor?<div className={reduced?"":"rise"}><VitalTiles vitals={v} band={seed.ageBand} reduced={reduced} big/></div>:<div style={{height:66}} aria-hidden/>}
      <Choice label="Sick or not sick" big value={sick} onChange={setSick} options={[{v:true,label:"Sick"},{v:false,label:"Not sick"}]}/>
      <div className="mono" style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.faint,letterSpacing:"0.12em",textTransform:"uppercase"}}><span>Acuity · ESI</span><span style={{color:C.dim,letterSpacing:"0.04em",textTransform:"none"}}>{acuity?acuityText(acuity):"1 sickest · 5 least"}</span></div>
      <Choice label="Acuity, ESI 1 resuscitation to 5 non-urgent" value={acuity} onChange={setAcuity} activeColor={C.amber} activeText={C.bg} fontSize={20} options={[1,2,3,4,5].map(n=>({v:n,label:String(n),aria:`${n} ${ACUITY_WORD[n]}`}))}/>
      <Label>Gut disposition</Label>
      <Choice label="Gut disposition" value={dispo} onChange={setDispo} options={["Discharge","Admit","Transfer"].map(d=>({v:d,label:d}))}/>
      <ErrorBox error={err}/>
    </div>
    <div style={{position:"sticky",bottom:0,padding:"10px 16px calc(10px + env(safe-area-inset-bottom))",background:C.bg,borderTop:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"center",zIndex:10}}>
      {timed&&<CountdownRing total={20} onDone={()=>latest.current(true)}/>}
      <Btn kind="lock" disabled={!all||closing} onClick={()=>lock(false)} style={{flex:1,minHeight:52,fontSize:13}}>{all?"Lock and start →":missing.join(" · ")}</Btn>
    </div>
  </div>);
};

// ── WORKUP ──────────────────────────────────────────────────────────────────
const eventText=(ev,vitals)=>{
  if(!ev)return"";
  if(ev.text||ev.message||ev.label)return ev.text||ev.message||ev.label;
  if(ev.kind==="deteriorating"&&ev.vital){const k=tileKeyFor(ev.vital);const lbl=(VITALS.find(x=>x.k===k)||{}).l||ev.vital;
    const dir=ev.to!=null&&ev.from!=null?(Number(ev.to)<Number(ev.from)?"falling":"rising"):"changing";
    return`${lbl} ${vitals?fmtVital(vitals,k):round(ev.to)} — ${dir}`}
  return String(ev.kind||"Event");
};

const CommitSheet=({enc,onClose,onSubmit,busy,error})=>{
  const [ddx,setDdx]=useState(["","",""]);const [conf,setConf]=useState(60);const [dispo,setDispo]=useState(null);const [focus,setFocus]=useState(null);const [plan,setPlan]=useState("");
  const [tc,setTc]=useState({airway:false,access:false,blood:false,pressors:false,sedation:false,receivingCall:false});
  const names=useMemo(()=>{try{return[...new Set((CASES_().CATALOG||[]).map(x=>x.dx).filter(Boolean))].sort()}catch{return[]}},[]);
  // iOS Safari hides <datalist> suggestions; show up to five matches as tappable chips under the focused field.
  const suggest=i=>{const q=(ddx[i]||"").trim().toLowerCase();if(focus!==i||q.length<2)return[];return names.filter(n=>n.toLowerCase().includes(q)&&n.toLowerCase()!==q).slice(0,5)};
  const dispos=(DW_()&&DW_().DISPOS)||["Discharge","Discharge w/ f/u","Admit inpatient","Transfer","Emergent transfer"];
  const isT=/transfer/i.test(dispo||"");
  const ok=ddx[0].trim()&&dispo&&!busy;
  const TC=[["airway","Airway secured or deliberately not needed"],["access","Two lines / IO"],["blood","Blood hanging or ready"],["pressors","Pressors titrated and stable"],["sedation","Sedation and analgesia running"],["receivingCall","Receiving facility accepted"]];
  const submit=()=>onSubmit({ddx:ddx.map(s=>s.trim()).filter(Boolean),confidence:conf,finalDispo:dispo,transferChecklist:isT?tc:null,plan:plan.trim()});
  return(<Sheet title="Commit" onClose={busy?()=>{}:onClose} maxH="94dvh">
    <SectionTitle size={16} style={{marginBottom:8}}>Differential, most likely first</SectionTitle>
    {ddx.map((d,i)=><div key={i} style={{marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:8}}>
      <span className="mono" style={{fontSize:13,color:i?C.faint:C.amber,width:22}}>#{i+1}</span>
      <input value={d} onChange={e=>{const n=ddx.slice();n[i]=e.target.value;setDdx(n)}} onFocus={()=>setFocus(i)} onBlur={()=>setTimeout(()=>setFocus(f=>f===i?null:f),150)} placeholder={i?"optional":"required"} aria-label={`Diagnosis ${i+1}`} autoComplete="off"
        style={{flex:1,minHeight:44,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:4,padding:"8px 12px",fontSize:16,color:C.text,outline:"none"}}/></div>
      {suggest(i).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"6px 0 2px 30px"}}>{suggest(i).map(n=><button key={n} onMouseDown={e=>e.preventDefault()} onClick={()=>{const x=ddx.slice();x[i]=n;setDdx(x);setFocus(null)}} style={{minHeight:40,padding:"0 12px",borderRadius:4,fontSize:14,background:C.bg3,color:C.text,border:`1px solid ${C.border}`}}>{n}</button>)}</div>}
    </div>)}
    <div className="mono" style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.faint,letterSpacing:"0.14em",textTransform:"uppercase",marginTop:12}}><span>Confidence in #1</span><span style={{color:C.text}}>{conf}%</span></div>
    <input type="range" min="0" max="100" step="5" value={conf} onChange={e=>setConf(Number(e.target.value))} aria-label="Confidence in diagnosis 1"/>
    <SectionTitle size={16} style={{margin:"10px 0 8px"}}>Final disposition</SectionTitle>
    <Choice label="Final disposition" cols={2} value={dispo} onChange={setDispo} options={dispos.map(d=>({v:d,label:d}))}/>
    {isT&&<div style={{marginTop:14}}>
      <SectionTitle size={16} style={{marginBottom:4}}>Packaged for transport?</SectionTitle>
      {TC.map(([k,l])=><Toggle key={k} on={tc[k]} onChange={v=>setTc({...tc,[k]:v})} label={l}/>)}
    </div>}
    <SectionTitle size={16} style={{margin:"14px 0 4px"}}>Plan at disposition <span style={{fontWeight:400,color:C.dim}}>· optional</span></SectionTitle>
    <div style={{fontSize:13,color:C.dim,lineHeight:1.5,marginBottom:6}}>Prescriptions, last orders, return precautions. These run as your final orders before grading.</div>
    <textarea value={plan} onChange={e=>setPlan(e.target.value)} rows={2} aria-label="Plan at disposition" placeholder="e.g. doxycycline 100 mg twice daily for 10 days; return for fever or spreading rash" style={{width:"100%",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:4,padding:10,fontSize:16,color:C.text,outline:"none",resize:"vertical",lineHeight:1.4}}/>
    <ErrorBox error={error} onRetry={ok?submit:null} style={{marginTop:12}}/>
    <div style={{position:"sticky",bottom:-20,margin:"14px -18px -20px",padding:"10px 18px 20px",background:C.bg2,borderTop:`1px solid ${C.border}`}}>
    <Btn kind="lock" disabled={!ok} onClick={submit} style={{width:"100%",minHeight:52}}>{busy?<span className="pulse-slow">Attending reviewing…</span>:"Submit for grading"}</Btn></div>
  </Sheet>);
};

// Stabilize and Transfer first: the groups that matter most in a crashing patient are never off-screen.
const GROUP_ORDER=["Stabilize","Transfer","Time","History","Exam","Labs","Imaging","Procedures"];
const lastSpoken=entries=>{for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(e&&e.k!=="time"&&e.k!=="doc")return(e.k==="event"?"Event: ":"")+e.t}return""};
const chipCostOf=(g,l)=>{try{const d=DW_();return d&&typeof d.chipCost==="function"?Number(d.chipCost(g,l))||0:0}catch{return 0}};
// The header clock rolls from the old minute to the new one over 600 ms, so the jump is seen when it happens.
const useCountUp=(value,ms,reduced)=>{const [v,setV]=useState(value);const from=useRef(value);
  useEffect(()=>{const a=from.current,b=value;if(reduced||ms<=0||a===b){setV(b);from.current=b;return}const t0=performance.now();let raf;
    const step=now=>{const f=Math.min(1,(now-t0)/ms);setV(Math.round(a+(b-a)*f));if(f<1)raf=requestAnimationFrame(step);else from.current=b};
    raf=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf)},[value,ms,reduced]);
  return v};

const Workup=({enc,setEnc,onHome,onGraded,onSettings,saveWarn})=>{
  const reduced=useReducedMotion();
  const c=caseOf(enc),p=c.persona||{},seed=c.seed||{};
  const chipsAll=(DW_()&&DW_().CHIPS)||{};
  const groups=[...GROUP_ORDER.filter(g=>chipsAll[g]),...Object.keys(chipsAll).filter(g=>GROUP_ORDER.indexOf(g)<0)];
  const [tab,setTab]=useState(null);const [tray,setTray]=useState([]);const [text,setText]=useState("");
  const [busy,setBusy]=useState(false);const [err,setErr]=useState(null);const [lastPayload,setLastPayload]=useState(null);
  const [pending,setPending]=useState(null);const [banner,setBanner]=useState(null);const [flash,setFlash]=useState({});
  const [trend,setTrend]=useState(null);const [commit,setCommit]=useState(false);const [gBusy,setGBusy]=useState(false);const [gErr,setGErr]=useState(null);
  const [listening,setListening]=useState(false);const recog=useRef(null);const [interim,setInterim]=useState("");
  const [saveFail,setSaveFail]=useState(!!saveWarn);const [announce,setAnnounce]=useState("");const [who,setWho]=useState(false);
  const logRef=useRef(null);
  const shownMin=useCountUp(enc.simMin||0,600,reduced);
  // Stale-reply guard: a reply that lands after he left this screen (or this case) is dropped.
  const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
  const caseId=seed.caseId;
  const log=enc.log||[];
  const vitals=vitalsNow(enc);
  const hist=enc.vitalsHistory||[];
  const prev=hist.length>1?hist[hist.length-2].vitals:null;
  useEffect(()=>{const el=logRef.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:reduced?"auto":"smooth"})},[log.length,pending,reduced]);
  useEffect(()=>()=>{try{recog.current&&recog.current.stop()}catch{}},[]);

  const toggleChip=(group,label)=>{haptic(8);setTray(t=>t.some(x=>x.group===group&&x.label===label)?t.filter(x=>!(x.group===group&&x.label===label)):[...t,{group,label}])};
  const send=async payload=>{
    payload=payload||{text:text.trim(),chips:tray};
    if(busy||(!payload.text&&!(payload.chips&&payload.chips.length)))return;
    setBusy(true);setErr(null);setLastPayload(payload);setBanner(null);
    setPending([payload.text,...payload.chips.map(x=>x.label)].filter(Boolean).join(" · "));
    setText("");setTray([]);setTab(null);haptic(10);
    try{
      const r=await DW_().act(enc,{text:payload.text||undefined,chips:payload.chips});
      if(!live.current)return; // he left this screen; the reply is dropped
      if(!r||r.stale||seedOf(r.enc).caseId!==caseId){setErr("Another patient is active on this device. Go Home to pick one.")}
      else{
        setEnc(r.enc);setLastPayload(null);
        setSaveFail(!!r.saveFailed);
        setAnnounce(lastSpoken(r.entries||[]));
        const evs=r.events||[];
        if(evs.length){const nv=vitalsNow(r.enc);const first=evs.find(e=>e.kind==="deteriorating")||evs[0];
          setBanner({text:eventText(first,nv),more:evs.length-1,at:first.atMin});haptic([40,60,40]);
          const f={};evs.forEach(e=>{if(e.vital)f[tileKeyFor(e.vital)]=Date.now()});setFlash(f)}
      }
    }catch(e){if(!live.current)return;setErr(errMsg(e));setText(payload.text||"");setTray(payload.chips||[])}
    if(live.current){setPending(null);setBusy(false)}
  };
  const voice=()=>{
    if(listening){try{recog.current&&recog.current.stop()}catch{}return}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){setErr("Voice input isn't supported in this browser.");return}
    try{const r=new SR();r.lang="en-US";r.interimResults=true;
      r.onresult=e=>{let fin="",tmp="";for(let i=e.resultIndex;i<e.results.length;i++){const res=e.results[i];if(res.isFinal)fin+=res[0].transcript;else tmp+=res[0].transcript}
        if(fin.trim())setText(x=>(x?x+" ":"")+fin.trim());setInterim(tmp)};
      r.onerror=()=>{setListening(false);setInterim("")};r.onend=()=>{setListening(false);setInterim("")};
      r.start();recog.current=r;setListening(true);haptic(15)}catch(e){setErr(errMsg(e))}
  };
  const grade=async answers=>{
    setGBusy(true);setGErr(null);
    try{const g=await DW_().grade(enc,answers);if(!live.current)return;setGBusy(false);onGraded(enc,g,answers)}
    catch(e){if(!live.current)return;setGErr(errMsg(e));setGBusy(false)}
  };
  const gut=enc.gut||{};
  const tr=enc.transport;
  const eta=tr&&tr.etaMin!=null?Math.round(tr.etaMin-(enc.simMin||0)):null;
  const n=tray.length;
  const batchCost=tray.reduce((m,x)=>Math.max(m,chipCostOf(x.group,x.label)),0);
  const crewHere=!!(tr&&tr.status==="at bedside");
  const physNow={...(c.physicality||{}),...(enc.physicality||{}),age:p.age};
  const firstName=(p.name||"Patient").split(" ")[0];
  const ageLine=[seed.ageLabel||(p.age!=null?`${p.age} y`:null),p.sex].filter(Boolean).join(" ");
  return(<div style={{height:"100dvh",display:"flex",flexDirection:"column",maxWidth:560,margin:"0 auto",overflow:"hidden"}}>
    <header style={{flexShrink:0,background:C.bg,borderBottom:`1px solid ${C.border}`,padding:"0 8px 8px"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,height:52}}>
        <IconBtn label="Home" onClick={onHome}><Icon name="back"/></IconBtn>
        <button onClick={()=>setWho(true)} aria-label={`About ${p.name||"the patient"}`} style={{width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:34,height:40,borderRadius:3,overflow:"hidden",border:`1px solid ${C.border}`}}><Avatar phys={physNow} still/></div></button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"baseline",gap:8,minWidth:0}}>
            <span className="mono" style={{fontSize:17,fontWeight:700,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}} aria-label={`T plus ${shownMin} minutes`}>T+{shownMin}</span>
            {tr&&<span className="mono" style={{fontSize:12,color:tr.status==="declined"?C.redText:C.amber,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:1}}>{tr.mode==="flight"?"Flight":"Ground"} {eta!=null?(eta>0?`ETA ${eta}m`:"at bedside"):(tr.status||"")}</span>}
            <span className="mono" style={{marginLeft:"auto",fontSize:12,color:C.dim,display:"inline-flex",alignItems:"center",gap:4,minWidth:0,flexShrink:1}} aria-label="Locked gut"><Icon name="lock" size={12}/><span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{gut.timedOut?"timed out · ":""}{gut.sick==null?"—":gut.sick?"Sick":"Not sick"} · {gut.acuity?`ESI ${gut.acuity}`:"ESI —"} · {gut.gutDispo||"—"}</span></span>
          </div>
          <div className="mono" style={{fontSize:12,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name||"Patient"}{ageLine?` · ${ageLine}`:""}{p.chiefComplaint?` · ${p.chiefComplaint}`:""}</div>
        </div>
        <Btn kind={crewHere?"lock":"line"} onClick={()=>setCommit(true)} disabled={busy} style={{padding:"0 10px",fontSize:12,flexShrink:0}}>Commit</Btn>
      </div>
      <div style={{padding:"0 4px 6px"}}><ConditionsStrip cond={seed.conditions} compact/></div>
      {(enc.pending||[]).length>0&&<div className="mono" aria-label="Results pending" style={{fontSize:12,color:C.amber,padding:"0 4px 6px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Pending · {enc.pending.map(p=>`${p.label} ~T+${p.readyAt}`).join(" · ")}</div>}
      <VitalTiles vitals={vitals} prev={prev} band={seed.ageBand} onTap={setTrend} flash={flash} reduced={reduced}/>
      {saveFail&&<div role="status" style={{marginTop:6,padding:"8px 12px",fontSize:14,lineHeight:1.4,background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderRadius:4,display:"flex",alignItems:"center",gap:8}}>
        <span style={{flex:1}}>Couldn't save — export your data.</span>
        <Btn kind="ghost" onClick={onSettings} style={{color:C.amber,minHeight:44,padding:"0 6px"}}>Export →</Btn></div>}
    </header>

    <div style={{position:"relative",flex:1,minHeight:0}}>
      {banner&&<div role="alert" className="banner-in" style={{position:"absolute",top:8,left:12,right:12,zIndex:5,display:"flex",alignItems:"center",gap:8,padding:"6px 4px 6px 12px",background:C.red,color:C.text,borderRadius:4,boxShadow:"0 10px 28px rgba(0,0,0,0.55)"}}>
        <Icon name="warn" size={16}/>
        <span style={{flex:1,fontSize:15,lineHeight:1.35}}>{banner.text}<span className="mono" style={{fontSize:12,opacity:0.8}}>{banner.at!=null?` · T+${banner.at}`:""}{banner.more>0?` · +${banner.more} more in log`:""}</span></span>
        <IconBtn label="Dismiss alert" onClick={()=>setBanner(null)} style={{color:C.text,minWidth:40,minHeight:40}}><Icon name="close" size={18}/></IconBtn>
      </div>}
      <div ref={logRef} style={{height:"100%",overflowY:"auto",padding:"10px 12px 10px 8px",display:"flex",flexDirection:"column",gap:7}}>
        <LogView log={log} enc={enc} name={(p.name||"").split(" ")[0]} band={seed.ageBand}/>
        {pending&&<Row><LogEntry e={{k:"doc",t:pending,pending:true}}/></Row>}
        {busy&&<div className="display pulse-slow" style={{color:C.faint,fontSize:15}}>…</div>}
        <ErrorBox error={err} onRetry={lastPayload?()=>send(lastPayload):null} onSettings={onSettings}/>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>
    </div>

    <div style={{flexShrink:0,borderTop:`1px solid ${C.border}`,background:C.bg,paddingBottom:"env(safe-area-inset-bottom)"}}>
      {tab&&chipsAll[tab]&&<div id="dw-chip-panel" role="group" aria-label={`${tab} options`} style={{display:"flex",flexWrap:"wrap",gap:6,padding:"8px 8px 2px",maxHeight:"45dvh",overflowY:"auto"}}>
        {chipsAll[tab].map(l=>{const on=tray.some(x=>x.group===tab&&x.label===l);const cost=chipCostOf(tab,l);return(
          <button key={l} className="chip" aria-label={l} aria-pressed={on} onClick={()=>toggleChip(tab,l)} style={{minHeight:44,padding:"0 14px",borderRadius:4,fontSize:14,background:on?C.text:C.bg3,color:on?C.bg:C.text,border:`1px solid ${on?C.text:C.border}`,display:"inline-flex",alignItems:"center"}}>{l}{cost>0&&<span className="mono" aria-hidden style={{fontSize:12,color:on?"rgba(10,10,10,0.65)":C.faint,marginLeft:7}}>+{cost}</span>}</button>)})}
      </div>}
      <div aria-label="Order groups" style={{display:"flex",flexWrap:"wrap",gap:6,padding:"8px 8px 0",opacity:crewHere?0.6:1}}>
        {groups.map(g=>{const on=tab===g;const cnt=tray.filter(x=>x.group===g).length;return(
          <button key={g} aria-expanded={on} aria-controls="dw-chip-panel" className="chip mono" onClick={()=>{setTab(on?null:g);haptic(6)}} style={{minHeight:44,padding:"0 11px",borderRadius:4,fontSize:12,letterSpacing:"0.06em",textTransform:"uppercase",background:on?C.text:C.bg3,color:on?C.bg:(g==="Stabilize"||g==="Transfer")?C.amber:C.dim,border:`1px solid ${on?C.text:C.border}`}}>{g}{cnt?` · ${cnt}`:""}</button>)})}
      </div>
      {listening&&<div className="mono" role="status" style={{fontSize:12,color:C.faint,padding:"6px 8px 0"}}>{interim||"Listening…"}</div>}
      <div style={{display:"flex",gap:6,padding:8,alignItems:"flex-end"}}>
        <IconBtn label={listening?"Stop dictation":"Dictate"} onClick={voice} style={{border:`1px solid ${listening?C.amber:C.border}`,background:listening?C.amberBg:C.bg3,color:listening?C.amber:C.text,width:48,height:48}}><Icon name="mic"/></IconBtn>
        <div style={{flex:1,minWidth:0,minHeight:48,display:"flex",flexWrap:"wrap",alignItems:"center",gap:4,padding:"4px 6px",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:4}} aria-label="Selected orders">
          {tray.map(x=><button key={x.group+x.label} onClick={()=>toggleChip(x.group,x.label)} aria-label={`Remove ${x.label}`} style={{minHeight:36,padding:"0 10px",borderRadius:4,fontSize:13,background:C.docBg,color:C.doc,border:`1px solid ${C.docBorder}`,whiteSpace:"nowrap"}}>{x.label} <span aria-hidden style={{opacity:0.7}}>×</span></button>)}
          <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")send()}} placeholder={n?"add a note…":"Type an order or a question"} enterKeyHint="send" aria-label="Free text order or question"
            style={{flex:"1 1 120px",minWidth:0,minHeight:38,background:"transparent",border:"none",padding:"0 6px",fontSize:16,color:C.text,outline:"none"}}/>
        </div>
        <Btn kind="primary" onClick={()=>send()} disabled={busy||(!text.trim()&&!n)} style={{minHeight:48,padding:"0 14px",whiteSpace:"nowrap"}} aria-label={n?`Send ${n} orders`:"Send"}>{busy?"…":n?`Send ${n}${batchCost?` · +${batchCost}`:""}`:"Send"}</Btn>
      </div>
    </div>
    {who&&<Sheet title={p.name||"Patient"} onClose={()=>setWho(false)}>
      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
        <div style={{width:128,height:160,flexShrink:0,borderRadius:4,overflow:"hidden",border:`1px solid ${C.border}`,background:"#0a0f18"}}><Avatar phys={physNow} still={reduced}/></div>
        <div style={{flex:1,minWidth:0,display:"grid",gap:6,fontSize:15,lineHeight:1.4}}>
          <div className="mono" style={{fontSize:12,color:C.dim}}>{ageLine}{p.ethnicity?` · ${p.ethnicity}`:""}{p.occupation?` · ${p.occupation}`:""}</div>
          <div className="mono" style={{fontSize:12,color:C.faint}}>Arrived {p.arrivalMode||"—"}</div>
          <div style={{padding:"6px 8px",background:C.amberBg,borderLeft:`2px solid ${C.amber}`,borderRadius:2}}>{p.chiefComplaint||"—"}</div>
        </div>
      </div>
      {p.emsHandoff&&<div style={{marginTop:12,fontSize:15,color:C.dim,lineHeight:1.4}}>EMS: “{p.emsHandoff}”</div>}
      {p.doorwayImpression&&<div className="display" style={{marginTop:12,fontSize:18,lineHeight:1.35,color:"#cdd2ee",borderLeft:`2px solid ${C.indigo}`,paddingLeft:10}}>{p.doorwayImpression}</div>}
      <div style={{marginTop:14}}><ConditionsStrip cond={seed.conditions}/></div>
      <div className="mono" style={{marginTop:12,fontSize:12,color:C.dim,display:"flex",alignItems:"center",gap:6}}><Icon name="lock" size={12}/>Your read: {gut.sick==null?"—":gut.sick?"sick":"not sick"} · ESI {gut.acuity||"—"} · {gut.gutDispo||"—"}{gut.elapsedSec!=null?` · locked in ${gut.elapsedSec} s`:""}{gut.timedOut?" · timed out":""}</div>
      <div style={{height:12}}/>
    </Sheet>}
    {trend&&<TrendSheet k={trend} enc={enc} band={seed.ageBand} onClose={()=>setTrend(null)}/>}
    {commit&&<CommitSheet enc={enc} onClose={()=>setCommit(false)} onSubmit={grade} busy={gBusy} error={gErr}/>}
  </div>);
};

// ── DEBRIEF ─────────────────────────────────────────────────────────────────
const Pair=({label,you,truth,ok,note})=>(
  <div style={{display:"grid",gridTemplateColumns:"74px 1fr 1fr",gap:8,alignItems:"start",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
    <Label style={{letterSpacing:"0.12em",paddingTop:2}}>{label}</Label>
    <div><div style={{fontSize:15,color:ok===false?C.redText:ok?C.good:C.text}}>{you??"—"}</div>{note&&<div className="mono" style={{fontSize:12,color:C.faint,marginTop:2}}>{note}</div>}</div>
    <div style={{fontSize:15,color:C.dim}}>{truth??"—"}</div>
  </div>);

const Pairs=({d})=>(
  <Card>
    <div style={{display:"grid",gridTemplateColumns:"74px 1fr 1fr",gap:8}}><span/><Label>You</Label><Label>Truth</Label></div>
    <Pair label="Read" you={d.gutSick==null?"—":d.gutSick?"Sick":"Not sick"} truth={d.trueSerious==null?"—":d.trueSerious?"Sick":"Not sick"} ok={d.gutSick==null||d.trueSerious==null?undefined:d.gutSick===d.trueSerious} note={[d.lockSec!=null?`locked in ${d.lockSec} s`:null,d.timedOut?"timed out":null].filter(Boolean).join(" · ")||null}/>
    <Pair label="ESI" you={acuityText(d.gutAcuity)} truth={acuityText(d.trueAcuity)} ok={d.gutAcuity==null||d.trueAcuity==null?undefined:Math.abs(d.gutAcuity-d.trueAcuity)<=0} note={d.gutAcuity!=null&&d.trueAcuity!=null&&d.gutAcuity!==d.trueAcuity?`off by ${Math.abs(d.gutAcuity-d.trueAcuity)}`:null}/>
    <Pair label="Dispo" you={d.finalDispo||d.gutDispo} truth={d.trueDispo} ok={d.trueDispo?dispoFamily(d.finalDispo)===dispoFamily(d.trueDispo):undefined} note={d.gutDispo?`gut: ${d.gutDispo}`:null}/>
    <Pair label="Dx" you={(d.ddx&&d.ddx[0])||"—"} truth={d.trueDx} ok={d.caught==null?undefined:!!d.caught} note={d.rank?`true dx at #${d.rank}${d.confidence!=null?` · ${d.confidence}% sure of #1`:""}`:d.caught===false?"not in your DDx":null}/>
  </Card>);

// Two columns, one clock: the answer key's ideal sequence on the left, what he did on the right,
// critical-action windows as bands across both, lateness as the gap between them. Items sit at
// their minute and are nudged down when they collide; DOM order stays by minute.
const layoutColumn=(items,scale,rowH)=>{const sorted=items.slice().sort((a,b)=>a.m-b.m||a.o-b.o);let y=0;return sorted.map(it=>{const top=Math.max(it.m*scale,y);y=top+rowH(it)+8;return{...it,top}})};
const Ruler=({enc,grade,answers,ak})=>{
  const [hs,setHs]=useState({});
  const refs=useRef({});
  const end=Math.max(1,Number(enc.simMin)||0);
  const clampM=v=>Math.max(0,Math.min(Number(v)||0,end));
  const crits=grade.criticalActions||[];
  const ideal=(ak.idealSequence||[]).map((s,i)=>({m:clampM(s.atMin),o:1,kind:"ideal",text:s.action,key:"i"+i}));
  crits.forEach((a,i)=>{if(a.status==="missed")ideal.push({m:clampM(a.windowMin),o:2,kind:"missed",text:a.action,win:a.windowMin,key:"m"+i})});
  const mine=[];
  (enc.log||[]).forEach((e,i)=>{if(e.k==="doc")mine.push({m:clampM(e.atMin),o:1,kind:"order",text:e.t,vitals:e.vitals,key:"d"+i});else if(e.k==="event")mine.push({m:clampM(e.atMin),o:0,kind:"event",text:e.t,key:"e"+i})});
  crits.forEach((a,i)=>{if(a.status==="done")mine.push({m:clampM(a.atMin),o:2,kind:"done",text:a.action,key:"c"+i});else if(a.status==="late")mine.push({m:clampM(a.atMin??a.windowMin),o:2,kind:"late",text:a.action,late:a.atMin!=null&&a.windowMin!=null?a.atMin-a.windowMin:null,win:a.windowMin,key:"l"+i})});
  (grade.divergences||[]).forEach((d,i)=>mine.push({m:clampM(d.atMin),o:3,kind:"div",did:d.did,should:d.shouldHave,key:"v"+i}));
  mine.push({m:end,o:9,kind:"commit",text:(answers&&answers.finalDispo)||"—",key:"commit"});
  const scale=Math.max(1.4,Math.min(3.2,560/end));
  // Heights are measured after the first paint (text wraps unpredictably at 157px); until then an estimate.
  const est=it=>{const chars=it.kind==="div"?((it.did||"").length+(it.should||"").length+24):(it.text||"").length;const lines=Math.max(1,Math.ceil(chars/22));return (it.kind==="ideal"||it.kind==="order"?0:18)+lines*18+(it.vitals?16:0)+4};
  const rowH=it=>hs[it.key]||est(it);
  const L=layoutColumn(ideal,scale,rowH),R=layoutColumn(mine,scale,rowH);
  const H=Math.max(end*scale,...L.map(i=>i.top+rowH(i)),...R.map(i=>i.top+rowH(i)))+16;
  useLayoutEffect(()=>{const next={};let changed=false;Object.entries(refs.current).forEach(([k,el])=>{if(!el)return;const h=el.offsetHeight;next[k]=h;if(hs[k]!==h)changed=true});if(changed)setHs(next)});
  const step=end>180?60:end>90?30:15;const stamps=[];for(let m=0;m<=end;m+=step)stamps.push(m);
  const bands=crits.filter(a=>a.windowMin!=null&&a.status!=="done").map((a,i)=><div key={"w"+i} aria-hidden style={{position:"absolute",left:0,right:0,top:0,height:clampM(a.windowMin)*scale,background:a.status==="missed"?"rgba(139,0,0,0.09)":"rgba(212,160,74,0.06)",borderBottom:`1px dashed ${a.status==="missed"?C.red:C.amber}`}}/>);
  const tag=(color,t)=><div className="mono" style={{fontSize:12,color,letterSpacing:"0.06em",textTransform:"uppercase"}}>{t}</div>;
  const item=(it,withAttrs)=>{
    let body;
    if(it.kind==="ideal")body=<div style={{color:C.dim}}>{it.text}</div>;
    else if(it.kind==="missed")body=<>{tag(C.redText,`Missed · by T+${it.win}`)}<div>{it.text}</div></>;
    else if(it.kind==="order")body=<><div style={{color:C.doc}}>{it.text}</div>{it.vitals&&<div className="mono" style={{fontSize:12,color:C.faint,marginTop:2}}>HR {it.vitals.HR} · BP {it.vitals.SBP}/{it.vitals.DBP} · SpO₂ {it.vitals.SpO2}%</div>}</>;
    else if(it.kind==="event")body=<>{tag(C.redText,"Event")}<div>{it.text}</div></>;
    else if(it.kind==="done")body=<>{tag(C.good,"On time")}<div>{it.text}</div></>;
    else if(it.kind==="late")body=<>{tag(C.amber,`+${it.late} min late`)}<div>{it.text}</div></>;
    else if(it.kind==="div")body=<>{tag(C.indigo,"Divergence")}<div style={{color:C.dim}}>You: {it.did}</div><div>Should have: {it.should}</div></>;
    else body=<>{tag(C.dim,"Committed")}<div>{it.text}</div></>;
    const attrs=withAttrs?{"data-tl-min":Math.round(it.m),"data-tl-kind":it.kind}:{};
    return<div key={it.key} ref={el=>{refs.current[it.key]=el}} {...attrs} style={{position:"absolute",top:it.top,left:0,right:0,fontSize:14,lineHeight:1.3}}>{body}</div>;
  };
  const lateLines=R.filter(it=>it.kind==="late"&&it.win!=null).map(it=><div key={"ll"+it.key} aria-hidden style={{position:"absolute",left:21,top:clampM(it.win)*scale,height:Math.max(0,it.top-clampM(it.win)*scale),borderLeft:`2px solid ${C.amber}`}}/>);
  return(<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 44px 1fr",marginBottom:6}}><Label>Ideal</Label><span/><Label style={{textAlign:"right"}}>You</Label></div>
    <div style={{position:"relative",display:"grid",gridTemplateColumns:"1fr 44px 1fr",height:H}}>
      <div style={{position:"relative"}}>{bands}{L.map(it=>item(it,false))}</div>
      <div style={{position:"relative"}}>
        <div aria-hidden style={{position:"absolute",left:21,top:0,bottom:0,borderLeft:`1px solid ${C.border}`}}/>
        {lateLines}
        {stamps.map(m=><div key={m} className="mono" style={{position:"absolute",top:m*scale-7,left:0,width:44,textAlign:"center",fontSize:12,color:C.faint,background:C.bg,lineHeight:"14px"}}>T+{m}</div>)}
      </div>
      <div style={{position:"relative",textAlign:"right"}}>{R.map(it=>item(it,true))}</div>
    </div>
  </div>);
};

const Debrief=({data,onNext,onHome})=>{
  // data: {enc, grade, answers} for a fresh debrief; {enc, grade, answers, entry, readOnly:true} from DW.getResult
  // for a recent case; {entry} alone for an older case whose full result was trimmed.
  const {enc,grade,answers={},entry}=data;
  const full=!!(enc&&grade); // timeline, carry forward, wins/misses available
  const ro=!!data.readOnly||!full; // past case: no editing
  const ak=enc?caseOf(enc).answerKey||{}:{};
  const seed=enc?seedOf(enc):{};
  const gut=enc&&enc.gut||{};
  const d=!full?{gutSick:entry.gutSick,timedOut:entry.gutTimedOut,lockSec:entry.lockSec,trueSerious:entry.bucket?entry.bucket==="serious":null,gutAcuity:entry.gutAcuity,trueAcuity:entry.trueAcuity,gutDispo:entry.gutDispo,finalDispo:entry.finalDispo,trueDispo:entry.trueDispo,ddx:entry.ddx,trueDx:entry.dx,caught:entry.caught,rank:entry.rankOfTrueDx,confidence:entry.confidence}
    :{gutSick:gut.sick,timedOut:gut.timedOut,lockSec:gut.elapsedSec,trueSerious:seed.bucket?seed.bucket==="serious":(ak.trueAcuity!=null?ak.trueAcuity<=2:null),gutAcuity:gut.acuity,trueAcuity:ak.trueAcuity,gutDispo:gut.gutDispo,finalDispo:answers.finalDispo,trueDispo:ak.trueDispo,ddx:answers.ddx,trueDx:ak.trueDx||seed.dx,caught:grade.caughtInDdx,rank:grade.rankOfTrueDx,confidence:answers.confidence};
  const crits=full?(grade.criticalActions||[]):[];
  const anyMissed=full?crits.some(a=>a.status==="missed"):(entry.critMissed||[]).length>0;
  const needReflect=d.caught===false||anyMissed;
  const caseId=(entry&&entry.caseId)||seed.caseId;
  const [refl,setRefl]=useState((entry&&entry.reflection)||"");const [reflMsg,setReflMsg]=useState(null);
  const [flagOpen,setFlagOpen]=useState(false);const [flagNote,setFlagNote]=useState("");const [flagMsg,setFlagMsg]=useState(entry&&entry.flagged?"Flagged.":null);
  const saveRefl=()=>{try{if(!DW_().saveReflection(caseId,refl.trim()))throw new Error("Couldn't find this case in your history.");setReflMsg("Saved.")}catch(e){setReflMsg(errMsg(e))}};
  const flag=()=>{try{if(!DW_().flagGrade(caseId,flagNote.trim()))throw new Error("case not in history");setFlagMsg("Flagged. It's marked in your history and export.");setFlagOpen(false)}catch(e){setFlagMsg("Couldn't flag: "+errMsg(e))}};
  const score=full?grade.score:entry.score;
  const sc=score>=80?C.good:score>=60?C.amber:C.redText;
  // Named only now, never at the doorway: the pattern that came back, and where he met it before.
  const orig=useMemo(()=>{const o=seed.reexposure&&seed.reexposure.originalCaseId;if(!o)return null;try{return DW_().findHistory(o)||{caseId:o}}catch{return{caseId:o}}},[seed]);
  const idealEnd=full?Math.max(0,...(ak.idealSequence||[]).map(s=>Number(s.atMin)||0)):0;
  const slowBenign=full&&d.trueSerious===false&&idealEnd>0&&Number(enc.simMin)>idealEnd*1.5;
  const ruleUsed=full&&grade.ruleApplied&&grade.ruleApplied.text?grade.ruleApplied:null;
  // Wins/misses only when they add something the timeline doesn't already say.
  const tlText=useMemo(()=>full?[...(enc.log||[]).filter(e=>e.k==="doc"||e.k==="event").map(e=>e.t),...crits.map(a=>a.action),...(grade.divergences||[]).flatMap(x=>[x.did,x.shouldHave])].filter(Boolean).join(" \n ").toLowerCase():"",[full,enc,grade]);
  const said=line=>{const w=String(line).toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(x=>x.length>3);if(!w.length)return false;return w.filter(x=>tlText.includes(x)).length/w.length>=0.7};
  const wins=full?(grade.wins||[]).filter(x=>!said(x)):[],misses=full?(grade.misses||[]).filter(x=>!said(x)):[];
  return(<div className="case-fade" style={{minHeight:"100dvh",maxWidth:560,margin:"0 auto",padding:"0 16px calc(24px + env(safe-area-inset-bottom))"}}>
    <header style={{display:"flex",alignItems:"center",height:56,gap:6}}><IconBtn label="Home" onClick={onHome}><Icon name="back"/></IconBtn><SectionTitle size={22}>{ro?"Past case":"Debrief"}</SectionTitle></header>
    <div className="display" style={{fontSize:30,lineHeight:1.15,color:C.amber,margin:"2px 0 14px"}}>{d.trueDx||"—"}</div>
    {full&&grade.criticalError&&<Card accent={C.red} style={{marginBottom:12,background:C.badBg}}><Label color={C.redText}>Critical error</Label><div style={{fontSize:15,marginTop:4,lineHeight:1.5}}>{grade.criticalError}</div></Card>}
    {orig&&<Card accent={C.amber} style={{marginBottom:12}}><SectionTitle size={16} color={C.amber}>This one came back</SectionTitle>
      <div style={{fontSize:15,lineHeight:1.5,marginTop:4}}>You missed {d.trueDx||"this"}{orig.date?` on ${new Date(orig.date).toLocaleDateString()}`:" before"}{orig.ageBand||orig.presentation?` (${[orig.ageBand,orig.presentation?`"${orig.presentation}"`:null].filter(Boolean).join(", ")})`:""}. Today it was {[seed.ageBand,seed.presentation?`"${seed.presentation}"`:null].filter(Boolean).join(", ")||"a different presentation"}{d.caught?" — and you caught it.":"."}</div></Card>}
    <Pairs d={d}/>
    {ruleUsed&&<div style={{marginTop:12,padding:"10px 12px",borderLeft:`2px solid ${ruleUsed.followed===false?C.amber:C.good}`,background:C.bg2,borderRadius:4,fontSize:15,lineHeight:1.45}}>
      <span className="mono" style={{fontSize:12,color:C.faint,letterSpacing:"0.08em",marginRight:8}}>YOUR RULE</span>“{ruleUsed.text}”{ruleUsed.followed===true?" — you followed it.":ruleUsed.followed===false?" — you didn't.":""}</div>}
    {slowBenign&&<div style={{marginTop:12,fontSize:15,lineHeight:1.45,color:C.dim}}>T+{enc.simMin} for a case the key finishes by T+{idealEnd}. In a 25-bed hospital with one nurse, the cost of a long workup is everyone else in the building.</div>}

    {full&&<>
      <SectionTitle style={{margin:"24px 0 4px"}}>Timeline</SectionTitle>
      <div style={{fontSize:14,color:C.dim,padding:"6px 0 10px"}}>T+0 · gut locked: {d.gutSick==null?"—":d.gutSick?"sick":"not sick"}, acuity {d.gutAcuity??"—"}, {d.gutDispo||"—"}{d.timedOut?" (timed out)":""}</div>
      <Ruler enc={enc} grade={grade} answers={answers} ak={ak}/>
    </>}
    {!full&&(entry.critMissed||[]).length+(entry.critLate||[]).length>0&&<Card style={{marginTop:14}}>
      {(entry.critMissed||[]).map(x=><div key={"m"+x} style={{fontSize:14,color:C.redText}}>Missed critical action: {x}</div>)}
      {(entry.critLate||[]).map(x=><div key={"l"+x} style={{fontSize:14,color:C.amber}}>Late critical action: {x}</div>)}
    </Card>}

    {full&&grade.carryForward&&<div style={{marginTop:22,padding:"16px 16px",background:C.amberBg,border:`1px solid ${C.amberBorder}`,borderLeft:`3px solid ${C.amber}`,borderRadius:4}}>
      <SectionTitle size={16} color={C.amber}>Carry forward</SectionTitle>
      <div className="display" style={{fontSize:22,lineHeight:1.3,marginTop:6}}>{grade.carryForward}</div>
    </div>}
    {full&&(grade.teachingPoint||ak.teachingPoint||ak.ruralTwist)&&<div style={{marginTop:12,fontSize:15,lineHeight:1.6,color:C.dim}}>
      {grade.teachingPoint||ak.teachingPoint}
      {ak.ruralTwist&&<div style={{marginTop:8,fontSize:14}}><span className="mono" style={{fontSize:12,letterSpacing:"0.15em",textTransform:"uppercase",color:C.amber,marginRight:6}}>Rural</span>{ak.ruralTwist}</div>}
    </div>}

    {needReflect&&!(ro&&!refl)&&<div style={{marginTop:22}}>
      <SectionTitle size={16} style={{marginBottom:6}}>Reflection <span style={{fontWeight:400,color:C.dim}}>· optional</span></SectionTitle>
      <div style={{fontSize:14,color:C.dim,lineHeight:1.5,marginBottom:8}}>What supported your diagnosis, what argued against it, what else explains it?</div>
      <textarea value={refl} onChange={e=>setRefl(e.target.value)} rows={4} aria-label="Reflection" readOnly={ro} style={{width:"100%",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:4,padding:10,fontSize:16,color:C.text,outline:"none",resize:"vertical",lineHeight:1.5}}/>
      {!ro&&<div style={{display:"flex",alignItems:"center",gap:10,marginTop:6}}><Btn kind="line" onClick={saveRefl} disabled={!refl.trim()}>Save reflection</Btn>{reflMsg&&<span className="mono" role="status" style={{fontSize:12,color:C.amber}}>{reflMsg}</span>}</div>}
    </div>}

    {(wins.length>0||misses.length>0)&&<details style={{marginTop:22,border:`1px solid ${C.border}`,borderRadius:4}}>
      <summary style={{minHeight:48,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px"}}><Label>Wins {wins.length} · misses {misses.length}</Label><span aria-hidden style={{color:C.faint}}>▾</span></summary>
      <div style={{padding:"0 14px 12px"}}>
        {wins.map((w,i)=><div key={"w"+i} style={{padding:"7px 10px",background:C.goodBg,borderLeft:`2px solid ${C.goodMuted}`,fontSize:14,marginBottom:4,lineHeight:1.45}}>✓ {w}</div>)}
        {misses.map((w,i)=><div key={"m"+i} style={{padding:"7px 10px",background:"rgba(139,0,0,0.10)",borderLeft:`2px solid ${C.red}`,fontSize:14,marginBottom:4,lineHeight:1.45}}>✗ {w}</div>)}
      </div>
    </details>}

    <div style={{marginTop:22}}>
      {!flagOpen&&!(flagMsg&&/^Flagged/.test(flagMsg))&&<button onClick={()=>setFlagOpen(true)} style={{minHeight:44,fontSize:13,color:C.dim,textDecoration:"underline"}}>Flag this grade</button>}
      {flagOpen&&<div style={{marginTop:6}}>
        <textarea value={flagNote} onChange={e=>setFlagNote(e.target.value)} rows={3} placeholder="What did the grader get wrong?" aria-label="Flag note" style={{width:"100%",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:4,padding:10,fontSize:16,color:C.text,outline:"none"}}/>
        <div style={{display:"flex",gap:8,marginTop:6}}><Btn kind="line" onClick={flag}>Flag</Btn><Btn kind="ghost" onClick={()=>setFlagOpen(false)}>Cancel</Btn></div></div>}
      {flagMsg&&<div className="mono" role="status" style={{fontSize:12,color:C.amber,marginTop:4}}>{flagMsg}</div>}
    </div>

    <div style={{marginTop:16,display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap"}}>
      <span className="mono" style={{fontSize:13,color:C.faint}}>Score <span style={{fontSize:16,color:sc,fontWeight:700}}>{score??"—"}</span>/100</span>
      {full&&<span className="mono" style={{fontSize:12,color:C.faint,lineHeight:1.6}}>gestalt {grade.gestaltCal||"—"} · workup {grade.workup||"—"} · stabilization {grade.stabilizationGrade||"—"}{grade.transferPackagingOk!=null?` · packaging ${grade.transferPackagingOk?"ok":"short"}`:""}</span>}
    </div>
    <div style={{marginTop:24,display:"flex",flexDirection:"column",gap:8}}>
      <Btn kind="primary" onClick={onNext} style={{minHeight:56,fontSize:13}}>Next patient →</Btn>
      <Btn kind="line" onClick={onHome}>Home</Btn>
    </div>
    <div style={{marginTop:18,fontSize:12,color:C.faint,textAlign:"center",lineHeight:1.5}}>A training tool, not medical advice. Grades come from a model and can be wrong.</div>
  </div>);
};

// ── APP ─────────────────────────────────────────────────────────────────────
const App=()=>{
  const [view,setView]=useState(()=>lsGet("dw_ui_seen_landing")?"home":"landing");
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [enc,setEncRaw]=useState(null);
  const [saveWarn,setSaveWarn]=useState(false);
  // The current case id, updated synchronously, so a late reply for another case can't replace it.
  const curCase=useRef(null);
  const setEnc=e=>{curCase.current=e?seedOf(e).caseId||null:null;setEncRaw(e)};
  const updateEnc=e=>{if(e&&seedOf(e).caseId===curCase.current)setEncRaw(e)};
  const [load,setLoad]=useState({cond:null,stage:null,error:null,mode:"shift"});
  const [debrief,setDebrief]=useState(null);
  const [refresh,setRefresh]=useState(0);
  const bump=()=>setRefresh(r=>r+1);
  useEffect(()=>{window.__dwMounted=true},[]);
  useEffect(()=>{try{window.scrollTo(0,0)}catch{}},[view]);

  const goHome=()=>{bump();setView("home")};
  const next=async mode=>{
    mode=mode||(getSettings().mode==="drill"?"drill":"shift");
    setDebrief(null);setLoad({cond:null,stage:null,error:null,mode});setView("loading");
    try{
      // newCase uses the prefetched case when one is ready or in flight; onSeed fires before generation.
      const c=await DW_().newCase({mode,onSeed:s=>{if(s&&s.conditions)setLoad(l=>({...l,cond:s.conditions}))},onStage:st=>setLoad(l=>({...l,stage:st}))});
      const e=DW_().startEncounter(c);
      setEnc(e);setSaveWarn(!!e.saveFailed);setView("doorway");haptic(20);
    }catch(err){setLoad(l=>({...l,error:errMsg(err)}))}
  };
  const lock=gut=>{const e=DW_().lockGut(enc,gut);setSaveWarn(!!e.saveFailed);const{saveFailed,...clean}=e;setEnc(clean);setView("workup")};
  const resume=a=>{setSaveWarn(false);setEnc(a);setView(a.gut?"workup":"doorway")};
  const graded=async(e0,grade,answers)=>{
    if(seedOf(e0).caseId!==curCase.current)return; // a grade for a case he already left
    const e=(grade&&grade.encAfter&&seedOf(grade.encAfter).caseId===seedOf(e0).caseId)?grade.encAfter:e0; // includes the disposition-plan turn
    const gut=e.gut||{};
    const extras={ddx:answers.ddx,confidence:answers.confidence,finalDispo:answers.finalDispo,transferChecklist:answers.transferChecklist,plan:answers.plan,gutTimedOut:!!(gut.timedOut||gut.gutTimedOut)};
    try{await Promise.resolve(DW_().recordResult(e,grade,extras))}catch(err){console.error("recordResult",err)}
    startPrefetch(getSettings().mode==="drill"?"drill":"shift");
    setDebrief({enc:e,grade,answers});setView("debrief");haptic([40,60,120]);
  };
  const openHistory=entry=>{
    let full=null;try{full=DW_().getResult(entry.caseId)}catch{}
    setDebrief(full&&full.enc&&full.grade?{...full,entry:full.entry||entry,readOnly:true}:{entry,readOnly:true});setView("debrief");
  };

  if(!DW_())return(<><GlobalStyle/><div style={{padding:24,maxWidth:480,margin:"20vh auto",fontSize:16,lineHeight:1.6}}>
    <div className="display" style={{fontSize:32}}>The Doorway didn't load.</div>
    <p style={{color:C.dim}}>The engine script is missing. Check your connection and reload.</p>
    <Btn kind="primary" onClick={()=>location.reload()}>Reload</Btn></div></>);

  let body=null;
  if(view==="landing")body=<Landing returning={!!lsGet("dw_ui_seen_landing")} onEnter={()=>{lsSet("dw_ui_seen_landing","1");goHome()}} onSettings={()=>setSettingsOpen(true)}/>;
  else if(view==="loading")body=<Loading cond={load.cond} stage={load.stage} error={load.error} onRetry={()=>next(load.mode)} onHome={goHome} onSettings={()=>setSettingsOpen(true)}/>;
  else if(view==="doorway"&&enc)body=<Doorway key={seedOf(enc).caseId||"d"} enc={enc} onLock={lock} onHome={goHome}/>;
  else if(view==="workup"&&enc)body=<Workup key={seedOf(enc).caseId||"w"} enc={enc} setEnc={updateEnc} saveWarn={saveWarn} onHome={goHome} onGraded={graded} onSettings={()=>setSettingsOpen(true)}/>;
  else if(view==="debrief"&&debrief)body=<Debrief data={debrief} onNext={()=>next()} onHome={goHome}/>;
  else body=<Home refresh={refresh} onNext={next} onResume={resume} onSettings={()=>setSettingsOpen(true)} onOpenHistory={openHistory}/>;
  return(<>
    <GlobalStyle/>
    {body}
    {settingsOpen&&<SettingsSheet onClose={()=>{setSettingsOpen(false);bump()}} onChanged={bump} onAbout={()=>{setSettingsOpen(false);setView("landing")}}/>}
  </>);
};

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
