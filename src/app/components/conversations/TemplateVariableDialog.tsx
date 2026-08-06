"use client";

import { type FormEvent, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { renderTemplateBodyWithVariables } from "@/lib/template-parameters";

type TemplateVariableDialogTemplate = {
  name: string;
  preview: string;
  variableCount: number;
};

type TemplateVariableDialogProps = {
  template: TemplateVariableDialogTemplate;
  values: string[];
  sending: boolean;
  onChange: (index: number, value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TemplateVariableDialog({
  template,
  values,
  sending,
  onChange,
  onCancel,
  onConfirm
}: TemplateVariableDialogProps) {
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const preview = useMemo(
    () => renderTemplateBodyWithVariables(template.preview, values),
    [template.preview, values]
  );
  const hasEmptyValue =
    values.length < template.variableCount ||
    values.some((value) => !value.trim());

  useEffect(() => {
    firstInputRef.current?.focus();
  }, [template.name]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel, sending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasEmptyValue || sending) return;
    onConfirm();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 sm:items-center">
      <form
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-line bg-white p-5 shadow-2xl"
        onSubmit={handleSubmit}
      >
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">
            Template WhatsApp
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-950">
            Preencha as variaveis
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Informe os valores que serao enviados neste template.
          </p>
        </div>

        <div className="space-y-3">
          {Array.from({ length: template.variableCount }, (_, index) => (
            <label key={index} className="block">
              <span className="text-xs font-bold text-slate-700">
                Variavel {`{{${index + 1}}}`}
              </span>
              <input
                ref={index === 0 ? firstInputRef : undefined}
                className="mt-1 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-300"
                value={values[index] ?? ""}
                onChange={(event) => onChange(index, event.target.value)}
                placeholder={`Valor de {{${index + 1}}}`}
              />
            </label>
          ))}
        </div>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            Preview
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {preview || template.preview}
          </p>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="h-10 rounded-full border border-line px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled={sending}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={hasEmptyValue || sending}
          >
            {sending ? (
              <>
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              "Enviar template"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
