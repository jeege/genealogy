import * as React from "react";
import * as XLSX from "xlsx";
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
import { Upload, Download, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { batchCreateFamilyMembers, previewFamilyMembersImport } from "./actions";
import { parseImportRows, type ImportFatherMatch, type ImportMemberInput } from "./member-import";
import { useRuntimeConfig } from "@/components/runtime-config-provider";
import { useCalendar } from "@/lib/calendar/calendar-context";

interface ImportMembersDialogProps {
  onSuccess?: () => void;
}

export function ImportMembersDialog({ onSuccess }: ImportMembersDialogProps) {
  const { familySurname } = useRuntimeConfig();
  const { formatDate } = useCalendar();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [parsedData, setParsedData] = React.useState<ImportMemberInput[]>([]);
  const [fatherMatches, setFatherMatches] = React.useState<ImportFatherMatch[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadVersion = React.useRef(0);

  const resetState = () => {
    uploadVersion.current += 1;
    setParsedData([]);
    setFatherMatches([]);
    setError(null);
    setIsLoading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      resetState();
    }
  };

  // 下载模板
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        姓名: `${familySurname}父名`,
        世代: 19,
        排行: 1,
        父亲姓名: "",
        性别: "男",
        官职: "",
        是否在世: "是",
        生平事迹: "",
        生日: "1965-01-01",
        居住地: "某地",
      },
      {
        姓名: `${familySurname}某某`,
        世代: 20,
        排行: 1,
        父亲姓名: `${familySurname}父名`,
        性别: "男",
        官职: "进士",
        是否在世: "是",
        生平事迹: "字某某",
        生日: "1990-01-01",
        居住地: "某地",
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "成员导入模板");
    XLSX.writeFile(wb, "族谱成员导入模板.xlsx");
  };

  // 处理文件上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setParsedData([]);
    setFatherMatches([]);
    const version = ++uploadVersion.current;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
        const formattedData = parseImportRows(data);
        const result = await previewFamilyMembersImport(formattedData);
        if (version !== uploadVersion.current) return;
        if (result.error) throw new Error(result.error);

        setParsedData(formattedData);
        setFatherMatches(result.fathers);
      } catch (err) {
        console.error(err);
        if (version === uploadVersion.current) {
          setError(err instanceof Error ? err.message : "解析文件失败，请确保文件格式正确");
        }
      } finally {
        if (version === uploadVersion.current) setIsLoading(false);
      }
    };
    reader.onerror = () => {
      if (version !== uploadVersion.current) return;
      setError("读取文件失败，请重新选择文件");
      setIsLoading(false);
    };
    reader.readAsBinaryString(file);
  };

  // 提交导入
  const handleImport = async () => {
    if (parsedData.length === 0) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await batchCreateFamilyMembers(parsedData);
      if (result.success) {
        alert(`成功导入 ${result.count} 条记录`);
        handleOpenChange(false);
        onSuccess?.();
      } else {
        setError(`导入失败: ${result.error}`);
        if (result.count > 0) {
          setParsedData([]);
          setFatherMatches([]);
          onSuccess?.();
        }
      }
    } catch {
      setError("导入请求失败，请核对成员列表后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          批量导入
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量导入成员</DialogTitle>
          <DialogDescription>
            请先下载模板，填写数据后上传。支持 Excel (.xlsx, .xls) 和 CSV 格式。
            父亲按姓名及上一世代匹配，可填写已有成员或同一文件中的成员。
            配偶关系不随文件导入，请在导入后于成员编辑中登记。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={handleDownloadTemplate} size="sm">
              <Download className="h-4 w-4 mr-2" />
              下载模板
            </Button>
            <div className="flex-1">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                disabled={isLoading}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>错误</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {parsedData.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <div className="bg-muted p-2 text-sm text-muted-foreground flex justify-between items-center">
                <span>预览 ({parsedData.length} 条记录)</span>
                {parsedData.some(m => m.father_name) && (
                  <span className="text-xs text-muted-foreground">
                    父亲关联已按姓名和世代检查
                  </span>
                )}
              </div>
              <div className="max-h-[300px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>姓名</TableHead>
                      <TableHead>世代</TableHead>
                      <TableHead>父亲姓名</TableHead>
                      <TableHead>性别</TableHead>
                      <TableHead>生日</TableHead>
                      <TableHead>居住地</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((member, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{member.name}</TableCell>
                        <TableCell>{member.generation}</TableCell>
                        <TableCell className={member.father_name ? "text-primary" : "text-muted-foreground"}>
                          {member.father_name || "-"}
                          {member.father_name && (
                            <div className="text-xs text-muted-foreground">
                              第 {member.generation! - 1} 世 · {fatherMatches[i]?.source === "existing" ? "已有成员" : "本次导入"}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{member.gender}</TableCell>
                        <TableCell>{formatDate(member.birthday)}</TableCell>
                        <TableCell>{member.residence_place || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={parsedData.length === 0 || isLoading}>
            {isLoading ? "处理中..." : "确认导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
