import { Link } from "@/components/link";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { getSession } from "@/lib/api/client";
import type { AuthUser } from "@/lib/api/types";
import { LogoutButton } from "./logout-button";

export function AuthButton() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getSession().then((current) => {
      if (!cancelled) setUser(current);
    });
    return () => { cancelled = true; };
  }, []);

  if (user === undefined) {
    return <div className="h-9 w-28 bg-muted animate-pulse rounded-md" />;
  }

  return user ? (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4 w-full md:w-auto">
      <span className="text-sm font-medium truncate max-w-[200px] md:max-w-none mb-2 md:mb-0">
        你好, {user.email}!
      </span>
      <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
        <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
          <Link href="/family-tree">数据维护</Link>
        </Button>
        <LogoutButton className="w-full md:w-auto" />
      </div>
    </div>
  ) : (
    <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
      <Button asChild size="sm" variant={"outline"} className="w-full md:w-auto">
        <Link href="/auth/login">登录</Link>
      </Button>
      <Button asChild size="sm" variant={"default"} className="w-full md:w-auto">
        <Link href="/auth/sign-up">注册</Link>
      </Button>
    </div>
  );
}
