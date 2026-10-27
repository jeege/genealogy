export function NotFoundPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm text-center space-y-3">
        <h1 className="text-2xl font-semibold">页面不存在</h1>
        <p className="text-sm text-muted-foreground">请检查地址，或返回族谱关系图。</p>
        <a href="/family-tree/graph" className="text-sm underline underline-offset-4">
          返回族谱
        </a>
      </div>
    </div>
  );
}
