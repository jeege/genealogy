import { Suspense } from "react";
import { fetchMembersForTimeline } from "../actions";
import { TimelineClient } from "./timeline-client";

async function TimelineWrapper() {
  const { data: members, error } = await fetchMembersForTimeline();
  if (error) {
    return <div role="alert" className="bg-destructive/10 text-destructive p-4 rounded-lg">加载数据失败：{error}</div>;
  }
  return <TimelineClient initialData={members} />;
}

export default function TimelinePage() {
  return (
    <div className="container mx-auto py-6">
       <Suspense fallback={<div>Loading timeline...</div>}>
         <TimelineWrapper />
       </Suspense>
    </div>
  );
}