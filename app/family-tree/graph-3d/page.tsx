"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LayoutDashboard } from "lucide-react";
import { fetchAllFamilyMembers, type FamilyMemberNode } from "../graph/actions";
import { FamilyForceGraph } from "./force-graph";

export default function FamilyTreeGraph3DPage() {
  const [members, setMembers] = useState<FamilyMemberNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAllFamilyMembers().then((result) => {
      if (cancelled) return;
      setMembers(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 mb-6">
        <h1 className="text-3xl font-bold">族谱关系图 (3D)</h1>
        <Button variant="outline" asChild>
          <Link href="/family-tree/graph">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            切换到 2D 视图
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="w-full h-[600px] border rounded-lg bg-muted/20 animate-pulse flex items-center justify-center">
          <div className="text-muted-foreground">加载族谱数据...</div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-[600px] border rounded-lg bg-destructive/10 text-destructive p-4">
          <p>加载数据失败: {error}</p>
        </div>
      ) : members.length === 0 ? (
        <div className="flex items-center justify-center h-[600px] border rounded-lg bg-muted/50 text-muted-foreground p-8 text-center">
          <p>暂无族谱数据，请先添加成员。</p>
        </div>
      ) : (
        <FamilyForceGraph data={members} />
      )}
    </div>
  );
}
