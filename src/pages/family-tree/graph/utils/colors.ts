// 家族统一色调 (HSL 版本) - 象征家族长青，同根同源
// 核心色相：松柏绿 (避开性别的红蓝)

export interface HSLColor {
  h: number;
  s: number;
  l: number;
}

// 全族统一基准色：深沉的松柏绿
const UNIFIED_BASE_COLOR: HSLColor = { h: 145, s: 45, l: 30 };

/**
 * 获取支系的基础颜色对象
 * 统一返回家族基准色，不再区分房头颜色
 */
export function getBranchBaseColor(_index: number): HSLColor {
  return UNIFIED_BASE_COLOR;
}

/**
 * 生成 CSS HSL 字符串
 * @param base 基准色
 * @param generationOffset 世代偏移量
 * @returns 带有亮度梯度的 HSL 字符串
 */
export function generateBranchColor(base: HSLColor, generationOffset: number = 0): string {
  // 每一代增加 6% 的亮度，产生明显的上下级层次感
  const step = 6; 
  const maxLightness = 85;
  
  // 增加起始代数的亮度步进，让第一代（祖先）保持最深，之后快速产生区分
  const currentLightness = Math.min(base.l + (generationOffset * step), maxLightness);
  
  return `hsl(${base.h}, ${base.s}%, ${currentLightness}%)`;
}