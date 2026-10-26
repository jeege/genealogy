package gedcom

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

// ExportOptions 控制导出内容。
type ExportOptions struct {
	// FileName 写入 HEAD 的 FILE 字段，仅作参考信息。
	FileName string
	// Now 便于测试固定导出日期；为零值时使用当前时间。
	Now time.Time
	// Marriages 是结构化配偶关系；缺省时仅导出成员上的配偶文本备注。
	Marriages []domain.Marriage
}

// Export 将成员序列化为 GEDCOM 5.5.1 文本（UTF-8，CRLF 行尾）。
// 父子关系用 FAM + HUSB/CHIL 表达；配偶文本、世代与排行使用 _SPO/_GENC/_SIBO
// 扩展标签，使导出结果可以无损导回本系统。
func Export(members []domain.Member, options ExportOptions) string {
	sorted := make([]domain.Member, len(members))
	copy(sorted, members)
	sortMembers(sorted)

	byID := make(map[int64]domain.Member, len(sorted))
	childrenByFather := make(map[int64][]domain.Member)
	for _, member := range sorted {
		byID[member.ID] = member
		if member.FatherID != nil {
			if _, exists := byID[*member.FatherID]; exists || hasMember(members, *member.FatherID) {
				childrenByFather[*member.FatherID] = append(childrenByFather[*member.FatherID], member)
			}
		}
	}

	now := options.Now
	if now.IsZero() {
		now = time.Now()
	}

	var builder strings.Builder
	writeLine(&builder, 0, "HEAD")
	writeLine(&builder, 1, "SOUR", "pure-genealogy")
	writeLine(&builder, 1, "GEDC")
	writeLine(&builder, 2, "VERS", "5.5.1")
	writeLine(&builder, 2, "FORM", "LINEAGE-LINKED")
	writeLine(&builder, 1, "CHAR", "UTF-8")
	if options.FileName != "" {
		writeLine(&builder, 1, "FILE", options.FileName)
	}
	writeLine(&builder, 1, "DATE", FormatDate(now.Format("2006-01-02")))

	for _, member := range sorted {
		writeIndividual(&builder, member, byID)
	}

	fatherIDs := make([]int64, 0, len(childrenByFather))
	for fatherID := range childrenByFather {
		fatherIDs = append(fatherIDs, fatherID)
	}
	sort.Slice(fatherIDs, func(i, j int) bool { return fatherIDs[i] < fatherIDs[j] })
	// 家庭记录按「丈夫 + 妻子」聚合：既表达配偶关系，也承载子女。
	type familyKey struct {
		husband int64
		wife    int64
	}
	type family struct {
		husband  int64
		wife     int64
		children []domain.Member
		marriage *domain.Marriage
	}
	families := make(map[familyKey]*family)
	order := make([]familyKey, 0, len(fatherIDs)+len(options.Marriages))

	keyOf := func(husband, wife int64) familyKey { return familyKey{husband: husband, wife: wife} }
	ensure := func(husband, wife int64) *family {
		key := keyOf(husband, wife)
		existing, ok := families[key]
		if ok {
			return existing
		}
		created := &family{husband: husband, wife: wife}
		families[key] = created
		order = append(order, key)
		return created
	}

	for _, marriage := range options.Marriages {
		// 统一以较小的 ID 作为 HUSB，避免同一对成员生成两种键。
		husband, wife := marriage.HusbandID, int64(0)
		if marriage.WifeID != nil {
			wife = *marriage.WifeID
		}
		if wife != 0 && husband > wife {
			husband, wife = wife, husband
		}
		entry := ensure(husband, wife)
		if entry.marriage == nil {
			marriageCopy := marriage
			entry.marriage = &marriageCopy
		}
	}

	for _, fatherID := range fatherIDs {
		if _, ok := byID[fatherID]; !ok {
			continue
		}
		children := childrenByFather[fatherID]
		sortMembers(children)
		// 子女归属到该父亲作为丈夫的家庭；父亲没有配偶时 wife 为 0。
		entry := ensure(fatherID, 0)
		entry.children = append(entry.children, children...)
	}

	sort.Slice(order, func(i, j int) bool {
		if order[i].husband != order[j].husband {
			return order[i].husband < order[j].husband
		}
		return order[i].wife < order[j].wife
	})
	for _, key := range order {
		entry := families[key]
		if entry.husband == 0 {
			continue
		}
		writeLine(&builder, 0, fmt.Sprintf("@F%d@", entry.husband), "FAM")
		writeLine(&builder, 1, "HUSB", individualXref(entry.husband))
		if entry.wife != 0 {
			writeLine(&builder, 1, "WIFE", individualXref(entry.wife))
		}
		unique := make(map[int64]bool, len(entry.children))
		for _, child := range entry.children {
			if unique[child.ID] {
				continue
			}
			unique[child.ID] = true
			writeLine(&builder, 1, "CHIL", individualXref(child.ID))
		}
		if entry.marriage != nil {
			writeDateEvent(&builder, "MARR", entry.marriage.MarriedOnRaw, entry.marriage.MarriedOn)
			writeDateEvent(&builder, "DIV", entry.marriage.DivorcedOnRaw, entry.marriage.DivorcedOn)
		}
	}

	writeLine(&builder, 0, "TRLR")
	return strings.ReplaceAll(builder.String(), "\n", "\r\n")
}

func writeIndividual(builder *strings.Builder, member domain.Member, byID map[int64]domain.Member) {
	writeLine(builder, 0, individualXref(member.ID), "INDI")
	writeLine(builder, 1, "NAME", escapeValue(member.Name))
	if member.Gender != nil {
		switch *member.Gender {
		case "男":
			writeLine(builder, 1, "SEX", "M")
		case "女":
			writeLine(builder, 1, "SEX", "F")
		}
	}

	writeDateEvent(builder, "BIRT", member.BirthDateRaw, member.Birthday)
	writeDateEvent(builder, "DEAT", member.DeathDateRaw, member.DeathDate)

	// 没有死亡事件时用扩展标签显式记录在世状态，保证往返保真：
	// 在世为 Y；已故但缺少死亡日期为 N（否则导回会默认成在世）。
	hasDeath := (member.DeathDateRaw != nil && strings.TrimSpace(*member.DeathDateRaw) != "") ||
		(member.DeathDate != nil && *member.DeathDate != "")
	if !hasDeath {
		if member.IsAlive {
			writeLine(builder, 1, "_ALIV", "Y")
		} else {
			writeLine(builder, 1, "_ALIV", "N")
		}
	}
	if member.OfficialPosition != nil && *member.OfficialPosition != "" {
		writeLine(builder, 1, "OCCU", escapeValue(*member.OfficialPosition))
	}
	if member.ResidencePlace != nil && *member.ResidencePlace != "" {
		writeLine(builder, 1, "RESI")
		writeLine(builder, 2, "PLAC", escapeValue(*member.ResidencePlace))
	}
	if member.Generation != nil {
		writeLine(builder, 1, "_GENC", fmt.Sprintf("%d", *member.Generation))
	}
	if member.SiblingOrder != nil {
		writeLine(builder, 1, "_SIBO", fmt.Sprintf("%d", *member.SiblingOrder))
	}
	if member.Spouse != nil && *member.Spouse != "" {
		writeLine(builder, 1, "_SPO", escapeValue(*member.Spouse))
	}
	// 只有父亲确实在导出集合内时才写 FAMC，避免产生指向不存在记录的指针。
	if father := member.FatherID; father != nil {
		if _, ok := byID[*father]; ok {
			writeLine(builder, 1, "FAMC", fmt.Sprintf("@F%d@", *father))
		}
	}

	for _, line := range noteLines(member.Remarks) {
		writeLine(builder, 1, "NOTE", line)
	}
}

func writeDateEvent(builder *strings.Builder, tag string, raw *string, iso *string) {
	if raw != nil && strings.TrimSpace(*raw) != "" {
		writeLine(builder, 1, tag)
		writeLine(builder, 2, "DATE", strings.TrimSpace(*raw))
		return
	}
	if iso != nil && *iso != "" {
		writeLine(builder, 1, tag)
		writeLine(builder, 2, "DATE", FormatDate(*iso))
	}
}

func sortMembers(members []domain.Member) {
	sort.SliceStable(members, func(i, j int) bool {
		left, right := members[i], members[j]
		leftGen, rightGen := 1<<31, 1<<31
		if left.Generation != nil {
			leftGen = *left.Generation
		}
		if right.Generation != nil {
			rightGen = *right.Generation
		}
		if leftGen != rightGen {
			return leftGen < rightGen
		}
		leftOrder, rightOrder := 1<<31, 1<<31
		if left.SiblingOrder != nil {
			leftOrder = *left.SiblingOrder
		}
		if right.SiblingOrder != nil {
			rightOrder = *right.SiblingOrder
		}
		if leftOrder != rightOrder {
			return leftOrder < rightOrder
		}
		return left.ID < right.ID
	})
}

func hasMember(members []domain.Member, id int64) bool {
	for _, member := range members {
		if member.ID == id {
			return true
		}
	}
	return false
}

// escapeValue 清理换行等无法写入单个 GEDCOM 行的字符。
func escapeValue(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.Join(strings.Fields(value), " ")
}

// noteLines 把 Slate JSON 或纯文本备注转换为可写入 NOTE 的行。
func noteLines(remarks *string) []string {
	if remarks == nil {
		return nil
	}
	text := strings.TrimSpace(*remarks)
	if text == "" {
		return nil
	}
	if strings.HasPrefix(text, "[") || strings.HasPrefix(text, "{") {
		var nodes any
		if err := json.Unmarshal([]byte(text), &nodes); err == nil {
			text = plainText(nodes)
		}
	}
	result := make([]string, 0, 4)
	for _, line := range strings.Split(text, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			result = append(result, escapeValue(trimmed))
		}
	}
	return result
}

func plainText(value any) string {
	switch node := value.(type) {
	case string:
		return node
	case []any:
		parts := make([]string, 0, len(node))
		for _, item := range node {
			parts = append(parts, plainText(item))
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if text, ok := node["text"].(string); ok {
			return text
		}
		if children, ok := node["children"]; ok {
			return plainText(children)
		}
	}
	return ""
}

// writeLine 按 GEDCOM 规范输出 "level 内容..."。首段可能是指针或标签。
func writeLine(builder *strings.Builder, level int, parts ...string) {
	builder.WriteString(fmt.Sprintf("%d", level))
	for _, part := range parts {
		if part == "" {
			continue
		}
		builder.WriteString(" ")
		builder.WriteString(part)
	}
	builder.WriteString("\n")
}

func individualXref(id int64) string { return fmt.Sprintf("@I%d@", id) }
