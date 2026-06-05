export type PrepRole = 'coach' | 'candidate';

export interface PrepTurn {
  role: PrepRole;
  text: string;
}

export interface PrepSessionDeps {
  /** Prior transcript to resume from; [] for a new or ephemeral session. */
  transcript: PrepTurn[];
  /** Produce one coach reply given the running transcript (one structured LLM call). */
  respond: (transcript: PrepTurn[]) => Promise<string>;
  /** Read the candidate's next line; resolve null on EOF (Ctrl-D) to end the session. */
  ask: () => Promise<string | null>;
  /** Print a coach reply to the user (injected for testability). */
  say: (text: string) => void;
  /** Persistence hook fired after every coach turn so progress is never lost. */
  onTurn?: (transcript: PrepTurn[]) => void;
}

export interface PrepSessionResult {
  transcript: PrepTurn[];
}

const EXIT = /^(exit|quit|\/done)$/i;

export async function runPrepSession(deps: PrepSessionDeps): Promise<PrepSessionResult> {
  const transcript: PrepTurn[] = [...deps.transcript]; // local copy — never mutate the caller's array

  // Opening coach turn — greets/asks about the round (new) or welcomes back (resume).
  const opening = await deps.respond([...transcript]);
  transcript.push({ role: 'coach', text: opening });
  deps.say(opening);
  deps.onTurn?.(transcript);

  for (;;) {
    const input = await deps.ask();
    if (input === null) break; // EOF / Ctrl-D
    const trimmed = input.trim();
    if (trimmed === '') continue; // re-prompt, send nothing
    if (EXIT.test(trimmed)) break;

    transcript.push({ role: 'candidate', text: trimmed });
    // Snapshot the transcript: respond must see the turns up to here, not the coach
    // reply pushed just below. (Also keeps test mocks from capturing later mutations.)
    const reply = await deps.respond([...transcript]);
    transcript.push({ role: 'coach', text: reply });
    deps.say(reply);
    deps.onTurn?.(transcript);
  }

  return { transcript };
}
