import { Suspense, lazy, useRef, useState, useMemo, useCallback, useEffect } from "react";
import { FamilyMemberNode } from "../graph/actions";
import { getFamilyLinks, getSpouseLinks } from "../graph/family-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  RotateCcw,
  Maximize,
  Minimize,
  User,
  X,
  Map,
} from "lucide-react";
import SpriteText from "three-spritetext";
import { useTheme } from "@/components/theme-provider";
import { MemberDetailDialog } from "../member-detail-dialog";
import { TourDialog } from "./tour-dialog";
import { TourControls } from "./tour-controls";

// 3D 依赖体积较大，按需加载以缩短首屏时间。
const ForceGraph3D = lazy(() => import("react-force-graph-3d"));

function ForceGraphLoading() {
  return (
    <div className="flex items-center justify-center h-full bg-muted/10">
      <div className="text-muted-foreground animate-pulse">加载 3D 视图中...</div>
    </div>
  );
}

interface ForceGraphProps {
  data: FamilyMemberNode[];
}

interface GraphNode extends FamilyMemberNode {
  x?: number;
  y?: number;
  z?: number;
  group?: number;
  // Index signature to satisfy react-force-graph types
  [key: string]: any;
}

export function FamilyForceGraph({ data }: ForceGraphProps) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [instanceKey, setInstanceKey] = useState<string>("");

  useEffect(() => {
    setMounted(true);
    setInstanceKey(Math.random().toString(36).substring(7));
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<FamilyMemberNode | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Tour State
  const [isTourDialogOpen, setIsTourDialogOpen] = useState(false);
  const [tourPath, setTourPath] = useState<FamilyMemberNode[]>([]);
  const [currentTourStep, setCurrentTourStep] = useState(0);
  const [isTourActive, setIsTourActive] = useState(false);
  const [isTourPaused, setIsTourPaused] = useState(false);
  const tourTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 监听容器大小变化
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    // 添加 resize 监听之前先执行一次，确保初始有值
    
    window.addEventListener("resize", updateDimensions);
    // 稍微延迟一下再次检查，防止初始渲染时容器未撑开
    const timer = setTimeout(updateDimensions, 100);

    return () => {
      window.removeEventListener("resize", updateDimensions);
      clearTimeout(timer);
    };
  }, []);

  // 转换数据为 graph 格式
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = data.map((member) => ({
      ...member,
      // 根据代数计算颜色分组，或者其他逻辑
      group: member.generation || 0,
    }));

    // 父子连线用实线，配偶连线用虚线并拉近，避免配偶成为孤立的漂浮节点。
    const parentLinks = getFamilyLinks(data).map((link) => ({ ...link, kind: "parent" as const }));
    const spouseLinks = getSpouseLinks(data).map((link) => ({ ...link, kind: "spouse" as const }));

    return { nodes, links: [...parentLinks, ...spouseLinks] };
  }, [data]);

  // Tour Logic
  const startTour = (path: FamilyMemberNode[]) => {
    setTourPath(path);
    setCurrentTourStep(0);
    setIsTourActive(true);
    setIsTourPaused(false);
    // Close detail dialog if open
    setIsDetailOpen(false);
  };

  const stopTour = () => {
    setIsTourActive(false);
    setIsTourPaused(false);
    setTourPath([]);
    setCurrentTourStep(0);
    setHighlightedId(null);
    if (tourTimeoutRef.current) {
      clearTimeout(tourTimeoutRef.current);
    }
  };

  const pauseTour = () => {
    setIsTourPaused(true);
    if (tourTimeoutRef.current) {
      clearTimeout(tourTimeoutRef.current);
    }
  };

  const resumeTour = () => {
    setIsTourPaused(false);
  };

  // Effect to handle tour progression
  useEffect(() => {
    if (!isTourActive || isTourPaused || !fgRef.current) return;

    if (currentTourStep >= tourPath.length) {
      stopTour();
      return;
    }

    const targetMember = tourPath[currentTourStep];
    // Find the node in the internal graph data to get current coordinates
    // Note: react-force-graph modifies the objects in graphData.nodes with x,y,z
    const node = graphData.nodes.find(n => n.id === targetMember.id);

    if (node && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
      setHighlightedId(node.id);

      // Calculate distance for camera
      const distance = 80;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);

      fgRef.current.cameraPosition(
        { 
          x: node.x * distRatio, 
          y: node.y * distRatio, 
          z: node.z * distRatio 
        },
        { x: node.x, y: node.y, z: node.z },
        2000 // Transition time (2s)
      );

      // Wait for transition + dwell time
      tourTimeoutRef.current = setTimeout(() => {
        setCurrentTourStep(prev => prev + 1);
      }, 3500); // 2000ms move + 1500ms dwell
    } else {
      // If node not found or coords missing, skip to next
      setCurrentTourStep(prev => prev + 1);
    }

    return () => {
      if (tourTimeoutRef.current) {
        clearTimeout(tourTimeoutRef.current);
      }
    };
  }, [isTourActive, isTourPaused, currentTourStep, tourPath, graphData.nodes]);


  // 搜索功能
  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;

    const foundNode = graphData.nodes.find((node) =>
      node.name.includes(searchQuery.trim())
    );

    if (foundNode && fgRef.current) {
      setHighlightedId(foundNode.id);
      
      // 移动相机视角到该节点
      const distance = 100;
      const distRatio = 1 + distance / Math.hypot(foundNode.x || 0, foundNode.y || 0, foundNode.z || 0);

      fgRef.current.cameraPosition(
        {
          x: (foundNode.x || 0) * distRatio,
          y: (foundNode.y || 0) * distRatio,
          z: (foundNode.z || 0) * distRatio,
        }, // new position
        { x: foundNode.x, y: foundNode.y, z: foundNode.z }, // lookAt
        3000 // ms transition duration
      );
    }
  }, [graphData, searchQuery]);

  const clearSearch = () => {
    setSearchQuery("");
    setHighlightedId(null);
  };

  // 重置视图
  const handleResetView = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 1000);
      setHighlightedId(null);
    }
  }, []);

  // 全屏切换
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error("Fullscreen error:", err);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 获取父亲姓名
  const getFatherName = (fatherId: number | null) => {
    if (!fatherId) return null;
    return data.find((m) => m.id === fatherId)?.name;
  };

  // 主题颜色配置
  const isDark = theme === "dark";
  const bgColor = isDark ? "#1c1917" : "#ffffff"; // background based on Stone theme
  const nodeTextColor = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
  const linkColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";

  if (!mounted) return null;

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full border rounded-lg overflow-hidden bg-background ${
        isFullscreen ? "h-screen border-0 rounded-none" : "h-[calc(100vh-140px)] min-h-[600px]"
      }`}
    >
      {/* 顶部工具栏 */}
      <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2 max-w-[80%]">
        <div className="flex items-center gap-1 bg-background/80 backdrop-blur-sm border rounded-md p-1 shadow-sm">
          <Input
            placeholder="搜索姓名..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="h-8 w-40 md:w-56 border-0 focus-visible:ring-0 bg-transparent"
          />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
          {searchQuery && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={clearSearch}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <Button size="icon" variant="secondary" onClick={handleResetView} title="重置视图">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="secondary" onClick={toggleFullscreen} title={isFullscreen ? "退出全屏" : "全屏"}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
        <Button 
          size="icon" 
          variant={isTourActive ? "default" : "secondary"} 
          onClick={() => setIsTourDialogOpen(true)} 
          title="自动巡游"
          className={isTourActive ? "animate-pulse" : ""}
        >
          <Map className="h-4 w-4" />
        </Button>
      </div>

      {/* 3D 图表 */}
      {dimensions.width > 0 && instanceKey && (
        <Suspense fallback={<ForceGraphLoading />}>
        <ForceGraph3D
          key={instanceKey}
          ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        backgroundColor={bgColor}
        nodeLabel="name"
        nodeAutoColorBy="generation" // 按代数着色
        nodeRelSize={6}
        linkOpacity={0.35}
        // 父子连线用主题文字色，配偶连线用琥珀色虚线以示区分。
        linkColor={(link: any) => (link?.kind === "spouse" ? "rgba(245,158,11,0.55)" : linkColor)}
        linkWidth={(link: any) => (link?.kind === "spouse" ? 1.5 : 1)}
        // 父子与配偶连线都有方向粒子；配偶线用琥珀色粒子与线色一致。
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={(link: any) =>
          link?.kind === "spouse" ? "rgba(245,158,11,0.9)" : linkColor
        }
        
        // 节点文字渲染
        nodeThreeObjectExtend={true}
        nodeThreeObject={(node: any) => {
          const sprite = new SpriteText(node.name);
          sprite.color = node.id === highlightedId ? "#ff0000" : nodeTextColor;
          sprite.textHeight = 6;
          sprite.padding = 2;
          sprite.backgroundColor = isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
          sprite.borderRadius = 4;
          sprite.position.y = 12; // 显示在节点上方
          return sprite;
        }}
        
        // 点击事件
        onNodeClick={(node: any) => {
          if (isTourActive) return; // Disable manual click during tour
          setSelectedMember(node);
          setIsDetailOpen(true);
          
          // 聚焦点击的节点
          const distance = 80;
          const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
          fgRef.current?.cameraPosition(
            { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
            { x: node.x, y: node.y, z: node.z },
            1500
          );
        }}
        />
        </Suspense>
      )}

      {/* Tour UI Components */}
      <TourDialog
        isOpen={isTourDialogOpen}
        onOpenChange={setIsTourDialogOpen}
        members={data}
        onStartTour={startTour}
      />

      {isTourActive && (
        <TourControls
          currentStep={currentTourStep}
          totalSteps={tourPath.length}
          currentMember={tourPath[currentTourStep]}
          nextMember={tourPath[currentTourStep + 1] || null}
          isPaused={isTourPaused}
          onPause={pauseTour}
          onResume={resumeTour}
          onStop={stopTour}
        />
      )}

      <MemberDetailDialog
        isOpen={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        member={selectedMember}
        fatherName={getFatherName(selectedMember?.father_id || null)}
      />
    </div>
  );
}
