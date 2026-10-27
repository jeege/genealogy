import * as React from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Marriage, MarriageInput, MemberOption } from "@/lib/api/types";
import { marriagePartner, marriedPartnerIds } from "./marriage-partner";

const STATUS_LABELS: Record<string, string> = {
  married: "已婚",
  divorced: "离异",
  widowed: "丧偶",
};

interface SpouseEditorProps {
  /** 当前编辑的成员 ID；新增成员时为 null，此时只维护草稿。 */
  memberId: number | null;
  gender: "男" | "女" | null;
  options: MemberOption[];
  isLoadingOptions?: boolean;
  /** 已保存的婚姻记录（编辑模式）。 */
  marriages: Marriage[];
  /** 新增成员时暂存的配偶 ID。 */
  draftSpouseIds: number[];
  onDraftSpouseIdsChange: (ids: number[]) => void;
  error?: string | null;
  onCreateMarriage: (input: MarriageInput) => Promise<string | null>;
  onDeleteMarriage: (id: number) => Promise<string | null>;
}

/**
 * 配偶关系维护：
 * - 编辑已有成员时直接增删 `marriages` 记录；
 * - 新增成员时只暂存配偶 ID，随成员一起提交。
 */
export function SpouseEditor({
  memberId,
  gender,
  options,
  isLoadingOptions,
  marriages,
  draftSpouseIds,
  onDraftSpouseIdsChange,
  error,
  onCreateMarriage,
  onDeleteMarriage,
}: SpouseEditorProps) {
  const [selectedId, setSelectedId] = React.useState("");
  const [marriedOn, setMarriedOn] = React.useState("");
  const [status, setStatus] = React.useState<MarriageInput["status"]>("married");
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const savedPartnerIds = React.useMemo(
    () => new Set(memberId === null ? [] : marriedPartnerIds(marriages, memberId)),
    [marriages, memberId],
  );

  const candidates = React.useMemo(
    () =>
      options.filter((option) => {
        if (memberId !== null && option.id === memberId) return false;
        if (draftSpouseIds.includes(option.id) || savedPartnerIds.has(option.id)) return false;
        return true;
      }),
    [options, memberId, draftSpouseIds, savedPartnerIds],
  );

  const addDraft = () => {
    if (!selectedId) return;
    const id = Number(selectedId);
    if (!Number.isInteger(id) || draftSpouseIds.includes(id)) return;
    onDraftSpouseIdsChange([...draftSpouseIds, id]);
    setSelectedId("");
  };

  const submitMarriage = async () => {
    if (!selectedId) return;
    if (memberId === null) {
      addDraft();
      return;
    }
    const partnerId = Number(selectedId);
    const husbandId = gender === "女" ? partnerId : memberId;
    const wifeId = husbandId === memberId ? partnerId : memberId;
    setBusy(true);
    setLocalError(null);
    try {
      const message = await onCreateMarriage({
        husband_id: husbandId,
        wife_id: wifeId,
        status,
        married_on: marriedOn || null,
      });
      if (message) {
        setLocalError(message);
        return;
      }
      setSelectedId("");
      setMarriedOn("");
      setStatus("married");
    } finally {
      setBusy(false);
    }
  };

  const removeMarriage = async (id: number) => {
    setBusy(true);
    setLocalError(null);
    try {
      const message = await onDeleteMarriage(id);
      if (message) setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const partnerName = (optionId: number) =>
    options.find((option) => option.id === optionId)?.name ?? `#${optionId}`;

  const displayError = localError ?? error ?? null;

  return (
    <div className="space-y-3">
      {memberId !== null ? (
        marriages.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚未登记配偶。</p>
        ) : (
          <ul className="space-y-2">
            {marriages.map((marriage) => {
              // 相对当前成员取「对方」，避免以妻子身份查看时显示自己。
              const partner = marriagePartner(marriage, memberId!);
              const partnerId = partner.id;
              return (
                <li
                  key={marriage.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{partner.name ?? `#${partnerId}`}</span>
                  <span className="text-muted-foreground">
                    {STATUS_LABELS[marriage.status] ?? marriage.status}
                  </span>
                  {(marriage.married_on || marriage.married_on_raw) && (
                    <span className="text-xs text-muted-foreground">
                      结婚 {marriage.married_on_raw || marriage.married_on}
                    </span>
                  )}
                  {(marriage.divorced_on || marriage.divorced_on_raw) && (
                    <span className="text-xs text-muted-foreground">
                      离异 {marriage.divorced_on_raw || marriage.divorced_on}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-7 w-7 text-destructive"
                    disabled={busy}
                    onClick={() => removeMarriage(marriage.id)}
                    aria-label={`解除与${partner.name ?? "配偶"}的关系`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : draftSpouseIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">保存成员后可继续补充配偶。</p>
      ) : (
        <ul className="space-y-2">
          {draftSpouseIds.map((id) => (
            <li key={id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">{partnerName(id)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                onClick={() => onDraftSpouseIdsChange(draftSpouseIds.filter((item) => item !== id))}
                aria-label="移除"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={selectedId} onValueChange={setSelectedId} disabled={isLoadingOptions || busy}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={isLoadingOptions ? "加载成员..." : "选择配偶成员"} />
          </SelectTrigger>
          <SelectContent>
            {candidates.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">没有可选择的成员</div>
            ) : (
              candidates.map((option) => (
                <SelectItem key={option.id} value={String(option.id)}>
                  {option.name}
                  {option.generation !== null ? `（第${option.generation}世）` : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {memberId !== null && (
          <Select
            value={status ?? "married"}
            onValueChange={(value) => setStatus(value as MarriageInput["status"])}
            disabled={busy}
          >
            <SelectTrigger className="sm:w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="married">已婚</SelectItem>
              <SelectItem value="divorced">离异</SelectItem>
              <SelectItem value="widowed">丧偶</SelectItem>
            </SelectContent>
          </Select>
        )}
        {memberId !== null && (
          <Input
            type="date"
            value={marriedOn}
            onChange={(event) => setMarriedOn(event.target.value)}
            className="sm:w-40"
            aria-label="结婚日期"
            disabled={busy}
          />
        )}
        <Button type="button" variant="outline" onClick={submitMarriage} disabled={!selectedId || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1">添加</span>
        </Button>
      </div>

      {displayError && (
        <p role="alert" className={cn("text-sm text-destructive")}>
          {displayError}
        </p>
      )}
    </div>
  );
}
