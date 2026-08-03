"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  Video,
  X
} from "lucide-react";
import NextImage from "next/image";
import { TemplateCreatePreview } from "./TemplateCreatePreview";
import {
  buildCreateTemplateFormData,
  createTemplateRequest
} from "./template-create-client";
import type { TemplateChannelOption } from "./types";

export type HeaderType = "NONE" | "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
export type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

export type HeaderMediaDraft = {
  file: File;
  name: string;
  mimeType: string;
  size: number;
};

export type TemplateHeaderDraft =
  | { type: "NONE"; text: ""; media: null }
  | { type: "TEXT"; text: string; media: null }
  | { type: "IMAGE" | "DOCUMENT" | "VIDEO"; text: ""; media: HeaderMediaDraft | null };

export type TemplateButtonDraft = {
  id: string;
  type: ButtonType;
  text: string;
  url: string;
  phoneNumber: string;
};

export type TemplateCreateDraft = {
  channelId: string;
  name: string;
  language: string;
  category: string;
  header: TemplateHeaderDraft;
  body: string;
  bodyExampleValues: string[];
  footer: string;
  buttons: TemplateButtonDraft[];
};

type TemplateCreateErrors = Partial<
  Record<
    keyof TemplateCreateDraft | "headerText" | "headerMedia" | "bodyExamples" | `button-${string}`,
    string
  >
>;

type HeaderMediaConfig = {
  accept: string;
  description: string;
  icon: typeof ImageIcon;
  maxBytes: number;
  mimeTypes: string[];
};

const megabyte = 1024 * 1024;
const headerMediaConfig: Record<Exclude<HeaderType, "NONE" | "TEXT">, HeaderMediaConfig> = {
  IMAGE: {
    accept: "image/jpeg,image/png",
    description: "JPG ou PNG até 5 MB.",
    icon: ImageIcon,
    maxBytes: 5 * megabyte,
    mimeTypes: ["image/jpeg", "image/png"]
  },
  DOCUMENT: {
    accept: "application/pdf",
    description: "PDF até 10 MB.",
    icon: FileText,
    maxBytes: 10 * megabyte,
    mimeTypes: ["application/pdf"]
  },
  VIDEO: {
    accept: "video/mp4",
    description: "MP4 até 16 MB.",
    icon: Video,
    maxBytes: 16 * megabyte,
    mimeTypes: ["video/mp4"]
  }
};

const languageOptions = [
  { label: "Português (Brasil)", value: "pt_BR" },
  { label: "Inglês", value: "en_US" },
  { label: "Espanhol", value: "es_ES" }
];

const categoryOptions = [
  { label: "Marketing", value: "MARKETING" },
  { label: "Utilidade", value: "UTILITY" }
];

const headerTypeOptions: Array<{ label: string; value: HeaderType; description: string }> = [
  { label: "Sem header", value: "NONE", description: "A mensagem começa direto pelo body." },
  { label: "Texto", value: "TEXT", description: "Header simples em texto." },
  { label: "Imagem", value: "IMAGE", description: "Imagem padrão do template." }
];

const buttonTypeOptions: Array<{ label: string; value: ButtonType }> = [
  { label: "Resposta rápida", value: "QUICK_REPLY" },
  { label: "URL", value: "URL" },
  { label: "Telefone", value: "PHONE_NUMBER" }
];

function createButtonDraft(): TemplateButtonDraft {
  return {
    id: `button-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "QUICK_REPLY",
    text: "",
    url: "",
    phoneNumber: ""
  };
}

function createHeaderDraft(type: HeaderType): TemplateHeaderDraft {
  if (type === "TEXT") return { type, text: "", media: null };
  if (type === "IMAGE" || type === "DOCUMENT" || type === "VIDEO") {
    return { type, text: "", media: null };
  }
  return { type: "NONE", text: "", media: null };
}

function createInitialDraft(channelId: string): TemplateCreateDraft {
  return {
    channelId,
    name: "",
    language: "pt_BR",
    category: "UTILITY",
    header: createHeaderDraft("NONE"),
    body: "",
    bodyExampleValues: [],
    footer: "",
    buttons: []
  };
}

function normalizeTemplateName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function formatFileSize(size: number) {
  if (size < megabyte) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / megabyte).toFixed(2)} MB`;
}

function isMediaHeader(type: HeaderType): type is "IMAGE" | "DOCUMENT" | "VIDEO" {
  return type === "IMAGE" || type === "DOCUMENT" || type === "VIDEO";
}

function readBodyPlaceholderNumbers(body: string) {
  const tokens = body.match(/\{\{\s*[^{}]+\s*\}\}/g) ?? [];
  const numbers: number[] = [];
  const seen = new Set<number>();

  for (const token of tokens) {
    const value = Number(token.replace(/[{}]/g, "").trim());
    if (!Number.isInteger(value) || value < 1 || seen.has(value)) {
      return null;
    }

    seen.add(value);
    numbers.push(value);
  }

  const sorted = [...numbers].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index + 1) return null;
  }

  return sorted;
}

function validateHeaderFile(type: "IMAGE" | "DOCUMENT" | "VIDEO", file: File) {
  const config = headerMediaConfig[type];
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isPdfByExtension = type === "DOCUMENT" && extension === "pdf";
  const isValidMime = config.mimeTypes.includes(file.type) || isPdfByExtension;

  if (!isValidMime) {
    return `Formato inválido. Use ${config.description}`;
  }

  if (file.size > config.maxBytes) {
    return `Arquivo muito grande. Use ${config.description}`;
  }

  return null;
}

function validateDraft(draft: TemplateCreateDraft, channels: TemplateChannelOption[]) {
  const errors: TemplateCreateErrors = {};

  if (!draft.channelId || !channels.some((channel) => channel.id === draft.channelId)) {
    errors.channelId = "Selecione um canal do WhatsApp para preparar o template.";
  }

  if (!draft.name.trim()) {
    errors.name = "Informe o nome do template.";
  } else if (!/^[a-z0-9_]{3,512}$/.test(draft.name.trim())) {
    errors.name = "Use apenas letras minúsculas, números e underscore, com ao menos 3 caracteres.";
  }

  if (!draft.language.trim()) {
    errors.language = "Selecione o idioma.";
  }

  if (!draft.category.trim()) {
    errors.category = "Selecione a categoria.";
  }

  if (draft.header.type === "TEXT" && !draft.header.text.trim()) {
    errors.headerText = "Informe o texto do header ou escolha outro tipo.";
  }

  if (isMediaHeader(draft.header.type) && !draft.header.media) {
    errors.headerMedia = "Selecione o arquivo padrão do header.";
  }

  if (!draft.body.trim()) {
    errors.body = "Informe o conteúdo principal do template.";
  } else {
    const bodyPlaceholders = readBodyPlaceholderNumbers(draft.body);
    if (!bodyPlaceholders) {
      errors.body = "Use variáveis no formato {{1}}, {{2}}, sem repetição ou lacunas.";
    } else if (
      bodyPlaceholders.length > 0 &&
      bodyPlaceholders.some((placeholder) => !draft.bodyExampleValues[placeholder - 1]?.trim())
    ) {
      errors.bodyExamples = "Informe um exemplo para cada variável do body.";
    }
  }

  if (draft.footer.length > 60) {
    errors.footer = "O footer deve ter no máximo 60 caracteres.";
  }

  for (const button of draft.buttons) {
    if (!button.text.trim()) {
      errors[`button-${button.id}`] = "Informe o texto do botão.";
    } else if (button.text.trim().length > 25) {
      errors[`button-${button.id}`] = "O texto do botão deve ter no máximo 25 caracteres.";
    } else if (button.type === "URL" && !button.url.trim()) {
      errors[`button-${button.id}`] = "Informe a URL do botão.";
    } else if (button.type === "PHONE_NUMBER" && !button.phoneNumber.trim()) {
      errors[`button-${button.id}`] = "Informe o telefone do botão.";
    }
  }

  return errors;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p className="mt-1 text-xs font-semibold text-rose-700" role="alert">
      {message}
    </p>
  );
}

function FieldLabel({
  children,
  hint
}: {
  children: string;
  hint?: string;
}) {
  return (
    <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
      {children}
      {hint && <span className="ml-1 normal-case tracking-normal text-slate-400">{hint}</span>}
    </span>
  );
}

function HeaderMediaPreview({
  media,
  type,
  onRemove
}: {
  media: HeaderMediaDraft;
  type: "IMAGE" | "DOCUMENT" | "VIDEO";
  onRemove: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (type === "DOCUMENT") {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(media.file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [media.file, type]);

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
      {type === "IMAGE" && previewUrl && (
        <NextImage
          alt={`Preview de ${media.name}`}
          className="max-h-64 w-full object-contain bg-slate-100"
          height={256}
          unoptimized
          width={512}
          src={previewUrl}
        />
      )}
      {type === "VIDEO" && previewUrl && (
        <video
          className="max-h-64 w-full bg-slate-950"
          controls
          preload="metadata"
          src={previewUrl}
        >
          <track kind="captions" />
        </video>
      )}
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{media.name}</p>
          <p className="text-xs font-medium text-slate-500">
            {media.mimeType || "Tipo não informado"} · {formatFileSize(media.size)}
          </p>
        </div>
        <button
          className="inline-flex h-9 items-center justify-center rounded-full border border-line px-3 text-xs font-bold text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
          onClick={onRemove}
          type="button"
        >
          Remover
        </button>
      </div>
    </div>
  );
}

function HeaderEditor({
  header,
  error,
  onChange
}: {
  header: TemplateHeaderDraft;
  error?: string;
  onChange: (header: TemplateHeaderDraft) => void;
}) {
  const mediaConfig = isMediaHeader(header.type) ? headerMediaConfig[header.type] : null;
  const MediaIcon = mediaConfig?.icon ?? UploadCloud;
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    setMediaError(null);
  }, [header.type]);

  function handleFileChange(file?: File | null) {
    if (!file || !isMediaHeader(header.type)) return;

    const mediaHeaderType = header.type;
    const validationError = validateHeaderFile(mediaHeaderType, file);
    if (validationError) {
      setMediaError(validationError);
      onChange({ type: mediaHeaderType, text: "", media: null });
      return;
    }

    setMediaError(null);
    onChange({
      type: mediaHeaderType,
      text: "",
      media: {
        file,
        name: file.name,
        mimeType: file.type,
        size: file.size
      }
    });
  }

  return (
    <div className="rounded-2xl border border-line/80 bg-slate-50/70 p-3">
      <FieldLabel>Tipo do Header</FieldLabel>
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {headerTypeOptions.map((option) => (
          <button
            className={`rounded-2xl border p-3 text-left transition ${
              header.type === option.value
                ? "border-blue-200 bg-blue-50 text-brand"
                : "border-line bg-white text-slate-600 hover:border-blue-100 hover:bg-blue-50/40"
            }`}
            key={option.value}
            onClick={() => onChange(createHeaderDraft(option.value))}
            type="button"
          >
            <span className="block text-sm font-black">{option.label}</span>
            <span className="mt-1 block text-xs font-medium text-slate-500">
              {option.description}
            </span>
          </button>
        ))}
      </div>

      {header.type === "TEXT" && (
        <label className="mt-3 block">
          <FieldLabel>Texto do Header</FieldLabel>
          <input
            className="h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => onChange({ ...header, text: event.target.value })}
            placeholder="Ex: Olá, {{1}}"
            value={header.text}
          />
          <FieldError message={error} />
        </label>
      )}

      {isMediaHeader(header.type) && mediaConfig && (
        <div className="mt-3">
          <label className="block cursor-pointer rounded-2xl border border-dashed border-blue-200 bg-white p-4 transition hover:bg-blue-50/40">
            <input
              accept={mediaConfig.accept}
              className="sr-only"
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
              type="file"
            />
            <span className="flex flex-col items-center justify-center gap-2 text-center text-sm text-slate-600">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-brand">
                <MediaIcon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="font-black text-slate-900">Selecionar arquivo do header</span>
              <span className="text-xs font-medium text-slate-500">{mediaConfig.description}</span>
            </span>
          </label>
          <FieldError message={mediaError ?? error} />
          {header.media && (
            <HeaderMediaPreview
              media={header.media}
              onRemove={() => onChange({ ...header, media: null })}
              type={header.type}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function TemplateCreatePanel({
  channels,
  channelsLoading,
  onCreated,
  onClose,
  preferredChannelId
}: {
  channels: TemplateChannelOption[];
  channelsLoading: boolean;
  onCreated: () => void;
  onClose: () => void;
  preferredChannelId?: string | null;
}) {
  const initialChannelId =
    channels.find((channel) => channel.id === preferredChannelId)?.id ?? channels[0]?.id ?? "";
  const [draft, setDraft] = useState<TemplateCreateDraft>(() =>
    createInitialDraft(initialChannelId)
  );
  const [submitted, setSubmitted] = useState(false);
  const [validated, setValidated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const errors = useMemo(() => validateDraft(draft, channels), [channels, draft]);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  useEffect(() => {
    setDraft((current) => {
      if (current.channelId && channels.some((channel) => channel.id === current.channelId)) {
        return current;
      }

      return {
        ...current,
        channelId:
          channels.find((channel) => channel.id === preferredChannelId)?.id ??
          channels[0]?.id ??
          ""
      };
    });
  }, [channels, preferredChannelId]);

  function updateDraft<K extends keyof TemplateCreateDraft>(
    field: K,
    value: TemplateCreateDraft[K]
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);
  }

  function updateBody(value: string) {
    const placeholders = readBodyPlaceholderNumbers(value) ?? [];
    setDraft((current) => ({
      ...current,
      body: value,
      bodyExampleValues: placeholders.map(
        (placeholder) => current.bodyExampleValues[placeholder - 1] ?? ""
      )
    }));
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);
  }

  function updateBodyExample(index: number, value: string) {
    setDraft((current) => ({
      ...current,
      bodyExampleValues: current.bodyExampleValues.map((example, exampleIndex) =>
        exampleIndex === index ? value : example
      )
    }));
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);
  }

  function updateButton(id: string, changes: Partial<TemplateButtonDraft>) {
    setDraft((current) => ({
      ...current,
      buttons: current.buttons.map((button) =>
        button.id === id ? { ...button, ...changes } : button
      )
    }));
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);
  }

  function addButton() {
    setDraft((current) => ({
      ...current,
      buttons: [...current.buttons, createButtonDraft()]
    }));
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);
  }

  function removeButton(id: string) {
    setDraft((current) => ({
      ...current,
      buttons: current.buttons.filter((button) => button.id !== id)
    }));
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);
  }

  function handleValidate() {
    setSubmitted(true);
    setValidated(!hasErrors);
  }

  async function handleCreateTemplate() {
    if (submitting) return;

    setSubmitted(true);
    setValidated(false);
    setSubmitError(null);
    setSuccessToast(null);

    if (hasErrors) {
      setSubmitError("Revise os campos destacados antes de criar o template.");
      return;
    }

    let formData: FormData;

    try {
      formData = buildCreateTemplateFormData(draft);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Não foi possível preparar os dados do template."
      );
      return;
    }

    setSubmitting(true);

    try {
      const result = await createTemplateRequest({
        channelId: draft.channelId,
        formData
      });

      setSuccessToast(
        `Template "${result.template.name}" enviado para aprovação e salvo na biblioteca.`
      );
      onCreated();
      window.setTimeout(onClose, 900);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o template. Tente novamente."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
    >
      <section
        aria-labelledby="template-create-title"
        aria-modal="true"
        className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col rounded-3xl border border-line bg-white shadow-2xl sm:min-h-0"
        role="dialog"
      >
      <div className="flex flex-col gap-3 border-b border-line/80 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
            Novo Template
          </p>
          <h3 className="mt-1 text-xl font-black text-slate-950" id="template-create-title">
            Enviar template para aprovação
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Preencha as informações, revise a prévia e envie para análise do WhatsApp.
          </p>
        </div>
        <button
          aria-label="Fechar criação de template"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
          Fechar
        </button>
      </div>

      <div className="space-y-4 p-4">
        {validated && (
          <div
            className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
            role="status"
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            Tudo certo para enviar à análise.
          </div>
        )}
        {successToast && (
          <div
            className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
            role="status"
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {successToast}
          </div>
        )}
        {submitError && (
          <div
            className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm font-semibold text-rose-700"
            role="alert"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {submitError}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <label>
                <FieldLabel>Canal do WhatsApp</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                  disabled={channelsLoading || channels.length === 0}
                  onChange={(event) => updateDraft("channelId", event.target.value)}
                  value={draft.channelId}
                >
                  {channels.length === 0 ? (
                    <option value="">
                      {channelsLoading ? "Carregando canais..." : "Nenhum canal do WhatsApp disponível"}
                    </option>
                  ) : (
                    channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.displayPhone ? `${channel.name} · ${channel.displayPhone}` : channel.name}
                      </option>
                    ))
                  )}
                </select>
                {submitted && <FieldError message={errors.channelId} />}
              </label>

              <label>
                <FieldLabel hint="Meta usa snake_case">Nome do template</FieldLabel>
                <input
                  className="h-11 w-full rounded-2xl border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  onBlur={() => updateDraft("name", normalizeTemplateName(draft.name))}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  placeholder="ex: retorno_beneficio_01"
                  value={draft.name}
                />
                {submitted && <FieldError message={errors.name} />}
              </label>

              <label>
                <FieldLabel>Idioma</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  onChange={(event) => updateDraft("language", event.target.value)}
                  value={draft.language}
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {submitted && <FieldError message={errors.language} />}
              </label>

              <label>
                <FieldLabel>Categoria</FieldLabel>
                <select
                  className="h-11 w-full rounded-2xl border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  onChange={(event) => updateDraft("category", event.target.value)}
                  value={draft.category}
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {submitted && <FieldError message={errors.category} />}
              </label>
            </div>

            <HeaderEditor
              error={submitted ? errors.headerText ?? errors.headerMedia : undefined}
              header={draft.header}
              onChange={(header) => updateDraft("header", header)}
            />

            <label className="block">
              <FieldLabel>Body</FieldLabel>
              <textarea
                className="min-h-40 w-full resize-y rounded-2xl border border-line bg-slate-50 p-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
                onChange={(event) => updateBody(event.target.value)}
                placeholder="Digite a mensagem principal do template. Use {{1}}, {{2}} para variáveis."
                value={draft.body}
              />
              <div className="mt-1 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>Variáveis serão validadas pela integração futura.</span>
                <span>{draft.body.length} caracteres</span>
              </div>
              {submitted && <FieldError message={errors.body} />}
              {draft.bodyExampleValues.length > 0 && (
                <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">
                    Exemplos das variáveis
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Use valores neutros. Eles ajudam a Meta a revisar o template.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {draft.bodyExampleValues.map((value, index) => (
                      <label key={`body-example-${index}`}>
                        <FieldLabel>{`Variável {{${index + 1}}}`}</FieldLabel>
                        <input
                          className="h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
                          onChange={(event) => updateBodyExample(index, event.target.value)}
                          placeholder={index === 0 ? "Ex: Cliente" : "Ex: solicitação"}
                          value={value}
                        />
                      </label>
                    ))}
                  </div>
                  {submitted && <FieldError message={errors.bodyExamples} />}
                </div>
              )}
            </label>

            <label className="block">
              <FieldLabel hint="opcional">Footer</FieldLabel>
              <input
                className="h-11 w-full rounded-2xl border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
                maxLength={60}
                onChange={(event) => updateDraft("footer", event.target.value)}
                placeholder="Ex: Responda SAIR para cancelar."
                value={draft.footer}
              />
              <div className="mt-1 text-xs text-slate-500">{draft.footer.length}/60 caracteres</div>
              {submitted && <FieldError message={errors.footer} />}
            </label>

            <section className="rounded-2xl border border-line/80 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <FieldLabel>Botões</FieldLabel>
              <p className="text-sm text-slate-500">
                Configure a estrutura dos botões. A validação final com a Meta virá depois.
              </p>
            </div>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 text-xs font-bold text-brand transition hover:bg-blue-100 disabled:opacity-60"
              disabled={draft.buttons.length >= 3}
              onClick={addButton}
              type="button"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              Adicionar botão
            </button>
          </div>

          {draft.buttons.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-slate-500">
              Nenhum botão configurado. Você pode adicionar respostas rápidas, URL ou telefone.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {draft.buttons.map((button, index) => (
                <div
                  className="rounded-2xl border border-line bg-slate-50 p-3"
                  key={button.id}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-900">Botão {index + 1}</p>
                    <button
                      aria-label={`Remover botão ${index + 1}`}
                      className="grid h-8 w-8 place-items-center rounded-full border border-line bg-white text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => removeButton(button.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label>
                      <FieldLabel>Tipo</FieldLabel>
                      <select
                        className="h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
                        onChange={(event) =>
                          updateButton(button.id, { type: event.target.value as ButtonType })
                        }
                        value={button.type}
                      >
                        {buttonTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <FieldLabel>Texto</FieldLabel>
                      <input
                        className="h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
                        onChange={(event) => updateButton(button.id, { text: event.target.value })}
                        placeholder="Ex: Quero saber mais"
                        value={button.text}
                      />
                    </label>
                    {button.type === "URL" && (
                      <label>
                        <FieldLabel>URL</FieldLabel>
                        <input
                          className="h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
                          onChange={(event) => updateButton(button.id, { url: event.target.value })}
                          placeholder="https://..."
                          value={button.url}
                        />
                      </label>
                    )}
                    {button.type === "PHONE_NUMBER" && (
                      <label>
                        <FieldLabel>Telefone</FieldLabel>
                        <input
                          className="h-10 w-full rounded-2xl border border-line bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
                          onChange={(event) =>
                            updateButton(button.id, { phoneNumber: event.target.value })
                          }
                          placeholder="+55..."
                          value={button.phoneNumber}
                        />
                      </label>
                    )}
                  </div>
                  {submitted && <FieldError message={errors[`button-${button.id}`]} />}
                </div>
              ))}
            </div>
          )}
            </section>
          </div>

          <TemplateCreatePreview draft={draft} />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line/80 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            className="inline-flex h-10 items-center justify-center rounded-full border border-line px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center justify-center rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            onClick={handleValidate}
            type="button"
          >
            Revisar
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            onClick={() => void handleCreateTemplate()}
            type="button"
          >
            {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {submitting ? "Enviando..." : "Enviar para aprovação"}
          </button>
        </div>
      </div>
      </section>
    </div>
  );
}
