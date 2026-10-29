import * as React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteMemberPhoto,
  fetchMemberPhotos,
  uploadMemberPhotos,
} from "@/lib/api/family";
import type { MemberPhoto } from "@/lib/api/types";

interface MemberPhotoEditorProps {
  /** 当前编辑的成员 ID；新增成员时为 null，此时提示先保存。 */
  memberId: number | null;
  /** 外部（如保存成功）触发的刷新信号。 */
  refreshToken?: number;
  className?: string;
}

/** 把字节数格式化成便于阅读的单位。 */
function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 成员照片管理：多图上传、缩略图预览、删除。
 *
 * 上传与删除都即时生效（不随表单提交），因为照片文件较大且独立于成员字段，
 * 混在「保存」里会让失败场景变得难以回滚。新增成员时需要先保存成员再传图。
 */
export function MemberPhotoEditor({ memberId, refreshToken, className }: MemberPhotoEditorProps) {
  const [photos, setPhotos] = React.useState<MemberPhoto[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (memberId === null) {
      setPhotos([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetchMemberPhotos(memberId)
      .then((result) => {
        if (cancelled) return;
        setPhotos(result.data);
        setError(result.error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, refreshToken]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || memberId === null) return;
    setIsUploading(true);
    setError(null);
    const result = await uploadMemberPhotos(memberId, Array.from(files));
    setIsUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPhotos((current) => [...current, ...result.data]);
    // 清空 input，允许重复选择同一个文件。
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDelete = async (photo: MemberPhoto) => {
    if (!window.confirm("确定删除这张照片吗？")) return;
    setError(null);
    const result = await deleteMemberPhoto(photo.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
  };

  if (memberId === null) {
    return (
      <p className="text-sm text-muted-foreground">保存成员后即可上传照片。</p>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading || isLoading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-2 h-4 w-4" />
          )}
          {isUploading ? "上传中..." : "添加照片"}
        </Button>
        <span className="text-xs text-muted-foreground">
          支持 JPEG / PNG / GIF / WebP，可一次选择多张
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载照片...
        </div>
      ) : photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚未上传照片。</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((photo) => (
            <li key={photo.id} className="group relative">
              <img
                src={photo.thumbnail_url}
                alt={photo.caption ?? "成员照片"}
                width={photo.width || undefined}
                height={photo.height || undefined}
                loading="lazy"
                className="aspect-square w-full rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => void handleDelete(photo)}
                aria-label="删除照片"
                title="删除照片"
                className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-destructive opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {photo.byte_size > 0 && (
                <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 text-[10px] text-muted-foreground">
                  {formatBytes(photo.byte_size)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
