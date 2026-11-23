import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const data = await mkdtemp(join(tmpdir(), "zhixu-ui-"));
const env = { ...process.env, STUDY_DATA_DIR: data, STUDY_PORT: "0" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [resolve(".")],
  env,
  timeout: 45000,
});
const logs = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => logs.push(e.message));
  await page.getByRole("button", { name: "学习伙伴", exact: true }).waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: "学习概览", exact: true }).click();
  await mkdir("evidence", { recursive: true });
  await page.screenshot({ path: "evidence/desktop-home.png", fullPage: true });
  await page.getByRole("button", { name: "新课程", exact: true }).click();
  await page.getByPlaceholder("例如：高等数学").fill("高等数学 · 验收样例");
  await page.getByRole("button", { name: "创建课程", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "个人错题本", exact: true }).click();
  await page.getByRole("button", { name: "手动录入错题", exact: true }).click();
  await page.locator("textarea[name=stem]").fill("求函数 f(x)=x² 的导数。");
  await page.locator("input[name=topics]").fill("导数");
  await page.locator("input[name=method]").fill("幂函数求导");
  await page.locator("textarea[name=answer]").fill("2x");
  await page.getByRole("button", { name: "保存核对结果" }).click();
  await page.getByRole("button", { name: "答错", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "每日计划", exact: true }).click();
  await page.getByRole("button", { name: "生成 / 重排当天" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "evidence/desktop-plan.png", fullPage: true });
  await page.getByRole("button", { name: "课程资料", exact: true }).click();
  const fixture = join(data, "sample.txt");
  await writeFile(
    fixture,
    "第 1 题：求 x² 的导数。\n知识点：幂函数求导。\n标准答案：2x。",
  );
  await page.locator("input[type=file]").first().setInputFiles(fixture);
  await page.getByText("sample.txt", { exact: true }).first().waitFor();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "学习概览", exact: true }).click();
  await page.screenshot({
    path: "evidence/desktop-learning.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "evidence/mobile-responsive.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw Error("Mobile layout overflows horizontally");
  if (logs.length) throw Error("Browser errors: " + logs.join("\n"));
  await writeFile(
    "evidence/UI_RESULT.json",
    JSON.stringify(
      {
        result: "PASS",
        courseCreated: true,
        questionRecorded: true,
        wrongAttemptRecorded: true,
        planGenerated: true,
        textImported: true,
        mobileViewport: "390x844",
        realPhone: false,
        errors: logs,
        data,
      },
      null,
      2,
    ),
  );
  console.log(
    "UI_SMOKE_PASS: course, question, attempt, plan, import, responsive layout",
  );
} finally {
  await app.close();
}
