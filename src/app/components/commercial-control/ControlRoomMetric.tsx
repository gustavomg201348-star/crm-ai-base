import clsx from "clsx";

type ControlRoomMetricProps = {
  label: string;
  value: number;
  description: string;
  tone?: "default" | "attention" | "success" | "brand";
};

const toneClasses = {
  default: "border-line bg-white text-slate-900",
  attention: "border-amber-200 bg-amber-50 text-amber-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  brand: "border-blue-200 bg-blue-50 text-blue-950"
};

export function ControlRoomMetric({
  label,
  value,
  description,
  tone = "default"
}: ControlRoomMetricProps) {
  return (
    <div className={clsx("rounded-2xl border p-4 shadow-sm", toneClasses[tone])}>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value.toLocaleString("pt-BR")}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
    </div>
  );
}
