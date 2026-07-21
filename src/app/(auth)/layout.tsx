/** Centered card layout for the authentication screens. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-secondary/40 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-sm font-black text-primary-foreground">
          PT
        </div>
        <div className="leading-tight">
          <div className="font-bold">Tactical Foreman</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Your Home, Our Mission.
          </div>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">{children}</div>
    </div>
  );
}
