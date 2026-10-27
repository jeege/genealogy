import { Suspense, lazy } from "react";
import type { BiographyMember } from "./actions";

// 书卷组件含较多动画，按需加载。
const BiographyBookInner = lazy(() =>
  import("./biography-book").then((mod) => ({ default: mod.BiographyBook })),
);

interface BiographyBookLoaderProps {
  members: BiographyMember[];
}

export function BiographyBookLoader({ members }: BiographyBookLoaderProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-stone-900">
          <p className="text-lg font-serif text-white">正在展卷...</p>
        </div>
      }
    >
      <BiographyBookInner members={members} />
    </Suspense>
  );
}
