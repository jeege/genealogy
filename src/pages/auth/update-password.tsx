import { useSearchParams } from "react-router-dom";
import { UpdatePasswordForm } from "@/components/update-password-form";

export function UpdatePasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm token={token} />
      </div>
    </div>
  );
}
