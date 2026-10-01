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
  change: Sens;
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
  change: { on: false, sens: 5 },
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
export type Heartbeat = { ts: number; battery?: number; charging?: boolean; stats?: Record<string, number> };
export type Face = { id: string; name: string; descs: number[][] };
