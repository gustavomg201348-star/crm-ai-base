"use client";
import { useEffect, useRef } from "react";

const event = "qevora-tasks-changed";
export function notifyTaskChanges() {
  window.dispatchEvent(new Event(event));
  try { localStorage.setItem(event, String(Date.now())); } catch { /* Local event still refreshes this tab. */ }
}
export function useTaskRefresh(refresh: () => void) {
  const current = useRef(refresh);
  current.current = refresh;
  useEffect(() => {
    const run = () => { if (!document.hidden) current.current(); };
    const storage = (e: StorageEvent) => { if (e.key === event) run(); };
    window.addEventListener(event, run);
    window.addEventListener("focus", run);
    window.addEventListener("storage", storage);
    const timer = window.setInterval(run, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(event, run);
      window.removeEventListener("focus", run);
      window.removeEventListener("storage", storage);
    };
  }, []);
}
