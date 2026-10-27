import { memo } from "react";
import { cn } from "@/lib/utils";

export interface GenerationNodeData {
  generation: number;
  label: string;
}

export interface GenerationNodeProps {
  data: GenerationNodeData;
}

function GenerationNodeComponent({ data }: GenerationNodeProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-2 px-3",
        "pointer-events-none select-none", // 禁止交互
        "transition-opacity duration-300"
      )}
    >
      <div className="flex flex-col items-center gap-1 opacity-60">
        {/* 装饰顶线 */}
        <div className="w-px h-8 bg-gradient-to-b from-transparent to-border/50" />
        
        {/* 文字内容 - 竖排 */}
        <div className="writing-vertical-rl text-lg font-serif tracking-widest text-foreground/60 font-bold whitespace-nowrap">
          {data.label}
        </div>

        {/* 装饰底线 */}
        <div className="w-px h-8 bg-gradient-to-t from-transparent to-border/50" />
      </div>
      
      {/* 世代数字背景水印 (可选) */}
      <div className="absolute -z-10 text-6xl font-serif opacity-[0.03] select-none pointer-events-none font-black translate-x-2">
        {data.generation}
      </div>
    </div>
  );
}

export const GenerationNodeType = memo(GenerationNodeComponent);
