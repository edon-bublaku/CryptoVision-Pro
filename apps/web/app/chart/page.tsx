"use client";

import { Suspense } from "react";
import { ChartTerminal } from "@/components/chart/chart-terminal";

export default function ChartPage() {
  return (
    <Suspense>
      <ChartTerminal />
    </Suspense>
  );
}
