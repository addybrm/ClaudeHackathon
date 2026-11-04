import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { currentUser, userBusinesses } from "@/lib/auth";
import { getActiveBusiness } from "@/lib/business";
import { liveAiAvailable } from "@/lib/ai/config";
import { MobileNav, Sidebar } from "@/components/shell";

export const metadata: Metadata = {
  title: "MarginOS",
  description: "Profit intelligence for independent restaurants.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u) {
    return (
      <html lang="en-GB">
        <body>{children}</body>
      </html>
    );
  }
  const [businesses, b] = await Promise.all([userBusinesses(u.id), getActiveBusiness()]);
  return (
    <html lang="en-GB">
      <body>
        <div className="flex min-h-screen">
          <Suspense fallback={<div className="hidden w-[236px] md:block" />}>
            <Sidebar
              user={{ name: u.name, email: u.email }}
              businesses={businesses.map((x) => ({ id: x.id, name: x.name, isDemo: x.is_demo }))}
              activeId={b?.id ?? null}
              aiLive={liveAiAvailable()}
            />
          </Suspense>
          <div className="min-w-0 flex-1">
            <Suspense>
              <MobileNav />
            </Suspense>
            <main className="mx-auto max-w-[1360px] px-4 py-8 md:px-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
