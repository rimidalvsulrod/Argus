// Shared renderer for the tracking overlay (sentry screen, console live view, snapshots).
export type Person = { id: number; score: number; box: [number, number, number, number]; kp: [number, number, number][] };
export type FaceMark = { box: [number, number, number, number]; pts: [number, number][]; name: string | null };
export type Scene = { persons: Person[]; faces: FaceMark[]; zone?: [number, number, number, number] | null };

export const C = { cyan: "#22d3ee", ok: "#10b981", warn: "#f59e0b", bad: "#f43f5e" };
// MoveNet 17-keypoint skeleton
const EDGES = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
// 68-point face contours: [start, end, closed]
const FACE: [number, number, boolean][] = [[0, 16, false], [17, 21, false], [22, 26, false], [27, 30, false], [31, 35, false], [36, 41, true], [42, 47, true], [48, 59, true], [60, 67, true]];

function brackets(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  const l = Math.min(w, h) * 0.18;
  c.strokeStyle = col; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x, y + l); c.lineTo(x, y); c.lineTo(x + l, y);
  c.moveTo(x + w - l, y); c.lineTo(x + w, y); c.lineTo(x + w, y + l);
  c.moveTo(x + w, y + h - l); c.lineTo(x + w, y + h); c.lineTo(x + w - l, y + h);
  c.moveTo(x + l, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - l);
  c.stroke();
}
function tag(c: CanvasRenderingContext2D, text: string, x: number, y: number, col: string, fs: number) {
  c.font = `600 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const w = c.measureText(text).width + fs;
  const ty = y - fs * 1.7 < 0 ? y + 2 : y - fs * 1.7;
  c.fillStyle = col; c.fillRect(x, ty, w, fs * 1.5);
  c.fillStyle = "#05070a"; c.fillText(text, x + fs / 2, ty + fs * 1.1);
}

export function drawScene(c: CanvasRenderingContext2D, s: Scene, W: number, H: number) {
  const fs = Math.max(10, Math.round(W / 60));
  const lw = Math.max(1.5, W / 420);
  c.lineCap = "round"; c.lineJoin = "round";
  if (s.zone) {
    const [x, y, w, h] = s.zone;
    c.setLineDash([6, 5]); c.strokeStyle = C.warn; c.lineWidth = 1.5;
    c.strokeRect(x * W, y * H, w * W, h * H); c.setLineDash([]);
    c.fillStyle = "rgba(245,158,11,.08)"; c.fillRect(x * W, y * H, w * W, h * H);
    c.font = `600 ${fs * 0.85}px ui-monospace, SFMono-Regular, Menlo, monospace`; c.fillStyle = C.warn;
    c.fillText("MOTION", x * W + 4, y * H + h * H - 5);
  }
  for (const p of s.persons) {
    const [bx, by, bw, bh] = p.box;
    brackets(c, bx * W, by * H, bw * W, bh * H, C.cyan);
    tag(c, `SUBJECT ${String(p.id).padStart(2, "0")}  ${Math.round(p.score * 100)}%`, bx * W, by * H, C.cyan, fs);
    c.strokeStyle = "rgba(34,211,238,.9)"; c.lineWidth = lw; c.shadowColor = C.cyan; c.shadowBlur = 8;
    c.beginPath();
    for (const [a, b] of EDGES) {
      const A = p.kp[a], B = p.kp[b];
      if (!A || !B || A[2] < 0.3 || B[2] < 0.3) continue;
      c.moveTo(A[0] * W, A[1] * H); c.lineTo(B[0] * W, B[1] * H);
    }
    c.stroke(); c.shadowBlur = 0;
    for (const k of p.kp) {
      if (k[2] < 0.3) continue;
      c.beginPath(); c.arc(k[0] * W, k[1] * H, lw * 2.4, 0, Math.PI * 2);
      c.fillStyle = "#05070a"; c.fill(); c.strokeStyle = "#e0fbff"; c.lineWidth = lw; c.stroke();
    }
  }
  for (const f of s.faces) {
    const col = f.name === "?" ? C.cyan : f.name ? C.ok : C.warn;
    const [bx, by, bw, bh] = f.box;
    brackets(c, bx * W, by * H, bw * W, bh * H, col);
    tag(c, f.name === "?" ? "FACE" : f.name ? f.name.toUpperCase() : "UNIDENTIFIED", bx * W, by * H, col, fs);
    if (f.pts.length === 68) {
      c.strokeStyle = col; c.globalAlpha = 0.65; c.lineWidth = Math.max(1, lw * 0.6);
      c.beginPath();
      for (const [a, b, closed] of FACE) {
        c.moveTo(f.pts[a][0] * W, f.pts[a][1] * H);
        for (let i = a + 1; i <= b; i++) c.lineTo(f.pts[i][0] * W, f.pts[i][1] * H);
        if (closed) c.lineTo(f.pts[a][0] * W, f.pts[a][1] * H);
      }
      c.stroke(); c.globalAlpha = 1; c.fillStyle = col;
      for (const [x, y] of f.pts) c.fillRect(x * W - 1, y * H - 1, 2, 2);
    }
  }
}

// Size a canvas to its CSS box (device pixels) and draw.
export function paint(cv: HTMLCanvasElement, s: Scene | null) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext("2d")!;
  c.clearRect(0, 0, w, h);
  if (s) drawScene(c, s, w, h);
}
