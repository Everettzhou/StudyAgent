import { startApp } from "./app";
import { resolve } from "node:path";
const root = resolve(__dirname, "..");
startApp({
  dir: process.env.STUDY_DATA_DIR || resolve(root, "data"),
  webDir: resolve(root, "dist"),
  port: Number(process.env.STUDY_PORT) || 43127,
  secrets: {
    read: () => ({
      apiKey: process.env.STUDY_API_KEY,
      searchKey: process.env.STUDY_SEARCH_KEY,
    }),
    write: () => {
      throw Error(
        "命令行模式请通过 STUDY_API_KEY / STUDY_SEARCH_KEY 环境变量配置密钥；桌面版可加密保存。",
      );
    },
  },
}).then((r) => {
  console.log(
    `Local launch: ${r.url}/#boot=${r.boot}\nCertificate: ${resolve(process.env.STUDY_DATA_DIR || "data", "certs/ca.crt")}`,
  );
  process.on("SIGINT", () => void r.close().then(() => process.exit()));
});
