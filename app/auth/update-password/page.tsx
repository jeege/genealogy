"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { UpdatePasswordForm } from "@/components/update-password-form";

function UpdatePasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";
  return <UpdatePasswordForm token={token} />;
}

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<div className="text-center text-muted-foreground">正在加载...</div>}>
          <UpdatePasswordContent />
        </Suspense>
      </div>
    </div>
  );
}
