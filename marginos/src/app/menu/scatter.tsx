"use client";

import { useRouter } from "next/navigation";
import { QuadrantScatter } from "@/components/charts";

export function MenuScatter(props: { periodKey: string; points: { id: string; label: string; x: number; y: number; highlight?: boolean }[]; xThreshold: number; yThreshold: number }) {
  const router = useRouter();
  return <QuadrantScatter points={props.points} xThreshold={props.xThreshold} yThreshold={props.yThreshold} onSelect={(id) => router.push(`/menu/${id}?period=${props.periodKey}`)} />;
}
