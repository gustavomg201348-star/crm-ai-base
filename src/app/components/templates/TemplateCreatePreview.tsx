"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Video } from "lucide-react";
import NextImage from "next/image";
import type { TemplateCreateDraft, TemplateHeaderDraft } from "./TemplateCreatePanel";

function PreviewPlaceholder({ children }: { children: string }) {
  return <span className="text-slate-400">{children}</span>;
}

function PreviewMedia({
  header
}: {
  header: Extract<TemplateHeaderDraft, { type: "IMAGE" | "DOCUMENT" | "VIDEO" }>;
}) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!header.media || header.type === "DOCUMENT") {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(header.media.file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [header.media, header.type]);

  if (!header.media) {
    const Icon = header.type === "IMAGE" ? ImageIcon : header.type === "VIDEO" ? Video : FileText;
    const label =
      header.type === "IMAGE"
        ? "Imagem do header"
        : header.type === "VIDEO"
          ? "Vídeo do header"
          : "Documento do header";

    return (
      <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center">
        <div className="space-y-2">
          <Icon aria-hidden="true" className="mx-auto h-7 w-7 text-slate-300" />
          <p className="text-xs font-semibold text-slate-400">{label} ainda não selecionado</p>
        </div>
      </div>
    );
  }

  if (header.type === "IMAGE" && previewUrl) {
    return (
      <NextImage
        alt={`Preview de ${header.media.name}`}
        className="max-h-56 w-full rounded-2xl bg-slate-100 object-contain"
        height={224}
        src={previewUrl}
        unoptimized
        width={360}
      />
    );
  }

  if (header.type === "VIDEO" && previewUrl) {
    return (
      <video
        className="max-h-56 w-full rounded-2xl bg-slate-950"
        controls
        preload="metadata"
        src={previewUrl}
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-brand">
        <FileText aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-900">{header.media.name}</p>
        <p className="text-xs font-medium text-slate-500">Documento PDF anexado ao header</p>
      </div>
    </div>
  );
}

function PreviewHeader({ header }: { header: TemplateHeaderDraft }) {
  if (header.type === "NONE") return null;

  if (header.type === "TEXT") {
    return (
      <p className="mb-2 text-sm font-bold text-slate-950">
        {header.text.trim() || <PreviewPlaceholder>Header em texto</PreviewPlaceholder>}
      </p>
    );
  }

  return (
    <div className="mb-2">
      <PreviewMedia header={header} />
    </div>
  );
}

function PreviewButtonIcon({ type }: { type: string }) {
  if (type === "URL") return <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />;
  if (type === "PHONE_NUMBER") return <Phone aria-hidden="true" className="h-3.5 w-3.5" />;
  return <Reply aria-hidden="true" className="h-3.5 w-3.5" />;
}

function renderBodyPreview(body: string, examples: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, value: string) => {
    const index = Number(value) - 1;
    return examples[index]?.trim() || `Exemplo ${value}`;
  });
}

export function TemplateCreatePreview({ draft }: { draft: TemplateCreateDraft }) {
  return (
    <aside className="rounded-2xl border border-line bg-slate-50 p-4 xl:sticky xl:top-4 xl:self-start">
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
          Preview
        </p>
        <h4 className="mt-1 text-lg font-black text-slate-950">WhatsApp Business</h4>
        <p className="mt-1 text-xs font-medium text-slate-500">
          Atualizado em tempo real. Apenas visual, sem envio.
        </p>
      </div>

      <div className="rounded-[2rem] border border-emerald-100 bg-[#e7f4ed] p-3 shadow-inner">
        <div className="mb-3 flex items-center gap-2 rounded-full bg-white/70 px-3 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-xs font-black text-white">
            CRM
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-slate-900">
              {draft.name.trim() || "novo_template"}
            </p>
            <p className="text-[11px] font-medium text-slate-500">{draft.language}</p>
          </div>
        </div>

        <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-white p-3 shadow-sm">
          <PreviewHeader header={draft.header} />

          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {draft.body.trim() ? (
              renderBodyPreview(draft.body, draft.bodyExampleValues)
            ) : (
              <PreviewPlaceholder>O body do template aparecerá aqui.</PreviewPlaceholder>
            )}
          </p>

          {draft.footer.trim() && (
            <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
              {draft.footer}
            </p>
          )}

          <p className="mt-2 text-right text-[10px] font-medium text-slate-400">12:45</p>
        </div>

        <div className="ml-auto mt-2 max-w-[92%] space-y-1.5">
          {draft.buttons.length === 0 ? (
            <div className="rounded-2xl bg-white/80 px-3 py-2 text-center text-xs font-semibold text-slate-400">
              Botões aparecerão aqui quando configurados.
            </div>
          ) : (
            draft.buttons.map((button, index) => (
              <div
                className="flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-bold text-brand shadow-sm"
                key={button.id}
              >
                <PreviewButtonIcon type={button.type} />
                <span className="truncate">
                  {button.text.trim() || `Botão ${index + 1}`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
