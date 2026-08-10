import type { ReactNode } from "react";

export function ControlRoomSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-line/80 bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
