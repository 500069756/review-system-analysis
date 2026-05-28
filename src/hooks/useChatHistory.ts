import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "eval-layer-history";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evalData?: any;
  stage?: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
};

function load(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: Conversation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota or serialize error — ignore */
  }
}

export function useChatHistory() {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    setConversations(load());
  }, []);

  const upsert = useCallback(
    (id: string, title: string, messages: StoredMessage[]) => {
      setConversations((prev) => {
        const now = Date.now();
        const existing = prev.find((c) => c.id === id);
        let next: Conversation[];
        if (existing) {
          next = prev.map((c) =>
            c.id === id ? { ...c, title, messages, updatedAt: now } : c,
          );
        } else {
          next = [
            { id, title, messages, createdAt: now, updatedAt: now },
            ...prev,
          ];
        }
        next.sort((a, b) => b.updatedAt - a.updatedAt);
        persist(next);
        return next;
      });
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persist(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setConversations([]);
    persist([]);
  }, []);

  const get = useCallback(
    (id: string) => conversations.find((c) => c.id === id) ?? null,
    [conversations],
  );

  return { conversations, upsert, remove, clearAll, get };
}
