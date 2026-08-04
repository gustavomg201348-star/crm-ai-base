const skeletonItems = Array.from({ length: 4 }, (_, index) => index);

export function LoadingState() {
  return (
    <div className="space-y-5">
      <div className="rounded-[1.5rem] border border-line/80 bg-white p-6 shadow-soft">
        <div className="h-4 w-32 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {skeletonItems.map((item) => (
            <div key={item} className="rounded-2xl border border-line bg-slate-50 p-4">
              <div className="h-8 w-12 animate-pulse rounded-full bg-slate-200" />
              <div className="mt-3 h-3 w-28 animate-pulse rounded-full bg-slate-200" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {skeletonItems.map((item) => (
          <div key={item} className="rounded-[1.5rem] border border-line/80 bg-white p-5 shadow-soft">
            <div className="h-4 w-40 animate-pulse rounded-full bg-slate-100" />
            <div className="mt-4 space-y-3">
              <div className="h-24 animate-pulse rounded-2xl bg-slate-50" />
              <div className="h-24 animate-pulse rounded-2xl bg-slate-50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
