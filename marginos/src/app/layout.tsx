import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { getActiveBusiness } from "@/lib/business";
import { liveAiAvailable } from "@/lib/ai/config";
import { MobileNav, Sidebar } from "@/components/shell";
import { DemoBanner } from "@/components/ui";

export const metadata: Metadata = {
  title: "MarginOS · Restaurant profit intelligence",
  description: "Understand where your restaurant's money is going, why profitability is changing and what to do next.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const b = await getActiveBusiness();
  return (
    <html lang="en-GB">
      <body>
        <div className="flex min-h-screen">
          <Suspense fallback={<div className="hidden w-[216px] md:block" />}>
            <Sidebar business={b?.name ?? null} isDemo={!!b?.isDemo} aiLive={liveAiAvailable()} />
          </Suspense>
          <div className="min-w-0 flex-1">
            {b?.isDemo && <DemoBanner />}
            <Suspense>
              <MobileNav />
            </Suspense>
            <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
