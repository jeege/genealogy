import { Link } from "@/components/link";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { CalendarSwitcher } from "@/components/calendar-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { useRuntimeConfig } from "@/components/runtime-config-provider";

export function FamilyTreeHeader() {
  const { familySurname } = useRuntimeConfig();
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg hover:opacity-80 transition-opacity">
          {familySurname}氏族谱
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link href="/family-tree" className="hover:text-primary transition-colors">
            成员列表
          </Link>
          <Link href="/family-tree/graph" className="hover:text-primary transition-colors">
            2D 族谱
          </Link>
          <Link href="/family-tree/graph-3d" className="hover:text-primary transition-colors">
            3D 族谱
          </Link>
          <Link href="/family-tree/timeline" className="hover:text-primary transition-colors">
            时间轴
          </Link>
          <Link href="/family-tree/statistics" className="hover:text-primary transition-colors">
            统计分析
          </Link>
          <Link href="/family-tree/biography-book" className="hover:text-primary transition-colors">
            生平册
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <CalendarSwitcher />
          <ThemeSwitcher />
          <div className="hidden md:block">
            <AuthButton />
          </div>
          <MobileNav>
            <AuthButton />
          </MobileNav>
        </div>
      </div>
    </header>
  );
}
