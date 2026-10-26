// Package family 实现与存储无关的族谱导入与统计规则。
package family

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

// ValidationError 表示调用方可修正的导入数据错误。
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return &ValidationError{Message: fmt.Sprintf(format, args...)}
}

type importKey struct {
	Name       string
	Generation int
}

func keyOf(name string, generation *int) importKey {
	if generation == nil {
		return importKey{Name: name, Generation: -1}
	}
	return importKey{Name: name, Generation: *generation}
}

func label(index int, name string) string {
	if name == "" {
		return fmt.Sprintf("第 %d 条记录", index+1)
	}
	return fmt.Sprintf("第 %d 条记录「%s」", index+1, name)
}

// NormalizeImportMembers 校验并清洗导入行，错误信息与前端逐条对应。
func NormalizeImportMembers(input []domain.ImportMember) ([]domain.ImportMember, error) {
	if len(input) == 0 {
		return nil, invalid("文件中没有有效的成员数据，请检查表头是否正确")
	}
	members := make([]domain.ImportMember, len(input))
	for index, source := range input {
		member := source
		member.Name = strings.TrimSpace(source.Name)
		if member.FatherName != nil {
			trimmed := strings.TrimSpace(*member.FatherName)
			if trimmed == "" {
				member.FatherName = nil
			} else {
				member.FatherName = &trimmed
			}
		}
		if member.Name == "" {
			return nil, invalid("%s缺少姓名", label(index, ""))
		}
		if member.Generation != nil {
			if *member.Generation < 1 || *member.Generation > 2147483647 {
				return nil, invalid("%s的世代必须为正整数", label(index, member.Name))
			}
		}
		if member.FatherName != nil && (member.Generation == nil || *member.Generation <= 1) {
			return nil, invalid("%s填写了父亲姓名，成员世代必须为大于 1 的整数", label(index, member.Name))
		}
		if member.Gender != nil {
			gender := strings.TrimSpace(*member.Gender)
			if gender != "" && gender != "男" && gender != "女" {
				return nil, invalid("%s的性别只能是「男」或「女」", label(index, member.Name))
			}
			if gender == "" {
				member.Gender = nil
			} else {
				member.Gender = &gender
			}
		}
		if member.Birthday != nil {
			birthday := strings.TrimSpace(*member.Birthday)
			if birthday == "" {
				member.Birthday = nil
			} else if _, err := time.Parse("2006-01-02", birthday); err != nil {
				return nil, invalid("%s的生日格式必须为 YYYY-MM-DD", label(index, member.Name))
			}
		}
		members[index] = member
	}
	return members, nil
}

// ResolveImportFathers 按「姓名 + 上一世代」匹配父亲；同一键存在多个候选时拒绝导入。
func ResolveImportFathers(
	members []domain.ImportMember,
	existingMembers []domain.ImportFatherCandidate,
) ([]*domain.ImportFatherMatch, error) {
	candidates := make(map[importKey][]*domain.ImportFatherMatch)
	addCandidate := func(key importKey, match *domain.ImportFatherMatch) {
		candidates[key] = append(candidates[key], match)
	}

	for _, member := range existingMembers {
		id := member.ID
		addCandidate(keyOf(member.Name, member.Generation), &domain.ImportFatherMatch{
			Source: "existing",
			ID:     &id,
		})
	}
	for index := range members {
		position := index
		addCandidate(keyOf(members[index].Name, members[index].Generation), &domain.ImportFatherMatch{
			Source: "import",
			Index:  &position,
		})
	}

	matches := make([]*domain.ImportFatherMatch, len(members))
	for index, member := range members {
		if member.FatherName == nil {
			continue
		}
		fatherGeneration := *member.Generation - 1
		key := importKey{Name: *member.FatherName, Generation: fatherGeneration}
		found := candidates[key]
		description := fmt.Sprintf("第 %d 条记录「%s」的父亲「%s」（第 %d 世）",
			index+1, member.Name, *member.FatherName, fatherGeneration)
		if len(found) == 0 {
			return nil, invalid("%s未找到，请检查姓名、世代，或将父亲加入同一份导入文件", description)
		}
		if len(found) > 1 {
			return nil, invalid("%s存在 %d 个同名同世代成员，无法唯一匹配，请先核对数据", description, len(found))
		}
		matches[index] = found[0]
	}
	return matches, nil
}

// HasBiography 判断富文本备注是否有实质内容，过滤只有空 Slate 结构的记录。
func HasBiography(remarks *string) bool {
	if remarks == nil || strings.TrimSpace(*remarks) == "" {
		return false
	}
	var parsed any
	if err := json.Unmarshal([]byte(*remarks), &parsed); err != nil {
		return strings.TrimSpace(*remarks) != ""
	}
	nodes, ok := parsed.([]any)
	if !ok {
		return false
	}
	return containsText(nodes)
}

func containsText(value any) bool {
	switch node := value.(type) {
	case string:
		return strings.TrimSpace(node) != ""
	case []any:
		for _, item := range node {
			if containsText(item) {
				return true
			}
		}
	case map[string]any:
		if text, ok := node["text"]; ok {
			if value, ok := text.(string); ok && strings.TrimSpace(value) != "" {
				return true
			}
		}
		if children, ok := node["children"]; ok && containsText(children) {
			return true
		}
	}
	return false
}
