import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Search, ChevronLeft, ChevronRight, Loader2, Download } from "lucide-react";
import type { FamilyMember } from "./actions";
import {
  createFamilyMember,
  updateFamilyMember,
  deleteFamilyMembers,
  fetchAllMembersForSelect,
  fetchMemberById,
} from "./actions";
import { createMarriage, deleteMarriage, fetchMemberMarriages } from "@/lib/api/family";
import type { Marriage, MemberOption } from "@/lib/api/types";
import { SpouseEditor } from "./spouse-editor";
import { exportGEDCOM } from "@/lib/api/family";
import { ImportMembersDialog } from "./import-members-dialog";
import { GEDCOMImportDialog } from "./gedcom-import-dialog";
import { FatherCombobox } from "./father-combobox";
import { RichTextEditor } from "@/components/rich-text/editor";
import { RichTextViewer } from "@/components/rich-text/viewer";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar/calendar-context";
import { DateField } from "@/components/date-field";
import { MemberPhotoEditor } from "./member-photo-editor";

interface FamilyMembersTableProps {
  initialData: FamilyMember[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  searchQuery: string;
  onRefresh?: () => void;
}

export function FamilyMembersTable({
  initialData,
  totalCount,
  currentPage,
  pageSize,
  searchQuery,
  onRefresh,
}: FamilyMembersTableProps) {
  const navigate = useNavigate();
  const searchParams = useSearchParams();
  const { formatDate } = useCalendar();
  const [isPending, startTransition] = React.useTransition();

  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState(searchQuery);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoadingParents, setIsLoadingParents] = React.useState(false);
  const [parentLoadError, setParentLoadError] = React.useState<string | null>(null);
  const [loadingFatherId, setLoadingFatherId] = React.useState<number | null>(null);

  const [editingMember, setEditingMember] = React.useState<FamilyMember | null>(null);
  const [biographyMember, setBiographyMember] = React.useState<FamilyMember | null>(null);
  const [parentOptions, setParentOptions] = React.useState<MemberOption[]>([]);
  const [marriages, setMarriages] = React.useState<Marriage[]>([]);
  const [marriageError, setMarriageError] = React.useState<string | null>(null);
  const [draftSpouseIds, setDraftSpouseIds] = React.useState<number[]>([]);

  // 新增表单状态
  const [formData, setFormData] = React.useState({
    name: "",
    generation: "",
    sibling_order: "",
    father_id: "",
    gender: "",
    official_position: "",
    is_alive: true,
    remarks: "",
    birthday: "",
    death_date: "",
    residence_place: "",
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  // 判断是否为编辑模式
  const isEditMode = editingMember !== null;

  // 打开弹窗时加载成员选项（父亲 / 配偶下拉共用）。
  // 已有选项时直接复用，避免每次打开都清空并重新请求——那会让下拉先空白再跳动。
  React.useEffect(() => {
    if (!isDialogOpen) return;
    if (parentOptions.length > 0 && !parentLoadError) return;
    let cancelled = false;
    setIsLoadingParents(true);
    setParentLoadError(null);
    fetchAllMembersForSelect()
      .then(({ data, error }) => {
        if (cancelled) return;
        setParentOptions(error ? [] : data);
        setParentLoadError(error);
      })
      .catch(() => {
        if (cancelled) return;
        setParentOptions([]);
        setParentLoadError("父亲列表加载失败，请关闭后重新打开弹窗重试");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingParents(false);
      });
    return () => { cancelled = true; };
  }, [isDialogOpen, parentOptions.length, parentLoadError]);

  const updateUrlParams = (params: Record<string, string>) => {
    startTransition(() => {
      const newParams = new URLSearchParams(searchParams.toString());
      Object.entries(params).forEach(([key, value]) => {
        if (value) {
          newParams.set(key, value);
        } else {
          newParams.delete(key);
        }
      });
      navigate(`/family-tree?${newParams.toString()}`);
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrlParams({ search: searchInput, page: "1" });
  };

  const handlePageChange = (newPage: number) => {
    updateUrlParams({ page: newPage.toString() });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(initialData.map((m) => m.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedIds(newSet);
  };

  const handleExportGEDCOM = async () => {
    setIsExporting(true);
    try {
      const result = await exportGEDCOM();
      if (result.error) alert(`导出失败：${result.error}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;

    const confirmed = window.confirm(
      `确定要删除选中的 ${selectedIds.size} 条记录吗？`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    const result = await deleteFamilyMembers(Array.from(selectedIds));
    setIsDeleting(false);

    if (result.success) {
      setSelectedIds(new Set());
      onRefresh?.();
    } else {
      alert(`删除失败: ${result.error}`);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      generation: "",
      sibling_order: "",
      father_id: "",
      gender: "",
      official_position: "",
      is_alive: true,
      remarks: "",
      birthday: "",
      death_date: "",
      residence_place: "",
    });
    setEditingMember(null);
    setDraftSpouseIds([]);
    setMarriageError(null);
  };

  // 打开新增弹窗
  const handleOpenAddDialog = () => {
    resetForm();
    setMarriages([]);
    setMarriageError(null);
    setDraftSpouseIds([]);
    setIsDialogOpen(true);
  };

  // 打开编辑弹窗
  const handleOpenEditDialog = (member: FamilyMember) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      generation: member.generation?.toString() ?? "",
      sibling_order: member.sibling_order?.toString() ?? "",
      father_id: member.father_id?.toString() ?? "null",
      gender: member.gender ?? "",
      official_position: member.official_position ?? "",
      is_alive: member.is_alive,
      remarks: member.remarks ?? "",
      birthday: member.birthday ?? "",
      death_date: member.death_date ?? "",
      residence_place: member.residence_place ?? "",
    });
    setDraftSpouseIds([]);
    setMarriageError(null);
    setMarriages([]);
    fetchMemberMarriages(member.id).then((result) => {
      setMarriages(result.data);
      setMarriageError(result.error);
    });
    setIsDialogOpen(true);
  };

  // 关闭弹窗
  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    resetForm();
  };

  const handleSubmitMember = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert("请输入姓名");
      return;
    }

    setIsSubmitting(true);

    const memberData = {
      name: formData.name.trim(),
      generation: formData.generation ? parseInt(formData.generation) : null,
      sibling_order: formData.sibling_order
        ? parseInt(formData.sibling_order)
        : null,
      father_id: (formData.father_id && formData.father_id !== "null") 
        ? parseInt(formData.father_id) 
        : null,
      gender: (formData.gender as "男" | "女") || null,
      official_position: formData.official_position || null,
      is_alive: formData.is_alive,
      remarks: formData.remarks || null,
      birthday: formData.birthday || null,
      death_date: (!formData.is_alive && formData.death_date) ? formData.death_date : null,
      residence_place: formData.residence_place || null,
    };

    // 新增成员时把草稿配偶一起提交；编辑模式由配偶编辑器单独维护，避免误清。
    const result = isEditMode && editingMember
      ? await updateFamilyMember({ ...memberData, id: editingMember.id })
      : await createFamilyMember(
          draftSpouseIds.length > 0 ? { ...memberData, spouse_ids: draftSpouseIds } : memberData,
        );

    setIsSubmitting(false);

    if (result.success) {
      handleCloseDialog();
      onRefresh?.();
    } else {
      alert(`${isEditMode ? "更新" : "添加"}失败: ${result.error}`);
    }
  };

  const allSelected =
    initialData.length > 0 && selectedIds.size === initialData.length;

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        {/* 搜索 */}
        <form onSubmit={handleSearch} className="flex w-full gap-2 lg:w-auto">
          <Input
            placeholder="搜索姓名..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full sm:w-64"
          />
          <Button type="submit" variant="outline" size="icon" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        {/* 操作按钮：窄屏两列均分，宽屏一行铺开 */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:w-auto">
          <ImportMembersDialog onSuccess={() => onRefresh?.()} />

          <GEDCOMImportDialog memberCount={totalCount} onSuccess={() => onRefresh?.()} />

          <Button variant="outline" onClick={handleExportGEDCOM} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            <span className="truncate">导出 GEDCOM</span>
          </Button>

          <Button onClick={handleOpenAddDialog}>
            <Plus className="h-4 w-4 mr-2" />
            新增
          </Button>

          <Button
            variant="destructive"
            className="col-span-2 sm:col-span-1"
            onClick={handleDelete}
            disabled={selectedIds.size === 0 || isDeleting}
          >
            {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            删除 {selectedIds.size > 0 && `(${selectedIds.size})`}
          </Button>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent 
          // 关闭默认的居中缩放动画，由下面的 className 按断点完整指定。
          defaultAnimation={false}
          className={cn(
            // ---- 定位 ----
            // 注意：不要用 translate 居中——tailwindcss-animate 的 @keyframes
            // 会整体覆盖 transform，居中在动画期间失效，弹窗会从右下角开始。
            // 基础组件用的是 `inset-0 + mx-auto/my-auto`，这里只覆盖尺寸与贴边。
            //
            // 移动端：贴底全宽 + 顶部圆角（抽屉观感），内容区自行滚动，
            // 避免小屏被软键盘顶出视野。
            // `mt-auto`（而非 transform）把弹窗推到底部，动画不会影响它。
            "mb-0 mt-auto max-h-[92svh] w-full max-w-full rounded-b-none rounded-t-xl p-0",
            // flex 列布局 + 内部滚动：h-fit 会依据内容收缩，
            // 内容超长时受 max-h 约束，由里面的 overflow-y-auto 接管滚动。
            "flex flex-col gap-0 overflow-hidden",
            // 桌面端：恢复垂直居中与固定宽度（水平居中由基础组件负责）。
            "sm:mb-auto sm:mt-auto sm:max-h-[90vh] sm:max-w-[640px] sm:rounded-lg",

            // ---- 动画 ----
            // 移动端：从底部滑入 / 滑出，类似抽屉。
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            // 桌面端：从中间放大出现、缩小消失。
            "sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
            // 抽屉滑动稍慢一些，观感更接近原生 bottom sheet；
            // 桌面端收紧到 200ms。基础组件已带 duration-200，这里按断点覆盖。
            "duration-300 sm:duration-200",
          )}
          onInteractOutside={(e) => e.preventDefault()}
          // 不要用 preventDefault() 阻止自动聚焦：
          // 那会把焦点留在触发按钮（位于 #root 内），而 Radix 会给 #root 设
          // aria-hidden，浏览器随即报
          // "Blocked aria-hidden on an element because its descendant retained focus"。
          // 改为聚焦弹窗容器本身：焦点进入弹窗（不再报警），
          // 同时避免一打开就跳到第一个输入框。
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            // 焦点必须**进入弹窗**，否则留在 #root 里的触发按钮上，
            // Radix 给 #root 设 aria-hidden 时就会报
            // "Blocked aria-hidden ... descendant retained focus"。
            //
            // currentTarget 是 FocusScope 的容器（带 tabIndex=-1），可直接聚焦；
            // 若它不可聚焦，退回到第一个可聚焦子元素。
            const container = event.currentTarget as HTMLElement | null;
            if (!container) return;
            container.focus({ preventScroll: true });
            if (document.activeElement === container) return;
            container
              .querySelector<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
              )
              ?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="border-b px-4 py-3 pr-12 sm:px-6 sm:py-4">
            <DialogTitle>{isEditMode ? "编辑成员" : "新增成员"}</DialogTitle>
            <DialogDescription>
              填写成员信息后点击保存
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmitMember} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="space-y-6">
                <FormSection title="基本信息">
                  <FormField label="姓名" htmlFor="name" required>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </FormField>

                  <FormField label="性别" htmlFor="gender">
                    <Select
                      value={formData.gender}
                      onValueChange={(value) =>
                        setFormData({ ...formData, gender: value })
                      }
                    >
                      <SelectTrigger id="gender" className="w-full">
                        <SelectValue placeholder="选择性别" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="男">男</SelectItem>
                        <SelectItem value="女">女</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="父亲" className="sm:col-span-2">
                    <FatherCombobox
                      value={formData.father_id}
                      options={parentOptions}
                      isLoading={isLoadingParents}
                      disabled={!!parentLoadError}
                      onChange={(value) => {
                        const father = parentOptions.find(p => p.id.toString() === value);
                        const newGeneration = father && father.generation !== null 
                          ? (father.generation + 1).toString() 
                          : (value === "null" ? "" : formData.generation);
                        setFormData({ 
                          ...formData, 
                          father_id: value, 
                          generation: newGeneration 
                        });
                      }}
                    />
                    {parentLoadError ? (
                      <p role="alert" className="text-sm text-destructive">加载数据失败：{parentLoadError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        选定父亲后会自动推算世代
                      </p>
                    )}
                  </FormField>

                  <FormField label="世代" htmlFor="generation">
                    <Input
                      id="generation"
                      type="number"
                      value={formData.generation}
                      onChange={(e) =>
                        setFormData({ ...formData, generation: e.target.value })
                      }
                      disabled={!!formData.father_id && formData.father_id !== "null"}
                    />
                  </FormField>

                  <FormField label="排行" htmlFor="sibling_order">
                    <Input
                      id="sibling_order"
                      type="number"
                      value={formData.sibling_order}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          sibling_order: e.target.value,
                        })
                      }
                    />
                  </FormField>

                  <FormField label="官职 / 头衔" htmlFor="official_position" className="sm:col-span-2">
                    <Input
                      id="official_position"
                      value={formData.official_position}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          official_position: e.target.value,
                        })
                      }
                    />
                  </FormField>
                </FormSection>

                <FormSection title="照片">
                  <div className="sm:col-span-2">
                    <MemberPhotoEditor memberId={editingMember?.id ?? null} />
                  </div>
                </FormSection>

                <FormSection title="生卒与居所">
                  <FormField label="是否在世" htmlFor="is_alive" className="sm:col-span-2">
                    <div className="flex h-9 items-center space-x-2">
                      <Checkbox
                        id="is_alive"
                        checked={formData.is_alive}
                        onCheckedChange={(checked) =>
                          setFormData({
                            ...formData,
                            is_alive: checked as boolean,
                          })
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {formData.is_alive ? "在世" : "已故，可填写卒年"}
                      </span>
                    </div>
                  </FormField>

                  <FormField label="生日" htmlFor="birthday" className="sm:col-span-2">
                    <DateField
                      id="birthday"
                      value={formData.birthday}
                      onChange={(next) => setFormData({ ...formData, birthday: next })}
                    />
                  </FormField>

                  {!formData.is_alive && (
                    <FormField label="卒年" htmlFor="death_date" className="sm:col-span-2">
                      <DateField
                        id="death_date"
                        value={formData.death_date}
                        onChange={(next) => setFormData({ ...formData, death_date: next })}
                      />
                    </FormField>
                  )}

                  <FormField label="居住地" htmlFor="residence_place" className="sm:col-span-2">
                    <Input
                      id="residence_place"
                      value={formData.residence_place}
                      onChange={(e) =>
                        setFormData({ ...formData, residence_place: e.target.value })
                      }
                    />
                  </FormField>
                </FormSection>

                <FormSection title="配偶关系">
                  <div className="sm:col-span-2 space-y-2">
                    <SpouseEditor
                      memberId={editingMember?.id ?? null}
                      gender={(formData.gender as "男" | "女") || null}
                      options={parentOptions}
                      isLoadingOptions={isLoadingParents}
                      marriages={marriages}
                      draftSpouseIds={draftSpouseIds}
                      onDraftSpouseIdsChange={setDraftSpouseIds}
                      error={marriageError}
                      onCreateMarriage={async (input) => {
                        const result = await createMarriage(input);
                        if (result.error) return result.error;
                        const refreshed = await fetchMemberMarriages(editingMember!.id);
                        setMarriages(refreshed.data);
                        setMarriageError(refreshed.error);
                        return null;
                      }}
                      onDeleteMarriage={async (id) => {
                        const result = await deleteMarriage(id);
                        if (result.error) return result.error;
                        setMarriages((current) => current.filter((item) => item.id !== id));
                        return null;
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      配偶需先登记为成员才能关联。
                    </p>
                  </div>
                </FormSection>

                <FormSection title="生平事迹">
                  <div className="sm:col-span-2">
                    <RichTextEditor
                      value={formData.remarks}
                      onChange={(value) =>
                        setFormData({ ...formData, remarks: value })
                      }
                      maxLength={500}
                    />
                  </div>
                </FormSection>
              </div>
            </div>
            
            <DialogFooter className="mt-auto border-t px-4 py-3 sm:px-6 sm:py-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseDialog}
              >
                取消
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSubmitting ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 表格：宽屏表格视图 / 窄屏卡片视图，共用同一份数据与选中态 */}
      <div className={cn("transition-opacity duration-200", isPending && "opacity-60 pointer-events-none")}>
        <div className="hidden md:block border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead>姓名</TableHead>
              <TableHead className="w-20">世代</TableHead>
              <TableHead className="w-20">排行</TableHead>
              <TableHead className="w-24">父亲</TableHead>
              <TableHead className="w-16">性别</TableHead>
              <TableHead>生日</TableHead>
              <TableHead>卒年</TableHead>
              <TableHead>居住地</TableHead>
              <TableHead className="w-20">在世</TableHead>
              <TableHead>配偶</TableHead>
              <TableHead>生平事迹</TableHead>
              <TableHead className="w-44">更新时间（北京时间）</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="h-24 text-center">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              initialData.map((member) => (
                <TableRow
                  key={member.id}
                  data-state={selectedIds.has(member.id) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(member.id)}
                      onCheckedChange={(checked) =>
                        handleSelectOne(member.id, checked as boolean)
                      }
                      aria-label={`选择 ${member.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      onClick={() => handleOpenEditDialog(member)}
                      className="text-primary hover:underline cursor-pointer text-left"
                    >
                      {member.name}
                    </button>
                  </TableCell>
                  <TableCell>{member.generation ?? "-"}</TableCell>
                  <TableCell>{member.sibling_order ?? "-"}</TableCell>
                  <TableCell>
                    {member.father_id && member.father_name ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={loadingFatherId === member.father_id}
                          onClick={async () => {
                            if (!member.father_id) return;
                            setLoadingFatherId(member.father_id);
                            try {
                              const fatherData = await fetchMemberById(member.father_id);
                              if (fatherData) {
                                handleOpenEditDialog(fatherData);
                              }
                            } finally {
                              setLoadingFatherId(null);
                            }
                          }}
                          className={cn(
                            "text-primary hover:underline cursor-pointer text-left",
                            loadingFatherId === member.father_id && "opacity-70 cursor-wait"
                          )}
                        >
                          {member.father_name}
                        </button>
                        {loadingFatherId === member.father_id && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>{member.gender ?? "-"}</TableCell>
                  <TableCell>{formatDate(member.birthday)}</TableCell>
                  <TableCell>{formatDate(member.death_date)}</TableCell>
                  <TableCell>{member.residence_place ?? "-"}</TableCell>
                  <TableCell>{member.is_alive ? "是" : "否"}</TableCell>
                  <TableCell>{formatSpouses(member)}</TableCell>
                  <TableCell>
                    {member.remarks ? (
                      <Button 
                        variant="link" 
                        size="sm" 
                        className="h-auto p-0" 
                        onClick={() => setBiographyMember(member)}
                      >
                        查看
                      </Button>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(member.updated_at).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>

        {/* 窄屏卡片视图：避免横向滚动查表 */}
        <div className="md:hidden space-y-2">
          {initialData.length === 0 ? (
            <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="全选"
                />
                <span className="text-sm text-muted-foreground">
                  全选本页（{initialData.length} 条）
                </span>
              </div>
              {initialData.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  selected={selectedIds.has(member.id)}
                  onSelect={(checked) => handleSelectOne(member.id, checked)}
                  onOpen={() => handleOpenEditDialog(member)}
                  onOpenFather={
                    member.father_id && member.father_name
                      ? async () => {
                          if (!member.father_id) return;
                          setLoadingFatherId(member.father_id);
                          try {
                            const fatherData = await fetchMemberById(member.father_id);
                            if (fatherData) handleOpenEditDialog(fatherData);
                          } finally {
                            setLoadingFatherId(null);
                          }
                        }
                      : undefined
                  }
                  isLoadingFather={loadingFatherId === member.father_id}
                  formatDate={formatDate}
                  onOpenBiography={
                    member.remarks ? () => setBiographyMember(member) : undefined
                  }
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          共 {totalCount} 条 · {currentPage}/{totalPages || 1} 页
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1 || isPending}
            aria-label="上一页"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">上一页</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages || isPending}
            aria-label="下一页"
          >
            <span className="hidden sm:inline">下一页</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 生平事迹查看弹窗 */}
      <Dialog open={!!biographyMember} onOpenChange={(open) => !open && setBiographyMember(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{biographyMember?.name} 的生平事迹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
             <RichTextViewer value={biographyMember?.remarks ?? null} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const MARRIAGE_STATUS_LABELS: Record<string, string> = {
  married: "",
  divorced: "（离异）",
  widowed: "（丧偶）",
};

/** 列表单元格：只展示已登记的配偶，未登记时显示占位。 */
function formatSpouses(member: FamilyMember): string {
  const linked = (member.spouses ?? []).map(
    (spouse) => `${spouse.name}${MARRIAGE_STATUS_LABELS[spouse.status] ?? ""}`,
  );
  return linked.length > 0 ? linked.join("、") : "-";
}

/** 窄屏成员卡片：把表格的一行折叠成一张卡片，避免横向滚动。 */
function MemberCard({
  member,
  selected,
  onSelect,
  onOpen,
  onOpenFather,
  isLoadingFather,
  formatDate,
  onOpenBiography,
}: {
  member: FamilyMember;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onOpenFather?: () => void;
  isLoadingFather: boolean;
  formatDate: (iso: string | null | undefined, fallback?: string) => string;
  onOpenBiography?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2",
        selected && "bg-muted/50 border-primary/40",
      )}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked as boolean)}
          aria-label={`选择 ${member.name}`}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="text-left font-medium text-primary hover:underline"
          >
            {member.name}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {member.gender && <span>{member.gender}</span>}
            {member.generation !== null && <span>第{member.generation}世</span>}
            {member.sibling_order !== null && <span>行{member.sibling_order}</span>}
            <span>{member.is_alive ? "在世" : "已故"}</span>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">父亲</dt>
          <dd className="truncate">
            {onOpenFather && member.father_name ? (
              <button
                type="button"
                disabled={isLoadingFather}
                onClick={onOpenFather}
                className={cn(
                  "text-primary hover:underline",
                  isLoadingFather && "opacity-70 cursor-wait",
                )}
              >
                {member.father_name}
              </button>
            ) : (
              "-"
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">配偶</dt>
          <dd className="truncate">{formatSpouses(member)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">生辰</dt>
          <dd className="truncate">{formatDate(member.birthday)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">卒年</dt>
          <dd className="truncate">{formatDate(member.death_date)}</dd>
        </div>
        <div className="min-w-0 col-span-2">
          <dt className="text-muted-foreground">居住地</dt>
          <dd className="truncate">{member.residence_place || "-"}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="text-[11px] text-muted-foreground">
          {new Date(member.updated_at).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          })}
        </span>
        {onOpenBiography && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onOpenBiography}>
            查看生平
          </Button>
        )}
      </div>
    </div>
  );
}

/** 表单分区：标题 + 响应式两列栅格。 */function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** 表单字段：标签在上、控件在下，避免长标签挤压输入框。 */
function FormField({
  label,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
