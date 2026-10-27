import { cn } from "@/lib/utils";
import { login } from "@/lib/api/client";
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
import { Loader2 } from "lucide-react";
import { Link } from "@/components/link";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  // 开发期可用 VITE_LOGIN_EMAIL / VITE_LOGIN_PASSWORD 预填，便于本地调式；
  // 生产镜像不注入这些变量，登录框始终为空。
  const prefillEmail = import.meta.env.VITE_LOGIN_EMAIL ?? "";
  const prefillPassword = import.meta.env.VITE_LOGIN_PASSWORD ?? "";
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState(prefillPassword);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await login(email, password);
      // 登录成功后重定向到族谱关系图页面
      // 整页跳转，确保新会话 Cookie 随 HTML 请求发送给 Go 页面鉴权。
      window.location.assign("/family-tree/graph");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">登录</CardTitle>
          <CardDescription>请输入您的邮箱登录账户</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">密码</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    忘记密码？
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "登录中..." : "登录"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              还没有账户？{" "}
              <Link href="/auth/sign-up" className="underline underline-offset-4">
                注册
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
