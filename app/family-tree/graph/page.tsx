"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Box } from "lucide-react";
import { fetchAllFamilyMembers, type FamilyMemberNode } from "./actions";
import { FamilyTreeGraph } from "./family-tree-graph";

export default function FamilyTreeGraphPage() {
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
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 mb-6">
        <h1 className="text-3xl font-bold">族谱关系图</h1>
        <Button variant="outline" asChild>
          <Link href="/family-tree/graph-3d">
            <Box className="mr-2 h-4 w-4" />
            切换到 3D 视图
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="w-full h-[calc(100vh-200px)] min-h-[500px] border rounded-lg bg-muted/20 animate-pulse flex items-center justify-center">
          <div className="text-muted-foreground">加载族谱关系图...</div>
        </div>
      ) : error ? (
        <div className="bg-destructive/10 text-destructive p-4 rounded-lg">
          <p>加载数据失败: {error}</p>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-muted/50 text-muted-foreground p-8 rounded-lg text-center">
          <p>暂无族谱数据，请先添加成员。</p>
        </div>
      ) : (
        <FamilyTreeGraph initialData={members} />
      )}
    </div>
  );
}
