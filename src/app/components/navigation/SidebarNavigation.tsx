import { useId } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { NavigationItem, Section, VisibleNavigationSection } from "@/lib/sidebar-navigation";

type SidebarNavigationProps = {
  sections: VisibleNavigationSection[];
  active: Section;
  collapsedGroups: Record<string, boolean>;
  unreadCount: number;
  onToggleGroup: (id: string) => void;
  onSelect: (id: Section) => void;
  compact?: boolean;
  dark?: boolean;
};

export function SidebarNavigation({
  sections, active, collapsedGroups, unreadCount, onToggleGroup, onSelect, compact = false, dark = false
}: SidebarNavigationProps) {
  const idPrefix = useId();
  const itemButton = (item: NavigationItem, nested = false) => {
    const Icon = item.icon;
    const selected = active === item.id;
    const count = item.id === "atendimento" ? unreadCount : 0;
    return (
      <button
        key={item.id}
        type="button"
        title={compact ? item.label : undefined}
        aria-label={compact ? item.label : undefined}
        aria-current={selected ? "page" : undefined}
        className={clsx(
          "group relative flex min-h-10 w-full items-center rounded-xl text-left text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          compact ? "justify-center" : "justify-between gap-2 px-3",
          nested && !compact && "pl-4",
          dark
            ? selected ? "bg-blue-600 text-white" : "text-blue-100 hover:bg-white/10 hover:text-white"
            : selected ? "bg-blue-50 text-brand ring-1 ring-inset ring-blue-100" : "text-slate-600 hover:bg-white hover:text-slate-950"
        )}
        onClick={() => onSelect(item.id)}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Icon aria-hidden="true" className={clsx("h-4 w-4 shrink-0",
            dark ? selected ? "text-white" : "text-blue-200" : selected ? "text-brand" : "text-slate-500"
          )} />
          {!compact && <span className="min-w-0 py-1.5">{item.label}</span>}
        </span>
        {count > 0 && (
          <span className={clsx(
            "rounded-full bg-rose-600 font-bold text-white",
            compact ? "absolute right-0.5 top-0.5 px-1 text-[9px]" : "shrink-0 px-2 py-0.5 text-[11px]"
          )}>{count > 99 ? "99+" : count}</span>
        )}
      </button>
    );
  };

  return (
    <nav
      aria-label="Navegação principal"
      className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]"
    >
      <div className={clsx(compact ? "space-y-2.5" : "space-y-3")}>
        {sections.map((section) => {
          if ("item" in section) return itemButton(section.item);
          if (compact) {
            return (
              <div key={section.id} role="group" aria-label={section.label}
                className={clsx("space-y-0.5 border-t pt-2", dark ? "border-white/15" : "border-slate-200")}>
                {section.items.map((item) => itemButton(item))}
              </div>
            );
          }

          const GroupIcon = section.icon;
          const activeGroup = section.items.some((item) => item.id === active);
          const expanded = activeGroup || !collapsedGroups[section.id];
          const groupId = `${idPrefix}-${section.id}`;
          return (
            <div key={section.id} className={clsx("border-t pt-2", dark ? "border-white/15" : "border-slate-200")}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() => onToggleGroup(section.id)}
                className={clsx(
                  "flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  dark
                    ? activeGroup ? "text-white" : "text-blue-100 hover:bg-white/10"
                    : activeGroup ? "text-slate-950" : "text-slate-700 hover:bg-white"
                )}
              >
                <GroupIcon aria-hidden="true" className={clsx("h-4 w-4 shrink-0", dark ? "text-blue-200" : "text-slate-500")} />
                <span className="min-w-0 flex-1 py-1.5">{section.label}</span>
                <ChevronRight aria-hidden="true" className={clsx("h-4 w-4 shrink-0 transition-transform",
                  expanded && "rotate-90", dark ? "text-blue-200" : "text-slate-500"
                )} />
              </button>
              <div id={groupId} role="group" aria-label={section.label} hidden={!expanded} className="ml-4 space-y-0.5">
                {section.items.map((item) => itemButton(item, true))}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
