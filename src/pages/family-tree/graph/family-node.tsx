import { Fragment, memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FamilyMemberNode } from "./actions";

export interface FamilyNodeData extends FamilyMemberNode {
  isHighlighted?: boolean;
  isPathHighlighted?: boolean; // 新增：是否在高亮路径上
  isDimmed?: boolean;          // 新增：是否需要变暗（非相关节点）
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: (id: number) => void;
  branchColor?: string;
  /** 与主成员合并渲染的配偶列表（支持多次婚姻）；非空时节点展示为多栏。 */
  partners?: FamilyMemberNode[];
  /** 节点渲染宽度，用于夫妻双栏排布。 */
  nodeWidth?: number;
  /** 点击配偶面板时回调（由父组件切换到该成员的详情）。 */
  onPartnerClick?: (member: FamilyMemberNode) => void;
  [key: string]: unknown;
}

export interface FamilyNodeProps {
  data: FamilyNodeData;
}

/** 性别/在世状态对应的边框与横条颜色。 */
function borderClass(member: FamilyMemberNode): string {
  if (member.gender === "男") {
    return member.is_alive
      ? "border-blue-400 dark:border-blue-500"
      : "border-blue-300/40 dark:border-blue-900/40";
  }
  if (member.gender === "女") {
    return member.is_alive
      ? "border-pink-400 dark:border-pink-500"
      : "border-pink-300/40 dark:border-pink-900/40";
  }
  return "border-border";
}

function barClass(member: FamilyMemberNode): string {
  if (member.gender === "男") {
    return member.is_alive ? "bg-blue-400 dark:bg-blue-500" : "bg-blue-300/40";
  }
  if (member.gender === "女") {
    return member.is_alive ? "bg-pink-400 dark:bg-pink-500" : "bg-pink-300/40";
  }
  return "bg-border";
}

function genderTextClass(member: FamilyMemberNode): string {
  if (member.gender === "男") {
    return member.is_alive ? "text-blue-600 dark:text-blue-400" : "text-blue-800/60 dark:text-blue-300/50";
  }
  return member.is_alive ? "text-pink-600 dark:text-pink-400" : "text-pink-800/60 dark:text-pink-300/50";
}

/** 单个成员的纵向信息块（姓名、世代、排行、性别、状态）。 */
function MemberBlock({
  member,
  compact,
  onSelect,
}: {
  member: FamilyMemberNode;
  compact?: boolean;
  onSelect?: () => void;
}) {
  const clickable = Boolean(onSelect);
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 w-full min-w-0",
        clickable && "cursor-pointer rounded-md hover:bg-accent/40 transition-colors",
        compact ? "px-1 py-0.5" : "px-2",
        // 在世状态按成员各自表达：夫妻节点里一方已故不应把另一方一起变灰。
        !member.is_alive && "rounded-md bg-muted/40 opacity-75 grayscale-[0.4]",
      )}
      onClick={
        clickable
          ? (event) => {
              // 阻止冒泡，避免同时触发整个合并节点的点击。
              event.stopPropagation();
              onSelect?.();
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onSelect?.();
              }
            }
          : undefined
      }
      title={member.name}
    >
      <div
        className={cn(
          "font-semibold text-center truncate w-full",
          compact ? "text-sm" : "text-base",
          !member.is_alive && "text-foreground/80",
        )}
      >
        {member.name}
      </div>
      <div className="flex items-center gap-1 flex-wrap justify-center">
        {member.generation !== null && (
          <Badge
            variant={member.is_alive ? "secondary" : "outline"}
            className={cn("text-[10px] px-1.5 py-0", !member.is_alive && "opacity-80")}
          >
            第{member.generation}世
          </Badge>
        )}
        {member.sibling_order !== null && (
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", !member.is_alive && "opacity-80")}>
            排行{member.sibling_order}
          </Badge>
        )}
      </div>
      {member.gender && (
        <span className={cn("text-xs", genderTextClass(member))}>{member.gender}</span>
      )}
      {!member.is_alive && <span className="text-xs text-muted-foreground/80 italic">已故</span>}
    </div>
  );
}

function FamilyMemberNodeComponent({ data }: FamilyNodeProps) {
  const nodeData = data as FamilyNodeData;
  const partners = nodeData.partners ?? [];
  const hasPartners = partners.length > 0;
  // 配偶关系只来自结构化婚姻；没有登记配偶时不显示。
  const spouseLabel =
    nodeData.spouses && nodeData.spouses.length > 0
      ? nodeData.spouses.map((spouse) => spouse.name).join("、")
      : null;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nodeData.onToggleCollapse) {
      nodeData.onToggleCollapse(nodeData.id);
    }
  };

  return (
    <div
      className={cn(
        "px-3 py-3 rounded-lg border-2 text-card-foreground shadow-md transition-all duration-300 relative group",
        !hasPartners && "min-w-[140px]",
        // 变暗模式 (当有高亮发生，但此节点不在路径上)
        nodeData.isDimmed && "opacity-30 grayscale scale-95 blur-[0.5px]",

        // 背景色：合并节点保持中性，已故观感由各自的成员块表达
        hasPartners || nodeData.is_alive ? "bg-card" : "bg-muted/50",

        // 边框颜色逻辑
        // 1. 当前选中高亮 -> 黄色光环 (最强)
        nodeData.isHighlighted
          ? "border-amber-500 ring-4 ring-amber-400/50 scale-110 z-50"
          // 2. 路径高亮 -> 金色边框 (次强)
          : nodeData.isPathHighlighted
            ? "border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.4)] z-10"
            // 3. 常规边框 -> 单成员按性别/状态；合并节点性别不一，用中性边框
            : hasPartners
              ? "border-border"
              : borderClass(nodeData),

        // 折叠时的强化样式 (仅在非变暗状态下显示)
        !nodeData.isDimmed && nodeData.collapsed && "border-primary shadow-lg",

        // 已故样式：只用于单成员节点，合并节点由各自的成员块表达
        !hasPartners && !nodeData.is_alive && !nodeData.isDimmed && "opacity-80 grayscale-[0.2]",

        // 悬浮提升感
        "hover:shadow-xl hover:-translate-y-0.5 transition-transform duration-300",

        // 折叠时的堆叠效果
        nodeData.collapsed && [
          "before:absolute before:inset-0 before:translate-x-1 before:translate-y-1 before:border-2 before:border-muted-foreground/20 before:rounded-lg before:-z-10",
          "after:absolute after:inset-0 after:translate-x-2 after:translate-y-2 after:border-2 after:border-muted-foreground/10 after:rounded-lg after:-z-20",
        ]
      )}
      style={nodeData.nodeWidth ? { width: nodeData.nodeWidth } : undefined}
    >
      {/* 顶部颜色横条：合并节点按栏位等分，分别反映各人的性别与在世状态 */}
      {hasPartners ? (
        <div className="absolute top-0 inset-x-0 h-1 rounded-t-[inherit] flex overflow-hidden">
          {[nodeData, ...partners].map((member, index) => (
            <div
              key={`${member.id}-${index}`}
              className={cn(
                "flex-1",
                nodeData.isHighlighted
                  ? "bg-amber-500"
                  : nodeData.isPathHighlighted
                    ? "bg-amber-400"
                    : barClass(member),
              )}
            />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "absolute top-0 inset-x-0 h-1 rounded-t-[inherit]",
            nodeData.isHighlighted
              ? "bg-amber-500"
              : nodeData.isPathHighlighted
                ? "bg-amber-400"
                : barClass(nodeData),
          )}
        />
      )}

      {/* 顶部连接点 - 连接到父亲 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />

      {/* 节点内容：有配偶时并排展示（支持多位），无配偶时单栏 */}
      {hasPartners ? (
        <div className="flex items-stretch gap-0 w-full">
          <div className="flex-1 min-w-0">
            <MemberBlock member={nodeData} />
          </div>
          {partners.map((partner) => (
            <Fragment key={partner.id}>
              {/* 连接符：独立一列夹在主成员与配偶之间，保证水平居中。
                  之前它包在配偶列内部，会贴在配偶一侧而非两者正中。 */}
              <div className="flex shrink-0 flex-col items-center justify-center px-1 select-none">
                <span aria-hidden className="w-px flex-1 bg-border" />
                <span className="my-1 text-[10px] text-muted-foreground/70 leading-none">配</span>
                <span aria-hidden className="w-px flex-1 bg-border" />
              </div>
              <div className="min-w-0 flex-1">
                <MemberBlock
                  member={partner}
                  compact
                  onSelect={
                    nodeData.onPartnerClick
                      ? () => nodeData.onPartnerClick!(partner)
                      : undefined
                  }
                />
              </div>
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 mb-1 w-full">
          <div
            className={cn(
              "font-semibold text-base text-center truncate w-full px-2",
              !nodeData.is_alive && "text-foreground/80",
            )}
            title={nodeData.name}
          >
            {nodeData.name}
          </div>

          {/* 配偶摘要：仅在未与配偶合并为同一节点时展示 */}
          {spouseLabel && (
            <div className="flex items-center justify-center gap-0.5 w-full -mt-0.5 mb-0.5">
              <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap select-none">配:</span>
              <span
                className="text-xs text-muted-foreground font-medium truncate max-w-[80%] text-center"
                title={spouseLabel}
              >
                {spouseLabel}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {nodeData.generation !== null && (
              <Badge
                variant={nodeData.is_alive ? "secondary" : "outline"}
                className={cn("text-xs", !nodeData.is_alive && "opacity-80")}
              >
                第{nodeData.generation}世
              </Badge>
            )}
            {nodeData.sibling_order !== null && (
              <Badge variant="outline" className={cn("text-xs", !nodeData.is_alive && "opacity-80")}>
                排行{nodeData.sibling_order}
              </Badge>
            )}
          </div>

          {nodeData.gender && (
            <span className={cn("text-xs", genderTextClass(nodeData))}>{nodeData.gender}</span>
          )}

          {!nodeData.is_alive && <span className="text-xs text-muted-foreground/80 italic">已故</span>}
        </div>
      )}

      {/* 底部连接点 - 仅当有子女时显示 */}
      {nodeData.hasChildren && (
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          className={cn(
            "!w-3 !h-3 !bg-primary !border-2 !border-background",
            nodeData.collapsed && "opacity-0",
          )}
        />
      )}

      {/* 折叠/展开按钮 */}
      {nodeData.hasChildren && (
        <button
          onClick={handleToggle}
          className={cn(
            "absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full border shadow-md flex items-center justify-center z-[60] transition-all duration-200 cursor-pointer",
            "hover:scale-125 active:scale-90",
            nodeData.collapsed
              ? "bg-primary border-primary text-primary-foreground hover:bg-primary/90"
              : "bg-background border-border hover:bg-muted",
          )}
        >
          {nodeData.collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

export const FamilyMemberNodeType = memo(FamilyMemberNodeComponent);
