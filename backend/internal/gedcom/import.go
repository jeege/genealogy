package gedcom

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

// ParsedTree 是解析并完成关系推导的族谱，供预览与导入共用。
type ParsedTree struct {
	Encoding        string
	Version         string
	Members         []domain.GEDCOMMember
	Unions          []domain.GEDCOMUnion
	Families        int
	IgnoredRecords  int
	UnsupportedTags []string
	Warnings        []string

	fatherXref map[string]string // 成员 xref -> 父亲 xref
	childOf    map[string]string // 成员 xref -> 出生家庭 FAMC
}

// ParseTree 解析文本并推导父子关系、世代与排行。所有错误都带可读的中文说明。
func ParseTree(text string) (*ParsedTree, error) {
	document, err := Parse(text)
	if err != nil {
		return nil, err
	}

	members := make([]domain.GEDCOMMember, 0, len(document.Individuals))
	byXref := make(map[string]*domain.GEDCOMMember, len(document.Individuals))
	unsupported := map[string]int{}
	fatherXref := map[string]string{}
	childOf := map[string]string{}
	danglingFathers := 0

	for _, individual := range document.Individuals {
		xref := normalizeXref(individual.Xref)
		if xref == "" {
			continue
		}
		member := buildMember(individual, document, unsupported)
		member.Xref = xref
		members = append(members, member)
	}
	for index := range members {
		byXref[members[index].Xref] = &members[index]
	}

	unions := make([]domain.GEDCOMUnion, 0, len(document.Families))

	// FAMC 指向出生家庭，HUSB/WIFE 指向配偶；CHIL 给出子女。
	for _, family := range document.Families {
		xref := normalizeXref(family.Xref)
		husband := normalizeXref(childValue(family, "HUSB"))
		wife := normalizeXref(childValue(family, "WIFE"))
		if husband != "" && wife != "" && husband != wife {
			union := domain.GEDCOMUnion{
				HusbandXref: husband,
				FamilyXref:  xref,
				Status:      "married",
			}
			wifeValue := wife
			union.WifeXref = &wifeValue
			if dateNode := childValue(family, "MARR", "DATE"); dateNode != "" {
				union.Married = ParseDate(dateNode)
			}
			if dateNode := childValue(family, "DIV", "DATE"); dateNode != "" {
				union.Divorced = ParseDate(dateNode)
				union.Status = "divorced"
			}
			unions = append(unions, union)
			// 记录到个人，便于导出时还原已知配偶姓名。
			if member, ok := byXref[husband]; ok && member.Spouse == nil {
				if partner, ok := byXref[wife]; ok && partner.Name != "" {
					name := partner.Name
					member.Spouse = &name
				}
			}
			if member, ok := byXref[wife]; ok && member.Spouse == nil {
				if partner, ok := byXref[husband]; ok && partner.Name != "" {
					name := partner.Name
					member.Spouse = &name
				}
			}
		}
		childXrefs := make([]string, 0, 4)
		for _, childNode := range children(family, "CHIL") {
			if child := normalizeXref(childNode.Value); child != "" {
				childXrefs = append(childXrefs, child)
			}
		}
		for _, childXref := range childXrefs {
			childMember, ok := byXref[childXref]
			if !ok {
				unsupported["CHIL 指向不存在的个体"]++
				continue
			}
			if childMember.FamilyAsChild == nil {
				value := xref
				childMember.FamilyAsChild = &value
			}
			childOf[childXref] = xref
			if husband != "" && husband != childXref {
				if _, exists := byXref[husband]; exists {
					fatherXref[childXref] = husband
				} else {
					danglingFathers++
				}
			}
			if childMember.SiblingOrder == nil {
				// 同一家庭内的顺序即排行，从 1 开始。
				order := 0
				for _, sibling := range childXrefs {
					order++
					if sibling == childXref {
						break
					}
				}
				value := order
				childMember.SiblingOrder = &value
			}
		}
	}

	// 世代：根为 1，子女为父代 +1；无法确定时留空。
	resolved := make(map[string]int, len(members))
	for index := range members {
		computeGeneration(members[index].Xref, byXref, fatherXref, resolved, 0)
	}
	for index := range members {
		if generation, ok := resolved[members[index].Xref]; ok {
			value := generation
			members[index].Generation = &value
		}
	}

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
		return left.Xref < right.Xref
	})

	for index := range members {
		if father := fatherXref[members[index].Xref]; father != "" {
			value := father
			members[index].FatherXref = &value
		}
	}

	return &ParsedTree{
		Encoding:        document.Charset,
		Version:         document.Version,
		Members:         members,
		Families:        len(document.Families),
		IgnoredRecords:  document.IgnoredRecords,
		Unions:          unions,
		UnsupportedTags: sortedKeys(unsupported),
		Warnings:        buildWarnings(members, unsupported, danglingFathers),
		fatherXref:      fatherXref,
		childOf:         childOf,
	}, nil
}

// computeGeneration 用记忆化递归计算世代；检测到环时返回 0 表示无法确定。
func computeGeneration(xref string, byXref map[string]*domain.GEDCOMMember, fatherXref map[string]string, resolved map[string]int, depth int) int {
	if generation, ok := resolved[xref]; ok {
		return generation
	}
	if depth > len(byXref)+1 {
		return 0
	}
	if _, ok := byXref[xref]; !ok {
		return 0
	}
	father, hasFather := fatherXref[xref]
	if !hasFather {
		resolved[xref] = 1
		return 1
	}
	parentGeneration := computeGeneration(father, byXref, fatherXref, resolved, depth+1)
	if parentGeneration == 0 {
		return 0
	}
	resolved[xref] = parentGeneration + 1
	return parentGeneration + 1
}

func buildMember(individual *node, document *Document, unsupported map[string]int) domain.GEDCOMMember {
	member := domain.GEDCOMMember{Xref: normalizeXref(individual.Xref)}

	// NAME 允许出现多个，取主名（第一个）。
	nameNode := child(individual, "NAME")
	if nameNode != nil {
		member.Surname, member.GivenNames = splitName(nameNode.Value)
		member.Name = joinName(member.Surname, member.GivenNames)
	}
	if member.Name == "" {
		if title := childValue(individual, "NAME", "GIVN"); title != "" {
			member.GivenNames = title
			member.Name = title
		}
	}

	switch strings.ToUpper(childValue(individual, "SEX")) {
	case "M":
		value := "男"
		member.Gender = &value
	case "F":
		value := "女"
		member.Gender = &value
	}

	if birth := child(individual, "BIRT"); birth != nil {
		if dateNode := child(birth, "DATE"); dateNode != nil {
			member.Birth = ParseDate(dateNode.Value)
		} else {
			member.Birth = ParseDate(childValue(birth, "DATE"))
		}
		if place := childValue(birth, "PLAC"); place != "" {
			member.ResidencePlace = &place
		}
	}
	if death := child(individual, "DEAT"); death != nil {
		if dateNode := child(death, "DATE"); dateNode != nil {
			member.Death = ParseDate(dateNode.Value)
		} else {
			member.Death = ParseDate(childValue(death, "DATE"))
		}
	}

	// 在世判定：有死亡事件或死亡日期则为已故；本系统显式记录 _ALIV。
	if alive := childValue(individual, "_ALIV"); alive != "" {
		value := strings.EqualFold(alive, "Y") || strings.EqualFold(alive, "YES") || alive == "1"
		member.IsAlive = &value
	} else if member.Death.Raw != "" || child(individual, "DEAT") != nil {
		value := false
		member.IsAlive = &value
	}

	// 本系统扩展标签：世代、排行、配偶文本。
	if generation := childValue(individual, "_GENC"); generation != "" {
		if value, err := strconv.Atoi(generation); err == nil && value > 0 {
			member.Generation = &value
		}
	}
	if order := childValue(individual, "_SIBO"); order != "" {
		if value, err := strconv.Atoi(order); err == nil && value >= 0 {
			member.SiblingOrder = &value
		}
	}
	if spouse := childValue(individual, "_SPO"); spouse != "" {
		member.Spouse = &spouse
	}
	if place := childValue(individual, "RESI", "PLAC"); place != "" {
		member.ResidencePlace = &place
	}
	if occupation := childValue(individual, "OCCU"); occupation != "" {
		member.OfficialPosition = &occupation
	}

	// 备注：NOTE 记录，支持 @N1@ 形式的共享备注。
	notes := make([]string, 0, 2)
	for _, noteNode := range children(individual, "NOTE") {
		value := strings.TrimSpace(noteNode.Value)
		if strings.HasPrefix(value, "@") && strings.HasSuffix(value, "@") {
			if shared, ok := document.Notes[normalizeXref(value)]; ok {
				notes = append(notes, shared)
				continue
			}
		}
		if value != "" {
			notes = append(notes, value)
		}
	}
	if len(notes) > 0 {
		text := strings.Join(notes, "\n\n")
		member.Remarks = &text
	}

	for _, childNode := range individual.Child {
		switch childNode.Tag {
		case "NAME", "SEX", "BIRT", "DEAT", "NOTE", "OCCU", "RESI", "FAMC", "FAMS",
			"_GENC", "_SIBO", "_SPO", "_ALIV", "SOUR", "CHAN", "REFN", "RIN", "UID":
		default:
			unsupported[childNode.Tag]++
		}
	}
	return member
}

// splitName 拆分 GEDCOM 姓名。
// 标准写法是「名 /姓/」，但国内族谱软件常导出「姓/名」，因此用字符长度判断：
// 斜杠前是 1-2 个中文字符、斜杠内更长时按中文顺序处理，否则按标准顺序。
func splitName(value string) (surname, given string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ""
	}
	if start := strings.Index(value, "/"); start >= 0 {
		first := strings.TrimSpace(value[:start])
		if end := strings.Index(value[start+1:], "/"); end >= 0 {
			middle := strings.TrimSpace(value[start+1 : start+1+end])
			trailing := strings.TrimSpace(value[start+1+end+1:])
			if isCJK(first) && isCJK(middle) && runeLen(first) <= 2 && runeLen(middle) >= 2 {
				// 「姓/名/」：斜杠前是姓。
				return first, strings.TrimSpace(middle + " " + trailing)
			}
			return middle, strings.Join(strings.Fields(first+" "+trailing), " ")
		}
		// 只有起始斜杠：按标准把斜杠后视为姓。
		return strings.TrimSpace(value[start+1:]), first
	}
	if index := strings.Index(value, ","); index >= 0 {
		return strings.TrimSpace(value[:index]), strings.TrimSpace(value[index+1:])
	}
	return "", value
}

func isCJK(value string) bool {
	for _, r := range value {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

func runeLen(value string) int { return len([]rune(value)) }

func joinName(surname, given string) string {
	switch {
	case surname == "":
		return given
	case given == "":
		return surname
	}
	return surname + given
}

func sortedKeys(counter map[string]int) []string {
	keys := make([]string, 0, len(counter))
	for key := range counter {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) > 20 {
		keys = keys[:20]
	}
	return keys
}

func buildWarnings(members []domain.GEDCOMMember, unsupported map[string]int, danglingFathers int) []string {
	warnings := make([]string, 0, 4)
	missing := 0
	for _, member := range members {
		if member.Name == "" {
			missing++
		}
	}
	if missing > 0 {
		warnings = append(warnings, fmt.Sprintf("%d 条个人记录缺少姓名，导入后需要手工补全", missing))
	}
	if unsupported["CHIL 指向不存在的个体"] > 0 {
		warnings = append(warnings, "部分 FAM 记录引用了不存在的子女，已忽略这些关系")
	}
	if danglingFathers > 0 {
		warnings = append(warnings, fmt.Sprintf("%d 个家庭记录的父亲不在文件中，相关成员按无父成员导入", danglingFathers))
	}
	noFather := 0
	for _, member := range members {
		if member.FatherXref == nil && member.Generation != nil && *member.Generation > 1 {
			noFather++
		}
	}
	if noFather > 0 {
		warnings = append(warnings, fmt.Sprintf("%d 位成员位于第二世及以后但没有可解析的父亲，世代按根节点处理", noFather))
	}
	if len(unsupported) > 0 {
		warnings = append(warnings, "部分 GEDCOM 标签未映射："+strings.Join(sortedKeys(unsupported), "、"))
	}
	return warnings
}

// ValidationError 表示可修正的导入数据问题。
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

// Preview 汇总导入前的规模与问题，不写入数据库。
func Preview(tree *ParsedTree) domain.GEDCOMImportPreview {
	preview := domain.GEDCOMImportPreview{
		Encoding:        tree.Encoding,
		Version:         tree.Version,
		Members:         len(tree.Members),
		Families:        tree.Families,
		Unions:          len(tree.Unions),
		IgnoredRecords:  tree.IgnoredRecords,
		UnsupportedTags: tree.UnsupportedTags,
		Warnings:        tree.Warnings,
	}
	names := make(map[string]int, len(tree.Members))
	for _, member := range tree.Members {
		if strings.TrimSpace(member.Name) == "" {
			preview.MissingName++
		}
		names[strings.TrimSpace(member.Name)]++
		if member.FatherXref != nil {
			preview.WithFather++
		}
		if member.Birth.ISO != nil || member.Birth.Year != nil {
			preview.WithBirthDate++
		}
	}
	for name, count := range names {
		if name != "" && count > 1 {
			preview.DuplicateNames++
		}
	}
	if preview.Warnings == nil {
		preview.Warnings = []string{}
	}
	if preview.UnsupportedTags == nil {
		preview.UnsupportedTags = []string{}
	}
	return preview
}

// ToMembers 把解析结果转换为可导出的成员结构，供导出前做格式校验与往返测试。
func ToMembers(tree *ParsedTree) []domain.Member {
	ids := make(map[string]int64, len(tree.Members))
	for index, member := range tree.Members {
		ids[member.Xref] = int64(index + 1)
	}
	members := make([]domain.Member, 0, len(tree.Members))
	for _, member := range tree.Members {
		isAlive := true
		if member.IsAlive != nil {
			isAlive = *member.IsAlive
		}
		var fatherID *int64
		if member.FatherXref != nil {
			if id, ok := ids[*member.FatherXref]; ok {
				fatherID = &id
			}
		}
		var birthRaw, deathRaw *string
		if strings.TrimSpace(member.Birth.Raw) != "" {
			raw := strings.TrimSpace(member.Birth.Raw)
			birthRaw = &raw
		}
		if strings.TrimSpace(member.Death.Raw) != "" {
			raw := strings.TrimSpace(member.Death.Raw)
			deathRaw = &raw
		}
		members = append(members, domain.Member{
			ID:               ids[member.Xref],
			Name:             member.Name,
			Generation:       member.Generation,
			SiblingOrder:     member.SiblingOrder,
			FatherID:         fatherID,
			Gender:           member.Gender,
			OfficialPosition: member.OfficialPosition,
			IsAlive:          isAlive,
			Spouse:           member.Spouse,
			Remarks:          member.Remarks,
			Birthday:         member.Birth.ISO,
			DeathDate:        member.Death.ISO,
			BirthDateRaw:     birthRaw,
			DeathDateRaw:     deathRaw,
			ResidencePlace:   member.ResidencePlace,
		})
	}
	return members
}
