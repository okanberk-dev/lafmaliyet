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
 *
 * Dinleme kendiliğinden kesilir (sonuç yok sayılır): düğme devre dışı kalınca (soru gönderildi, yanıt bekleniyor) ya da
 * kutudaki metin dinlemenin yazdığından başka olunca (kullanıcı yazdı, sildi ya da Gönder kutuyu boşalttı). Yoksa geç
 * gelen bir sonuç boşalan kutuyu eski metinle yeniden doldurur ya da kullanıcının yazdığını ezerdi.
 */
export function VoiceButton({ value, onChange, onNote, disabled }: { value: string; onChange: (text: string) => void; onNote: (note: string | null) => void; disabled?: boolean }) {
  const supported = useSpeechSupported();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** Dinlemenin kutuya son yazdığı metin (başlarken kutudaki metin) */
  const written = useRef<string | null>(null);

  /** Dinlemeyi keser; sonradan gelen sonuç yok sayılır (onresult yalnız etkin tanıyıcıdan) */
  const cancel = () => {
    const rec = recRef.current;
    recRef.current = null;
    written.current = null;
    setListening(false);
    rec?.abort();
  };

  useEffect(() => () => recRef.current?.abort(), []);

  useEffect(() => {
    if (disabled && recRef.current) cancel();
  }, [disabled]);

  useEffect(() => {
    if (recRef.current && written.current !== null && value !== written.current) cancel();
  }, [value]);

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
    rec.onresult = (e) => {
      if (recRef.current !== rec) return;
      const next = mergeTranscript(base, transcriptOf(e.results));
      written.current = next;
      onChange(next);
    };
    rec.onerror = (e) => {
      if (recRef.current === rec) onNote(speechErrorText(e.error));
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      setListening(false);
      recRef.current = null;
      written.current = null;
    };
    recRef.current = rec;
    written.current = base;
    onNote(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      written.current = null;
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
