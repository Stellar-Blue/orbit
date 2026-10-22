"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { enterDemoMode } from "@/lib/demo-mode";

/**
 * Public entry point for the demo workspace. It only plants the demo cookie; the workspace itself
 * is the normal app, rendered from `mock-data.ts` because the provider sees that cookie.
 */
export default function DemoEntryPage() {
  useEffect(() => {
    enterDemoMode();
    // Full navigation, not router.push: the provider reads the cookie once, at boot.
    window.location.replace("/");
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-slate-50 text-slate-500">
      <Loader2 className="h-8 w-8 animate-spin text-[#3D87D3]" />
      <p className="text-sm font-semibold">Preparing the Orbit demo workspace…</p>
      <p className="text-xs text-slate-400">Sample data only — no company records are shown.</p>
    </div>
  );
}
