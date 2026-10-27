import { useEffect, useState } from "react";
import { fetchMembersWithBiography } from "./actions";
import type { BiographyMember } from "@/lib/api/types";
import { BiographyBookLoader } from "./biography-book-loader";

export function BiographyBookPage() {
  const [members, setMembers] = useState<BiographyMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMembersWithBiography().then((result) => {
      if (cancelled) return;
      setMembers(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900">
        <div className="text-center text-white">
          <div className="animate-spin mb-4">
            <svg
              className="h-8 w-8 mx-auto text-amber-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-lg font-serif">正在展卷...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900">
        <div className="text-center text-white">
          <p className="text-lg">加载失败</p>
          <p className="text-sm text-white/60 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900">
        <div className="text-center text-white">
          <p className="text-lg">暂无生平事迹记录</p>
          <p className="text-sm text-white/60 mt-2">请先在成员管理中添加生平事迹</p>
        </div>
      </div>
    );
  }

  return <BiographyBookLoader members={members} />;
}
