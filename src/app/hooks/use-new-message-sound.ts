"use client";

import { useCallback, useEffect, useRef } from "react";

export function useNewMessageSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isDisposedRef = useRef(false);

  const getAudio = useCallback(() => {
    if (typeof window === "undefined" || isDisposedRef.current) return null;

    if (!audioRef.current) {
      const audio = new Audio("/sounds/new-message.wav");
      audio.preload = "auto";
      audio.volume = 0.82;
      audioRef.current = audio;
    }

    return audioRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;

    audio.load();
  }, [getAudio]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleFirstInteraction = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
    };

    window.addEventListener("pointerdown", handleFirstInteraction, { once: true });
    window.addEventListener("keydown", handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
    };
  }, [unlockAudio]);

  useEffect(() => {
    isDisposedRef.current = false;

    return () => {
      isDisposedRef.current = true;
      const audio = audioRef.current;
      audioRef.current = null;

      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);

  const playNewMessageSound = useCallback(() => {
    try {
      const audio = getAudio();
      if (!audio) return;

      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } catch {
      // Audio feedback must never interrupt the CRM workflow.
    }
  }, [getAudio]);

  return { playNewMessageSound };
}
