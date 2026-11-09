/* Private, collaborative Arabic dashboard powered by GitHub Issues.
   Access token remains in memory only, never in source, logs, or storage. */
(() => {
"use strict";
const OWNER="deputyoffice89-ctrl",REPO="vp-office-dashboard",API="https://api.github.com/repos/"+OWNER+"/"+REPO;
const DIRS=["الاشتراكات","المستحقات","إصابات العمل","خدمات المتعاملين","مكتب الدكتور"];
const VIEWS={overview:"نظرة عامة",topics:"مواضيع مرسال",overdue:"المواضيع المتأخرة",mails:"البريد الإلكتروني",closed:"المواضيع المنجزة"};
const $=id=>document.getElementById(id);
let auth="",connected=false,issues=[],records=[],view="overview",editing=null,editorKind="topic",detail=null,lastSync=null,loading=false,filterDir="",refreshTimer=null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const empty=v=>!v||["غير محدد","—","_No response_","None"].includes(String(v).trim());
const fmDate=d=>d?new Intl.DateTimeFormat("ar-OM",{day:"numeric",month:"short",year:"numeric"}).format(d):"غير محدد";
const fmTime=d=>new Intl.DateTimeFormat("ar-OM",{hour:"2-digit",minute:"2-digit"}).format(d);
const today=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())};
const add14=d=>{if(!d)return null;const x=new Date(d);x.setDate(x.getDate()+14);return x};
const iso=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||""))return null;const [y,m,d]=s.split("-").map(Number),v=new Date(y,m-1,d);return v.getFullYear()===y&&v.getMonth()===m-1&&v.getDate()===d?v:null};
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
  const receivedRaw=get(body,["تاريخ الوصول","تاريخ وصول الموضوع"]),received=iso(receivedRaw),due=add14(received);
  return {id:issue.number,issue,kind:mail?"mail":"topic",number,title,rawStatus,waiting,status,receivedRaw,received,due,
    overdue:issue.state==="open"&&due&&due<today(),transferred:get(body,["تاريخ التحويل","تاريخ تحويل الموضوع للمديرية المختصة"]),
    directorate:get(body,["المديرية المختصة"]),assignee:get(body,["الموظف المسؤول"]),
    details:get(body,["تفاصيل الموضوع","تفاصيل الرسالة","تفاصيلها"]),
    notes:get(body,["الملاحظات","الملاحظات وآخر التحديثات"]),updates:get(body,["آخر التحديثات"]),
    direction:get(body,["التوجيه"]),updatedAt:new Date(issue.updated_at),
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
    const result=[];
    for(let page=1;page<=20;page++){
      const batch=await api("GET","/issues?state=all&per_page=100&page="+page);
      for(const issue of batch)if(!issue.pull_request&&(/^\[(موضوع|بريد)\]/.test(issue.title)))result.push(issue);
      if(batch.length<100)break;
    }
    issues=result;records=result.map(decode);lastSync=new Date();render();
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
  $("overviewView").hidden=next!=="overview";$("listView").hidden=next==="overview";
  $("sidebar").classList.remove("show");$("searchField").value="";$("statusFilter").value="";
  if(next!=="topics")filterDir="";
  if(next==="overview")renderOverview();else renderList();
}
function render(){
  $("connectionBanner").hidden=connected;
  $("connectLabel").textContent=connected?"الحساب متصل":"ربط الحساب";
  const t=topics(),m=mails(),late=t.filter(x=>x.overdue),done=t.filter(x=>x.status==="منتهي");
  const snapshots=connected?[t.length,m.length,late.length,done.length]:[116,6,0,88];
  for(const [id,val] of [["countTopics",snapshots[0]],["countMails",snapshots[1]],["countOverdue",snapshots[2]],["countClosed",snapshots[3]],["nav-topics",snapshots[0]],["nav-overdue",snapshots[2]],["nav-mails",snapshots[1]]])$(id).textContent=val.toLocaleString("ar-OM");
  $("lastSync").textContent=lastSync?"آخر مزامنة "+fmTime(lastSync)+" · تحديث تلقائي كل دقيقة":"لم تُحمّل البيانات بعد";
  $("dateToday").textContent=fmDate(new Date());
  const selected=$("directorateFilter").value;
  const dirs=[...new Set([...DIRS,...t.map(r=>r.directorate).filter(Boolean)])];
  $("directorateFilter").innerHTML='<option value="">جميع المديريات</option>'+dirs.map(d=>'<option value="'+esc(d)+'">'+esc(d)+'</option>').join("")+'<option value="غير محدد">غير محدد</option>';
  $("directorateFilter").value=filterDir||selected||"";
  if(view==="overview")renderOverview();else renderList();
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
  const recent=[...t].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8);
  $("recentTopics").innerHTML=connected?(recent.length?recent.map(r=>'<button type="button" class="recent-item" data-open-id="'+r.id+'"><div class="recent-main"><strong>'+esc(r.title)+'</strong><small>'+esc(r.number||"#"+r.id)+' · '+esc(r.directorate||"غير محدد")+'</small></div>'+stat(r)+'</button>').join(""):'<p class="empty-note">لا توجد مواضيع.</p>'):'<p class="empty-note">تظهر المواضيع بعد ربط الحساب.</p>';
}
function renderList(){
  let rows=view==="mails"?mails():topics();
  if(view==="overdue")rows=rows.filter(r=>r.overdue);
  if(view==="closed")rows=rows.filter(r=>r.status==="منتهي");
  const q=$("searchField").value.trim().toLowerCase(),dir=$("directorateFilter").value||filterDir,emp=$("employeeFilter").value,status=$("statusFilter").value;
  if(q)rows=rows.filter(r=>[r.number,r.title,r.details,r.notes,r.updates,r.assignee].join(" ").toLowerCase().includes(q));
  if(dir&&view!=="mails")rows=rows.filter(r=>(r.directorate||"غير محدد")===dir);
  if(emp)rows=rows.filter(r=>r.assignee===emp);
  if(status)rows=rows.filter(r=>status==="متأخر"?r.overdue:r.status===status);
  rows.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||b.updatedAt-a.updatedAt);
  $("listTitle").textContent=VIEWS[view];
  $("listSubtitle").textContent=view==="overdue"?"التي تجاوزت 14 يوماً من تاريخ وصولها":view==="closed"?"المواضيع المنتهية والمؤرشفة":view==="mails"?"متابعة المراسلات والإجراءات":"عرض وإدارة جميع المعاملات";
  $("addMail").hidden=view!=="mails";$("directorateFilter").hidden=view==="mails";
  $("resultsCount").textContent=connected?"عدد النتائج: "+rows.length.toLocaleString("ar-OM"):"سجّل دخولك لعرض البيانات";
  $("listHead").innerHTML=view==="mails"?
    '<tr><th>رقم الرسالة</th><th>موضوع الرسالة</th><th>الموظف المسؤول</th><th>الحالة</th><th>آخر تعديل</th><th>الإجراء</th></tr>':
    '<tr><th>رقم الموضوع</th><th>اسم الموضوع</th><th>المديرية</th><th>المسؤول</th><th>الحالة</th><th>الموعد النهائي</th><th>الإجراء</th></tr>';
  $("listBody").innerHTML=!connected?'<tr><td colspan="7" class="empty-table">سجّل دخولك لعرض البيانات.</td></tr>':
    !rows.length?'<tr><td colspan="7" class="empty-table">لا توجد نتائج مطابقة.</td></tr>':
    rows.map(r=>view==="mails"?
      '<tr><td>'+esc(r.number||"—")+'</td><td><span class="row-title">'+esc(r.title)+'</span></td><td>'+esc(r.assignee||"—")+'</td><td>'+stat(r)+'</td><td>'+fmDate(r.updatedAt)+'</td><td><button class="row-action" type="button" data-open-id="'+r.id+'">فتح وتحديث</button></td></tr>':
      '<tr><td>'+esc(r.number||"—")+'</td><td><span class="row-title">'+esc(r.title)+'</span></td><td>'+esc(r.directorate||"—")+'</td><td>'+esc(r.assignee||"—")+'</td><td>'+stat(r)+'</td><td>'+fmDate(r.due)+'</td><td><button class="row-action" type="button" data-open-id="'+r.id+'">فتح وتحديث</button></td></tr>').join("");
}
function requireLogin(){if(connected)return true;$("loginDialog").showModal();return false}
function formField(f,value){
  const label=document.createElement("label");label.className="field-label"+(f.wide?" field-wide":"");label.append(document.createTextNode(f.label));
  let el;
  if(f.options){el=document.createElement("select");for(const opt of f.options){const o=document.createElement("option");o.value=opt;o.textContent=opt||"غير محدد";el.append(o)}}
  else if(f.textarea){el=document.createElement("textarea");el.rows=3}
  else{el=document.createElement("input");el.type=f.date?"date":"text"}
  el.name=f.name;el.id="field-"+f.name;el.required=!!f.required;el.value=value||"";el.placeholder=f.placeholder||"";label.append(el);return label;
}
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
  for(const f of kind==="mail"?mailFields:topicFields){
    let value=record?.[f.name]||"";
    if(f.name==="status")value=record?.status||"قيد الإجراء";
    $("editorFields").append(formField(f,value));
  }
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
  lines.push("","---","**لتوثيق تحديث جديد:** أضف تعليقاً على الموضوع.");
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
  $("detailMeta").innerHTML=[["الرقم",r.number||"—"],["المديرية",r.directorate||"—"],["المسؤول",r.assignee||"—"],["الحالة",r.overdue?"متأخر":r.status],["الموعد النهائي",fmDate(r.due)]].map(([k,v])=>'<span class="detail-chip">'+esc(k)+": "+esc(v)+'</span>').join("");
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
async function saveComment(e){
  e.preventDefault();if(!detail)return;
  const content=$("commentText").value.trim(),id=detail.id;
  if(!content)return;
  const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;
  try{await api("POST","/issues/"+id+"/comments",{body:content});$("commentText").value="";await loadComments(id);await reload(true);toast("تم حفظ التحديث للجميع")}
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
function events(){
  document.querySelectorAll(".nav-item").forEach(el=>el.addEventListener("click",()=>changeView(el.dataset.view)));
  document.body.addEventListener("click",e=>{
    const viewBtn=e.target.closest("[data-open-view]");if(viewBtn)changeView(viewBtn.dataset.openView);
    const issueBtn=e.target.closest("[data-open-id]");if(issueBtn)openDetail(issueBtn.dataset.openId);
    const dirBtn=e.target.closest("[data-dir]");if(dirBtn){changeView("topics");filterDir=dirBtn.dataset.dir;$("directorateFilter").value=filterDir;renderList()}
    const dismiss=e.target.closest("[data-close-dialog]");if(dismiss)$(dismiss.dataset.closeDialog).close();
  });
  $("menuToggle").onclick=()=>$("sidebar").classList.toggle("show");
  $("connectButton").onclick=()=>{
    if(!connected){$("loginDialog").showModal();return}
    if(confirm("تسجيل الخروج من شاشة المتابعة؟")){
      auth="";connected=false;issues=[];records=[];lastSync=null;detail=null;
      $("githubToken").value="";clearInterval(refreshTimer);render();toast("تم تسجيل الخروج")
    }
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
  $("editorForm").onsubmit=saveEditor;
  $("commentForm").onsubmit=saveComment;
  $("toggleClose").onclick=flipStatus;
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