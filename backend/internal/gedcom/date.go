package gedcom

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

var monthAbbreviations = []string{
	"JAN", "FEB", "MAR", "APR", "MAY", "JUN",
	"JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
}

func monthIndex(token string) int {
	upper := strings.ToUpper(token)
	if len(upper) < 3 {
		return 0
	}
	prefix := upper[:3]
	for index, month := range monthAbbreviations {
		if month == prefix {
			return index + 1
		}
	}
	return 0
}

// parseSingleDate 解析单个日期表达式，返回 ISO 日期（仅日精度）与年份。
func parseSingleDate(expression string) (iso *string, year *int) {
	tokens := strings.Fields(expression)
	if len(tokens) == 0 {
		return nil, nil
	}
	var day, month int
	for _, token := range tokens {
		if value, err := strconv.Atoi(token); err == nil {
			if value >= 1 && value <= 31 && day == 0 && len(token) <= 2 {
				day = value
				continue
			}
			if len(token) >= 3 && len(token) <= 4 && value > 0 {
				years := value
				year = &years
			}
			continue
		}
		if index := monthIndex(token); index > 0 && month == 0 {
			month = index
		}
	}
	if year == nil || *year < 1 || *year > 9999 {
		return nil, nil
	}
	if day != 0 && month != 0 {
		value := fmt.Sprintf("%04d-%02d-%02d", *year, month, day)
		return &value, year
	}
	return nil, year
}

// ParseDate 解析 GEDCOM 日期表达式。原始文本始终保留，用于导出时还原精度。
// 支持 ABT/CAL/EST/BEF/AFT/FROM-TO/BET-AND/INT 与 @#DJULIAN@ 等日历转义。
func ParseDate(raw string) domain.GEDCOMDate {
	result := domain.GEDCOMDate{Raw: strings.TrimSpace(raw)}
	cleaned := result.Raw
	if cleaned == "" {
		return result
	}
	// 去掉日历转义（@#DGREGORIAN@、@#DJULIAN@ 等），按公历近似处理。
	for {
		start := strings.Index(cleaned, "@#D")
		if start < 0 {
			break
		}
		end := strings.Index(cleaned[start+1:], "@")
		if end < 0 {
			cleaned = cleaned[:start]
			break
		}
		cleaned = cleaned[:start] + cleaned[start+1+end+1:]
	}
	cleaned = strings.TrimSpace(cleaned)

	upper := strings.ToUpper(cleaned)
	switch {
	case strings.HasPrefix(upper, "BET "), strings.HasPrefix(upper, "FROM "):
		// 区间取起点，导出仍使用原始文本。
		body := strings.TrimSpace(cleaned[strings.Index(upper, " ")+1:])
		if index := strings.Index(strings.ToUpper(body), " AND "); index >= 0 {
			body = body[:index]
		}
		if index := strings.Index(strings.ToUpper(body), " TO "); index >= 0 {
			body = body[:index]
		}
		cleaned = strings.TrimSpace(body)
	case strings.HasPrefix(upper, "INT "):
		body := cleaned[4:]
		if index := strings.Index(body, "("); index >= 0 {
			body = body[:index]
		}
		cleaned = strings.TrimSpace(body)
	}
	for _, prefix := range []string{"ABT ", "CAL ", "EST ", "BEF ", "AFT "} {
		if strings.HasPrefix(strings.ToUpper(cleaned), prefix) {
			cleaned = strings.TrimSpace(cleaned[len(prefix):])
			break
		}
	}
	// 括号中的解释性文本（如 "(about 1850)"）不参与解析。
	if index := strings.Index(cleaned, "("); index >= 0 {
		cleaned = strings.TrimSpace(cleaned[:index])
	}

	result.ISO, result.Year = parseSingleDate(cleaned)
	return result
}

// FormatDate 将 ISO 日期格式化为 GEDCOM 日期（D MMM YYYY）。
func FormatDate(iso string) string {
	parts := strings.Split(iso, "-")
	if len(parts) != 3 {
		return iso
	}
	year, err := strconv.Atoi(parts[0])
	if err != nil {
		return iso
	}
	month, err := strconv.Atoi(parts[1])
	if err != nil || month < 1 || month > 12 {
		return iso
	}
	day, err := strconv.Atoi(parts[2])
	if err != nil || day < 1 || day > 31 {
		return iso
	}
	return fmt.Sprintf("%d %s %04d", day, monthAbbreviations[month-1], year)
}
