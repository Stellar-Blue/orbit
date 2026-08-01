"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CalendarRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6 text-center text-slate-500 text-sm font-medium">
      Redirecting to Unified Home &amp; Calendar Hub...
    </div>
  );
}
