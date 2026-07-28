"use client";

import { useCallback, useEffect, useRef } from "react";

type WindowWithAudioContext = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;

  const audioWindow = window as WindowWithAudioContext;
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

export function useNewMessageSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const isDisposedRef = useRef(false);

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined" || isDisposedRef.current) return null;

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    return audioContextRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    const audioContext = getAudioContext();
    if (!audioContext || audioContext.state !== "suspended") return;

    void audioContext.resume().catch(() => undefined);
  }, [getAudioContext]);

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
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;

      if (!audioContext || audioContext.state === "closed") return;
      void audioContext.close().catch(() => undefined);
    };
  }, []);

  const playNewMessageSound = useCallback(() => {
    try {
      const audioContext = getAudioContext();
      if (!audioContext || audioContext.state !== "running") return;

      const now = audioContext.currentTime;
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      gain.connect(audioContext.destination);

      const firstTone = audioContext.createOscillator();
      firstTone.type = "sine";
      firstTone.frequency.setValueAtTime(520, now);
      firstTone.connect(gain);
      firstTone.start(now);
      firstTone.stop(now + 0.12);

      const secondTone = audioContext.createOscillator();
      secondTone.type = "sine";
      secondTone.frequency.setValueAtTime(660, now + 0.09);
      secondTone.connect(gain);
      secondTone.start(now + 0.09);
      secondTone.stop(now + 0.22);

      secondTone.onended = () => {
        gain.disconnect();
      };
    } catch {
      // Audio feedback must never interrupt the CRM workflow.
    }
  }, [getAudioContext]);

  return { playNewMessageSound };
}
