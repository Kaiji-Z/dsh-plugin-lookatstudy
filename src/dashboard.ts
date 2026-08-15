/**
 * The self-served study workbench: LookatStudy's left rail (course map) and
 * right column (讲解 lesson view + Cornell 笔记) as one page the learner
 * opens in their own browser, served from the dsh webserver and reading the
 * same live plugin state the tutor tools write. Focus can be switched from
 * the page, and buttons send messages back to the tutor through the last
 * agent that ran a study tool.
 * @module dsh-plugin-lookatstudy/dashboard
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { renderMarkdown } from './markdown.ts'
import {
  conceptViews,
  deleteCourse,
  dueReviews,
  findCourse,
  findLesson,
  learnerSnapshot,
  starterPrompts,
  strategyBand,
  type LearningState,
} from './state.ts'

/** Minimal agent handle the reverse channel needs. */
export interface FollowupAgent {
  followup(message: UserMessage): void
}

/** State access shared with the tools (same live object). */
export interface DashboardStore {
  get(): LearningState
  save(): void
}

/** Wiring handed in by `apply`. */
export interface DashboardDeps {
  store: DashboardStore
  /** The last agent that executed a study tool; buttons message it. */
  agentRef: { current: FollowupAgent | undefined }
}

/** Structural slice of the dsh `webServer` service, for testability. */
export interface RouteRegistry {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: RequestLike, res: ResponseLike) => void | Promise<void> }): () => void
}

/** Structural `IncomingMessage`. */
export interface RequestLike {
  method?: string
  url?: string
}

/** Structural `ServerResponse` the handlers write to. */
export interface ResponseLike {
  headersSent: boolean
  writeHead(status: number, headers?: Record<string, string>): ResponseLike
  end(chunk?: string): ResponseLike
  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'end', listener: () => void): void
}

/** One course's map for the left rail. */
export interface WorkbenchCourse {
  courseId: string
  title: string
  mastered: number
  total: number
  avgMasteryPct: number | null
  sections: Array<{
    title: string
    index: number
    lessons: Array<{
      id: string
      title: string
      kind: string
      status: string
      masteryPct: number | null
      weakConcepts: number
      frictionCount: number
      due: boolean
      focus: boolean
    }>
  }>
}

/** The focus lesson's 讲解 view. */
export interface WorkbenchLesson {
  lessonId: string
  courseTitle: string
  sectionTitle: string
  title: string
  status: string
  masteryPct: number | null
  strategy: string
  concepts: Array<{ title: string; masteryPct: number; weak: boolean }>
  starters: Array<{ label: string; message: string }>
  notes: Array<{ id: string; zone: string; title: string; text: string; source: string; quote: string | null }>
  html: string
}

/** Whole workbench state for the page. */
export interface WorkbenchState {
  mode: string
  courses: WorkbenchCourse[]
  focusLessonId: string | null
  lesson: WorkbenchLesson | null
  dueCount: number
  due: Array<{ lessonId: string; lessonTitle: string; courseTitle: string; overdueDays: number }>
  pendingProposals: Array<{ id: string; lessonTitle: string; rationale: string }>
  memory: { global: string | null; lesson: string | null; pattern: string | null }
}

/**
 * Assemble the whole workbench state (pure read; the lesson HTML is rendered
 * server-side from the sanitized markdown pipeline).
 * @param state - live learning state.
 * @param now - current time.
 * @returns the page's data contract.
 */
export function workbenchState(state: LearningState, now: Date): WorkbenchState {
  const focusId = state.focus?.lessonId ?? null
  const dueIds = new Set(dueReviews(state, undefined, now).map(d => d.lessonId))
  const courses: WorkbenchCourse[] = state.courses.map((course) => {
    const lessons = course.sections.flatMap(s => s.lessons)
    const answered = lessons.filter(l => l.mastery !== null)
    return {
      courseId: course.id,
      title: course.title,
      mastered: lessons.filter(l => l.status === 'mastered').length,
      total: lessons.length,
      avgMasteryPct: answered.length === 0
        ? null
        : Math.round(answered.reduce((sum, l) => sum + (l.mastery ?? 0), 0) / answered.length * 100),
      sections: course.sections.map((section, index) => ({
        title: section.title,
        index,
        lessons: section.lessons.map(lesson => ({
          id: lesson.id,
          title: lesson.title,
          kind: lesson.kind,
          status: lesson.status,
          masteryPct: lesson.mastery === null ? null : Math.round(lesson.mastery * 100),
          weakConcepts: (conceptViews(lesson) ?? []).filter(c => c.weak).length,
          frictionCount: lesson.friction.length,
          due: dueIds.has(lesson.id),
          focus: lesson.id === focusId,
        })),
      })),
    }
  })
  let lesson: WorkbenchLesson | null = null
  if (focusId !== null) {
    try {
      const ref = findLesson(state, focusId)
      lesson = {
        lessonId: ref.lesson.id,
        courseTitle: ref.course.title,
        sectionTitle: ref.section.title,
        title: ref.lesson.title,
        status: ref.lesson.status,
        masteryPct: ref.lesson.mastery === null ? null : Math.round(ref.lesson.mastery * 100),
        strategy: strategyBand(ref.lesson.mastery),
        concepts: conceptViews(ref.lesson) ?? [],
        starters: starterPrompts(ref.lesson.title).map(s => ({ label: s.label, message: s.message })),
        notes: ref.lesson.notes.map(n => ({
          id: n.id,
          zone: n.zone,
          title: n.title,
          text: n.text,
          source: n.source,
          quote: n.quote,
        })),
        html: renderMarkdown(ref.lesson.body),
      }
    } catch {
      lesson = null
    }
  }
  const due = dueReviews(state, undefined, now)
  return {
    mode: state.mode,
    courses,
    focusLessonId: focusId,
    lesson,
    dueCount: due.length,
    due: due.map(d => ({ lessonId: d.lessonId, lessonTitle: d.lessonTitle, courseTitle: d.courseTitle, overdueDays: d.overdueDays })),
    pendingProposals: state.proposals
      .filter(p => p.status === 'pending')
      .map(p => {
        try {
          return { id: p.id, lessonTitle: findLesson(state, p.lessonId).lesson.title, rationale: p.rationale }
        } catch {
          return { id: p.id, lessonTitle: p.lessonId, rationale: p.rationale }
        }
      }),
    memory: (() => {
      const snap = learnerSnapshot(state, now)
      return { global: snap.memoryGlobal, lesson: snap.memoryLesson, pattern: snap.memoryPattern }
    })(),
  }
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function sendJson(res: ResponseLike, status: number, value: unknown): void {
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(value))
}

/**
 * Read one JSON body, answering 400 on malformed or oversized input so the
 * handler never throws into the HTTP layer.
 * @returns the parsed value, or undefined when the response is already sent.
 */
async function readJsonBodySafe(req: RequestLike, res: ResponseLike): Promise<unknown | undefined> {
  try {
    return await readJsonBody(req as never)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad request' })
    return undefined
  }
}

/** Read one JSON request body with a hard 64 kB cap; malformed bodies reject. */
function readJsonBody(req: RequestLike & { on(event: 'data' | 'end', listener: (...args: never[]) => void): void }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (chunks.reduce((n, c) => n + c.length, 0) > 65_536) {
        reject(new Error('request body too large'))
        return
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('request body is not valid JSON'))
      }
    })
  })
}

/**
 * Register the workbench routes under `/lookatstudy`: the page, the polling
 * state API, focus switching, and the reverse message channel.
 * @param webServer - the composed webserver's route registry.
 * @param deps - store plus last-agent reference.
 * @returns the disposer removing every route.
 */
export function registerDashboard(webServer: RouteRegistry, deps: DashboardDeps): () => void {
  const disposePage = webServer.register({
    kind: 'prefix',
    path: '/lookatstudy',
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (req.method === 'GET' && (pathname === '/lookatstudy' || pathname === '/lookatstudy/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(WORKBENCH_PAGE)
        return
      }
      if (req.method === 'GET' && pathname === '/lookatstudy/api/state') {
        sendJson(res, 200, workbenchState(deps.store.get(), new Date()))
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/focus') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'lessonId (string) required' })
          return
        }
        try {
          const ref = findLesson(deps.store.get(), body.lessonId)
          deps.store.get().focus = { lessonId: ref.lesson.id }
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/message') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.text !== 'string' || body.text.trim() === '') {
          sendJson(res, 400, { ok: false, error: 'text (non-empty string) required' })
          return
        }
        const agent = deps.agentRef.current
        if (agent === undefined) {
          sendJson(res, 409, { ok: false, error: 'no tutor session yet — say something to the tutor in dsh first, then buttons work here' })
          return
        }
        agent.followup(createUserMessage({ content: [{ type: 'text', text: body.text }], source: { kind: 'user' } }))
        sendJson(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/course/delete') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.courseId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'courseId (string) required' })
          return
        }
        try {
          const course = findCourse(deps.store.get(), body.courseId)
          deleteCourse(deps.store.get(), course.id)
          if (deps.store.get().focus?.lessonId.startsWith(`${course.id}:`)) {
            deps.store.get().focus = null
          }
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/mode') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (body.mode !== 'direct' && body.mode !== 'guide' && body.mode !== 'practice') {
          sendJson(res, 400, { ok: false, error: 'mode must be direct | guide | practice' })
          return
        }
        deps.store.get().mode = body.mode
        deps.store.save()
        sendJson(res, 200, { ok: true, mode: body.mode })
        return
      }
      sendJson(res, 404, { ok: false, error: 'not found' })
    },
  })
  return () => { disposePage() }
}

/** The workbench page: dark mini-LookatStudy (map rail + 讲解/笔记 tabs). */
export const WORKBENCH_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LookatStudy 学习台</title>
<style>
:root{--bg:#0f101a;--s1:#161827;--s2:#1d2033;--s3:#262a42;--brand:#58cc02;--gold:#ffc800;--warn:#ff4b4b;--accent:#1cb0f6;--review:#ff7a1a;--text:#eef0f6;--dim:#9aa0b4}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.65 system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:10px 18px;background:var(--s1);border-bottom:1px solid #23263a}
header h1{font-size:16px;font-weight:700}
header .grow{flex:1}
select{background:var(--s3);color:var(--text);border:1px solid #323650;border-radius:8px;padding:4px 8px}
.badge{border-radius:999px;padding:2px 10px;font-size:12px}
.badge.mode{background:#2a2410;color:var(--gold)}
.badge.due{background:#301708;color:var(--review)}
#banner{display:none;background:#241d33;border-bottom:1px solid #3a2f55;padding:10px 18px;gap:10px;align-items:center}
#banner .why{flex:1}
#banner button{margin-left:8px}
main{flex:1;display:flex;min-height:0}
#rail{width:320px;min-width:260px;background:var(--s1);overflow-y:auto;padding:14px}
#rail .course{margin-bottom:20px}
#rail h3{font-size:13px;color:var(--dim);margin-bottom:8px}
#rail .sec{margin:12px 0 4px;font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.node{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;cursor:pointer;margin:2px 0}
.node:hover{background:var(--s2)}
.node.focus{background:var(--s3);outline:1px solid #3b4066}
.node .g{width:20px;text-align:center}
.node .t{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node .pct{font-size:11px;color:var(--dim)}
.node .bar{width:44px;height:5px;border-radius:3px;background:#2b2f4a;overflow:hidden}
.node .bar i{display:block;height:100%;background:var(--brand)}
.node.locked{opacity:.45;cursor:not-allowed}
.tag{font-size:10px;border-radius:4px;padding:0 4px;margin-left:3px}
.tag.weak{background:#33230a;color:var(--gold)}
.tag.fric{background:#331414;color:var(--warn)}
#content{flex:1;overflow-y:auto;padding:20px 26px;background:var(--s2)}
.tabs{display:flex;gap:6px;margin-bottom:14px}
.tabs button{background:var(--s3);color:var(--dim);border:none;border-radius:8px;padding:6px 16px;cursor:pointer;font-size:13px}
.tabs button.on{background:var(--brand);color:#0b1a02;font-weight:700}
#lesson-head h2{font-size:19px;margin-bottom:4px}
#lesson-head .meta{color:var(--dim);font-size:12px;margin-bottom:6px}
#lesson-head .chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.chip{border-radius:999px;padding:2px 10px;font-size:11px;background:var(--s3)}
.chip.weak{background:#33230a;color:var(--gold)}
.prose{max-width:80ch}
.prose h1,.prose h2,.prose h3,.prose h4{margin:18px 0 8px}
.prose pre{background:#101223;border:1px solid #262a42;border-radius:10px;padding:12px;overflow-x:auto;margin:10px 0;font-size:12.5px}
.prose code{background:#262a42;border-radius:4px;padding:1px 5px;font-size:.92em}
.prose pre code{background:none;padding:0}
.prose table{border-collapse:collapse;margin:10px 0}
.prose th,.prose td{border:1px solid #323650;padding:5px 11px;font-size:13px}
.prose blockquote{border-left:3px solid var(--accent);padding:2px 12px;color:var(--dim);margin:10px 0}
.prose a{color:var(--accent)}
.prose ul,.prose ol{padding-left:22px;margin:8px 0}
.starters{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:12px;border-top:1px dashed #323650}
.starters button{background:var(--s3);color:var(--text);border:1px solid #3b4066;border-radius:999px;padding:5px 14px;cursor:pointer;font-size:12.5px}
.starters button:hover{border-color:var(--accent)}
.zone{margin-bottom:18px}
.zone h4{font-size:13px;color:var(--dim);margin-bottom:8px}
.note{background:var(--s1);border:1px solid #2b2f4a;border-radius:10px;padding:10px 14px;margin-bottom:8px}
.note .nt{font-weight:600;font-size:13px}
.note .src{float:right;font-size:10px;color:var(--dim)}
.note .nx{margin-top:4px;white-space:pre-wrap;font-size:13px}
.note .q{margin-top:6px;color:var(--dim);font-size:12px;border-left:2px solid var(--gold);padding-left:8px}
.empty{color:var(--dim);text-align:center;padding:60px 0}
#toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#202439;border:1px solid #3b4066;color:var(--text);border-radius:10px;padding:9px 18px;display:none;font-size:13px;z-index:9}
button.primary{background:var(--brand);color:#0b1a02;border:none;border-radius:9px;padding:6px 16px;font-weight:700;cursor:pointer}
button.ghost{background:var(--s3);color:var(--text);border:1px solid #3b4066;border-radius:9px;padding:6px 16px;cursor:pointer}
#duebox{margin-bottom:12px;background:var(--s1);border-radius:10px;padding:10px 12px;font-size:12.5px}
#duebox .d{color:var(--review)}
</style>
</head>
<body>
<header>
  <h1>📚 LookatStudy 学习台</h1>
  <select id="course" title="课程"></select>
  <div class="grow"></div>
  <span class="badge mode" id="mode"></span>
  <span class="badge due" id="due"></span>
</header>
<div id="banner">
  <span>🎓</span><span class="why" id="banner-why"></span>
  <button class="primary" id="banner-accept">接受(标记掌握)</button>
  <button class="ghost" id="banner-reject">再练练</button>
</div>
<main>
  <nav id="rail"></nav>
  <section id="content">
    <div class="tabs"><button id="tab-lesson" class="on">讲解</button><button id="tab-notes">笔记</button></div>
    <div id="view-lesson"></div>
    <div id="view-notes" style="display:none"></div>
  </section>
</main>
<div id="toast"></div>
<script>
var lastRaw='', selectedCourse='', tab='lesson';
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.style.display='block';setTimeout(function(){t.style.display='none'},2600)}
function send(text){
  fetch('/lookatstudy/api/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
    .then(function(r){toast(r.ok?'已发送给导师,回到 dsh 对话查看回复':r.j.error)})
    .catch(function(){toast('发送失败')})
}
function render(state){
  document.getElementById('mode').textContent='风格: '+state.mode;
  document.getElementById('due').textContent=state.dueCount>0?('今日待复习 '+state.dueCount):'';
  var cs=document.getElementById('course');
  if(cs.dataset.count!=String(state.courses.length)){
    cs.dataset.count=String(state.courses.length);
    cs.innerHTML=state.courses.length?'':'<option>暂无课程</option>';
    state.courses.forEach(function(c){var o=document.createElement('option');o.value=c.courseId;o.textContent=c.title;cs.appendChild(o)});
  }
  if(selectedCourse&&state.courses.some(function(c){return c.courseId===selectedCourse}))cs.value=selectedCourse;
  else if(state.courses.length){selectedCourse=state.courses[0].courseId;cs.value=selectedCourse}
  var course=state.courses.filter(function(c){return c.courseId===selectedCourse})[0];
  var rail=document.getElementById('rail');
  var h='';
  if(course){
    h+='<div class="course"><h3>'+esc(course.title)+' · '+course.mastered+'/'+course.total+' 已掌握'+'</h3>';
    if(state.dueCount>0){
      h+='<div id="duebox">🔁 <b>'+state.dueCount+'</b> 项到期<div>';
      state.due.forEach(function(d){h+='<div class="d">'+esc(d.lessonTitle)+' — '+esc(d.courseTitle)+(d.overdueDays>0?(' · 超'+d.overdueDays+'天'):'')+'</div>'});
      h+='</div><button class="ghost" onclick="send(\'开始今天的复习,从最到期的开始\')">开始复习</button></div>';
    }
    course.sections.forEach(function(s){
      h+='<div class="sec">'+esc(s.title)+'</div>';
      s.lessons.forEach(function(l){
        var g=l.kind==='exam'?'🎯':(l.status==='mastered'?'👑':(l.status==='in_progress'?'📖':(l.status==='available'?'⭐':'🔒')));
        h+='<div class="node '+(l.status==='locked'?'locked':'')+(l.focus?' focus':'')+'" data-id="'+esc(l.id)+'">'
          +'<span class="g">'+g+'</span><span class="t">'+esc(l.title)+'</span>'
          +(l.weakConcepts>0?'<span class="tag weak">⚡'+l.weakConcepts+'</span>':'')
          +(l.frictionCount>0?'<span class="tag fric">😣'+l.frictionCount+'</span>':'')
          +(l.masteryPct==null?'':'<span class="bar"><i style="width:'+l.masteryPct+'%"></i></span><span class="pct">'+l.masteryPct+'%</span>')
          +'</div>';
      });
    });
    h+='</div>';
  } else { h='<div class="empty">暂无课程<br>在 dsh 对话里让导师导入一个课程</div>'; }
  rail.innerHTML=h;
  Array.prototype.forEach.call(rail.querySelectorAll('.node'),function(n){
    n.onclick=function(){
      if(n.classList.contains('locked')){toast('尚未解锁 — 先完成前面的课时');return}
      fetch('/lookatstudy/api/focus',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lessonId:n.dataset.id})})
        .then(function(r){return r.json()}).then(function(j){if(j.ok){load(true)}else{toast(j.error)}}).catch(function(){toast('切换失败')});
    };
  });
  var b=document.getElementById('banner');
  if(state.pendingProposals.length){
    var p=state.pendingProposals[0];
    b.style.display='flex';
    document.getElementById('banner-why').textContent='导师提议你已掌握「'+p.lessonTitle+'」:'+p.rationale;
    document.getElementById('banner-accept').onclick=function(){send('接受提案 '+p.id+' —— 确认标记这课为已掌握');};
    document.getElementById('banner-reject').onclick=function(){send('拒绝提案 '+p.id+' —— 我想再练练');};
  } else { b.style.display='none'; }
  var lv=document.getElementById('view-lesson'), nv=document.getElementById('view-notes');
  if(state.lesson){
    var L=state.lesson;
    var chips=L.concepts.map(function(c){return '<span class="chip'+(c.weak?' weak':'')+'">'+esc(c.title)+' '+c.masteryPct+'%'+(c.weak?' ⚡':'')+'</span>'}).join('');
    lv.innerHTML='<div id="lesson-head"><h2>'+esc(L.title)+'</h2>'
      +'<div class="meta">'+esc(L.courseTitle)+' / '+esc(L.sectionTitle)+' · '+esc(L.status)
      +(L.masteryPct==null?'':' · 掌握度 '+L.masteryPct+'%')+'</div>'
      +'<div class="meta">策略:'+esc(L.strategy)+'</div>'
      +(chips?'<div class="chips">'+chips+'</div>':'')
      +'</div><div class="prose">'+L.html
      +'<div class="starters">'+L.starters.map(function(s){return '<button data-m="'+esc(s.message)+'">'+esc(s.label)+'</button>'}).join('')+'</div></div>';
    Array.prototype.forEach.call(lv.querySelectorAll('.starters button'),function(btn){
      btn.onclick=function(){send(btn.dataset.m)};
    });
    var zones=[['understand','🧠 理解区 — 知识结构(AI 沉淀)'],['record','📝 记录区 — 我的话'],['practice','✍️ 练习区 — 答题日志']];
    var nh='';
    zones.forEach(function(z){
      var notes=L.notes.filter(function(n){return n.zone===z[0]});
      if(!notes.length)return;
      nh+='<div class="zone"><h4>'+z[1]+'</h4>'+notes.map(function(n){
        return '<div class="note"><span class="src">'+esc(n.source)+'</span><div class="nt">'+esc(n.title)+'</div>'
          +'<div class="nx">'+esc(n.text)+'</div>'
          +(n.quote?'<div class="q">“'+esc(n.quote)+'”</div>':'')
          +'</div>';
      }).join('')+'</div>';
    });
    nv.innerHTML=nh||'<div class="empty">这一课还没有笔记<br>讲解时让导师沉淀结构,或自己记要点</div>';
  } else {
    lv.innerHTML='<div class="empty">点击左侧课时开始学习<br>(或先在 dsh 对话里导入课程)</div>';
    nv.innerHTML='<div class="empty">先选择一课</div>';
  }
}
function load(force){
  fetch('/lookatstudy/api/state').then(function(r){return r.json()}).then(function(state){
    var raw=JSON.stringify(state);
    if(raw===lastRaw&&!force)return;
    lastRaw=raw;render(state);
  }).catch(function(){});
}
document.getElementById('course').onchange=function(){selectedCourse=this.value;load(true)};
document.getElementById('tab-lesson').onclick=function(){tab='lesson';this.className='on';document.getElementById('tab-notes').className='';document.getElementById('view-lesson').style.display='';document.getElementById('view-notes').style.display='none'};
document.getElementById('tab-notes').onclick=function(){tab='notes';this.className='on';document.getElementById('tab-lesson').className='';document.getElementById('view-notes').style.display='';document.getElementById('view-lesson').style.display='none'};
load(true);
setInterval(function(){load(false)},3000);
</script>
</body>
</html>
`
