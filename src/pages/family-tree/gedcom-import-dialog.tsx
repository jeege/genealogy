import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, FileUp, Loader2 } from "lucide-react";
import { importGEDCOM, previewGEDCOMImport } from "@/lib/api/family";
import type { GEDCOMImportPreview } from "@/lib/api/types";

interface GEDCOMImportDialogProps {
  onSuccess?: () => void;
  memberCount?: number;
}

/** GEDCOM 导入：上传 .ged/.txt，先预览统计与告警，再确认写入。 */
export function GEDCOMImportDialog({ onSuccess, memberCount = 0 }: GEDCOMImportDialogProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [content, setContent] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [preview, setPreview] = React.useState<GEDCOMImportPreview | null>(null);
  const [replace, setReplace] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const requestVersion = React.useRef(0);

  const reset = () => {
    requestVersion.current += 1;
    setContent("");
    setFileName("");
    setPreview(null);
    setReplace(false);
    setError(null);
    setIsLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) reset();
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++requestVersion.current;
    setIsLoading(true);
    setError(null);
    setPreview(null);
    setReplace(false);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async () => {
      const buffer = reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0);
      try {
        const text = decodeGEDCOM(buffer);
        setContent(text);
        const result = await previewGEDCOMImport(text);
        if (version !== requestVersion.current) return;
        if (result.error || !result.preview) throw new Error(result.error ?? "解析文件失败");
        setPreview(result.preview);
      } catch (readError) {
        if (version !== requestVersion.current) return;
        setError(readError instanceof Error ? readError.message : "解析文件失败，请确认是 GEDCOM 文件");
      } finally {
        if (version === requestVersion.current) setIsLoading(false);
      }
    };
    reader.onerror = () => {
      if (version !== requestVersion.current) return;
      setError("读取文件失败，请重新选择");
      setIsLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (!content) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await importGEDCOM(content, replace);
      if (result.error || !result.result) {
        setError(result.error ?? "导入失败");
        return;
      }
      const warnings = result.result.warnings;
      alert(
        `成功导入 ${result.result.members} 位成员、${result.result.families} 个家庭关系。` +
          (warnings.length > 0 ? `\n\n提示：\n${warnings.join("\n")}` : ""),
      );
      handleOpenChange(false);
      onSuccess?.();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="h-4 w-4 mr-2" />
          导入 GEDCOM
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入 GEDCOM</DialogTitle>
          <DialogDescription>
            支持 GEDCOM 5.5.1（.ged / .txt，UTF-8 或 GBK）。父子关系按 FAM 记录自动建立，
            世代与排行可由家庭结构推导。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".ged,.txt"
            onChange={handleFile}
            disabled={isLoading}
          />
          {fileName && (
            <p className="text-sm text-muted-foreground">
              已选择：{fileName}
              {preview ? `（${preview.encoding}${preview.version ? ` · GEDCOM ${preview.version}` : ""}）` : ""}
            </p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>错误</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在解析并检查文件...
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Stat label="个人记录" value={preview.members} />
                <Stat label="家庭记录" value={preview.families} />
                <Stat label="可解析父亲" value={preview.with_father} />
                <Stat label="含出生日期" value={preview.with_birth_date} />
                <Stat label="缺姓名" value={preview.missing_name} />
                <Stat label="重复姓名" value={preview.duplicate_names} />
              </div>

              {preview.warnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>导入提示</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-5 space-y-1">
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {preview.unsupported_tags.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <div className="bg-muted p-2 text-sm text-muted-foreground">
                    未映射的标签（不会导入）
                  </div>
                  <div className="p-2 text-sm break-all">
                    {preview.unsupported_tags.join("、")}
                  </div>
                </div>
              )}

              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>导入内容</TableHead>
                      <TableHead>说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>姓名、性别</TableCell>
                      <TableCell>NAME / SEX</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>生卒日期与地点</TableCell>
                      <TableCell>BIRT / DEAT / RESI，保留原始日期文本</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>父子关系</TableCell>
                      <TableCell>FAM 的 HUSB 与 CHIL，自动推导世代</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>生平、官职</TableCell>
                      <TableCell>NOTE / OCCU</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {memberCount > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <Checkbox
                    id="replace-gedcom"
                    checked={replace}
                    onCheckedChange={(checked) => setReplace(checked === true)}
                  />
                  <div className="grid gap-1">
                    <Label htmlFor="replace-gedcom" className="font-medium">
                      先清空现有族谱（{memberCount} 位成员）再导入
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      不勾选时为追加导入；勾选后旧数据会被删除且不可恢复，建议先导出备份。
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={!preview || isLoading}>
            {isLoading ? "处理中..." : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 先按 UTF-8 严格解码；失败时回退到 GB18030，兼容国内族谱软件导出的 GBK 文件。
 * 解码后统一以 UTF-8 文本提交，后端只需处理一种编码。
 */
function decodeGEDCOM(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
