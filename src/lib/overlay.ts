// Shared renderer for the tracking overlay (sentry screen, console live view, snapshots).
export type Person = { id: number; score: number; box: [number, number, number, number]; kp: [number, number, number][] };
export type FaceMark = { box: [number, number, number, number]; pts: [number, number][]; name: string | null };
export type Scene = { persons: Person[]; faces: FaceMark[]; zone?: [number, number, number, number] | null };

export const C = { cyan: "#22d3ee", ok: "#34d399", warn: "#fbbf24", bad: "#fb7185" };
// MoveNet 17-keypoint skeleton
const EDGES = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
// 68-point face contours: [start, end, closed]
const FACE: [number, number, boolean][] = [[0, 16, false], [17, 21, false], [22, 26, false], [27, 30, false], [31, 35, false], [36, 41, true], [42, 47, true], [48, 59, true], [60, 67, true]];

function brackets(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, lw: number) {
  const l = Math.max(8, Math.min(w, h) * 0.16);
  c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha = 0.9;
  c.beginPath();
  c.moveTo(x, y + l); c.lineTo(x, y); c.lineTo(x + l, y);
  c.moveTo(x + w - l, y); c.lineTo(x + w, y); c.lineTo(x + w, y + l);
  c.moveTo(x + w, y + h - l); c.lineTo(x + w, y + h); c.lineTo(x + w - l, y + h);
  c.moveTo(x + l, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - l);
  c.stroke(); c.globalAlpha = 1;
}
function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// Glass label chip: dark translucent pill, coloured dot, white text
function tag(c: CanvasRenderingContext2D, text: string, sub: string, x: number, y: number, col: string, fs: number, W: number) {
  c.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  const tw = c.measureText(text).width;
  c.font = `500 ${fs * 0.9}px ui-monospace, Menlo, monospace`;
  const sw = sub ? c.measureText(sub).width + fs * 0.6 : 0;
  const h = fs * 1.9, w = tw + sw + fs * 2.2;
  const tx = Math.min(Math.max(0, x), W - w), ty = y - h - 4 < 0 ? y + 4 : y - h - 4;
  rrect(c, tx, ty, w, h, h / 2);
  c.fillStyle = "rgba(8,10,16,.72)"; c.fill();
  c.strokeStyle = col; c.globalAlpha = 0.5; c.lineWidth = 1; c.stroke(); c.globalAlpha = 1;
  c.beginPath(); c.arc(tx + fs * 0.85, ty + h / 2, fs * 0.28, 0, Math.PI * 2); c.fillStyle = col; c.fill();
  c.fillStyle = "#f8fafc"; c.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  c.fillText(text, tx + fs * 1.45, ty + h / 2 + fs * 0.36);
  if (sub) { c.fillStyle = col; c.font = `500 ${fs * 0.9}px ui-monospace, Menlo, monospace`; c.fillText(sub, tx + fs * 1.45 + tw + fs * 0.6, ty + h / 2 + fs * 0.34); }
}

export function drawScene(c: CanvasRenderingContext2D, s: Scene, W: number, H: number) {
  const fs = Math.max(11, Math.round(W / 70));
  const lw = Math.max(1.5, W / 520);
  c.lineCap = "round"; c.lineJoin = "round";
  if (s.zone) {
    const [x, y, w, h] = s.zone;
    c.setLineDash([4, 6]); c.strokeStyle = C.warn; c.globalAlpha = 0.7; c.lineWidth = 1.2;
    rrect(c, x * W, y * H, w * W, h * H, 6); c.stroke(); c.setLineDash([]);
    c.fillStyle = "rgba(251,191,36,.06)"; c.fill(); c.globalAlpha = 1;
  }
  for (const p of s.persons) {
    const [bx, by, bw, bh] = p.box;
    brackets(c, bx * W, by * H, bw * W, bh * H, C.cyan, lw);
    tag(c, `Subject ${p.id}`, `${Math.round(p.score * 100)}%`, bx * W, by * H, C.cyan, fs, W);
    // limbs: soft glow pass, then crisp core
    const limbs = () => {
      c.beginPath();
      for (const [a, b] of EDGES) {
        const A = p.kp[a], B = p.kp[b];
        if (!A || !B || A[2] < 0.3 || B[2] < 0.3) continue;
        c.moveTo(A[0] * W, A[1] * H); c.lineTo(B[0] * W, B[1] * H);
      }
    };
    c.strokeStyle = "rgba(34,211,238,.25)"; c.lineWidth = lw * 5; limbs(); c.stroke();
    c.strokeStyle = "rgba(165,243,252,.95)"; c.lineWidth = lw * 1.3; limbs(); c.stroke();
    for (const k of p.kp) {
      if (k[2] < 0.3) continue;
      const x = k[0] * W, y = k[1] * H;
      c.beginPath(); c.arc(x, y, lw * 4.5, 0, Math.PI * 2); c.fillStyle = "rgba(34,211,238,.18)"; c.fill();
      c.beginPath(); c.arc(x, y, lw * 2.2, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill();
      c.strokeStyle = C.cyan; c.lineWidth = lw; c.stroke();
    }
  }
  for (const f of s.faces) {
    const col = f.name === "?" ? "#a5b4fc" : f.name ? C.ok : C.warn;
    const [bx, by, bw, bh] = f.box;
    brackets(c, bx * W, by * H, bw * W, bh * H, col, lw);
    tag(c, f.name === "?" ? "Face" : f.name ? f.name : "Unidentified", "", bx * W, by * H + bh * H + 4 + fs * 1.9 + 4, col, fs, W);
    if (f.pts.length === 68) {
      c.strokeStyle = col; c.globalAlpha = 0.55; c.lineWidth = Math.max(1, lw * 0.7);
      c.beginPath();
      for (const [a, b, closed] of FACE) {
        c.moveTo(f.pts[a][0] * W, f.pts[a][1] * H);
        for (let i = a + 1; i <= b; i++) c.lineTo(f.pts[i][0] * W, f.pts[i][1] * H);
        if (closed) c.lineTo(f.pts[a][0] * W, f.pts[a][1] * H);
      }
      c.stroke(); c.globalAlpha = 1; c.fillStyle = col;
      for (const [x, y] of f.pts) { c.beginPath(); c.arc(x * W, y * H, Math.max(1, lw * 0.7), 0, Math.PI * 2); c.fill(); }
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
