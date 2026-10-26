"use client";

import { useEffect, useState } from "react";
import { fetchFamilyStatistics } from "./actions";
import type { StatisticsData } from "@/lib/api/types";
import { StatisticsCharts } from "./charts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function StatisticsContent() {
  const [data, setData] = useState<StatisticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchFamilyStatistics().then((result) => {
      if (cancelled) return;
      setData(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">正在加载统计数据...</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>获取统计数据失败: {error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return <div className="text-center text-muted-foreground py-8">暂无数据</div>;
  }

  return <StatisticsCharts data={data} />;
}
