export type PrepRole = 'coach' | 'candidate';
export interface PrepTurn {
  role: PrepRole;
  text: string;
}
