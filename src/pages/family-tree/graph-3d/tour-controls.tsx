import { FamilyMemberNode } from "../graph/actions";
import { Button } from "@/components/ui/button";
import { Pause, Play, Square, MapPin } from "lucide-react";
import { Progress } from "@/components/ui/progress"; // Assuming shadcn progress exists, if not I'll handle it
import { Card } from "@/components/ui/card";

interface TourControlsProps {
  currentStep: number;
  totalSteps: number;
  currentMember: FamilyMemberNode | null;
  nextMember: FamilyMemberNode | null;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function TourControls({
  currentStep,
  totalSteps,
  currentMember,
  nextMember,
  isPaused,
  onPause,
  onResume,
  onStop,
}: TourControlsProps) {
  const progress = Math.min(100, (currentStep / Math.max(1, totalSteps - 1)) * 100);

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[90%] max-w-md">
      <Card className="p-4 shadow-xl border-primary/20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span>自动巡游中...</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {currentStep + 1} / {totalSteps}
            </span>
          </div>

          <div className="space-y-1">
            <div className="text-sm">
              <span className="text-muted-foreground">当前位置: </span>
              <span className="font-medium">{currentMember?.name}</span>
            </div>
            {nextMember && (
              <div className="text-xs text-muted-foreground">
                前往: {nextMember.name}
              </div>
            )}
          </div>

          {/* Simple Progress Bar if component not available, otherwise use UI component */}
          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-in-out" 
              style={{ width: `${progress}%` }} 
            />
          </div>

          <div className="flex justify-center gap-4 mt-1">
            {isPaused ? (
              <Button size="sm" onClick={onResume} className="w-24">
                <Play className="h-4 w-4 mr-2" /> 继续
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onPause} className="w-24">
                <Pause className="h-4 w-4 mr-2" /> 暂停
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={onStop} className="w-24">
              <Square className="h-4 w-4 mr-2" /> 结束
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
