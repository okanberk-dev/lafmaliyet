"use client";

import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { configureRecognition, mergeTranscript, speechErrorText, speechRecognitionCtor, transcriptOf, type SpeechRecognitionLike } from "@/lib/assistant/speech";
import { cn } from "@/lib/utils";

const noop = () => () => {};

/** Tarayıcı ses tanımayı destekliyor mu (sunucuda ve hidrasyonda false: düğme sonradan belirir) */
function useSpeechSupported(): boolean {
  return useSyncExternalStore(
    noop,
    () => speechRecognitionCtor(window) !== null,
    () => false,
  );
}

/**
 * Sesle soru (src/lib/assistant/speech.ts; docs/ASISTAN.md › Sesle soru): mikrofon düğmesi. Tarayıcı desteklemiyorsa
 * HİÇ çizilmez. Dokununca dinler (tr-TR), konuşma bitince durur; tanınan metin yazı kutusundaki metnin sonuna yazılır
 * (`value` + konuşma), gönderilmez: kullanıcı okuyup Gönder'e basar. Ses panelin sunucusuna gitmez. 44 px.
 */
export function VoiceButton({ value, onChange, onNote, disabled }: { value: string; onChange: (text: string) => void; onNote: (note: string | null) => void; disabled?: boolean }) {
  const supported = useSpeechSupported();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => recRef.current?.abort(), []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = speechRecognitionCtor(window);
    if (!Ctor) return;
    const base = value;
    const rec = configureRecognition(new Ctor());
    rec.onresult = (e) => onChange(mergeTranscript(base, transcriptOf(e.results)));
    rec.onerror = (e) => onNote(speechErrorText(e.error));
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    onNote(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      onNote("Ses tanıma başlatılamadı.");
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Dinlemeyi durdur" : "Sesle sor"}
      title={listening ? "Dinlemeyi durdur" : "Sesle sor (Türkçe)"}
      data-voice
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40",
        listening ? "bg-ink text-on-solid motion-safe:animate-pulse" : "bg-panel text-ink-soft hover:text-ink",
      )}
    >
      {listening ? <MicOff className="size-5" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
    </button>
  );
}
