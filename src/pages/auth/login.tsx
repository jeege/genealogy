import { LoginForm } from "@/components/login-form";

export function LoginPage() {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center p-6 md:p-10 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <img
          src="/images/login-bg.jpg"
          alt="族谱背景"
          className="absolute inset-0 h-full w-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[2px]" />
      </div>
      <div className="w-full max-w-sm z-10">
        <LoginForm />
      </div>
    </div>
  );
}
