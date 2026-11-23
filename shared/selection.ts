export type Rect = { x: number; y: number; w: number; h: number };
export type SelectionSource = {
  kind: "page" | "question" | "review" | "chat";
  id: string;
  version: number;
  courseId: string;
  examId?: string;
};
export type AskSelection = {
  source: SelectionSource;
  label: string;
  excerpt: string;
  region?: Rect;
  image?: string;
  imageHash?: string;
};
export function selectionRect(a: {x:number;y:number}, b: {x:number;y:number}): Rect {
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};
}
export function overlaps(a: Rect, b: Rect) {
  return a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}
