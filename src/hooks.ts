import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> = { data?: T; error?: string; status?: number; loading: boolean; reload: () => void };

/** Runs `fn` whenever `deps` change; ignores stale responses. `fn` may return null to skip (e.g. offline). */
export function useAsync<T>(fn: () => Promise<T> | null, deps: unknown[]): AsyncState<T> {
  const [state, set] = useState<{ data?: T; error?: string; status?: number; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    const p = fn();
    if (!p) { set({ loading: false }); return; }
    set(s => ({ data: s.data, loading: true }));
    p.then(data => live && set({ data, loading: false }))
      .catch((e: any) => live && set({ loading: false, error: e?.message ?? 'Request failed', status: e?.status }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { ...state, reload };
}

/** Calls `onOutside` when a mousedown happens outside the referenced element, or Escape is pressed. */
export function useDismiss<T extends HTMLElement>(open: boolean, onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onOutside(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onOutside]);
  return ref;
}
