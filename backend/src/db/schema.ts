export type UserRecord = {
  id: string;
  is_suspected: boolean;
  suspected_reason?: string;
  suspected_at?: number;
  suspicion_score: number;
  suspicion_history: string[];
};

const users = new Map<string, UserRecord>();

export function getUser(id: string): UserRecord | undefined {
  return users.get(id);
}

export function markUserSuspected(id: string, reason: string): void {
  const current =
    users.get(id) ??
    ({
      id,
      is_suspected: false,
      suspicion_score: 0,
      suspicion_history: [],
    } satisfies UserRecord);
  const history = [...current.suspicion_history, reason];
  users.set(id, {
    ...current,
    is_suspected: true,
    suspected_reason: reason,
    suspected_at: Date.now(),
    suspicion_score: current.suspicion_score + 1,
    suspicion_history: history,
  });
}

export function clearUserSuspicion(id: string): void {
  const current =
    users.get(id) ??
    ({
      id,
      is_suspected: false,
      suspicion_score: 0,
      suspicion_history: [],
    } satisfies UserRecord);
  users.set(id, {
    ...current,
    is_suspected: false,
    suspected_reason: undefined,
    suspected_at: undefined,
  });
}

export function getSuspicionSummary(id: string): {
  isSuspected: boolean;
  score: number;
  history: string[];
} {
  const current =
    users.get(id) ??
    ({
      id,
      is_suspected: false,
      suspicion_score: 0,
      suspicion_history: [],
    } satisfies UserRecord);
  return {
    isSuspected: current.is_suspected,
    score: current.suspicion_score,
    history: [...current.suspicion_history],
  };
}
