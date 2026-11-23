import {CourseReader} from './CourseReader';
import {QuickPractice,SmartPractice,SelfCheck} from "./QuickPractice";
import {ThreadPanel} from "./ThreadPanel";
import {ResearchLibrary} from "./ResearchLibrary";
import {SkillsPanel} from "./SkillsPanel";
import {LearningPartner,MemorySettings,MemoryActions} from "./LearningPartner";
import {PaperWorkbench,MasteryControls} from "./PaperWorkbench";
import {UploadButton} from "./UploadButton";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  LayoutDashboard,
  CalendarDays,
  NotebookPen,
  GraduationCap,
  Brain,
  Settings,
  Plus,
  Upload,
  Search,
  ArrowRight,
  Check,
  FileText,
  Smartphone,
  RefreshCw,
  Play,
  Download,
  Trash2,
  Lock,
  Unlock,
  MessageCircle,
  X,
  LoaderCircle,
  ChevronRight,
  Activity,
  Layers,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import QRCode from "qrcode";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./style.css";
import type { StudyTarget, DueItem } from "../shared/navigation";
import { SelectableContent } from "./SelectableContent";
import type { AskSelection, SelectionSource } from "../shared/selection";
import { TimetableImport } from "./TimetableImport";
import {normalizeMathMarkdown,rehypeReadableMath,rehypeMathBlocks,MATH_STYLES} from '../shared/math-layout';
const mathStyle = document.createElement('style');
mathStyle.textContent = MATH_STYLES;
document.head.appendChild(mathStyle);
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
type Item = Record<string, any>;
async function api(path: string, data?: any) {
  const r = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "请求失败");
  return d;
}
const today = () => new Date().toLocaleDateString("sv-SE");
const b64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
function download(name: string, content: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  a.download = name + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const outcomeNames: Item = {
  independent: "独立答对",
  prompted: "提示后答对",
  reviewed: "看解析后重做",
  wrong: "答错",
  skip: "跳过",
  unspecified: "答对（未说明完成方式）",
};
const navs = [
  ["home", "学习概览", LayoutDashboard],
  ["library", "课程资料", BookOpen],
  ["questions", "个人错题本", NotebookPen],
  ["practice", "练习与试卷", GraduationCap],
  ["plan", "每日计划", CalendarDays],
  ["research", "论文库", FileText],
  ["partner", "学习伙伴", MessageCircle],
  ["settings", "设置与连接", Settings],
] as const;
function App() {
  const [state, setState] = useState<Item | null>(null),
    [tab, setTab] = useState("partner"),
    [course, setCourse] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [unauth, setUnauth] = useState(false),
    [pairCode, setPairCode] = useState(
      new URLSearchParams(location.hash.slice(1)).get("pair") || "",
    ),
    [pairId, setPairId] = useState("");
  const [docId, setDocId] = useState(""),
    [pageId, setPageId] = useState(""),
    [selection, setSelection] = useState(""),
    [crop, setCrop] = useState(""),
    [prompt, setPrompt] = useState(""),
    [qId, setQId] = useState(""),
    [examId, setExamId] = useState(""),
    [selectedTopics, setSelectedTopics] = useState<string[]>([]),
    [mode, setMode] = useState("practice"),
    [source, setSource] = useState("mixed"),
    [count, setCount] = useState(3),
    [minutes, setMinutes] = useState(30),
    [date, setDate] = useState(today()),
    [devices, setDevices] = useState<Item | null>(null),
    [qr, setQr] = useState(""),
    [backups, setBackups] = useState<string[]>([]),
    [courseModal, setCourseModal] = useState(false),
    [questionModal, setQuestionModal] = useState(false),
    [editing, setEditing] = useState<Item | null>(null),
    [answer, setAnswer] = useState(""),
    [answerImage, setAnswerImage] = useState(""),
    [shownAnswers, setShownAnswers] = useState<string[]>([]),
    [examStarted, setExamStarted] = useState<Record<string, number>>({}),
    [examAnswers, setExamAnswers] = useState<Record<string, string>>({});
  const [practiceView,setPracticeView]=useState("quick"),[workTarget,setWorkTarget]=useState(""),[activeThread,setActiveThread]=useState("");
  const [readerDoc,setReaderDoc]=useState('');
  const [initialReply,setInitialReply]=useState<Item|null>(null);
  const [citationTarget,setCitationTarget]=useState<Item|null>(null);
  const [advanced,setAdvanced]=useState<Item>({});
  const [askNoMemory,setAskNoMemory]=useState(false);
  const [practiceRequest,setPracticeRequest]=useState("");
  const [practicePreview,setPracticePreview]=useState<{id:string;key:string}|null>(null);
  const practiceKey=JSON.stringify([course,practiceRequest.trim(),selectedTopics]);
  const previewJob=practicePreview?.key===practiceKey?state?.records?.job?.find((j:Item)=>j.id===practicePreview.id):null;
  const preview=previewJob?.status==='done'?previewJob.result:null;
  const previewPending=!!previewJob&&['queued','running'].includes(previewJob.status);
  const practiceTopics:string[]=preview?.topics||selectedTopics;
  const needsPreview=!!practiceRequest.trim()&&!preview;

  const [adaptive,setAdaptive]=useState(true),[advice,setAdvice]=useState<Item|null>(null),[explanationReviewed,setExplanationReviewed]=useState(false);
  const [askSelection,setAskSelection]=useState<AskSelection|null>(null);
  const [selectionPrompt,setSelectionPrompt]=useState("这一步为什么成立？请结合上下文详细解释。");
  const [selectionJob,setSelectionJob]=useState("");
  const [selectionParent,setSelectionParent]=useState("");
  const [chatLimit,setChatLimit]=useState(6);
  const [pendingTarget,setPendingTarget]=useState<StudyTarget|null>(null);
  const [topicFilter,setTopicFilter]=useState(""),[wrongOnly,setWrongOnly]=useState(false),[highlightId,setHighlightId]=useState("");
  const navigate=(target:StudyTarget)=>setPendingTarget(target);
  const activeSelection=useRef<AskSelection|null>(null);
  activeSelection.current=askSelection;
  const imgRef = useRef<HTMLImageElement>(null),
    drag = useRef<{ x: number; y: number } | null>(null),
    [box, setBox] = useState<Item | null>(null);
  const initializedCourse=useRef(false);
  const refresh = async () => {
    try {
      const s = await api("state");
      setState(s);
      setUnauth(false);
      if(!initializedCourse.current){initializedCourse.current=true;setCourse(c=>c||s.records.course[0]?.id||"");}
    } catch (e) {
      if (String(e).includes("配对")) setUnauth(true);
      else setError(String(e));
    }
  };
  useEffect(() => {
    void (async () => {
      const boot = new URLSearchParams(location.hash.slice(1)).get("boot");
      if (boot) {
        try {
          await api("auth", { boot });
          history.replaceState(null, "", "/");
        } catch (e) {
          setError(String(e));
        }
      }
      await refresh();
    })();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!pairId) return;
    const timer = setInterval(() => {
      void api("pair/status", { id: pairId })
        .then((r) => {
          if (r.status === "approved") {
            setPairId("");
            void refresh();
          }
        })
        .catch((e) => setError(String(e)));
    }, 2000);
    return () => clearInterval(timer);
  }, [pairId]);
  const run = async (fn: () => Promise<any>, message = "") => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (message) setNotice(message);
      await refresh();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  useEffect(()=>{let stopped=false;setExplanationReviewed(false);if(!course||!practiceTopics.length||needsPreview){setAdvice(null);return;}void api('next-batch',{courseId:course,topics:practiceTopics,remainingMinutes:minutes}).then(r=>{if(!stopped){if(preview?.intent?.difficulty&&preview.intent.difficulty!=='自动')for(const row of r.rows)if(!row.diagnostic)row.difficulty=preview.intent.difficulty;setAdvice(r);}}).catch(()=>{if(!stopped)setAdvice(null);});return()=>{stopped=true;};},[course,practiceTopics.join('|'),needsPreview,preview?.intent?.difficulty,practiceKey,minutes,JSON.stringify(state?.masteryDetails),state?.records?.attempt?.length]);
  const records = state?.records || {},
    list = (kind: string) => records[kind] || [],
    filtered = (kind: string) =>
      list(kind).filter((r: Item) => !course || r.courseId === course),
    currentCourse = list("course").find((c: Item) => c.id === course),
    docs = filtered("document"),
    doc = docs.find((d: Item) => d.id === docId),
    pages = list("page")
      .filter((p: Item) => p.documentId === docId)
      .sort((a: Item, b: Item) => a.number - b.number),
    page = pages.find((p: Item) => p.id === pageId) || pages[0],
    questions = filtered("question"),
    question = questions.find((q: Item) => q.id === qId),
    topics = [
      ...new Set(questions.flatMap((q: Item) => q.topics || [])),
    ] as string[],
    exams = filtered("exam"),
    exam = exams.find((e: Item) => e.id === examId),
    running = list("job").filter((j: Item) =>
      ["running", "queued"].includes(j.status),
    );
  const selectedJob=list("job").find((j:Item)=>j.id===selectionJob);
  const completedChat=list("chat").find((c:Item)=>c.jobId===selectionJob);
  const currentParent=completedChat?.id||selectionParent;
  const conversationTurns:Item[]=[];
  for(let id=currentParent;id&&conversationTurns.length<50;){const c=list("chat").find((v:Item)=>v.id===id&&v.courseId===course);if(!c||conversationTurns.some(v=>v.id===c.id))break;conversationTurns.unshift(c);id=c.parentChatId;}
  const continueChat=(c:Item)=>{setAskSelection(c.selection||{source:sourceFor("chat",c),label:c.prompt,excerpt:c.text.slice(0,6000)});setSelectionParent(c.id);setSelectionJob("");setSelectionPrompt("");};
  const sourceFor=(kind:SelectionSource["kind"],record:Item,examId?:string):SelectionSource=>({kind,id:record.id,version:record.version,courseId:course,...(examId?{examId}:{})});
  useEffect(()=>{setSelection("");setCrop("");setBox(null);drag.current=null;},[course,docId,page?.id,page?.version]);
  useEffect(()=>{setAskSelection(null);setSelectionJob("");setSelectionParent("");},[course,docId,page?.id,qId,examId,tab]);
  useEffect(()=>{
    const select=(event:Event)=>{const detail=(event as CustomEvent<AskSelection>).detail;if(readerDoc||detail.source.courseId!==course)return;setSelection("");setCrop("");setBox(null);setAskSelection(detail);setSelectionJob("");setSelectionParent("");setSelectionPrompt("这一步为什么成立？请结合上下文详细解释。");};
    window.addEventListener("study-selection",select);return ()=>window.removeEventListener("study-selection",select);
  },[course,readerDoc]);
  const job = (action: string, extra: Item = {}) =>
    run(async () => {
      const j = await api("job", { action, courseId: course, ...(action==='ask'?{noMemory:askNoMemory}:{}), ...extra });
      setNotice("任务已启动，可在下方查看进度");
      return j;
    });
  useEffect(() => {
    setTopicFilter("");setWrongOnly(false);
    setChatLimit(6);
    setDocId("");
    setPageId("");
    setQId("");
    setExamId("");
    setSelectedTopics([]);setPracticeRequest("");setAdvanced({});setPracticePreview(null);
    setSelection("");
    setCrop("");
  }, [course]);
  useEffect(() => {
    const handler = (event: Event) => {
      const { name, number } = (event as CustomEvent).detail;
      const d = docs.find((d: Item) => d.name === name);
      const p =
        d &&
        list("page").find(
          (p: Item) => p.documentId === d.id && p.number === number,
        );
      if (p) {
        setTab("library");
        setDocId(d.id);
        setPageId(p.id);
      } else setNotice("此引用未匹配到已导入页面，请核对资料名称与页码。");
    };
    window.addEventListener("study-citation", handler);
    return () => window.removeEventListener("study-citation", handler);
  }, [state, course]);
  useEffect(()=>{
    const handler=(event:Event)=>{const t=(event as CustomEvent).detail;if(t&&["home","library","questions","plan","practice"].includes(t.tab))setPendingTarget(t);};
    window.addEventListener("study-navigate",handler);return ()=>window.removeEventListener("study-navigate",handler);
  },[]);
  useEffect(()=>{
    if(!pendingTarget||!state)return;
    const t=pendingTarget;
    const record=t.id?[...list("question"),...list("document"),...list("plan"),...list("task")].find((r:Item)=>r.id===t.id):undefined;
    if(t.id&&!record){setNotice("该项目已移除，已返回学习概览。");setTab("home");setPendingTarget(null);return;}
    const targetCourse=record?.courseId||(record?.taskId?list("task").find((r:Item)=>r.id===record.taskId)?.courseId:undefined)||t.courseId;
    if(targetCourse&&targetCourse!==course&&list("course").some((c:Item)=>c.id===targetCourse)){setCourse(targetCourse);return;}
    setTab(t.tab);setHighlightId(t.id?"study-item-"+t.id:t.focus||"");
    if(t.tab==="library"){setDocId(t.id||"");setPageId("");}
    if(t.tab==="questions"){setTopicFilter(t.topic||"");setWrongOnly(!!t.wrongOnly);setQId(t.id||questions.find((q:Item)=>(!t.topic||q.topics?.includes(t.topic))&&(!t.wrongOnly||q.wrong))?.id||"");setAnswer("");setAnswerImage("");}
    if(t.tab==="plan")setDate(record?.date||t.date||today());
    if(t.tab==="practice")setPracticeView("special");
    setPendingTarget(null);
  },[pendingTarget,course,state]);
  useEffect(()=>{if(!highlightId)return;const timer=setTimeout(()=>{const el=document.getElementById(highlightId);let parent=el?.parentElement;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}el?.scrollIntoView({block:"center",behavior:"instant"});el?.focus({preventScroll:true});},60);return ()=>clearTimeout(timer);},[highlightId,tab,date,practiceView]);
  const save = (kind: string, data: Item) =>
    api("save", { kind, data, version: data.version });
  async function upload(file: File) {
    if (!course) throw Error("请先新建或选择课程");
    const raw = await b64(file),
      d = await api("upload", {
        courseId: course,
        name: file.name,
        mime: file.type,
        base64: raw.split(",")[1],
      });
    setDocId(d.id);
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      }).promise;
      try {
        if (pdf.numPages > 200)
          throw Error("此版单份 PDF 最多处理 200 页，请拆分导入");
        for (let n = 1; n <= pdf.numPages; n++) {
          setNotice(`正在准备页面 ${n}/${pdf.numPages}`);
          const p = await pdf.getPage(n),
            vp = p.getViewport({ scale: 1.5 }),
            canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          await p.render({ canvas, viewport: vp }).promise;
          const content = await p.getTextContent();
          await api("page", {
            documentId: d.id,
            number: n,
            text: content.items.map((i: any) => i.str || "").join(" "),
            image: canvas.toDataURL("image/png"),
          });
        }
      } finally {
        await pdf.destroy();
      }
    } else if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = raw;
      await img.decode();
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 2000 / img.width);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      await api("page", {
        documentId: d.id,
        number: 1,
        text: "",
        image: canvas.toDataURL("image/png"),
      });
    } else if (/\.(txt|md)$/i.test(file.name))
      await api("page", {
        documentId: d.id,
        number: 1,
        text: await file.text(),
      });
    setNotice("资料已导入；可点击“识别与核对”运行模型分流");
  }
  function cropEnd(e: React.PointerEvent) {
    if (!drag.current || !imgRef.current) return;
    const img = imgRef.current,
      r = img.getBoundingClientRect(),
      end = {
        x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
        y: Math.max(0, Math.min(r.height, e.clientY - r.top)),
      },
      start = drag.current;
    drag.current = null;
    const x = Math.min(start.x, end.x),
      y = Math.min(start.y, end.y),
      w = Math.abs(start.x - end.x),
      h = Math.abs(start.y - end.y);
    if (w < 8 || h < 8) {
      setBox(null);
      return;
    }
    const canvas = document.createElement("canvas"),
      ratio = img.naturalWidth / r.width;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas
      .getContext("2d")!
      .drawImage(
        img,
        x * ratio,
        y * ratio,
        w * ratio,
        h * ratio,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    setCrop(canvas.toDataURL("image/png"));
    setBox({ x, y, w, h });
    setSelection(`已框选第 ${page.number} 页图片区域`);
  }
  const exportRecord = (id: string, answers = false, print = false) =>
    run(async () => {
      const r = await api(print ? "pdf" : "export", { id, answers });
      if (print) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(
          new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], {
            type: "application/pdf",
          }),
        );
        a.download = r.name + ".pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        setNotice("PDF 已生成并开始下载");
      } else download(r.name, r.text);
    });
  useEffect(() => {
    if (tab === "settings" && state?.admin) {
      void api("devices")
        .then(setDevices)
        .catch(() => {});
      void api("backups")
        .then(setBackups)
        .catch(() => {});
    }
  }, [tab, state?.records?.job?.length]);
  useEffect(() => {
    if (devices?.urls?.[0])
      void QRCode.toDataURL(devices.urls[0] + "/#pair=" + devices.code, {
        width: 180,
        margin: 1,
      }).then(setQr);
  }, [devices?.code, devices?.urls?.[0]]);
  if (unauth)
    return (
      <div className="pair-screen">
        <div className="brand-mark">
          <BookOpen />
        </div>
        <h1>连接你的学习工作台</h1>
        <p>
          手机和电脑连接同一 Wi-Fi，先安装并信任电脑导出的本地证书。
          <br />
          输入电脑显示的配对码，然后在电脑确认。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api("pair", {
                code: pairCode,
                name: "手机浏览器",
              });
              setPairId(r.id);
            });
          }}
        >
          <input
            aria-label="配对码"
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value)}
            placeholder="8 位配对码"
          />
          <button disabled={!!pairId}>
            {pairId ? "等待电脑确认…" : "请求配对"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  if (!state)
    return (
      <div className="pair-screen">
        <LoaderCircle className="spin" />
        <p>正在连接本地学习工作台…</p>
        {error && <p>{error}</p>}
      </div>
    );
  const workProps={state,call:api,run,busy,course,render:(text:string)=><RichText>{text}</RichText>,onNavigate:(view:string,id?:string)=>{setTab(view);if(id){setWorkTarget(id);if(view==='questions')setQId(id);if(view==='practice'){const e=list('exam').find((x:Item)=>x.id===id);if(e){setExamId(id);setPracticeView(e.generation?.action==='exam'||e.title.includes('试卷')?'paper':'special');}else setPracticeView('quick');}}}};
  const replyCourse=async(c:Item)=>{const excerpt=window.getSelection()?.toString().trim()||'';const t=await run(()=>api('workspace/thread/create',{resumeId:c.id}));if(t){setActiveThread(t.id);setInitialReply({id:c.id,excerpt,at:Date.now()});setTab('partner');}};
  const forkChat=async(c:Item)=>{const excerpt=window.getSelection()?.toString().trim()||c.text;const t=await run(()=>api('workspace/thread/create',{fromId:c.id,excerpt,title:'分支 · '+c.prompt.slice(0,45),mode:'partner'}));if(t){setActiveThread(t.id);setTab('partner');}};
  return (
    <div className={"app-shell "+(tab==='partner'?'chat-active':'')}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={24} />
          </span>
          <div>
            知序 <span>STUDY AGENT</span>
          </div>
        </div>
        <div className="sidebar-label">你的学习空间</div>
        <nav>
          {navs.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              data-mobile={({home:'概览',library:'资料',questions:'错题',practice:'练习',plan:'计划',memory:'记忆',partner:'伙伴',research:'论文',settings:'设置'} as Item)[id]}
              onClick={() => {setTab(id);setWorkTarget("");if(id==='research')setCitationTarget(null);}}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "questions" &&
                questions.filter((q: Item) => q.wrong).length > 0 && (
                  <b>{questions.filter((q: Item) => q.wrong).length}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="local-status">
          <span className="dot" /> 本地运行 · 数据留在你的电脑
          <small>
            {state.hasKey ? "模型已配置" : "等待配置模型"}
            <br />
            v0.1.11 · 学习工作台
          </small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            学习空间 <ChevronRight size={14} />
            <strong>{navs.find((n) => n[0] === tab)?.[1]}</strong>
          </div>
          <div className="top-actions">
            <select
              aria-label="当前课程"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
            >
              <option value="">选择课程</option>
              {list("course").map((c: Item) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.cloud ? "" : " · 仅本地"}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => setCourseModal(true)}>
              <Plus size={16} />
              新课程
            </button>
            <div className="avatar">学</div>
          </div>
        </header>
        <main>{readerDoc&&list("document").find((d:Item)=>d.id===readerDoc)&&<CourseReader key={readerDoc} {...workProps} document={list("document").find((d:Item)=>d.id===readerDoc)!} onClose={()=>setReaderDoc('')}/>}
          {error && (
            <div role="alert" className="alert error">
              <span>{error}</span>
              <button onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {state.space.low && (
            <div className="alert error">
              磁盘空间偏低，大型导入暂停。原始资料不会被自动删除。
            </div>
          )}
          {state.personalCare&&<div className="alert"><span>{state.personalCare.text}</span><button className="ghost" onClick={()=>setTab('partner')}>与学习伙伴聊聊</button><button className="ghost" aria-label="关闭今日关心" onClick={()=>void run(()=>api('personal-memory/dismiss',{}))}>今天先这样</button></div>}
          {tab==='partner'&&<section className="direct-partner"><PageHead title="学习伙伴" sub="直接聊学习、问问题，或让我帮你安排下一步。"/><ThreadPanel direct {...workProps} initialThreadId={activeThread} initialReply={initialReply} onCitation={c=>{setCitationTarget({...c,requestId:Date.now()});setWorkTarget(c.articleId);setTab('research');}}/><MemorySettings state={state} call={api} run={run} busy={busy}/><MemoryActions state={state} call={api} run={run}/></section>}
          {tab==='research'&&<ResearchLibrary {...workProps} initialId={workTarget} citationTarget={citationTarget}/>}
          {tab === "home" && (
            <>
              <div className="page-head">
                <div className="eyebrow">LEARN WITH INTENTION</div>
                <h1>把每一次学习，变成下一步。</h1>
                <p>从理解到练习，再到真正掌握。今天也按自己的节奏来。</p>
              </div>
              <div className="hero">
                <div>
                  <span className="pill light">你的学习闭环</span>
                  <h2>
                    {currentCourse
                      ? `继续学习 ${currentCourse.name}`
                      : "从第一门课程开始"}
                  </h2>
                  <p>导入课件，圈出疑问。让错题告诉你下一步该学什么。</p>
                  <button
                    onClick={() =>
                      course ? setTab("library") : setCourseModal(true)
                    }
                  >
                    {course ? "打开课程资料" : "创建我的课程"}
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div className="hero-art">
                  <div className="orbit o1" />
                  <div className="orbit o2" />
                  <div className="book-art">
                    <BookOpen size={64} strokeWidth={1.1} />
                    <span>理解 · 练习 · 掌握</span>
                  </div>
                  <span className="float-chip">
                    <Check size={15} />
                    每一步都有依据
                  </span>
                </div>
              </div>
              <div className="stats">
                {[
                  [FileText, "课程资料", docs.length, "份已保存的原始资料", {tab:"library",id:docs[0]?.id,courseId:course}],
                  [
                    NotebookPen,
                    "待复习错题",
                    questions.filter((q: Item) => q.wrong).length,
                    "按知识点组织",
                    {tab:"questions",wrongOnly:true,courseId:course},
                  ],
                  [Layers, "知识点", topics.length, "掌握程度有迹可循",{tab:"practice",courseId:course,focus:"topic-picker"}],
                  [
                    CalendarDays,
                    "今日安排",
                    list("plan").filter((p: Item) => p.date === today()).length,
                    "按可用时间规划",
                    {tab:"plan",date:today()},
                  ],
                ].map(([Icon, label, value, sub, target]: any) => (
                  <button type="button" className="stat card overview-link" aria-label={"打开"+label} key={label} onClick={()=>navigate(target)}>
                    <Icon size={20} />
                    <span>{label}</span>
                    <strong>
                      {value}
                      <small> 项</small>
                    </strong>
                    <p>{sub}</p>
                  </button>
                ))}
              </div>
              <section className="card due-reminders" id="due-reminders" tabIndex={-1}>
                <div className="section-head"><h3>待复习与到期待办 <small>{(state.dueItems||[]).length}</small></h3><button className="link" onClick={()=>setTab("settings")}>提醒设置</button></div>
                {(state.dueItems||[]).length===0?<p className="muted">暂时没有到期项目。到达复习时间后会在这里提醒你。</p>:(state.dueItems as DueItem[]).map(item=><button type="button" className="due-item overview-link" key={item.key} aria-label={"打开提醒："+item.title} onClick={()=>navigate(item.target)}><span><strong>{item.title}</strong><small>{list("course").find((c:Item)=>c.id===item.courseId)?.name||"学习待办"} · {item.date} {item.time}</small></span><span className={"pill "+(item.overdue?"warm":"")}>{item.overdue?"已逾期":"待处理"}</span><ArrowRight size={16}/></button>)}
              </section>
              <div className="two-col">
                <section className="card">
                  <div className="section-head">
                    <h3>今天的学习计划</h3>
                    <button className="link" onClick={() => navigate({tab:"plan",date:today()})}>
                      查看全部 <ArrowRight size={14} />
                    </button>
                  </div>
                  {list("plan")
                    .filter((p: Item) => p.date === today())
                    .slice(0, 4)
                    .map((p: Item) => (
                      <div className="timeline" key={p.id}>
                        <button className="timeline-link overview-link" aria-label={"打开计划："+p.title} onClick={()=>navigate({tab:"plan",id:p.id,date:p.date})}><time>{p.start}</time>
                        <span>
                          <strong>{p.title}</strong>
                          <small>
                            {p.minutes} 分钟 ·{" "}
                            {p.status === "done" ? "已完成" : "等待你的反馈"}
                          </small>
                        </span></button>
                        <button
                          className="icon"
                          aria-label={"完成计划："+p.title}
                          disabled={p.status==="done"}
                          onClick={() =>
                            void run(() =>
                              api("plan/update", {
                                id: p.id,
                                version: p.version,
                                status: "done",
                              }),
                            )
                          }
                        >
                          <Check size={18} />
                        </button>
                      </div>
                    ))}
                  {!list("plan").some((p: Item) => p.date === today()) && (
                    <Empty
                      title="今天还没有安排"
                      text="添加待办与可用时间，再生成不挤占课表的学习计划。"
                      action="规划今天"
                      onClick={() => setTab("plan")}
                    />
                  )}
                </section>
                <section className="card">
                  <div className="section-head">
                    <h3>知识点掌握概览</h3>
                    <span className="pill">以独立作答为依据</span>
                  </div>
                  {topics.slice(0, 5).map((t) => (
                    <button className="topic-row overview-link" aria-label={"查看知识点："+t} key={t} onClick={()=>navigate({tab:"questions",topic:t,courseId:course})}>
                      <span>{t}</span>
                      <span
                        className={
                          "pill " +
                          (state.mastery[course + "|" + t] === "薄弱"
                            ? "warm"
                            : "")
                        }
                      >
                        {state.mastery[course + "|" + t] || "待评估"}
                      </span>
                    </button>
                  ))}
                  {!topics.length && (
                    <Empty
                      title="让学习留下清晰的轨迹"
                      text="导入作业或手动录入错题后，知识点会出现在这里。"
                      action="打开错题本"
                      onClick={() => setTab("questions")}
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "library" && (
            <>
              <PageHead
                title="课程资料"
                sub="保留原始资料，让每一次回答都能回到出处。"
              />
              <div className="toolbar">
                <UploadButton>
                  <Upload size={16} />
                  导入课件 / 作业
                  <input
                    hidden
                    type="file"
                    accept=".pdf,.pptx,.png,.jpg,.jpeg,.txt,.md"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void run(() => upload(f));
                      e.target.value = "";
                    }}
                  />
                </UploadButton>
                <button
                  className="secondary"
                  disabled={!doc || busy}
                  onClick={() => void job("recognize", { documentId: docId })}
                >
                  识别与核对
                </button>
                <button
                  className="secondary"
                  disabled={!course || busy}
                  onClick={() => void job("review")}
                >
                  生成复习资料
                </button>
                {currentCourse && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={currentCourse.cloud}
                      onChange={(e) =>
                        void run(() =>
                          save("course", {
                            ...currentCourse,
                            cloud: e.target.checked,
                          }),
                        )
                      }
                    />
                    允许本课程必要片段发送云端
                  </label>
                )}
              </div>
              <div className="library-layout">
                <div className="card doc-list">
                  <h3>
                    我的资料 <small>{docs.length}</small>
                  </h3>
                  {docs.map((d: Item) => (
                    <button
                      key={d.id}
                      className={docId === d.id ? "doc active-doc" : "doc"}
                      onClick={() => {
                        setDocId(d.id);
                        setPageId("");
                        setCrop("");
                        setSelection("");
                      }}
                    >
                      <FileText size={19} />
                      <span>
                        {d.name}
                        <small>{Math.round(d.size / 1024)} KB · 原件保留</small>
                      </span>
                    </button>
                  ))}
                  {!docs.length && (
                    <p className="muted">导入第一份课件，开始你的学习。</p>
                  )}
                  <div className="note">
                    PPTX
                    当前提供文字提取。需要完整图片、公式和版式时，请将幻灯片导出
                    PDF 后导入。
                  </div>
                </div>
                <section className="card reader">
                  <div className="section-head">
                    <h3>{doc?.name || "资料阅读器"}</h3>{doc&&<button className="secondary" onClick={()=>setReaderDoc(doc.id)}>沉浸阅读课件</button>}
                    {pages.length > 0 && (
                      <select
                        aria-label="页面"
                        value={page?.id || ""}
                        onChange={(e) => {
                          setPageId(e.target.value);
                          setCrop("");
                          setBox(null);
                          setSelection("");
                        }}
                      >
                        {pages.map((p: Item) => (
                          <option key={p.id} value={p.id}>
                            第 {p.number} 页{p.uncertain ? " · 待核对" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {page ? (
                    <>
                      <div className="hint">
                        选中文字，或在页面图像上拖动框选公式与图表。
                      </div>
                      {page.imageHash && (
                        <div
                          className="page-image"
                          onPointerDown={(e) => {
                            if(e.button!==0 || !imgRef.current?.complete || !imgRef.current.naturalWidth)return;
                            const r = imgRef.current.getBoundingClientRect();
                            drag.current = {
                              x: e.clientX - r.left,
                              y: e.clientY - r.top,
                            };
                            e.currentTarget.setPointerCapture(e.pointerId);
                            setBox(null);setCrop("");setSelection("");
                          }}
                          onPointerMove={(e) => {
                            if (drag.current && imgRef.current) {
                              const r = imgRef.current.getBoundingClientRect(),
                                x = e.clientX - r.left,
                                y = e.clientY - r.top;
                              setBox({
                                x: Math.min(x, drag.current.x),
                                y: Math.min(y, drag.current.y),
                                w: Math.abs(x - drag.current.x),
                                h: Math.abs(y - drag.current.y),
                              });
                            }
                          }}
                          onPointerCancel={()=>{drag.current=null;setBox(null);setCrop("");setSelection("");}}
                          onLostPointerCapture={()=>{drag.current=null;}}
                          onPointerUp={cropEnd}
                        >
                          <img
                            ref={imgRef}
                            src={"/api/file/" + page.imageHash}
                            draggable={false}
                          />
                          {box && (
                            <div
                              className="selection-box"
                              style={{
                                left: box.x,
                                top: box.y,
                                width: box.w,
                                height: box.h,
                              }}
                            />
                          )}
                        </div>
                      )}
                      <SelectableContent key={page.id+":"+page.version} source={sourceFor("page",page)} label={doc.name+" · 第 "+page.number+" 页"}>
                        <div className="page-text">{page.text || "这一页还没有识别文字。点击“识别与核对”。"}</div>
                      </SelectableContent>
                      <details>
                        <summary>修正页面识别结果</summary>
                        <form
                          key={page.id + page.version}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void run(
                              () =>
                                api("page", {
                                  documentId: docId,
                                  number: page.number,
                                  text: f.get("text"),
                                  corrected: true,
                                }),
                              "页面文字已更新",
                            );
                          }}
                        >
                          <textarea
                            name="text"
                            defaultValue={page.text}
                            rows={10}
                          />
                          <button>保存修正</button>
                        </form>
                      </details>
                    </>
                  ) : (
                    <Empty
                      title="选择一份资料"
                      text="页面图像、识别文本和选区提问会在这里联动。"
                    />
                  )}
                </section>
                <section className="card assistant">
                  <h3>
                    <MessageCircle size={18} />
                    学习助手
                  </h3>
                  {selection && (
                    <div className="quote">
                      {doc?.name} · {selection.slice(0, 180)}
                      {crop && <img className="crop-preview" src={crop} alt="课件框选预览"/>}
                      <button
                        className="link"
                        onClick={() => {
                          setSelection("");
                          setCrop("");
                          setBox(null);
                        }}
                      >
                        清除选区
                      </button>
                    </div>
                  )}
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="这一步为什么可以这样变形？"
                    rows={4}
                  />
                  <button
                    disabled={!course || busy}
                    onClick={() => {
                      void job("ask", {
                        prompt,
                        selection,
                        image: crop || undefined,
                        selectionSource: selection && page ? sourceFor("page",page) : undefined,
                        selectionRegion: selection && box ? box : undefined,
                      });
                      setPrompt("");
                    }}
                  >
                    结合资料提问 <ArrowRight size={16} />
                  </button>
                  <p className="hint">
                    课件不足时可自动搜索；课件提问与学习伙伴共享个人记忆，重点记录学习薄弱点。可直接说“记住：…”“纠正记忆：旧内容 → 新内容”“忘记：…”。
                  </p>
                  <label className="check"><input type="checkbox" checked={askNoMemory} onChange={e=>setAskNoMemory(e.target.checked)}/>本次课件问答不记忆</label>
                  {filtered("chat")
                    .slice(0, chatLimit)
                    .map((c: Item) => (
                      <article className="response" key={c.id}>
                        <strong>{c.prompt}</strong>
                        <RichText source={sourceFor("chat",c)} label="智能体回答">{c.text}</RichText>
                        <button className="ghost small" onMouseDown={e=>e.preventDefault()} onClick={()=>void replyCourse(c)}>回复／回复选中内容</button><button className="ghost small" onMouseDown={e=>e.preventDefault()} onClick={()=>void forkChat(c)}>选中回答／开启分支</button><p className="hint">{c.memoryState}</p><button className="secondary small" onClick={()=>{setAskNoMemory(!!c.noMemory);continueChat(c);}}>继续追问</button>
                        {c.selection&&<p className="hint">原选区：{c.selection.label}</p>}
                        {c.sources?.map((s: Item) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.title || s.url}
                          </a>
                        ))}
                      </article>
                    ))}
                  {filtered("chat").length>chatLimit&&<button className="ghost small" onClick={()=>setChatLimit(filtered("chat").length)}>显示全部问答（{filtered("chat").length}）</button>}
                </section>
              </div>
              {filtered("review").map((r: Item) => (
                <section className="card review" key={r.id}>
                  <div className="section-head">
                    <h3>{r.title}</h3>
                    <div>
                      <button
                        className="ghost"
                        onClick={() => {
                          const value = window.prompt(
                            "编辑复习资料（可粘贴完整内容）",
                            r.text,
                          );
                          if (value !== null)
                            void run(() =>
                              api("review/edit", {
                                id: r.id,
                                version: r.version,
                                text: value,
                              }),
                            );
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="ghost"
                        onClick={() => void exportRecord(r.id)}
                      >
                        Markdown
                      </button>
                      <button
                        className="ghost"
                        onClick={() => void exportRecord(r.id, true, true)}
                      >
                        打印 / PDF
                      </button>
                    </div>
                  </div>
                  <RichText source={sourceFor("review",r)} label={r.title||"复习资料"}>{r.text}</RichText>
                </section>
              ))}
            </>
          )}
          {tab === "questions" && (
            <>
              <PageHead
                title="个人错题本"
                sub="按知识点理解错误，而不是只积攒题目。"
              />
              <div className="toolbar">
                <button
                  onClick={() => {
                    setEditing(null);
                    setQuestionModal(true);
                  }}
                >
                  <Plus size={16} />
                  手动录入错题
                </button>
                <select
                  aria-label="提取题目的资料"
                  value={docId}
                  onChange={(e) => setDocId(e.target.value)}
                >
                  <option value="">选择已导入的作业 / 试卷</option>
                  {docs.map((d: Item) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary"
                  disabled={!docId}
                  onClick={() => void job("extract", { documentId: docId })}
                >
                  提取全部题目
                </button>
                <button
                  className="secondary"
                  disabled={!docId}
                  onClick={() => {
                    const numbers = window.prompt(
                      "输入错题题号，例如：第 3、7、12 题；重复题号请加页码",
                    );
                    if (numbers)
                      void job("extract", { documentId: docId, numbers });
                  }}
                >
                  报题号收录
                </button>
              </div>
              <div className="two-col questions-layout">
                <section className="card">
                  <h3>
                    题目与错题 <small>{questions.length}</small>
                  </h3>
                  {(topicFilter||wrongOnly)&&<div className="filter-note">{topicFilter?"知识点："+topicFilter:"仅待复习错题"}<button className="link" onClick={()=>{setTopicFilter("");setWrongOnly(false);}}>显示全部题目</button></div>}
                  {questions.filter((q:Item)=>(!topicFilter||q.topics?.includes(topicFilter))&&(!wrongOnly||q.wrong)).map((q: Item) => (
                    <button
                      id={"study-item-"+q.id}
                      className={qId === q.id ? "q-row selected" : "q-row"}
                      key={q.id}
                      onClick={() => {
                        setQId(q.id);
                        setAnswer(q.studentAnswer || "");
                        setAnswerImage("");
                      }}
                    >
                      <div>
                        <span className={"pill " + (q.wrong ? "warm" : "")}>
                          {q.consolidated ? "已巩固" : q.wrong ? "错题" : "练习题"}
                        </span>
                        <span className="muted">
                          {" "}
                          {q.number ? "第 " + q.number + " 题" : ""}
                        </span>
                      </div>
                      <RichText>{q.stem}</RichText>
                      <small>
                        {q.topics.join(" / ")} · {q.learningStatus||q.status}{q.errorCount!==undefined&&" · 累计错误 "+q.errorCount+" 次"}
                      </small>
                    </button>
                  ))}
                  {!questions.length && (
                    <Empty
                      title="第一道错题，也是进步的起点"
                      text="可上传作业后提取，或直接手动记录题干与知识点。"
                    />
                  )}
                </section>
                <section className="card">
                  {question ? (
                    <>
                      <div className="section-head">
                        <h3>题目详情</h3>
                        <button
                          className="ghost"
                          onClick={() => {
                            setEditing(question);
                            setQuestionModal(true);
                          }}
                        >
                          核对 / 编辑
                        </button>
                      </div>
                      <RichText>{question.stem}</RichText>
                      <div className="tags">
                        {question.topics.map((t: string) => (
                          <span className="pill" key={t}>
                            {t} · {state.mastery[course + "|" + t] || "待评估"}
                          </span>
                        ))}
                      </div>
                      <p className="muted">
                        解题方法：{question.method || "待确认"} · 来源：
                        {question.source || "用户录入"}
                      </p>
                      {question.unclear && (
                        <p className="error">
                          题干或字迹待核对，确认前不更新掌握程度。
                        </p>
                      )}
                      <label>
                        你的作答
                        <textarea
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                          rows={5}
                        />
                      </label>
                      <UploadButton className="secondary">
                        <Upload size={15} />
                        上传手写作答
                        <input
                          hidden
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void b64(f).then(setAnswerImage);
                          }}
                        />
                      </UploadButton>
                      {answerImage && (
                        <img className="answer-preview" src={answerImage} />
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void job("grade", {
                            questionId: qId,
                            answer,
                            image: answerImage || undefined,
                          })
                        }
                      >
                        分析作答
                      </button>
                      {question.grading && (
                        <div className="grading">
                          <span className="pill warm">
                            {question.grading.confirmed
                              ? "已确认"
                              : "待用户确认"}
                          </span>
                          <RichText>{question.grading.analysis}</RichText>
                          <h4>识别作答</h4>
                          <RichText>{question.grading.transcription}</RichText>
                          <p>判断：{question.grading.outcome}</p>
                        </div>
                      )}
                      <h4>确认本次练习结果</h4>
                      {question.topics.length>1&&<p className="hint">综合题仅按有证据的步骤更新薄弱知识点；未知错因不会将所有知识点判弱。</p>}
                      <div className="toolbar">
                        {Object.entries(outcomeNames).map(([out, label]) => (
                          <button
                            className="secondary small"
                            key={out}
                            disabled={question.unclear}
                            onClick={() =>
                              void run(
                                () =>
                                  api("attempt", {
                                    id: crypto.randomUUID(),
                                    questionId: qId,
                                    outcome: out,
                                    answer,
                                    novel: question.origin === "generated",
                                  }),
                                "练习记录已保存，掌握情况已更新",
                              )
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <details>
                        <summary>答案与解析</summary>
                        <RichText source={sourceFor("question",question)} label={"第 "+(question.number||"未编号")+" 题 · 参考答案与解析"}>
                          {question.answer || "尚无标准答案"}
                          {"\n\n"}
                          {question.explanation}
                        </RichText>
                      </details>
                      <details><summary>历史作答与纠正</summary>{list('attempt').filter((a:Item)=>a.questionId===question.id).map((a:Item)=><div className="topic-row" key={a.id}><small>{new Date(a.at).toLocaleString()}</small><select aria-label="修正作答结果" value={a.outcome} onChange={e=>void run(()=>api('attempt/update',{id:a.id,version:a.version,outcome:e.target.value}),'作答结果已修正，掌握情况与计划已更新')}>{Object.entries(outcomeNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>)}</details>
                      <div className="toolbar">
                        <button
                          className="ghost"
                          onClick={() =>
                            void run(
                              () =>
                                save("task", {
                                  title: "复习 " + question.topics.join("、"),
                                  minutes: 30,
                                  priority: 2,
                                  courseId: course,
                                  status: "todo",
                                }),
                              "已加入待办，可在每日计划中排程",
                            )
                          }
                        >
                          加入复习待办
                        </button>
                        <button
                          className="ghost danger"
                          onClick={() => {
                            if (
                              confirm(
                                "删除此题及其练习记录？掌握情况将重新计算。",
                              )
                            )
                              void run(() => api("delete", { id: qId }));
                          }}
                        >
                          删除题目
                        </button>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="选择一道题目"
                      text="核对识别、分析作答，再记录真正的掌握情况。"
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "practice" && (
            <>
              <PageHead
                title="练习与复习试卷"
                sub="少量、针对性、可反馈。把看懂变成独立做对。"
              />
              <div className="mode-switch" role="tablist" aria-label="练习与试卷模式">{[['quick','快捷练习'],['special','专项练习'],['paper','复习试卷']].map(([key,label])=><button role="tab" aria-selected={practiceView===key} key={key} className={practiceView===key?'selected':'ghost'} onClick={()=>{setPracticeView(key);setExamId('');}}>{label}</button>)}</div>
              {practiceView==='quick'?<QuickPractice {...workProps}/>:<div className={'legacy-practice mode-'+practiceView}>
              <SmartPractice {...workProps} supplied={{...advanced,...(selectedTopics.length?{topics:selectedTopics}:{}),...(practiceRequest.trim()?{practiceRequest}:{}),...(explanationReviewed?{explanationReviewed:true}:{})}} target={practiceView==='paper'?'exam':'practice'} onReady={id=>setExamId(id)}/>
              <div className="two-col">
                <details className="legacy-settings"><summary>详细设置与手动出题</summary><section className="card" id="topic-picker" tabIndex={-1}>
                  <h3>定制下一轮练习</h3>
                  <p className="muted">
                    选择知识点。默认 3 道，可调整题量与时长。
                  </p>
                  <div className="topic-options">
                    {topics.map((t) => (
                      <label key={t} className="topic-choice">
                        <input
                          type="checkbox"
                          checked={selectedTopics.includes(t)}
                          onChange={(e) =>
                            setSelectedTopics(
                              e.target.checked
                                ? [...selectedTopics, t]
                                : selectedTopics.filter((x) => x !== t),
                            )
                          }
                        />
                        <span>{t}</span>
                        <small>
                          {state.mastery[course + "|" + t] || "待评估"}
                        </small>
                      </label>
                    ))}
                  </div>
                  <div className="toolbar">
                    <button
                      className="ghost"
                      onClick={() => setSelectedTopics(topics)}
                    >
                      全面复习：全部知识点
                    </button>
                    <button
                      className="ghost"
                      onClick={() =>
                        setSelectedTopics(
                          topics.filter(
                            (t) => state.mastery[course + "|" + t] !== "较熟练",
                          ),
                        )
                      }
                    >
                      薄弱强化
                    </button>
                  </div>
                  <label>想练什么？<textarea aria-label="想练习的题目类型" rows={2} maxLength={1500} value={practiceRequest} onChange={e=>setPracticeRequest(e.target.value)} placeholder="例如：含参数的导数极值题；三角代换积分题；导数与积分综合题"/></label><p className="hint">可以直接输入题型，不必先选知识点。可写明难度、条件和想加强的方法；先解析并预览知识点与难度，再确认生成；修改要求后需要重新解析。</p>
                  {practiceRequest.trim()&&<button className="secondary" disabled={busy||previewPending} onClick={()=>void run(async()=>{const key=practiceKey;const j=await api('job',{action:'practice-preview',courseId:course,topics:selectedTopics,practiceRequest,minutes,count,adaptive});setPracticePreview({id:j.id,key});setNotice('正在解析题型，完成后请核对预览');})}>{previewPending?'正在解析题型…':'解析题型与预览'}</button>}
                  {previewJob?.status==='failed'&&<p role="alert">{previewJob.error}</p>}
                  {preview&&<section className="practice-advice" aria-label="题型解析预览"><h4>题型解析预览</h4><p>{preview.intent?.type}</p><p>知识点：{preview.topics.join(' · ')} · 难度：{preview.intent?.difficulty==='自动'?'按掌握情况调整':preview.intent?.difficulty}</p><small>当前输入仅用于本轮出题；生成题目不会更改掌握度，确认作答后才更新学习记录。</small></section>}
                  <MasteryControls course={course} topics={topics} state={state} run={run}/>
                  <label className="check"><input type="checkbox" checked={adaptive} onChange={e=>setAdaptive(e.target.checked)}/>按知识点掌握度自动分配题量（取消后可手动指定总题数）</label>
                  {advice&&<div className="practice-advice"><h4>自动题量建议：{advice.count} 题 · 约 {advice.minutes} 分钟</h4>{advice.rows.map((r:Item)=><p key={r.topic}><strong>{r.topic}</strong> · {r.effective} · {r.count}/{r.target} 题 · {r.difficulty}{r.diagnostic?' · 单知识点诊断':''}<small>{r.variants.join(' / ')}</small></p>)}{advice.deferred>0&&<p>时间内未安排的 {advice.deferred} 题顺延；可调整本轮可用时间。</p>}{advice.rows.some((r:Item)=>r.explainFirst)&&<><details><summary>连续错误：先回顾参考解答</summary>{questions.filter((q:Item)=>q.wrong&&q.topics.some((t:string)=>practiceTopics.includes(t))).slice(0,5).map((q:Item)=><div key={q.id}><RichText>{q.stem+'\n\n'+q.answer+'\n\n'+q.explanation}</RichText></div>)}</details><label className="check"><input type="checkbox" checked={explanationReviewed} onChange={e=>setExplanationReviewed(e.target.checked)}/>已回顾讲解，开始分批变式练习</label></>}</div>}
                  <div className="form-grid">
                    <label>
                      题目来源
                      <select
                        value={source}
                        onChange={(e) => {setSource(e.target.value);setAdvanced(v=>({...v,source:e.target.value}));}}
                      >
                        <option value="mixed">生成 + 联网找题</option>
                        <option value="generate">只生成变式题</option>
                        <option value="web">只找现成题</option>
                      </select>
                    </label>
                    <label>
                      作答模式
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="practice">练习：可查看提示</option>
                        <option value="exam">模拟考试：交卷后解析</option>
                      </select>
                    </label>
                    <label>
                      题量
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={count}
                        onChange={(e) => {setAdaptive(false);setCount(Number(e.target.value));setAdvanced(v=>({...v,count:e.target.value?Number(e.target.value):undefined,adaptive:e.target.value?false:undefined}));}}
                      />
                    </label>
                    <label>
                      预计时长（分钟）
                      <input
                        type="number"
                        min="5"
                        max="180"
                        value={minutes}
                        onChange={(e) => {setMinutes(Number(e.target.value));setAdvanced(v=>({...v,minutes:e.target.value?Number(e.target.value):undefined}));}}
                      />
                    </label>
                  </div>
                  <div className="toolbar">
                    <button style={{display:practiceView==='special'?'':'none'}}
                      disabled={!practiceTopics.length || needsPreview || busy || previewPending || !!(advice?.rows.some((r:Item)=>r.explainFirst)&&!explanationReviewed)}
                      onClick={() =>
                        void job("practice", {
                          topics: selectedTopics,
                          count,
                          minutes,
                          mode,
                          source, adaptive, explanationReviewed, practiceRequest, previewId:preview?practicePreview?.id:undefined,
                        })
                      }
                    >
                      <Play size={16} />
                      生成针对练习
                    </button>
                    <button
                      className="ghost"
                      disabled={!practiceTopics.length || needsPreview}
                      onClick={() =>
                        void run(async () => {
                          const r = await api("next-batch", {
                            courseId: course,
                            topics: practiceTopics,
                            remainingMinutes: minutes,
                          });
                          if(preview?.intent?.difficulty&&preview.intent.difficulty!=='自动')for(const row of r.rows)if(!row.diagnostic)row.difficulty=preview.intent.difficulty;setAdvice(r);setCount(r.count || 1);setAdaptive(true);
                          setNotice(r.action + "（建议 " + r.count + " 题）");
                        })
                      }
                    >
                      按掌握情况调整题量
                    </button>
                    <button style={{display:practiceView==='paper'?'':'none'}}
                      className="secondary"
                      disabled={!practiceTopics.length || needsPreview || busy || previewPending || !!(advice?.rows.some((r:Item)=>r.explainFirst)&&!explanationReviewed)}
                      onClick={() =>
                        void job("exam", {
                          topics: selectedTopics,
                          count,
                          minutes,
                          mode,
                          source, adaptive, explanationReviewed, practiceRequest, previewId:preview?practicePreview?.id:undefined,
                          title: "个人复习试卷",
                        })
                      }
                    >
                      生成覆盖试卷
                    </button>
                  </div>
                  <p className="hint">
                    覆盖知识点多于题量时会要求调整；未通过答案核验的题不发布。
                  </p>
                </section></details>
                <section className="card">
                  <h3>{practiceView==='paper'?'我的试卷':'我的专项练习'}</h3>
                  {exams.filter((e:Item)=>practiceView==='paper'?(e.generation?.action==='exam'||e.title.includes('试卷')):!(e.generation?.action==='exam'||e.title.includes('试卷'))).map((e: Item) => (
                    <button
                      className="q-row"
                      key={e.id}
                      onClick={() => {
                        setExamId(e.id);void run(()=>api("paper/open",{examId:e.id}));
                        setExamStarted((s) => ({
                          ...s,
                          [e.id]: s[e.id] || Date.now(),
                        }));
                      }}
                    >
                      <strong>{e.title}</strong>
                      <small>
                        {e.questionIds.length} 题 · {e.minutes} 分钟 ·{" "}
                        {e.mode === "exam" ? "模拟考试" : "练习模式"}
                        {e.submitted ? " · 已交卷" : ""}
                      </small>
                      <span>{e.topics.join(" / ")}</span>
                    </button>
                  ))}
                  {!exams.length && (
                    <Empty
                      title="你的下一份练习，因你而不同"
                      text="生成后保留题目、来源、知识点覆盖及独立解析。"
                    />
                  )}
                </section>
              </div>
              {exam && (
                <section className="card exam">
                  <div className="section-head">
                    <div>
                      <h2>{exam.title}</h2>
                      <p className="muted">
                        {exam.topics.join(" · ")} · 预计 {exam.minutes} 分钟{exam.practiceRequest&&" · 练习要求："+exam.practiceRequest}
                      </p>
                      {examStarted[exam.id] && (
                        <small>
                          {Date.now() - examStarted[exam.id] >
                          exam.minutes * 60000
                            ? "已超过预计时长，可继续作答，不强制交卷。"
                            : "开始于 " +
                              new Date(
                                examStarted[exam.id],
                              ).toLocaleTimeString()}
                        </small>
                      )}
                    </div>
                    <div className="toolbar">
                      <button
                        className="ghost"
                        onClick={() => void exportRecord(exam.id, false, true)}
                      >
                        导出作答卷
                      </button>
                      <button
                        className="ghost"
                        disabled={exam.mode === "exam" && !exam.submitted}
                        onClick={() => void exportRecord(exam.id, true, true)}
                      >
                        答案 / PDF
                      </button>
                      {!exam.submitted && (
                        <button
                          onClick={() =>
                            void run(
                              () => api("exam/submit", { id: exam.id }),
                              "已交卷，可查看答案与解析",
                            )
                          }
                        >
                          交卷
                        </button>
                      )}
                    </div>
                  </div>
                  <SelfCheck {...workProps} exam={exam}/><PaperWorkbench key={exam.id} exam={exam} records={records} run={run} job={job} busy={busy}/>
                  <div className="toolbar"><button className="secondary" disabled={busy||!!exam.startedAt||exam.submitted} onClick={()=>void job('exam',{topics:exam.topics,count:exam.questionIds.length,minutes:exam.minutes,mode:exam.mode,source:exam.generation?.source||'mixed',adaptive:true,explanationReviewed,practiceRequest:exam.practiceRequest||'',replaceExamId:exam.id,title:exam.title+' · 新版本'})}>按最新掌握度重新生成（保留旧卷）</button><button className="ghost" disabled={!!exam.startedAt||exam.submitted} onClick={()=>void run(()=>api('paper/open',{examId:exam.id,start:true}),'已开始作答，原卷保持不变')}>开始作答</button></div>
                  {exam.questionIds.map((id: string, i: number) => {
                    const q = exam.snapshot?.find((q:Item)=>q.id===id)||questions.find((q: Item) => q.id === id);
                    if (!q) return <p key={id}>题目已删除</p>;
                    const allowed = exam.mode === "practice" || exam.submitted;
                    return (
                      <article className="exam-question" key={id}>
                        <h3>第 {i + 1} 题</h3>
                        <RichText>{q.stem}</RichText>
                        <span className="pill">{q.topics.join(" / ")} · {q.variant||"原题"} · {q.difficulty}</span>
                        <textarea
                          placeholder="输入作答；手写作答可在题目详情上传。"
                          value={examAnswers[id] || ""}
                          onChange={(e) => {
                            if(!exam.startedAt)void run(()=>api("paper/open",{examId:exam.id,start:true}));
                            setExamAnswers((a) => ({
                              ...a,
                              [id]: e.target.value,
                            }));}
                          }
                        />
                        <div className="toolbar">
                          <button
                            className="ghost"
                            disabled={!allowed}
                            onClick={() => {
                              setShownAnswers((a) => [...a, id]);
                            }}
                          >
                            查看答案 / 提示
                          </button>
                          <button
                            className="ghost"
                            disabled={!allowed}
                            onClick={() => {
                              setTab("questions");
                              setQId(id);
                              setAnswer(examAnswers[id] || "");
                            }}
                          >
                            批改 / 上传手写作答
                          </button>
                        </div>
                        {allowed && shownAnswers.includes(id) && (
                          <RichText source={sourceFor("question",q,exam.id)} label={"第 "+(i+1)+" 题 · 参考答案与解析"}>
                            {"### 答案\n\n"}
                            {q.answer}
                            {"\n\n"}
                            {"### 解题步骤\n\n"}
                            {q.explanation}
                          </RichText>
                        )}
                        {allowed && (
                          <div className="toolbar">
                            {Object.entries(outcomeNames).map(
                              ([out, label]) => (
                                <button
                                  className="secondary small"
                                  key={out}
                                  onClick={() =>
                                    void run(
                                      () =>
                                        api("attempt", {
                                          id: crypto.randomUUID(),
                                          questionId: id,
                                          outcome:
                                            out === "independent" &&
                                            shownAnswers.includes(id)
                                              ? "prompted"
                                              : out,
                                          answer: examAnswers[id] || "",
                                          novel: true,
                                        }),
                                      "本次结果已记录",
                                    )
                                  }
                                >
                                  {label}
                                </button>
                              ),
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>
              )}
              </div>}
            </>
          )}
          {tab === "plan" && (
            <>
              <PageHead
                title="每日计划"
                sub="保护固定安排，让复习适应你的时间，而不是反过来。"
              />
              <div className="toolbar">
                <input
                  aria-label="计划日期"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <button
                  onClick={() =>
                    void run(async () => {
                      const r = await api("plan", { date });
                      setNotice(
                        r.unscheduled.length
                          ? "未排入：" + r.unscheduled.join("、")
                          : "计划已生成，固定安排保持不变",
                      );
                    })
                  }
                >
                  <CalendarDays size={16} />
                  生成 / 重排当天
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    const c = list("change").find(
                      (c: Item) => c.date === date && !c.undone,
                    );
                    if (c)
                      void run(
                        () => api("undo", { id: c.id }),
                        "已撤销最近调整",
                      );
                    else setNotice("没有可撤销的变更");
                  }}
                >
                  撤销最近调整
                </button>
              </div>
              <div className="two-col">
                <section className="card">
                  <h3>可用时间与待办</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(
                        () =>
                          api("settings", {
                            preferences: {
                              start: f.get("start"),
                              minutes: Number(f.get("minutes")),
                            },
                          }),
                        "可用时间已保存",
                      );
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        每日开始时间
                        <input
                          name="start"
                          type="time"
                          defaultValue={state.preferences.start}
                        />
                      </label>
                      <label>
                        每日学习上限（分钟）
                        <input
                          name="minutes"
                          type="number"
                          min="1"
                          max="720"
                          defaultValue={state.preferences.minutes}
                        />
                      </label>
                    </div>
                    <button className="secondary">保存可用时间</button>
                  </form>
                  <hr />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(
                        () =>
                          save("task", {
                            title: f.get("title"),
                            minutes: Number(f.get("minutes")),
                            deadline: f.get("deadline") || "",
                            priority: Number(f.get("priority")),
                            courseId: course,
                            status: "todo",
                          }),
                        "待办已加入",
                      );
                      e.currentTarget.reset();
                    }}
                  >
                    <label>
                      待办事项
                      <input
                        name="title"
                        required
                        placeholder="例如：复习分部积分并完成三道变式题"
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        时长
                        <input
                          name="minutes"
                          type="number"
                          min="1"
                          max="720"
                          defaultValue="30"
                        />
                      </label>
                      <label>
                        截止日期
                        <input name="deadline" type="date" />
                      </label>
                      <label>
                        优先级
                        <select name="priority">
                          <option value="1">普通</option>
                          <option value="2">重要</option>
                          <option value="3">紧急</option>
                        </select>
                      </label>
                    </div>
                    <button>
                      <Plus size={15} />
                      添加待办
                    </button>
                  </form>
                  {list("task").map((t: Item) => (
                    <div className={"topic-row"+(highlightId==="study-item-"+t.id?" focused-item":"")} id={"study-item-"+t.id} tabIndex={-1} key={t.id}>
                      <div>
                        {t.title}
                        <small>
                          {t.minutes} 分钟 · {t.deadline || "无截止日期"} ·{" "}
                          {t.status || "todo"}
                        </small>
                      </div>
                      {!["done","skip"].includes(t.status)&&<button className="secondary small" onClick={()=>void run(()=>save("task",{...t,status:"done"}),"待办已完成")}>完成待办</button>}
                      <button
                        className="icon"
                        onClick={() =>
                          void run(() => api("delete", { id: t.id }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </section>
                <section className="card">
                  <h3>{date} · 当日安排</h3>
                  {list("timetable")
                    .filter((t: Item) => t.date === date)
                    .map((t: Item) => (
                      <div className="timeline fixed" key={t.id}>
                        <Lock size={16} />
                        <time>{t.start}</time>
                        <div>
                          <strong>{t.title}</strong>
                          <small>
                            固定安排 · {t.end} · {t.location}
                          </small>
                        </div>
                      </div>
                    ))}
                  {list("plan")
                    .filter((p: Item) => p.date === date)
                    .sort((a: Item, b: Item) => a.start.localeCompare(b.start))
                    .map((p: Item) => (
                      <div className={"plan-row"+(highlightId==="study-item-"+p.id?" focused-item":"")} id={"study-item-"+p.id} tabIndex={-1} key={p.id}>
                        <div className="timeline">
                          <time>{p.start}</time>
                          <div>
                            <strong>{p.title}</strong>
                            <small>
                              至 {p.end} · {p.minutes} 分钟
                            </small>
                          </div>
                          <button
                            className="icon"
                            onClick={() =>
                              void run(() =>
                                api("plan/update", {
                                  id: p.id,
                                  version: p.version,
                                  locked: !p.locked,
                                }),
                              )
                            }
                          >
                            {p.locked ? (
                              <Lock size={16} />
                            ) : (
                              <Unlock size={16} />
                            )}
                          </button>
                        </div>
                        <div className="toolbar">
                          {[
                            ["done", "完成"],
                            ["partial", "部分完成"],
                            ["skip", "跳过"],
                          ].map(([v, l]) => (
                            <button
                              key={v}
                              className={
                                p.status === v ? "small" : "secondary small"
                              }
                              onClick={() =>
                                void run(() =>
                                  api("plan/update", {
                                    id: p.id,
                                    version: p.version,
                                    status: v,
                                  }),
                                )
                              }
                            >
                              {l}
                            </button>
                          ))}
                          <button
                            className="ghost small"
                            onClick={() => {
                              const start = window.prompt(
                                  "新的开始时间 HH:mm",
                                  p.start,
                                ),
                                end = window.prompt(
                                  "新的结束时间 HH:mm",
                                  p.end,
                                );
                              if (start && end)
                                void run(() =>
                                  api("plan/update", {
                                    id: p.id,
                                    version: p.version,
                                    start,
                                    end,
                                  }),
                                );
                            }}
                          >
                            明确修改时间
                          </button>
                        </div>
                      </div>
                    ))}
                  {!list("plan").some((p: Item) => p.date === date) && (
                    <Empty
                      title="给今天留一点明确的方向"
                      text="添加待办后生成计划；排不下的任务会明确列出。"
                    />
                  )}
                </section>
              </div>
              <section className="card review">
                <h3>课表与固定安排</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(
                      () =>
                        save("timetable", {
                          title: f.get("title"),
                          date: f.get("date"),
                          start: f.get("start"),
                          end: f.get("end"),
                          location: f.get("location"),
                          courseId: course,
                        }),
                      "固定安排已保存",
                    );
                  }}
                >
                  <div className="form-grid five">
                    <label>
                      课程 / 安排
                      <input name="title" required />
                    </label>
                    <label>
                      日期
                      <input
                        name="date"
                        type="date"
                        defaultValue={date}
                        required
                      />
                    </label>
                    <label>
                      开始
                      <input name="start" type="time" required />
                    </label>
                    <label>
                      结束
                      <input name="end" type="time" required />
                    </label>
                    <label>
                      地点
                      <input name="location" />
                    </label>
                  </div>
                  <button className="secondary">添加固定安排</button>
                </form>
                <hr />
                <TimetableImport
                  course={course}
                  job={job}
                  run={run}
                  jobs={list("job")}
                  batches={list("timetableImport")}
                />
              </section>
            </>
          )}
          {tab === "partner" && (
            <details className="card merged-memory" aria-label="课程记忆与学习证据"><summary>课程记忆与学习证据（已有记录）</summary>
              <p className="hint">这里保留原有课程记忆，与上方学习伙伴及课件提问共同使用。当前课程由顶部选择器决定。</p>
              <div className="toolbar">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={state.preferences.autoMemory !== false}
                    onChange={(e) =>
                      void run(() =>
                        api("settings", {
                          preferences: { autoMemory: e.target.checked },
                        }),
                      )
                    }
                  />
                  从已确认的练习反馈沉淀记忆
                </label>
              </div>
              <div className="two-col">
                <section className="card">
                  <h3>告诉助手一件重要的事</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(
                        () =>
                          save("memory", {
                            courseId: course,
                            text: f.get("text"),
                            type: "explicit",
                            verified: true,
                          }),
                        "记忆已保存",
                      );
                      e.currentTarget.reset();
                    }}
                  >
                    <textarea
                      name="text"
                      required
                      rows={5}
                      placeholder="例如：我周三晚上只有半小时；希望先看直观例子再推公式。"
                    />
                    <button>
                      <Plus size={16} />
                      添加明确记忆
                    </button>
                  </form>
                  <div className="note">
                    模型推测与明确事实分开保存。删除后不再进入问答上下文；已生成的历史回答保留原文。
                  </div>
                </section>
                <section className="card">
                  <h3>可查看、可纠正的记忆</h3>
                  {filtered("memory").map((m: Item) => (
                    <article className="memory" key={m.id}>
                      <span className={"pill " + (m.verified ? "" : "warm")}>
                        {m.verified ? "用户确认" : "推测 · 待验证"}
                      </span>
                      <p>{m.text}</p>
                      <small>
                        依据：{m.evidence?.join("、") || "用户明确告知"}
                      </small>
                      <div className="toolbar">
                        <button
                          className="ghost"
                          onClick={() => {
                            const value = window.prompt("修正这条记忆", m.text);
                            if (value)
                              void run(() =>
                                save("memory", {
                                  ...m,
                                  text: value,
                                  type: "explicit",
                                  verified: true,
                                }),
                              );
                          }}
                        >
                          纠正 / 确认
                        </button>
                        <button
                          className="ghost danger"
                          onClick={() =>
                            void run(() => api("delete", { id: m.id }))
                          }
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                  {!filtered("memory").length && (
                    <Empty
                      title="记忆由你掌控"
                      text="不会把所有聊天永久当作事实，也不会把推测当成定论。"
                    />
                  )}
                </section>
              </div>
            </details>
          )}
          {tab!=='partner'&&<MemoryActions state={state} call={api} run={run}/>}
          {tab === "settings" && (
            <>
              <PageHead
                title="设置与连接"
                sub="明确数据去向，连接属于自己的学习工具。"
              />
              <MemorySettings state={state} call={api} run={run} busy={busy}/><SkillsPanel {...workProps}/><section className="card reminder-settings"><h3>学习提醒</h3>
                <label className="check"><input type="checkbox" aria-label="启用系统学习提醒" disabled={busy} checked={state.preferences.notify!==false} onChange={e=>void run(()=>api("settings",{preferences:{notify:e.target.checked}}))}/>有到期内容时发送系统通知（默认含声音）</label>
                <p className="hint">计划按开始时间提醒；未排入计划的待办和错题在每日学习开始时间 {state.preferences.start||"18:00"} 提醒。逾期项目会补提醒，同一项目同一天只提醒一次。</p>
                <p className="hint">软件运行或驻留托盘时有效；完全退出或关机后停止。通知声音和横幅仍受 Windows 的通知及勿扰设置控制。概览中的待处理列表始终保留。</p>
                {state.reminderDelivery&&<p className="hint">最近系统提醒：{({shown:"系统已接收",failed:"发送未成功，请查看概览",unsupported:"此环境未提供系统通知，请查看概览",unconfirmed:"系统未确认显示，请查看概览"} as Item)[state.reminderDelivery.status]||state.reminderDelivery.status}</p>}
              </section>
              {!state.admin ? (
                <div className="card">模型、设备配对和备份请在电脑端设置。</div>
              ) : (
                <>
                  <div className="two-col">
                    <section className="card">
                      <h3>模型服务</h3>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void run(
                            () =>
                              api("settings", {
                                model: {
                                  baseUrl: f.get("baseUrl"),
                                  model: f.get("model"),
                                  inputPrice: f.get("inputPrice"),
                                  outputPrice: f.get("outputPrice"),
                                },
                                apiKey: f.get("apiKey"),
                                searchKey: f.get("searchKey"),
                              }),
                            "配置已保存，密钥经 Windows 加密存储",
                          );
                        }}
                      >
                        <label>
                          API 地址（含 /v1）
                          <input
                            name="baseUrl"
                            type="url"
                            required
                            defaultValue={
                              state.model.baseUrl || "https://api.openai.com/v1"
                            }
                          />
                        </label>
                        <label>
                          模型 ID
                          <input
                            name="model"
                            required
                            defaultValue={state.model.model || ""}
                            placeholder="填写服务商提供的模型 ID"
                          />
                        </label>
                        <label>
                          API Key
                          <input
                            name="apiKey"
                            type="password"
                            autoComplete="new-password"
                            placeholder={
                              state.hasKey ? "已配置；留空保持原值" : "尚未配置"
                            }
                          />
                        </label>
                        <label>
                          Brave Search Key
                          <input
                            name="searchKey"
                            type="password"
                            autoComplete="new-password"
                            placeholder={
                              state.hasSearch
                                ? "已配置；留空保持原值"
                                : "用于联网找题与资料搜索"
                            }
                          />
                        </label>
                        <div className="form-grid">
                          <label>
                            输入单价 / 百万 tokens
                            <input
                              name="inputPrice"
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={state.model.inputPrice ?? ""}
                            />
                          </label>
                          <label>
                            输出单价 / 百万 tokens
                            <input
                              name="outputPrice"
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={state.model.outputPrice ?? ""}
                            />
                          </label>
                        </div>
                        <button>保存配置</button>
                      </form>
                      <div className="toolbar">
                        <button
                          className="secondary"
                          onClick={() =>
                            void job("capability", { type: "text" })
                          }
                        >
                          测试文字
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            void job("capability", { type: "tools" })
                          }
                        >
                          测试工具调用
                        </button>
                        <button
                          className="secondary"
                          onClick={() => {
                            const c = document.createElement("canvas");
                            c.width = 180;
                            c.height = 70;
                            const x = c.getContext("2d")!;
                            x.fillStyle = "white";
                            x.fillRect(0, 0, 180, 70);
                            x.fillStyle = "black";
                            x.font = "28px sans-serif";
                            x.fillText("STUDY 123", 10, 45);
                            void job("capability", {
                              type: "vision",
                              image: c.toDataURL(),
                            });
                          }}
                        >
                          测试图片
                        </button>
                      </div>
                      <p className="hint">
                        单价为空则不估算金额。用量只展示，不设消费拦截。
                      </p>
                      <div className="usage">
                        已记录 {list("usage").length} 次调用 · 输入{" "}
                        {list("usage").reduce(
                          (n: number, x: Item) => n + (x.input || 0),
                          0,
                        )}{" "}
                        tokens · 输出{" "}
                        {list("usage").reduce(
                          (n: number, x: Item) => n + (x.output || 0),
                          0,
                        )}{" "}
                        tokens
                      </div>
                    </section>
                    <section className="card">
                      <div className="section-head">
                        <h3>
                          <Smartphone size={18} />
                          手机连接
                        </h3>
                        <button
                          className="ghost"
                          onClick={() =>
                            void run(async () => {
                              await api("device-action", { action: "refresh" });
                              setDevices(await api("devices"));
                            })
                          }
                        >
                          刷新配对码
                        </button>
                      </div>
                      <p>
                        1. 电脑和手机连接同一 Wi-Fi。
                        <br />
                        2. 下载本机证书并传到手机安装、信任，核对指纹。
                        <br />
                        3. 扫码访问，再在电脑确认设备。
                      </p>
                      <a
                        className="button secondary"
                        href="/api/certificate"
                        download
                      >
                        下载本机 CA 证书
                      </a>
                      {qr && <img className="qr" src={qr} />}
                      <strong className="pair-code">{devices?.code}</strong>
                      <p className="muted">
                        {devices?.urls?.join("\n") ||
                          "尚未发现局域网 IPv4 地址"}
                      </p>
                      <details>
                        <summary>证书 SHA-256 指纹</summary>
                        <code>{devices?.fingerprint}</code>
                      </details>
                      <button
                        className="ghost"
                        onClick={() => void api("devices").then(setDevices)}
                      >
                        检查待配对设备
                      </button>
                      {devices?.pending.map((p: Item) => (
                        <div className="topic-row" key={p.id}>
                          <span>{p.name}</span>
                          <button
                            onClick={() =>
                              void run(async () => {
                                await api("device-action", {
                                  action: "approve",
                                  id: p.id,
                                });
                                setDevices(await api("devices"));
                              })
                            }
                          >
                            允许配对
                          </button>
                        </div>
                      ))}
                      {devices?.devices
                        .filter((d: Item) => !d.revoked)
                        .map((d: Item) => (
                          <div className="topic-row" key={d.id}>
                            <span>{d.name}</span>
                            <button
                              className="ghost danger"
                              onClick={() =>
                                void run(async () => {
                                  await api("device-action", {
                                    action: "revoke",
                                    id: d.id,
                                  });
                                  setDevices(await api("devices"));
                                })
                              }
                            >
                              撤销设备
                            </button>
                          </div>
                        ))}
                      <p className="hint">
                        iPhone：安装描述文件后，在“关于本机 →
                        证书信任设置”启用本机
                        CA。请只信任自己电脑导出的证书。Wi-Fi
                        隔离或防火墙可能阻止连接。
                      </p>
                    </section>
                  </div>
                  <section className="card review">
                    <h3>备份与空间</h3>
                    <p>
                      剩余 {(state.space.free / 1024 ** 3).toFixed(1)} GB /{" "}
                      {(state.space.total / 1024 ** 3).toFixed(0)}{" "}
                      GB。每日备份保留最近 7 份，ZIP 无损压缩；不含
                      Key、网站登录和配对凭据。
                    </p>
                    <div className="toolbar">
                      <button
                        onClick={() =>
                          void run(async () => {
                            await api("backup", {});
                            setBackups(await api("backups"));
                          }, "完整备份已校验并保存")
                        }
                      >
                        <Download size={16} />
                        立即备份
                      </button>
                      <UploadButton className="secondary">
                        从备份恢复
                        <input
                          hidden
                          type="file"
                          accept=".zip"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (
                              f &&
                              confirm(
                                "将恢复学习数据；当前状态会先自动备份。继续？",
                              )
                            )
                              void run(
                                async () =>
                                  api("restore", {
                                    base64: (await b64(f)).split(",")[1],
                                    confirm: "恢复备份",
                                  }),
                                "备份已恢复",
                              );
                          }}
                        />
                      </UploadButton>
                    </div>
                    {backups.map((b) => (
                      <div key={b} className="topic-row">
                        <span>{b}</span>
                        <a href={"/api/backup/" + b}>下载</a>
                      </div>
                    ))}
                  </section>
                </>
              )}
            </>
          )}
          {list("job").length > 0 && (
            <section className="card job-panel">
              <div className="section-head">
                <h3>
                  <Activity size={17} />
                  智能体任务
                </h3>
                <span className="pill">{running.length} 项运行中</span>
              </div>
              {list("job")
                .slice(0, 6)
                .map((j: Item) => (
                  <div className="job" key={j.id}>
                    <div>
                      <strong>
                        {(
                          {
                            recognize: "资料识别",
                            ask: "学习问答",
                            review: "复习资料",
                            extract: "题目提取",
                            grade: "作答分析",
                            practice: "针对练习",
                            "practice-preview": "题型解析预览",
                            partner: "学习伙伴", "memory-organize": "整理个人记忆",
                            exam: "复习试卷",
                            capability: "连接测试",
                            timetable: "课表提取",
                          } as Item
                        )[j.action] || j.action}
                      </strong>
                      <span
                        className={
                          "pill " +
                          (["failed", "paused"].includes(j.status)
                            ? "warm"
                            : "")
                        }
                      >
                        {j.status}
                      </span>
                    </div>
                    <p>{j.error || j.progress}</p>
                    {j.status === "done" && (
                      <details>
                        <summary>查看结果</summary>
                        <RichText>
                          {typeof j.result === "string"
                            ? j.result
                            : JSON.stringify(j.result, null, 2)}
                        </RichText>
                      </details>
                    )}
                    {["running", "queued"].includes(j.status) && (
                      <button
                        className="ghost"
                        onClick={() =>
                          void run(() => api("cancel", { id: j.id }))
                        }
                      >
                        取消任务
                      </button>
                    )}
                    {["failed", "paused", "cancelled"].includes(j.status) && (
                      <button
                        className="ghost"
                        onClick={() => void job(j.action, j.params)}
                      >
                        继续 / 重试
                      </button>
                    )}
                  </div>
                ))}
            </section>
          )}
          <footer>
            知序 · 本地学习工作台 <span>先理解，再练习，让进步有依据。</span>
          </footer>
        </main>
      </div>
      {askSelection && (
        <Modal title="就此选区问智能体" onClose={()=>setAskSelection(null)}>
          <p className="selection-source">{askSelection.label}</p>
          <div className="quote selection-dialog-preview"><RichText>{askSelection.excerpt}</RichText>{askSelection.imageHash&&<img className="crop-preview" src={"/api/file/"+askSelection.imageHash} alt="原课件选区"/>}</div>
          <section className="selection-reply" aria-live="polite">
            {conversationTurns.map((turn:Item)=><article className="conversation-turn" key={turn.id}><h4>你：{turn.prompt}</h4><RichText>{turn.text}</RichText></article>)}
            {["queued","running"].includes(selectedJob?.status)&&<p>智能体正在结合原选区和前文解释…</p>}
            {selectedJob?.error&&<p role="alert">{selectedJob.error}</p>}
          </section>
          <label className="check"><input type="checkbox" checked={askNoMemory} onChange={e=>setAskNoMemory(e.target.checked)}/>本次选区问答不记忆</label>
          <form onSubmit={async e=>{e.preventDefault();const chosen=askSelection;const parent=currentParent;const payload=parent?{parentChatId:parent}:{selection:chosen.excerpt,selectionSource:chosen.source,selectionRegion:chosen.region,image:chosen.image};const j=await job("ask",{prompt:selectionPrompt,...payload});if(j&&activeSelection.current===chosen){setSelectionParent(parent);setSelectionJob(j.id);setSelectionPrompt("");}}}>
            <label>{currentParent?"继续追问（保留原选区和前文）":"你想问什么？"}<textarea aria-label="选区问题" value={selectionPrompt} onChange={e=>setSelectionPrompt(e.target.value)} placeholder={currentParent?"还是没懂？可以让智能体换一种解释或举个例子。":"这一步为什么成立？"} rows={3}/></label>
            <button disabled={busy||!selectionPrompt.trim()||["queued","running"].includes(selectedJob?.status)}>{currentParent?"发送追问":"发送选区问题"}</button>
          </form>
          {conversationTurns.length>0&&<p className="hint">问答已保存在本课程的学习助手中，关闭后可点击“继续追问”恢复。长对话使用近期原文和已核验摘要；原选区保留，尚未摘要的超限内容会提示补充。</p>}

        </Modal>
      )}
      {courseModal && (
        <Modal title="创建一门课程" onClose={() => setCourseModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const c = await save("course", {
                  name: f.get("name"),
                  cloud: f.get("cloud") === "on",
                });
                setCourse(c.id);
                setCourseModal(false);
              });
            }}
          >
            <label>
              课程名称
              <input
                name="name"
                required
                autoFocus
                placeholder="例如：高等数学"
              />
            </label>
            <label className="check">
              <input name="cloud" type="checkbox" />
              允许将本课程必要的文字、题目和页面片段发送给已配置的云端模型
            </label>
            <p className="hint">
              关闭时仍可本地阅读、管理错题与手动规划；云端识别、问答和生成暂停。
            </p>
            <button>创建课程</button>
          </form>
        </Modal>
      )}
      {questionModal && (
        <Modal
          title={editing ? "核对题目" : "手动录入错题"}
          onClose={() => setQuestionModal(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const q = await api("question", {
                  ...editing,
                  courseId: course,
                  number: f.get("number"),
                  stem: f.get("stem"),
                  topics: String(f.get("topics"))
                    .split(/[，,、]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  method: f.get("method"),
                  answer: f.get("answer"),
                  studentAnswer: f.get("studentAnswer"),
                  explanation: f.get("explanation"),
                  source: editing?.source || "用户录入",
                  wrong: true,
                  unclear: f.get("unclear") === "on",
                });
                setQId(q.id);
                setQuestionModal(false);
              });
            }}
          >
            <label>
              题号
              <input name="number" defaultValue={editing?.number} />
            </label>
            <label>
              题干
              <textarea
                name="stem"
                required
                rows={4}
                defaultValue={editing?.stem}
              />
            </label>
            <label>
              知识点（逗号分隔）
              <input
                name="topics"
                required
                defaultValue={editing?.topics?.join("，")}
                placeholder="分部积分"
              />
            </label>
            <label>
              该知识点下的解题题型 / 方法
              <input name="method" defaultValue={editing?.method} />
            </label>
            <label>
              原始作答
              <textarea
                name="studentAnswer"
                defaultValue={editing?.studentAnswer}
              />
            </label>
            <label>
              标准答案（未知留空）
              <textarea name="answer" defaultValue={editing?.answer} />
            </label>
            <label>
              解析
              <textarea
                name="explanation"
                defaultValue={editing?.explanation}
              />
            </label>
            <label className="check">
              <input
                name="unclear"
                type="checkbox"
                defaultChecked={editing?.unclear}
              />
              仍有识别不清的内容
            </label>
            <button>保存核对结果</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function RichText({ children,source,label="参考答案" }: { children: React.ReactNode; source?:SelectionSource;label?:string }) {
  const raw = normalizeMathMarkdown(React.Children.toArray(children).join(""));
  const content = raw.replace(
    /\[([^\]\n]+) p\.(\d+)\]/g,
    (_, name, n) =>
      "[" +
      name +
      " p." +
      n +
      "](#source=" +
      encodeURIComponent(name) +
      "&page=" +
      n +
      ")",
  );
  const rendered = (
    <div className="rich-text math-content">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeReadableMath,rehypeKatex,rehypeMathBlocks]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                if (href?.startsWith("#source=")) {
                  e.preventDefault();
                  const p = new URLSearchParams(href.slice(1));
                  window.dispatchEvent(
                    new CustomEvent("study-citation", {
                      detail: {
                        name: p.get("source"),
                        number: Number(p.get("page")),
                      },
                    }),
                  );
                }
              }}
              target={href?.startsWith("#") ? undefined : "_blank"}
              rel="noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
  return source ? <SelectableContent source={source} label={label}>{rendered}</SelectableContent> : rendered;
}
function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={25} strokeWidth={1.5} />
      </div>
      <h4>{title}</h4>
      <p>{text}</p>
      {action && (
        <button className="ghost" onClick={onClick}>
          {action}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="section-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

