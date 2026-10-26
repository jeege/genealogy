"use client";

import { cn } from "@/lib/utils";
import { resetPassword } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";

interface UpdatePasswordFormProps extends React.ComponentPropsWithoutRef<"div"> {
  token: string;
}

export function UpdatePasswordForm({ className, token, ...props }: UpdatePasswordFormProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    token ? null : "重置链接缺少令牌，请重新申请密码重置。",
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setIsLoading(true);
    setError(null);

    try {
      await resetPassword(token, password);
      window.location.assign("/auth/login/");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "重置失败，请重新申请");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">重置您的密码</CardTitle>
          <CardDescription>请在下方输入您的新密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">新密码</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="至少 8 个字符"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!token}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading || !token}>
                {isLoading ? "保存中..." : "保存新密码"}
              </Button>
              <div className="text-center text-sm">
                <Link href="/auth/forgot-password" className="underline underline-offset-4">
                  重新申请重置链接
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
