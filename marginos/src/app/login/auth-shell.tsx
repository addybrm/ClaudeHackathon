import { Mark } from "@/components/logo";

/** Two-column sign-in frame: the form on paper, the brand on ink. */
export function AuthShell({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col bg-surface px-6 py-8 sm:px-12">
        <div className="flex items-center gap-2.5">
          <Mark size={26} ink="var(--ink)" facet="var(--brand)" />
          <span className="text-[16px] font-semibold tracking-[-0.02em]">MarginOS</span>
        </div>
        <div className="mx-auto my-auto w-full max-w-[380px] py-12">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          <p className="mb-8 mt-2 text-[14px] text-muted">{lede}</p>
          {children}
        </div>
        <p className="text-[12px] text-muted">Your data stays in your workspace. Passwords are hashed; sessions expire after 30 days.</p>
      </div>
      <div className="relative hidden overflow-hidden bg-[#141414] lg:block">
        <div className="absolute -right-24 top-1/2 -translate-y-1/2 opacity-[0.95]">
          <Mark size={620} ink="#232323" facet="#3b47f5" />
        </div>
        <div className="relative flex h-full flex-col justify-end p-14">
          <p className="max-w-[440px] text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">Know why your margin moved, and what to do about it.</p>
          <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-[#b4b4b4]">
            MarginOS reads your till exports, supplier invoices, delivery statements and recipes, then shows which dishes, suppliers and channels are costing you money.
          </p>
        </div>
      </div>
    </div>
  );
}
