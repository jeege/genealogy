const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/**
 * 把世代数字转换为中文数字，用于「第 X 世」标尺。
 * 族谱通常不超过几十代，覆盖 1-99 即可，超出时回退为阿拉伯数字。
 */
export function toChineseNum(num: number): string {
  if (!Number.isInteger(num) || num < 0) return num.toString();
  if (num === 0) return CHINESE_DIGITS[0];
  if (num < 10) return CHINESE_DIGITS[num];
  if (num < 20) {
    return "十" + (num % 10 !== 0 ? CHINESE_DIGITS[num % 10] : "");
  }
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return CHINESE_DIGITS[tens] + "十" + (ones !== 0 ? CHINESE_DIGITS[ones] : "");
  }
  return num.toString();
}
