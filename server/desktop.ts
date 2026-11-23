import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  safeStorage,
  dialog,
  shell,
  Notification,
} from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { reminderRunner } from "./reminders";
import type { StudyTarget } from "../shared/navigation";
import { startApp } from "./app";
import {printHtml} from './print';
app.setPath(
  "userData",
  process.env.STUDY_DATA_DIR || join(app.getPath("appData"), "ZhixuStudyAgent"),
);
if(process.platform==="win32")app.setAppUserModelId("local.zhixu.studyagent");
let quitting = false,
  window: BrowserWindow,
  site: BrowserWindow | undefined,
  tray: Tray;
let runtime: Awaited<ReturnType<typeof startApp>>;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const data = process.env.STUDY_DATA_DIR || app.getPath("userData");
      mkdirSync(data, { recursive: true });
      const secretPath = join(data, "credentials.bin");
      const secrets = {
        read: () => {
          if (!existsSync(secretPath)) return {};
          if (!safeStorage.isEncryptionAvailable())
            throw Error("系统凭据加密服务不可用");
          return JSON.parse(
            safeStorage.decryptString(readFileSync(secretPath)),
          );
        },
        write: (v: any) => {
          if (!safeStorage.isEncryptionAvailable())
            throw Error("系统凭据加密服务不可用，未保存密钥");
          writeFileSync(
            secretPath,
            safeStorage.encryptString(JSON.stringify(v)),
          );
        },
      };
      async function check(url: string) {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.username || u.password)
          throw Error("官网请使用 HTTPS 地址");
        const a = await lookup(u.hostname, { all: true });
        if (a.some((x) => ipaddr.process(x.address).range() !== "unicast"))
          throw Error("官网地址必须为公网地址");
        return u.href;
      }
      runtime = await startApp({
        dir: data,
        webDir: join(__dirname, "../dist"),
        port: process.env.STUDY_PORT ? Number(process.env.STUDY_PORT) : 43127,
        secrets,
        pdf: async (content) => {
          const printWindow = new BrowserWindow({
            show: false,
            width: 900,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              partition: "print-" + Date.now(),
            },
          });
          printWindow.webContents.setWindowOpenHandler(() => ({
            action: "deny",
          }));
          try {
            await printWindow.loadURL(
              "data:text/html;charset=utf-8," +
                encodeURIComponent(
                  printHtml(content),
                ),
            );
            await printWindow.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
            const oversized = await printWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.math-block')).some(block => {
              const formula=block.querySelector('.katex-html');
              return formula && (formula.getBoundingClientRect().width > block.clientWidth - 12 || block.getBoundingClientRect().height > 930);
            })`);
            if (oversized) throw Error('公式超出 A4 可用范围，请把长推导分行或拆成多个公式后再导出');
            return await printWindow.webContents.printToPDF({
              printBackground: true,
              pageSize: "A4",
              preferCSSPageSize: true,
            });
          } finally {
            printWindow.destroy();
          }
        },
        openWebsite: async (url) => {
          const target = await check(url);
          if (site && !site.isDestroyed()) site.close();
          site = new BrowserWindow({
            width: 1150,
            height: 850,
            title: "官网登录 · 只读提取",
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              partition: "persist:school",
            },
          });
          site.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          site.webContents.on("will-navigate", (event, url) => {
            event.preventDefault();
            void check(url)
              .then((ok) => site?.loadURL(ok))
              .catch(() => {});
          });
          site.webContents.on("will-redirect", (event, url) => {
            if (!url.startsWith("https://")) event.preventDefault();
          });
          await site.loadURL(target);
        },
        readWebsite: async () => {
          if (!site || site.isDestroyed())
            throw Error("请先打开官网并登录到课表页面");
          return await site.webContents.executeJavaScript(
            "document.body.innerText.slice(0,60000)",
          );
        },
      });
      app.on(
        "certificate-error",
        (event, _web, url, _error, cert, callback) => {
          if (
            new URL(url).origin === runtime.url &&
            cert.data.replace(/\s/g, "") === runtime.tls.cert.replace(/\s/g, "")
          ) {
            event.preventDefault();
            callback(true);
          } else callback(false);
        },
      );
      window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 900,
        minHeight: 650,
        title: "知序 · 本地学习工作台",
        icon:join(__dirname,'../dist/icon.png'),
        backgroundColor: "#f5f7f9",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(runtime.url)) {
          const child = new BrowserWindow({
            width: 1000,
            height: 800,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          });
          void child.loadURL(url);
          child.webContents.once("did-finish-load", () => {
            child.webContents.print({ silent: false, printBackground: true });
          });
        } else if (url.startsWith("https://")) void shell.openExternal(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (e, url) => {
        if (new URL(url).origin !== runtime.url) e.preventDefault();
      });
      const icon = nativeImage.createFromPath(join(__dirname,'../dist/icon.png')).resize({width:32,height:32});
      tray = new Tray(icon);
      tray.setToolTip("知序学习助手 · 正在运行");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开学习工作台", click: () => window.show() },
          {
            label: "打开数据目录",
            click: () => {
              void shell.openPath(data);
            },
          },
          {
            label: "退出（停止访问和提醒）",
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on("double-click", () => window.show());
      window.on("close", (e) => {
        if (!quitting) {
          e.preventDefault();
          window.hide();
          if (!runtime.db.setting("trayExplained")) {
            runtime.db.set("trayExplained", true);
            void dialog.showMessageBox({
              type: "info",
              message:
                "知序已进入托盘，手机访问和提醒继续运行。右键托盘图标可完全退出。",
            });
          }
        }
      });
      await window.loadURL(runtime.url + "/#boot=" + runtime.boot);
      const openTarget=(target:StudyTarget)=>{
        if(window.isDestroyed())return;
        if(window.isMinimized())window.restore();window.show();window.focus();
        void window.webContents.executeJavaScript('window.dispatchEvent(new CustomEvent("study-navigate",{detail:'+JSON.stringify(target)+'}))').catch(()=>{});
      };
      const reminderNotifications=new Set<Notification>();
      const remind=reminderRunner(runtime.db,items=>new Promise<boolean>(resolve=>{
        const status=(status:string)=>runtime.db.set("reminderDelivery",{status,at:new Date().toISOString()});
        if(!Notification.isSupported()){status("unsupported");resolve(false);return;}
        const notification=new Notification({title:"知序 · 待复习与到期提醒",body:items.length===1?items[0].title:items.length+" 项待处理："+items.slice(0,3).map(i=>i.title).join("；"),silent:false});
        reminderNotifications.add(notification);notification.once("close",()=>reminderNotifications.delete(notification));
        const timer=setTimeout(()=>{status("unconfirmed");resolve(false);},5000);
        notification.once("show",()=>{clearTimeout(timer);status("shown");resolve(true);});
        notification.once("failed",()=>{reminderNotifications.delete(notification);clearTimeout(timer);status("failed");resolve(false);});
        notification.on("click",()=>openTarget(items.length===1?items[0].target:{tab:"home",focus:"due-reminders"}));
        notification.show();
      }));
      const checkReminders=()=>void remind().catch(()=>runtime.db.set("reminderDelivery",{status:"failed",at:new Date().toISOString()}));
      setTimeout(checkReminders,1500).unref();
      setInterval(checkReminders,60000).unref();
    })
    .catch((e) => {
      dialog.showErrorBox("知序启动失败", e.message);
      app.quit();
    });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => {
    void runtime?.close();
  });
}
