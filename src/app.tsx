import { Suspense, lazy, useEffect } from "react";
import { Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FamilyTreeHeader } from "@/components/family-tree-header";
import { LoginPage } from "@/pages/auth/login";
import { SignUpPage } from "@/pages/auth/sign-up";
import { SignUpSuccessPage } from "@/pages/auth/sign-up-success";
import { ErrorPage } from "@/pages/auth/error";
import { NotFoundPage } from "@/pages/not-found";

// 重型页面（图表、3D、表格）按需加载，主包只保留登录与外壳。
const FamilyMemberListPage = lazy(() =>
  import("@/pages/family-tree/member-list").then((mod) => ({ default: mod.FamilyMemberListPage })),
);
const FamilyTreeGraphPage = lazy(() =>
  import("@/pages/family-tree/graph/page").then((mod) => ({ default: mod.FamilyTreeGraphPage })),
);
const FamilyTreeGraph3DPage = lazy(() =>
  import("@/pages/family-tree/graph-3d/page").then((mod) => ({ default: mod.FamilyTreeGraph3DPage })),
);
const TimelinePage = lazy(() =>
  import("@/pages/family-tree/timeline/page").then((mod) => ({ default: mod.TimelinePage })),
);
const StatisticsPage = lazy(() =>
  import("@/pages/family-tree/statistics/page").then((mod) => ({ default: mod.StatisticsPage })),
);
const BiographyBookPage = lazy(() =>
  import("@/pages/family-tree/biography-book/page").then((mod) => ({ default: mod.BiographyBookPage })),
);

function PageFallback() {
  return (
    <div className="container mx-auto py-16 px-4">
      <div className="text-center text-muted-foreground">正在加载...</div>
    </div>
  );
}

/** 族谱页面的公共外壳：顶栏 + 内容区。 */
function FamilyTreeLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <FamilyTreeHeader />
      <main className="flex-1">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

/** 首页直接进入关系图，保持原有跳转行为。 */
function HomeRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    navigate("/family-tree/graph", { replace: true, state: location.state });
  }, [navigate, location.state]);
  return null;
}

/** 路由切换时回到页面顶部，避免长列表残留滚动位置。 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/sign-up" element={<SignUpPage />} />
        <Route path="/auth/sign-up-success" element={<SignUpSuccessPage />} />
        <Route path="/auth/error" element={<ErrorPage />} />

        <Route path="/family-tree" element={<FamilyTreeLayout />}>
          <Route index element={<FamilyMemberListPage />} />
          <Route path="graph" element={<FamilyTreeGraphPage />} />
          <Route path="graph-3d" element={<FamilyTreeGraph3DPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="statistics" element={<StatisticsPage />} />
          <Route path="biography-book" element={<BiographyBookPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
