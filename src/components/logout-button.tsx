import { logout as logoutRequest } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {

  const logout = async () => {
    try {
      await logoutRequest();
    } finally {
      window.location.assign("/auth/login");
    }
  };

  return <Button onClick={logout} className={cn(className)}>登出</Button>;
}
