import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ErrorPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">抱歉，出错了。</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {error ? `错误代码: ${error}` : "发生了一个未知错误。"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
