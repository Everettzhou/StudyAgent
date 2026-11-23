export function mastery(attempts: any[]): string {
  const rows = attempts
    .filter((a) => a.confirmed && ["independent", "wrong"].includes(a.outcome))
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  if (!rows.length) return "待评估";
  if (rows.at(-1).outcome === "wrong") return "薄弱";
  const lastWrong = rows.map((a) => a.outcome).lastIndexOf("wrong");
  const correct = rows
    .slice(lastWrong + 1)
    .filter((a) => a.outcome === "independent" && a.novel);
  const dates = new Set(correct.map((a) => String(a.at).slice(0, 10))),
    questions = new Set(correct.map((a) => a.questionId));
  if (
    dates.size >= 2 &&
    questions.size >= 3 &&
    Date.parse(correct.at(-1).at) - Date.parse(correct[0].at) >= 2 * 86400000
  )
    return "较熟练";
  return "巩固中";
}
export function nextBatch(
  attempts: any[],
  remainingMinutes: number,
  perQuestion = 10,
) {
  const recent = attempts.filter((a) => a.confirmed).slice(-3);
  const wrong = recent.filter((a) => a.outcome === "wrong").length;
  if (remainingMinutes < perQuestion)
    return { count: 0, action: "结束或安排下一次复习" };
  if (wrong >= 2)
    return { count: 0, action: "先回顾知识点与例题，再开始下一轮" };
  const strong =
    recent.length === 3 &&
    recent.every((a) => a.outcome === "independent" && a.novel);
  return {
    count: Math.min(strong ? 1 : 3, Math.floor(remainingMinutes / perQuestion)),
    action: strong ? "减少重复，可切换题型" : "继续巩固",
  };
}
export function schedule(
  tasks: any[],
  fixed: any[],
  date: string,
  start: number,
  budget: number,
): any[] {
  const minutes = (s: string) => {
    const [h, m] = String(s).split(":").map(Number);
    return h * 60 + m;
  };
  const clock = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const occupied = fixed
    .map((f) => [minutes(f.start), minutes(f.end)])
    .filter(([a, b]) => Number.isFinite(a) && b > a);
  const result: any[] = [];
  let used = 0;
  const sorted = [...tasks]
    .filter((t) => !t.deadline || t.deadline >= date)
    .sort(
      (a, b) =>
        (b.priority || 0) - (a.priority || 0) ||
        String(a.deadline || "9999").localeCompare(
          String(b.deadline || "9999"),
        ),
    );
  for (const t of sorted) {
    const duration = Math.ceil(Number(t.minutes));
    if (!Number.isFinite(duration) || duration < 1 || used + duration > budget)
      continue;
    let cursor = start;
    while (cursor + duration <= 24 * 60) {
      const conflict = occupied.find(
        ([a, b]) => cursor < b && cursor + duration > a,
      );
      if (conflict) {
        cursor = conflict[1];
        continue;
      }
      result.push({
        taskId: t.id,
        title: t.title,
        start: clock(cursor),
        end: clock(cursor + duration),
        minutes: duration,
      });
      occupied.push([cursor, cursor + duration]);
      used += duration;
      break;
    }
  }
  return result;
}
