import React, { useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter, type NextRouter } from "next/router";
import type { Logger } from "pino";

export function withRouter<P extends object>(Component: ComponentType<P & { router: NextRouter }>) {
  return function Routed(props: P) {
    const router = useRouter();
    return <Component {...props} router={router} />;
  };
}

interface ExportOptions {
  format: "csv" | "json";
  delimiter: string;
  includeHeader: boolean;
  maxRows: number;
}

const DEFAULT_EXPORT: ExportOptions = { format: "csv", delimiter: ",", includeHeader: true, maxRows: 10_000 };

export const withDefaults = (options: Partial<ExportOptions>): ExportOptions => ({
  ...DEFAULT_EXPORT,
  ...options,
  maxRows: Math.min(options.maxRows ?? DEFAULT_EXPORT.maxRows, 100_000),
});

export const scopedLogger = (parent: Logger, scope: string, fields: Record<string, unknown> = {}): Logger =>
  parent.child({ scope, ...fields });

interface Session {
  user: { id: string; roles: string[] } | null;
}

declare function useSession(): Session;

export function withAuth<P extends object>(Component: ComponentType<P>, role?: string) {
  return function Guarded(props: P) {
    const session = useSession();
    if (!session.user) return <a href="/login">Sign in</a>;
    if (role && !session.user.roles.includes(role)) return <p>Forbidden</p>;
    return <Component {...props} />;
  };
}

export function withKeyboardShortcuts<P extends object>(Component: ComponentType<P>, bindings: Record<string, () => void>) {
  return function Bound(props: P) {
    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        const handler = bindings[event.key];
        if (handler) handler();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);
    return <Component {...props} />;
  };
}

interface SaveState {
  saving: boolean;
  error: string | null;
}

export function useSave(save: (draft: string) => Promise<void>) {
  const [state, setState] = useState<SaveState>({ saving: false, error: null });
  const pending = useRef<AbortController | null>(null);

  const withSaving = async (draft: string): Promise<void> => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ saving: true, error: null });
    await save(draft);
    if (controller.signal.aborted) return;
    setState({ saving: false, error: null });
  };

  return { state, withSaving };
}

export function withStyleOverride<P extends object>(Component: ComponentType<P>, styleId: string, css: string) {
  return function Styled(props: P) {
    useEffect(() => {
      const el = document.createElement("style");
      el.id = styleId;
      el.textContent = css;
      document.head.appendChild(el);
    }, []);
    return <Component {...props} />;
  };
}
