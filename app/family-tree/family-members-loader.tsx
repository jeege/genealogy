"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchFamilyMembers } from "@/lib/api/family";
import type { FamilyMember } from "@/lib/api/types";
import { FamilyMembersTable } from "./family-members-table";

interface FamilyMembersLoaderProps {
  page: number;
  pageSize: number;
  search: string;
}

export function FamilyMembersLoader({ page, pageSize, search }: FamilyMembersLoaderProps) {
  const [data, setData] = useState<FamilyMember[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFamilyMembers(page, pageSize, search).then((result) => {
      if (cancelled) return;
      setData(result.data);
      setCount(result.count);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [page, pageSize, search, version]);

  if (loading && data.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-muted-foreground">
        正在加载成员数据...
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-destructive/10 text-destructive p-4 rounded-lg">
        <p>加载数据失败: {error}</p>
      </div>
    );
  }

  return (
    <FamilyMembersTable
      initialData={data}
      totalCount={count}
      currentPage={page}
      pageSize={pageSize}
      searchQuery={search}
      onRefresh={refresh}
    />
  );
}
