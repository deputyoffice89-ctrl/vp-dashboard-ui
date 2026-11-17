/* Private, collaborative Arabic dashboard powered by GitHub Issues.
   Access token remains in memory only, never in source, logs, or storage. */
(() => {
"use strict";
const OWNER="deputyoffice89-ctrl",REPO="vp-office-dashboard",API="https://api.github.com/repos/"+OWNER+"/"+REPO;
const DIRS=["الاشتراكات","المستحقات","إصابات العمل","خدمات المتعاملين","مكتب الدكتور"];
const VIEWS={overview:"نظرة عامة",topics:"مواضيع مرسال",overdue:"المواضيع المتأخرة",mails:"البريد الإلكتروني",closed:"المواضيع المنجزة",reminders:"تذكيرات المتابعة",abdulrahman:"مواضيع عبدالرحمن",mohammad:"مواضيع محمد",urgent:"المواضيع العاجلة",metrics:"المؤشرات الشهرية"};
const CATEGORIES=["عادي","عاجل","مجلس الوزراء","أوامر سامية"];
const priorityDays={"عادي":14,"عاجل":3,"مجلس الوزراء":2,"أوامر سامية":1};
const bounded=(v,d)=>Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=365?Number(v):d;
const canonicalDir=v=>{
  const raw=String(v||"").normalize("NFKC").replace(/[\u200b-\u200f\ufeff\u0640]/g,"").replace(/\s+/g," ").trim();
  if(!raw||raw==="غير محدد")return "";
  const key=x=>x.replace(/[أإآ]/g,"ا").replace(/\s+/g,"").replace(/^ال/,"");
  const clean=raw.replace(/^(?:ال)?مديرية\s+(?:العامة\s+)?/,"").replace(/^ل(?:ل|ـ)?/,"");
  return DIRS.find(d=>key(d)===key(raw)||key(d)===key(clean))||raw;
};
const $=id=>document.getElementById(id);
let auth="",connected=false,issues=[],records=[],view="overview",editing=null,editorKind="topic",detail=null,lastSync=null,loading=false,filterDir="",refreshTimer=null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const empty=v=>!v||["غير محدد","—","_No response_","None"].includes(String(v).trim());
const fmDate=d=>d?new Intl.DateTimeFormat("ar-OM",{day:"numeric",month:"short",year:"numeric"}).format(d):"غير محدد";
const fmTime=d=>new Intl.DateTimeFormat("ar-OM",{hour:"2-digit",minute:"2-digit"}).format(d);
const today=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())};
const add14=d=>{if(!d)return null;const x=new Date(d);x.setDate(x.getDate()+14);return x};
const iso=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||""))return null;const [y,m,d]=s.split("-").map(Number),v=new Date(y,m-1,d);return v.getFullYear()===y&&v.getMonth()===m-1&&v.getDate()===d?v:null};

/* Working week in Oman: Sunday through Thursday. All dates use Asia/Muscat. */
function omanISO(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Muscat",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(date);
  const val=type=>parts.find(p=>p.type===type)?.value;
  return val("year")+"-"+val("month")+"-"+val("day");
}
function dayUTC(day){return Date.parse(day+"T00:00:00Z")}
function validDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(day||"")&&Number.isFinite(dayUTC(day))&&new Date(dayUTC(day)).toISOString().slice(0,10)===day}
function calendarAge(day){if(!validDay(day))return null;return Math.max(0,Math.round((dayUTC(omanISO())-dayUTC(day))/86400000))}
function isWorkingDay(day){const weekday=new Date(dayUTC(day)).getUTCDay();return weekday!==5&&weekday!==6}
function afterWorkDays(day,count){
  if(!validDay(day))return "";
  let current=dayUTC(day),remaining=count;
  while(remaining>0){current+=86400000;const date=new Date(current).toISOString().slice(0,10);if(isWorkingDay(date))remaining--}
  return new Date(current).toISOString().slice(0,10);
}
function workingDaysBetween(start,end){
  if(!validDay(start)||!validDay(end)||end<=start)return 0;
  let current=dayUTC(start),count=0;
  while(current<dayUTC(end)){current+=86400000;const date=new Date(current).toISOString().slice(0,10);if(isWorkingDay(date))count++}
  return count;
}
function reminderTag(r){
  if(r.status==="منتهي")return '<span class="age-empty">—</span>';
  if(r.reminderDueNow)return '<span class="reminder-pill due">تذكير مستحق</span>';
  return '<span class="reminder-pill">بعد '+workingDaysBetween(omanISO(),r.nextReminder)+' يوم عمل</span>';
}
function ageNum(r){return r.ageDays===null?'<span class="age-empty" title="تاريخ الوصول غير محدد">—</span>':'<span class="age-num">'+r.ageDays+'</span>'}

let noticeTimer;
function toast(message,bad=false){const n=$("toast");n.textContent=message;n.style.background=bad?"#913f55":"#194d40";n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.hidden=true,4400)}
function field(body,name){
  const lines=String(body||"").split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(lines[i].startsWith("**"+name+"**:"))return lines[i].slice(name.length+5).trim();
    if(lines[i].trim()==="### "+name){
      const val=[];for(let j=i+1;j<lines.length;j++){if(lines[j].startsWith("### ")||lines[j].trim()==="---")break;val.push(lines[j])}
      return val.join("\n").trim();
    }
  }
  return "";
}
function get(body,names){for(const n of names){const v=field(body,n);if(!empty(v))return v}return ""}
function decode(issue){
  const body=issue.body||"",mail=issue.title.startsWith("[بريد]");
  const number=get(body,mail?["رقم الرسالة","رقم الموضوع"]:["رقم الموضوع"]);
  const fallback=issue.title.replace(/^\[(موضوع|بريد)\]\s*/,"").replace(/^[^\u2014]+ — /,"");
  const title=get(body,mail?["موضوع الرسالة","موضوع البريد"]:["اسم الموضوع"])||fallback;
  const rawStatus=get(body,["الحالة","حالة الموضوع في الإكسل","حالة المتابعة","حالة الرسالة"]);
  const waiting=rawStatus.includes("انتظار مرئيات السيد")||rawStatus.includes("بانتظار");
  const status=issue.state==="closed"?"منتهي":waiting?"انتظار مرئيات السيد":"قيد الإجراء";
  const receivedRaw=get(body,["تاريخ الوصول","تاريخ وصول الموضوع"]),received=iso(receivedRaw);
  const transferred=get(body,["تاريخ التحويل","تاريخ تحويل الموضوع للمديرية المختصة"]);
  const explicitCategory=get(body,["التصنيف"]);
  const category=CATEGORIES.includes(explicitCategory)?explicitCategory:/أوامر سامية|الأوامر السامية|أمر سامٍ|أمر سامي/.test(title.normalize("NFKC"))?"أوامر سامية":/مجلس الوزراء/.test(title.normalize("NFKC"))?"مجلس الوزراء":"عادي";
  const deadlineDays=bounded(get(body,["مدة الإنجاز بالأيام"]),priorityDays[category]);
  const deadlineBase=iso(transferred)||received;
  const due=deadlineBase?new Date(deadlineBase.getFullYear(),deadlineBase.getMonth(),deadlineBase.getDate()+deadlineDays):null;
  const dueISO=due?[due.getFullYear(),String(due.getMonth()+1).padStart(2,"0"),String(due.getDate()).padStart(2,"0")].join("-"):"";
  const interval=bounded(get(body,["أيام المتابعة"]),3);
  const directorUpdateDate=get(body,["تاريخ آخر تحديث من المديرية"]);
  const directorUpdate=get(body,["آخر تحديث من المديرية"]);
  const directorAge=validDay(directorUpdateDate)?calendarAge(directorUpdateDate):validDay(transferred)?calendarAge(transferred):null;
  const sentAge=validDay(transferred)?calendarAge(transferred):null;
  const attachments=get(body,["المرفقات"]);
  const followupLog=get(body,["سجل المتابعات"]).split(",").filter(validDay);

  const followupStamp=get(body,["تاريخ آخر متابعة"]);
  const followupBase=validDay(followupStamp)?followupStamp:validDay(transferred)?transferred:validDay(receivedRaw)?receivedRaw:omanISO(new Date(issue.created_at));
  const nextReminder=afterWorkDays(followupBase,interval);
  const reminderDueNow=issue.state!=="closed"&&nextReminder<=omanISO();
  const ageDays=validDay(receivedRaw)?calendarAge(receivedRaw):null;
  return {id:issue.number,issue,kind:mail?"mail":"topic",number,title,rawStatus,waiting,status,receivedRaw,received,due,dueISO,
    overdue:issue.state==="open"&&((dueISO&&dueISO<omanISO())||(directorAge!==null&&directorAge>deadlineDays)),transferred,
    category,deadlineDays,interval,directorUpdateDate,directorUpdate,directorAge,sentAge,attachments,followupLog,
    directorate:canonicalDir(get(body,["المديرية المختصة","المديرية","جميع المديريات"])),assignee:get(body,["الموظف المسؤول"]),
    details:get(body,["تفاصيل الموضوع","تفاصيل الرسالة","تفاصيلها"]),
    notes:get(body,["الملاحظات","الملاحظات وآخر التحديثات"]),updates:get(body,["آخر التحديثات"]),
    direction:get(body,["التوجيه"]),updatedAt:new Date(issue.updated_at),
    ageDays,followupStamp,followupBase,nextReminder,reminderDueNow,
    source:(body.match(/^>\s*مستورد من ملف المتابعة[^\n]*/m)||[""])[0]};
}
async function api(method,path,body){
  if(!auth)throw Error("يلزم ربط حساب GitHub");
  const url=path.startsWith("https://")?path:API+path;
  const res=await fetch(url,{method,headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+auth,"X-GitHub-Api-Version":"2022-11-28",...(body!==undefined?{"Content-Type":"application/json"}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
  const val=await res.json().catch(()=>({}));
  if(!res.ok){let msg=val.message||"تعذر الاتصال";if(res.status===401)msg="رمز GitHub غير صحيح أو منتهي";if(res.status===403)msg="ليست لديك صلاحية لهذا الإجراء";if(res.status===404)msg="المستودع غير متاح لهذا الحساب";const e=Error(msg);e.status=res.status;throw e}
  return val;
}
async function reload(silent=false){
  if(!connected||loading)return;
  loading=true;$("syncButton").disabled=true;
  try{
    const result=[],snapshots=[];
    for(let page=1;page<=20;page++){
      const batch=await api("GET","/issues?state=all&per_page=100&page="+page);
      for(const issue of batch)if(!issue.pull_request){
        if(/^\[(موضوع|بريد)\]/.test(issue.title))result.push(issue);
        else if(issue.title.startsWith("[مؤشر شهري] ")){try{const v=JSON.parse(issue.body);if(Array.isArray(v.rows)&&v.month)snapshots.push(v)}catch{}}
      }
      if(batch.length<100)break;
    }
    monthlySnapshots=snapshots;issues=result;records=result.map(decode);lastSync=new Date();render();
    if(!silent)toast("تم تحديث البيانات من GitHub");
    return true;
  }catch(e){toast("تعذر التحديث: "+e.message,true);return false}
  finally{loading=false;$("syncButton").disabled=false}
}
const topics=()=>records.filter(x=>x.kind==="topic"),mails=()=>records.filter(x=>x.kind==="mail");
const stat=r=>r.overdue?'<span class="status-pill late">متأخر</span>':r.status==="منتهي"?'<span class="status-pill done">منتهي</span>':r.waiting?'<span class="status-pill wait">انتظار مرئيات السيد</span>':'<span class="status-pill">قيد الإجراء</span>';
function changeView(next){
  if(!VIEWS[next])return;
  view=next;
  $("breadcrumbCurrent").textContent=VIEWS[next];
  document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===next));
  $("overviewView").hidden=next!=="overview";$("listView").hidden=next==="overview"||next==="metrics";$("metricsView").hidden=next!=="metrics";
  $("sidebar").classList.remove("show");
  // A fresh page must not inherit a hidden department or employee filter.
  $("searchField").value="";
  $("statusFilter").value="";
  $("directorateFilter").value="";
  $("employeeFilter").value="";
  filterDir="";
  if(next==="overview")renderOverview();else if(next==="metrics")renderMetrics();else renderList();
}
function render(){
  $("connectionBanner").hidden=connected;
  $("connectLabel").textContent=connected?"الحساب متصل":"ربط الحساب";
  $("connectButton").hidden=connected;
  $("logoutButton").hidden=!connected;
  const t=topics(),m=mails(),late=records.filter(x=>x.overdue),done=t.filter(x=>x.status==="منتهي");
  const snapshots=connected?[t.length,m.length,late.length,done.length]:[null,null,null,null];
  for(const [id,val] of [["countTopics",snapshots[0]],["countMails",snapshots[1]],["countOverdue",snapshots[2]],["countClosed",snapshots[3]],["nav-topics",snapshots[0]],["nav-overdue",snapshots[2]],["nav-mails",snapshots[1]],["nav-reminders",records.filter(x=>x.reminderDueNow).length],["nav-urgent",records.filter(x=>x.category!=="عادي"&&x.status!=="منتهي").length],["nav-abdulrahman",t.filter(x=>(x.assignee||"").trim()==="عبدالرحمن").length],["nav-mohammad",t.filter(x=>(x.assignee||"").trim()==="محمد").length]])$(id).textContent=connected?val.toLocaleString("ar-OM"):"—";
  $("lastSync").textContent=lastSync?"آخر مزامنة "+fmTime(lastSync)+" · تحديث تلقائي كل دقيقة":"لم تُحمّل البيانات بعد";
  $("dateToday").textContent=fmDate(new Date());
  const selected=$("directorateFilter").value;
  const dirs=[...new Set([...DIRS,...records.map(r=>r.directorate).filter(Boolean)])].filter(d=>d!=="غير محدد");
  $("directorateFilter").innerHTML='<option value="">جميع المديريات</option>'+dirs.map(d=>'<option value="'+esc(d)+'">'+esc(d)+'</option>').join("")+'<option value="غير محدد">غير محدد</option>';
  $("directorateFilter").value=filterDir||selected||"";
  if(view==="overview")renderOverview();else if(view==="metrics")renderMetrics();else renderList();
}
function renderOverview(){
  const t=topics();
  const dirs=[...new Set([...DIRS,...t.map(r=>r.directorate).filter(Boolean)])];
  if(t.some(r=>!r.directorate))dirs.push("غير محدد");
  const groups=dirs.map(name=>({name,list:t.filter(r=>(r.directorate||"غير محدد")===name)}));
  $("dirCount").textContent=groups.filter(g=>g.list.length).length.toLocaleString("ar-OM")+" مديريات";
  $("directorateChart").innerHTML=connected?
    '<div class="dir-legend"><span><i class="legend-dot"></i> قيد المتابعة</span><span><i class="legend-dot gray"></i> منجزة</span></div>'+
    groups.map(g=>{
      const done=g.list.filter(r=>r.status==="منتهي").length,n=g.list.length,width=t.length?100*n/t.length:0;
      return '<button type="button" class="dir-row" data-dir="'+esc(g.name)+'"><span class="dir-top"><span class="dir-label">'+esc(g.name)+'</span><strong>'+n.toLocaleString("ar-OM")+'</strong></span><span class="bar-track"><span class="bar-fill" style="width:'+width.toFixed(2)+'%"></span></span><span style="font-size:11px;color:#9aaea0">قيد المتابعة: '+(n-done).toLocaleString("ar-OM")+' · منجزة: '+done.toLocaleString("ar-OM")+'</span></button>';
    }).join(""):'<p class="empty-note">سيظهر الرسم بعد تسجيل الدخول.</p>';
  const all=t.filter(r=>r.status!=="منتهي").sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(a.due?.getTime()||9999999999999)-(b.due?.getTime()||9999999999999)||a.id-b.id);
  $("priorityCount").textContent=t.filter(r=>r.overdue).length.toLocaleString("ar-OM")+" متأخرة";
  $("priorityList").innerHTML=connected?(all.length?all.slice(0,7).map(r=>'<button class="priority-item" type="button" data-open-id="'+r.id+'"><div class="priority-description"><strong>'+esc(r.title)+'</strong><small>'+esc(r.directorate||"مديرية غير محددة")+' · '+esc(r.assignee||"بدون مسؤول")+'</small></div><span class="priority-code">'+esc(r.number||"#"+r.id)+'</span>'+(r.overdue?'<span class="priority-badge">متأخر</span>':'')+'</button>').join(""):'<p class="empty-note">لا توجد مواضيع قيد الإجراء حالياً.</p>'):'<p class="empty-note">تظهر المواضيع التي تحتاج متابعة هنا.</p>';
  const reminders=records.filter(r=>r.reminderDueNow).sort((a,b)=>a.nextReminder.localeCompare(b.nextReminder)||a.id-b.id);
  $("reminderCount").textContent=connected?reminders.length.toLocaleString("ar-OM")+" مستحق":"—";
  $("reminderItems").innerHTML=connected?(reminders.length?reminders.slice(0,9).map(r=>
    '<button class="reminder-card" type="button" data-open-id="'+r.id+'"><span class="reminder-badge">حان موعد المتابعة</span><span class="reminder-title">'+esc(r.title)+'</span><span class="reminder-meta">'+esc(r.number||"#"+r.id)+' · '+esc(r.assignee||"غير محدد")+' · موعد: '+esc(r.nextReminder)+'</span></button>').join(""):'<p class="empty-note">لا توجد تذكيرات مستحقة حالياً. ستظهر المواضيع المفتوحة بعد 3 أيام عمل دون تحديث.</p>'):'<p class="empty-note">تظهر تذكيرات المتابعة بعد تسجيل الدخول.</p>';
  const recent=[...t].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8);
  $("recentTopics").innerHTML=connected?(recent.length?recent.map(r=>'<button type="button" class="recent-item" data-open-id="'+r.id+'"><div class="recent-main"><strong>'+esc(r.title)+'</strong><small>'+esc(r.number||"#"+r.id)+' · '+esc(r.directorate||"غير محدد")+'</small></div>'+stat(r)+'</button>').join(""):'<p class="empty-note">لا توجد مواضيع.</p>'):'<p class="empty-note">تظهر المواضيع بعد ربط الحساب.</p>';
}
function renderList(){
  let rows=view==="mails"?mails():["urgent","overdue","reminders"].includes(view)?records.slice():topics();
  if(view==="urgent")rows=rows.filter(r=>r.category!=="عادي"&&r.status!=="منتهي");
  if(view==="overdue")rows=rows.filter(r=>r.overdue);
  if(view==="closed")rows=rows.filter(r=>r.status==="منتهي");
  if(view==="reminders")rows=rows.filter(r=>r.reminderDueNow);
  const staffPage=view==="abdulrahman"||view==="mohammad";
  const staffName=view==="abdulrahman"?"عبدالرحمن":view==="mohammad"?"محمد":"";
  // Staff navigation uses the assignee saved in each private issue, not the
  // employee select, which is hidden on these two pages.
  if(staffPage)rows=rows.filter(r=>String(r.assignee||"").normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g,"").trim()===staffName);
  const q=$("searchField").value.trim().toLowerCase(),dir=$("directorateFilter").value||filterDir,emp=staffPage?"":$("employeeFilter").value,status=$("statusFilter").value;
  if(q)rows=rows.filter(r=>[r.number,r.title,r.details,r.notes,r.updates,r.assignee].join(" ").toLowerCase().includes(q));
  if(dir)rows=rows.filter(r=>(r.directorate||"غير محدد")===dir);
  if(emp)rows=rows.filter(r=>r.assignee===emp);
  if(status)rows=rows.filter(r=>status==="متأخر"?r.overdue:r.status===status);
  rows.sort((a,b)=>view==="reminders"?a.nextReminder.localeCompare(b.nextReminder):Number(b.overdue)-Number(a.overdue)||b.updatedAt-a.updatedAt);
  $("listTitle").textContent=VIEWS[view];
  $("listSubtitle").textContent=view==="urgent"?"المعاملات ذات الأولوية المفتوحة":view==="overdue"?"تجاوزت مدة الإنجاز أو مدة انتظار تحديث المديرية":view==="closed"?"المواضيع المنتهية والمؤرشفة":view==="mails"?"متابعة المراسلات والإجراءات":view==="reminders"?"مواضيع حان موعد متابعتها بعد ثلاثة أيام عمل بدون الجمعة والسبت":view==="abdulrahman"?"مواضيع مرسال المسندة إلى عبدالرحمن فقط":view==="mohammad"?"مواضيع مرسال المسندة إلى محمد فقط":"عرض وإدارة جميع المعاملات";
  $("addMail").hidden=view!=="mails";$("directorateFilter").hidden=false;
  $("employeeFilter").hidden=view==="abdulrahman"||view==="mohammad";
  $("resultsCount").textContent=connected?"عدد النتائج: "+rows.length.toLocaleString("ar-OM"):"سجّل دخولك لعرض البيانات";
  const columns=["الرقم / الموضوع","المديرية / المسؤول","الحالة / التصنيف","الوصول / الإرسال","إجمالي أيام الوصول / الإرسال","آخر تحديث من المديرية","أيام دون تحديث","متابعة المكتب","التفاصيل والتوجيه والملاحظات","المرفقات","الإجراء"];
  $("listHead").innerHTML="<tr>"+columns.map(c=>"<th>"+esc(c)+"</th>").join("")+"</tr>";
  const txt=v=>esc(v||"—");
  const num=v=>v===null?"—":String(v);
  $("listBody").innerHTML=!connected||!rows.length?'<tr><td colspan="11" class="empty-table">'+(connected?"لا توجد نتائج مطابقة.":"سجّل دخولك لعرض البيانات.")+'</td></tr>':rows.map(r=>
  '<tr class="'+(r.category!=="عادي"?"priority-row ":"")+(r.overdue?"overdue-row":"")+'"><td><small>'+txt(r.number)+' · '+(r.kind==="mail"?"بريد":"مرسال")+'</small><strong class="row-title">'+txt(r.title)+'</strong></td><td>'+txt(r.directorate)+'<small>'+txt(r.assignee)+'</small></td><td>'+stat(r)+'<small class="category-label">'+esc(r.category)+'</small><small>مدة الإنجاز: '+r.deadlineDays+' يوم</small><small>الموعد النهائي: '+txt(r.dueISO)+'</small></td><td>وصول: '+txt(r.receivedRaw)+'<small>إرسال: '+txt(r.transferred)+'</small></td><td class="numeric-cell">'+num(r.sentAge)+'<small>من الوصول: '+num(r.ageDays)+'</small></td><td>'+txt(r.directorUpdateDate)+'<div class="full-note">'+txt(r.directorUpdate)+'</div></td><td class="numeric-cell">'+num(r.directorAge)+(r.directorAge!==null&&!validDay(r.directorUpdateDate)?'<small>من الإرسال · لا تحديث مسجل</small>':'')+'</td><td>'+reminderTag(r)+'<small>كل '+r.interval+' أيام عمل</small><small>آخر متابعة: '+txt(r.followupStamp)+'</small></td><td class="wide-notes"><b>التفاصيل:</b> '+txt(r.details)+'<br><b>التوجيه:</b> '+txt(r.direction)+'<br><b>الملاحظات:</b> '+txt(r.notes)+'<br><b>التحديثات:</b> '+txt(r.updates)+'</td><td>'+attachmentLinks(r.attachments)+'</td><td><button class="row-action" data-open-id="'+r.id+'" type="button">تعديل / تحديث</button></td></tr>').join("");

}
function attachmentLinks(value){
  return String(value||"").split(/\r?\n/).filter(Boolean).map(line=>{
    const url=line.trim();return /^https:\/\//i.test(url)?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">فتح المرفق ↗</a>':esc(line);
  }).join("<br>")||"—";
}

let monthlySnapshots=[];
function monthStats(month){
  const end=month===omanISO().slice(0,7)?omanISO():new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  const inMonth=d=>validDay(d)&&d.slice(0,7)===month;
  const dirNames=[...new Set([...DIRS,...records.map(r=>r.directorate||"غير محدد")])];
  const rows=[];
  for(const dir of [...dirNames,"جميع المديريات"]){
    for(const kind of ["topic","mail","all"]){
      const group=records.filter(r=>(dir==="جميع المديريات"||(r.directorate||"غير محدد")===dir)&&(kind==="all"||r.kind===kind));
      const received=group.filter(r=>inMonth(r.receivedRaw));
      const completed=received.filter(r=>r.issue.closed_at&&omanISO(new Date(r.issue.closed_at))<=end&&r.status==="منتهي");
      const open=received.filter(r=>!completed.includes(r));
      const late=open.filter(r=>r.dueISO&&r.dueISO<end);
      rows.push({dir,kind,received:received.length,completed:completed.length,open:open.length,late:late.length,sent:group.filter(r=>inMonth(r.transferred)).length,followups:group.reduce((n,r)=>n+r.followupLog.filter(inMonth).length,0),unknown:group.filter(r=>!validDay(r.receivedRaw)).length});
    }
  }
  return {month,end,rows,savedAt:omanISO()};
}
function renderMetrics(){
  const month=$("metricMonth").value||omanISO().slice(0,7);
  $("metricMonth").value=month;
  const dir=$("metricDirectorate").value;
  const saved=monthlySnapshots.find(s=>s.month===month);
  const data=saved||monthStats(month);
  const names=[...new Set(data.rows.map(r=>r.dir))];
  $("metricDirectorate").innerHTML='<option value="">كل مديرية على حدة</option>'+names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join("");
  $("metricDirectorate").value=names.includes(dir)?dir:"";
  $("metricsStatus").textContent=!connected?"سجل الدخول أولاً":saved?"حصر محفوظ بتاريخ "+saved.savedAt:"حصر محسوب من التواريخ المتوفرة · غير مثبت بعد";
  $("saveMonth").disabled=!connected||!!saved||month>=omanISO().slice(0,7);
  $("metricsBody").innerHTML=!connected?"":data.rows.filter(r=>dir?r.dir===dir:r.dir!=="جميع المديريات").map(r=>"<tr><td>"+esc(r.dir)+"</td><td>"+({topic:"مرسال",mail:"البريد",all:"مشترك"}[r.kind])+"</td>"+["received","completed","open","late","sent","followups","unknown"].map(k=>"<td>"+r[k]+"</td>").join("")+"</tr>").join("");
  const office=data.rows.find(r=>r.dir==="جميع المديريات"&&r.kind==="all");
  $("officeMetrics").innerHTML=!connected||!office?"": [["المستلمة",office.received],["المرسلة",office.sent],["المنجزة من وارد الشهر",office.completed],["المتابعات المسجلة",office.followups]].map(([k,v])=>'<div class="metric-card"><small>'+k+'</small><strong>'+v+'</strong></div>').join("");
}
async function saveMonthlySnapshot(){
  if(!requireLogin())return;
  const month=$("metricMonth").value;
  if(!/^\d{4}-\d{2}$/.test(month)||month>=omanISO().slice(0,7)||monthlySnapshots.some(x=>x.month===month))return;
  if(!confirm("تثبيت حصر شهر "+month+" في المستودع الخاص؟ لن يتغير مع الشهور التالية."))return;
  try{
    const snapshot=monthStats(month);
    await api("POST","/issues",{title:"[مؤشر شهري] "+month,body:JSON.stringify(snapshot)});
    await reload(true);toast("تم حفظ الحصر الشهري");
  }catch(e){toast("تعذر حفظ الحصر: "+e.message,true)}
}

function requireLogin(){if(connected)return true;$("loginDialog").showModal();return false}
function formField(f,value){
  const label=document.createElement("label");label.className="field-label"+(f.wide?" field-wide":"");label.append(document.createTextNode(f.label));
  let el;
  if(f.options){el=document.createElement("select");for(const opt of f.options){const o=document.createElement("option");o.value=opt;o.textContent=opt||"غير محدد";el.append(o)}}
  else if(f.textarea){el=document.createElement("textarea");el.rows=3}
  else{el=document.createElement("input");el.type=f.date?"date":f.numeric?"number":"text";if(f.numeric){el.min=1;el.max=365;el.step=1}}
  el.name=f.name;el.id="field-"+f.name;el.required=!!f.required;el.value=value||"";el.placeholder=f.placeholder||"";label.append(el);return label;
}
const extraFields=[
{name:"directorUpdateDate",label:"تاريخ آخر تحديث من المديرية",date:true},
{name:"directorUpdate",label:"آخر تحديث من المديرية عن الموضوع",textarea:true,wide:true},
{name:"category",label:"التصنيف",options:CATEGORIES},
{name:"deadlineDays",label:"مدة الإنجاز (أيام تقويمية)",numeric:true},
{name:"interval",label:"أيام المتابعة (أيام عمل)",numeric:true},
{name:"attachments",label:"المرفقات (روابط داخلية، رابط بكل سطر)",textarea:true,wide:true}];
const topicFields=[
{name:"number",label:"رقم الموضوع",required:true,placeholder:"123/2026"},
{name:"title",label:"اسم الموضوع",required:true},
{name:"receivedRaw",label:"تاريخ وصول الموضوع",date:true},
{name:"transferred",label:"تاريخ تحويل الموضوع للمديرية",date:true},
{name:"directorate",label:"المديرية المختصة",options:["",...DIRS]},
{name:"assignee",label:"الموظف المسؤول",options:["","عبدالرحمن","محمد"]},
{name:"status",label:"الحالة",options:["قيد الإجراء","انتظار مرئيات السيد","منتهي"]},
{name:"details",label:"تفاصيل الموضوع",textarea:true,wide:true},
{name:"direction",label:"التوجيه",textarea:true,wide:true},
{name:"notes",label:"الملاحظات",textarea:true,wide:true},
{name:"updates",label:"آخر التحديثات",textarea:true,wide:true}];
const mailFields=[
{name:"number",label:"رقم الرسالة"},
{name:"title",label:"موضوع البريد",required:true},
{name:"assignee",label:"الموظف المسؤول",options:["","عبدالرحمن","محمد"]},
{name:"status",label:"الحالة",options:["قيد الإجراء","انتظار مرئيات السيد","منتهي"]},
{name:"details",label:"تفاصيل الرسالة",textarea:true,wide:true},
{name:"notes",label:"الملاحظات",textarea:true,wide:true},
{name:"updates",label:"آخر التحديثات",textarea:true,wide:true}];
function openEditor(kind,record=null){
  if(!requireLogin())return;editorKind=kind;editing=record;
  $("editorTitle").textContent=(record?"تعديل ":"إضافة ")+(kind==="mail"?"رسالة بريد":"موضوع");
  $("editorSubmit").textContent=record?"حفظ التعديلات":"حفظ وإضافة";
  $("editorFields").replaceChildren();
  const base=kind==="mail"?[...mailFields,{name:"receivedRaw",label:"تاريخ الوصول",date:true},{name:"transferred",label:"تاريخ الإرسال",date:true},{name:"directorate",label:"المديرية المختصة",options:["",...DIRS]}]:topicFields;
  for(const f of [...base,...extraFields]){
    if(f.name==="directorate")f.options=[...new Set(["",...DIRS,...records.map(r=>r.directorate).filter(Boolean)])];
    let value=record?.[f.name]||"";
    if(f.name==="status")value=record?.status||"قيد الإجراء";
    if(f.name==="interval")value=record?.interval||3;
    if(f.name==="category")value=record?.category||"عادي";
    if(f.name==="deadlineDays")value=record?.deadlineDays||14;
    $("editorFields").append(formField(f,value));
  }
  $("field-category").onchange=()=>{$("field-deadlineDays").value=priorityDays[$("field-category").value]};
  $("editorDialog").showModal();
}
const boldLine=(k,v)=>"**"+k+"**: "+(String(v||"").trim()||"غير محدد");
function bodyFor(v,kind,record){
  const lines=[];
  if(record?.source)lines.push(record.source,"");
  lines.push("> محفوظ عبر شاشة المتابعة الخاصة بمكتب نائب الرئيس.","");
  if(kind==="topic"){
    lines.push(boldLine("رقم الموضوع",v.number),boldLine("اسم الموضوع",v.title),
      boldLine("الحالة",v.status),boldLine("تاريخ الوصول",v.receivedRaw),boldLine("تاريخ التحويل",v.transferred),
      boldLine("المديرية المختصة",v.directorate),boldLine("الموظف المسؤول",v.assignee),

      "","### تفاصيل الموضوع",v.details||"—","","### التوجيه",v.direction||"—",
      "","### الملاحظات",v.notes||"—","","### آخر التحديثات",v.updates||"—");
  }else{
    lines.push(boldLine("رقم الرسالة",v.number),boldLine("موضوع الرسالة",v.title),boldLine("الحالة",v.status),
      boldLine("الموظف المسؤول",v.assignee),"","### تفاصيل الرسالة",v.details||"—",
      "","### الملاحظات",v.notes||"—","","### آخر التحديثات",v.updates||"—");
  }
  lines.push("","---",boldLine("التصنيف",v.category),boldLine("مدة الإنجاز بالأيام",bounded(v.deadlineDays,priorityDays[v.category]||14)),boldLine("أيام المتابعة",bounded(v.interval,3)),boldLine("تاريخ آخر تحديث من المديرية",v.directorUpdateDate),boldLine("تاريخ آخر متابعة",record?.followupStamp),boldLine("سجل المتابعات",record?.followupLog?.join(",")));
  if(kind==="mail")lines.push(boldLine("تاريخ الوصول",v.receivedRaw),boldLine("تاريخ التحويل",v.transferred),boldLine("المديرية المختصة",v.directorate));
  lines.push("","### آخر تحديث من المديرية",v.directorUpdate||"—","","### المرفقات",v.attachments||"—","","---","**لتوثيق تحديث جديد:** أضف تعليقاً على الموضوع.");
  return lines.join("\n");
}
async function saveEditor(e){
  e.preventDefault();if(!connected)return;
  const btn=$("editorSubmit");btn.disabled=true;
  try{
    const v=Object.fromEntries(new FormData(e.target));
    if(v.receivedRaw&&!iso(v.receivedRaw))throw Error("تاريخ الوصول غير صحيح");
    if(v.transferred&&!iso(v.transferred))throw Error("تاريخ التحويل غير صحيح");
    if(v.receivedRaw&&v.transferred&&v.transferred<v.receivedRaw)throw Error("تاريخ التحويل قبل تاريخ الوصول");
    if(v.directorUpdateDate&&v.directorUpdateDate>omanISO())throw Error("تاريخ تحديث المديرية لا يمكن أن يكون مستقبلياً");
    if(v.directorUpdateDate&&v.transferred&&v.directorUpdateDate<v.transferred)throw Error("تاريخ تحديث المديرية قبل تاريخ الإرسال");
    const title=editorKind==="mail"?"[بريد] "+(v.number?v.number+" — ":"")+v.title:"[موضوع] "+v.number+" — "+v.title;
    const body=bodyFor(v,editorKind,editing);
    if(editing)await api("PATCH","/issues/"+editing.id,{title,body,state:v.status==="منتهي"?"closed":"open"});
    else{const created=await api("POST","/issues",{title,body});if(v.status==="منتهي")await api("PATCH","/issues/"+created.number,{state:"closed"})}
    $("editorDialog").close();toast("تم حفظ البيانات بنجاح، وستظهر للموظف الآخر");
    await reload(true);
  }catch(err){toast("فشل الحفظ: "+err.message,true)}
  finally{btn.disabled=false}
}
async function openDetail(id){
  if(!requireLogin())return;
  const r=records.find(x=>x.id===Number(id));if(!r)return;detail=r;
  $("detailRef").textContent=(r.kind==="mail"?"رسالة بريد":"موضوع")+" #"+r.id;
  $("detailTitle").textContent=r.title;
  $("markFollowup").hidden=r.status==="منتهي";
  $("detailMeta").innerHTML=[["الرقم",r.number||"—"],["المديرية",r.directorate||"—"],["المسؤول",r.assignee||"—"],["الحالة",r.overdue?"متأخر":r.status],["عدد الأيام",r.ageDays===null?"—":String(r.ageDays)],["موعد تذكير المتابعة",r.kind==="mail"||r.status==="منتهي"?"—":r.nextReminder],["الموعد النهائي",fmDate(r.due)]].map(([k,v])=>'<span class="detail-chip">'+esc(k)+": "+esc(v)+'</span>').join("");
  const sections=r.kind==="mail"?[["تفاصيل الرسالة",r.details],["الملاحظات",r.notes],["آخر التحديثات",r.updates]]:[["تفاصيل الموضوع",r.details],["التوجيه",r.direction],["الملاحظات",r.notes],["آخر التحديثات",r.updates]];
  $("detailBody").innerHTML=sections.map(([k,v])=>"<h3>"+esc(k)+"</h3><p>"+esc(v||"—")+"</p>").join("");
  $("toggleClose").textContent=r.status==="منتهي"?"↺ إعادة الموضوع للمتابعة":"✓ إنهاء الموضوع";
  $("githubDetail").href=r.issue.html_url;$("commentText").value="";
  $("commentList").innerHTML='<p class="empty-note">جارٍ تحميل التحديثات…</p>';
  $("detailDialog").showModal();await loadComments(r.id);
}
async function loadComments(id){
  try{
    const items=await api("GET","/issues/"+id+"/comments?per_page=100");
    if(detail?.id!==id)return;
    const list=$("commentList");list.replaceChildren();
    if(!items.length){list.innerHTML='<p class="empty-note">لا توجد تعليقات حتى الآن.</p>';return}
    for(const item of items){
      const box=document.createElement("div");box.className="comment-card";
      const author=document.createElement("strong");author.textContent=item.user?.login||"مستخدم";
      const date=document.createElement("small");date.textContent=fmDate(new Date(item.created_at))+" · "+fmTime(new Date(item.created_at));
      const body=document.createElement("p");body.textContent=item.body||"";
      box.append(author,date,body);list.append(box);
    }
  }catch(e){$("commentList").textContent="تعذر تحميل التعليقات: "+e.message}
}
async function setFollowupDate(id){
  const issue=await api("GET","/issues/"+id);
  const stamp=omanISO();
  const oldBody=String(issue.body||"");
  const pattern=/^\*\*تاريخ آخر متابعة\*\*:[^\r\n]*/m;
  let newBody=pattern.test(oldBody)?oldBody.replace(pattern,"**تاريخ آخر متابعة**: "+stamp):"**تاريخ آخر متابعة**: "+stamp+"\n\n"+oldBody;
  const logPattern=/^\*\*سجل المتابعات\*\*:[^\r\n]*/m;
  const history=get(oldBody,["سجل المتابعات"]).split(",").filter(validDay);
  history.push(stamp);
  newBody=logPattern.test(newBody)?newBody.replace(logPattern,"**سجل المتابعات**: "+history.join(",")):"**سجل المتابعات**: "+history.join(",")+"\n\n"+newBody;
  await api("PATCH","/issues/"+id,{body:newBody});
  return stamp;
}
async function markFollowupToday(){
  if(!detail||detail.status==="منتهي")return;
  const btn=$("markFollowup");btn.disabled=true;
  try{
    await setFollowupDate(detail.id);
    $("detailDialog").close();
    await reload(true);
    toast("تم تسجيل المتابعة، والتذكير القادم حسب مدة المتابعة المحددة دون الجمعة والسبت");
  }catch(error){toast("تعذر تسجيل المتابعة: "+error.message,true)}
  finally{btn.disabled=false}
}

async function saveComment(e){
  e.preventDefault();if(!detail)return;
  const content=$("commentText").value.trim(),id=detail.id;
  if(!content)return;
  const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;
  try{
    await api("POST","/issues/"+id+"/comments",{body:content});
    $("commentText").value="";
    let followupOk=true;
    if(detail.status!=="منتهي"){
      try{await setFollowupDate(id)}catch(error){followupOk=false;toast("حُفظ التعليق، لكن لم يتم تحديث موعد التذكير: "+error.message,true)}
    }
    await loadComments(id);await reload(true);
    if(followupOk)toast("تم حفظ التحديث، وتم تجديد موعد التذكير");
  }
  catch(err){toast("تعذر حفظ التحديث: "+err.message,true)}
  finally{btn.disabled=false}
}
async function flipStatus(){
  if(!detail)return;
  const next=detail.status==="منتهي"?"open":"closed";
  if(!confirm(next==="open"?"هل تريد إعادة فتح الموضوع؟":"هل انتهى الموضوع وتريد إغلاقه؟"))return;
  try{await api("PATCH","/issues/"+detail.id,{state:next});$("detailDialog").close();await reload(true);toast("تم تغيير الحالة")}
  catch(e){toast("تعذر تغيير الحالة: "+e.message,true)}
}
function logoutDashboard(){
  if(!connected)return;
  if(!confirm("هل تريد تسجيل الخروج من شاشة المتابعة؟"))return;
  auth="";connected=false;issues=[];records=[];monthlySnapshots=[];lastSync=null;detail=null;
  $("githubToken").value="";clearInterval(refreshTimer);refreshTimer=null;
  for(const modal of document.querySelectorAll("dialog"))if(modal.open)modal.close();
  render();
  changeView("overview");
  toast("تم تسجيل الخروج ومسح رمز الدخول من هذه الصفحة");
}
function downloadDashboard(){
  if(!requireLogin())return;
  if(!records.length){toast("لم يتم تحميل أي سجلات للتصدير",true);return}
  if(!window.OfficeXLSX||typeof window.OfficeXLSX.createWorkbook!=="function"){
    toast("تعذر تحميل مكتبة Excel المحلية. حدّث الصفحة وجرب مرة ثانية.",true);
    return;
  }
  try{
    const headings=["التصنيف","مدة الإنجاز","أيام المتابعة","آخر تحديث من المديرية","تاريخ تحديث المديرية","أيام دون تحديث","أيام من الإرسال","المرفقات","نوع السجل","الرقم","اسم الموضوع","المديرية المختصة","الموظف المسؤول","الحالة","عدد الأيام","موعد تذكير المتابعة","تاريخ الوصول","تاريخ التحويل","الموعد النهائي","تفاصيل الموضوع","التوجيه","الملاحظات","آخر التحديثات","آخر تعديل","رابط السجل"];
    const toRow=r=>[r.category,r.deadlineDays,r.interval,r.directorUpdate,r.directorUpdateDate,r.directorAge??"",r.sentAge??"",r.attachments,
      r.kind==="mail"?"بريد إلكتروني":"موضوع مرسال",
      r.number,r.title,r.directorate,r.assignee,r.overdue?"متأخر":r.status,
      r.ageDays===null?"":r.ageDays,
      r.status!=="منتهي"?r.nextReminder:"",
      r.receivedRaw,r.transferred,r.dueISO,
      r.details,r.direction,r.notes,r.updates,
      r.updatedAt?r.updatedAt.toISOString():"",
      r.issue.html_url
    ];
    const topics=records.filter(r=>r.kind==="topic");
    const mails=records.filter(r=>r.kind==="mail");
    const reminders=records.filter(r=>r.reminderDueNow);
    const history=[...monthlySnapshots].sort((a,b)=>a.month.localeCompare(b.month));
    const current=monthStats(omanISO().slice(0,7));
    const metricRows=[...history,current].flatMap(s=>s.rows.map(r=>[s.month,s===current?"جاري":"محفوظ",r.dir,({topic:"مرسال",mail:"البريد",all:"مشترك"}[r.kind]),r.received,r.completed,r.open,r.late,r.sent,r.followups,r.unknown]));
    const workbook=window.OfficeXLSX.createWorkbook([
      {name:"مواضيع مرسال",headers:headings,rows:topics.map(toRow)},
      {name:"البريد الإلكتروني",headers:headings,rows:mails.map(toRow)},
      {name:"تذكيرات المتابعة",headers:headings,rows:reminders.map(toRow)},
      {name:"المواضيع العاجلة",headers:headings,rows:records.filter(r=>r.category!=="عادي"&&r.status!=="منتهي").map(toRow)},
      {name:"المؤشرات الشهرية",headers:["الشهر","الحصر","المديرية","المصدر","المستلمة","المنجزة","قيد الإجراء","المتأخرة","المرسلة","المتابعات","بلا تاريخ وصول"],rows:metricRows}
    ]);
    const url=URL.createObjectURL(workbook);
    const link=document.createElement("a");
    link.href=url;
    link.download="متابعة_مواضيع_مكتب_نائب_الرئيس_"+omanISO()+".xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    toast("تم تجهيز ملف Excel بصيغة XLSX ويضم "+records.length+" سجلاً في 5 صفحات");
  }catch(error){
    toast("تعذر إنشاء ملف Excel: "+error.message,true);
  }
}
function events(){
  document.querySelectorAll(".nav-item").forEach(el=>el.addEventListener("click",()=>changeView(el.dataset.view)));
  document.body.addEventListener("click",e=>{
    const viewBtn=e.target.closest("[data-open-view]");if(viewBtn)changeView(viewBtn.dataset.openView);
    const issueBtn=e.target.closest("[data-open-id]");if(issueBtn)openDetail(issueBtn.dataset.openId);
    const dirBtn=e.target.closest("[data-dir]");if(dirBtn){changeView("topics");filterDir=dirBtn.dataset.dir;$("directorateFilter").value=filterDir;renderList()}
    const dismiss=e.target.closest("[data-close-dialog]");if(dismiss)$(dismiss.dataset.closeDialog).close();
  });
  $("menuToggle").onclick=()=>$("sidebar").classList.toggle("show");
  $("connectButton").onclick=()=>{if(!connected)$("loginDialog").showModal();else logoutDashboard()};
  $("logoutButton").onclick=logoutDashboard;
  $("downloadButton").onclick=downloadDashboard;
  $("editContentButton").onclick=()=>{
    if(!requireLogin())return;
    changeView("topics");
    toast("اختر الموضوع من القائمة واضغط «فتح وتحديث» ثم «تعديل البيانات»");
  };
  $("bannerLogin").onclick=()=>requireLogin();
  $("addTopic").onclick=()=>openEditor("topic");
  $("addMail").onclick=()=>openEditor("mail");
  $("syncButton").onclick=()=>{if(requireLogin())reload()};
  $("loginForm").onsubmit=async e=>{
    e.preventDefault();const btn=$("loginSubmit");btn.disabled=true;$("authError").textContent="";auth=$("githubToken").value.trim();
    try{
      await api("GET","https://api.github.com/user");
      const repository=await api("GET","");
      if(repository.private!==true)throw Error("المستودع ليس خاصاً، أوقف الاستخدام لحماية البيانات");
      connected=true;
      if(!await reload(true))throw Error("تعذر تحميل المواضيع؛ تأكد من صلاحية Issues: Read and write لرمز GitHub");
      $("loginDialog").close();$("githubToken").value="";
      clearInterval(refreshTimer);
      refreshTimer=setInterval(()=>{if(!document.hidden)reload(true)},60000);
      toast("تم الدخول إلى شاشة المتابعة بنجاح");
    }catch(error){auth="";connected=false;issues=[];records=[];$("authError").textContent=error.message;render()}
    finally{btn.disabled=false}
  };
  $("metricMonth").onchange=renderMetrics;
  $("metricDirectorate").onchange=renderMetrics;
  $("saveMonth").onclick=saveMonthlySnapshot;
  $("editorForm").onsubmit=saveEditor;
  $("commentForm").onsubmit=saveComment;
  $("toggleClose").onclick=flipStatus;
  $("markFollowup").onclick=markFollowupToday;
  $("editDetail").onclick=()=>{const r=detail;$("detailDialog").close();openEditor(r.kind,r)};
  ["searchField","directorateFilter","employeeFilter","statusFilter"].forEach(id=>{
    $(id).addEventListener(id==="searchField"?"input":"change",()=>{
      if(id==="directorateFilter")filterDir=$("directorateFilter").value;
      renderList();
    })
  });
  for(const dialog of document.querySelectorAll("dialog"))dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close()});
}
events();render();
})();