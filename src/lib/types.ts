export type Sens = { on: boolean; sens: number };
export type Settings = {
  armed: boolean;
  armDelay: number; // seconds after arming before triggers count
  cooldown: number; // seconds between alerts of the same type
  snapshots: boolean;
  person: Sens;
  motion: Sens;
  light: Sens;
  sound: Sens;
  calib: { on: boolean; trip: number; at: number }; // zero-point deviation tripwire; trip in % of frame, at = last zero request
  faceUnknown: { on: boolean };
  faceKnown: { on: boolean };
};
export const DEFAULT_SETTINGS: Settings = {
  armed: true,
  armDelay: 10,
  cooldown: 10,
  snapshots: true,
  person: { on: true, sens: 6 },
  motion: { on: true, sens: 5 },
  light: { on: true, sens: 5 },
  sound: { on: true, sens: 5 },
  calib: { on: true, trip: 3, at: 0 },
  faceUnknown: { on: true },
  faceKnown: { on: false },
};
export type EventType =
  | "person" | "motion" | "light" | "sound" | "change" | "face_unknown" | "face_known";
export type ArgusEvent = {
  id: string;
  ts: number;
  type: EventType;
  label: string;
  conf?: number;
  snap: boolean; // snapshot stored under /api/snap?id=
};
export type Stats = { motion: number; light: number; sound: number; dev: number; persons: number; faces: number; calibAt: number; calibState: number /* 0 none, 1 running, 2 ready */ };
export type Heartbeat = { ts: number; battery?: number; charging?: boolean; stats?: Stats; peer?: string; token?: string; thumb?: string };
export type Face = { id: string; name: string; descs: number[][] };
