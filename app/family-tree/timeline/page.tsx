"use client";

import { useEffect, useState } from "react";
import { fetchMembersForTimeline } from "../actions";
import type { TimelineMember } from "@/lib/api/types";
import { TimelineClient } from "./timeline-client";

export default function TimelinePage() {
  const [members, setMembers] = useState<TimelineMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMembersForTimeline().then((result) => {
      if (cancelled) return;
      setMembers(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container mx-auto py-6">
      {loading ? (
        <div className="py-16 text-center text-muted-foreground">正在加载时间轴...</div>
      ) : error ? (
        <div role="alert" className="bg-destructive/10 text-destructive p-4 rounded-lg">
          加载数据失败：{error}
        </div>
      ) : members.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          暂无可展示的时间轴数据，请先补充成员生日。
        </div>
      ) : (
        <TimelineClient initialData={members} />
      )}
    </div>
  );
}
