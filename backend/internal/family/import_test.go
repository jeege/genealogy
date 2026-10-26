package family

import (
	"strings"
	"testing"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

func intPtr(value int) *int          { return &value }
func stringPtr(value string) *string { return &value }

func TestNormalizeImportMembers(t *testing.T) {
	members, err := NormalizeImportMembers([]domain.ImportMember{{
		Name:       "  刘某某 ",
		Generation: intPtr(20),
		FatherName: stringPtr(" 刘父 "),
		Gender:     stringPtr(" 女 "),
		Birthday:   stringPtr("1990-01-01"),
	}})
	if err != nil {
		t.Fatal(err)
	}
	member := members[0]
	if member.Name != "刘某某" || *member.FatherName != "刘父" || *member.Gender != "女" {
		t.Fatalf("字段未正确清洗：%+v", member)
	}

	cases := []struct {
		name   string
		input  domain.ImportMember
		errMsg string
	}{
		{"空数组", domain.ImportMember{}, "没有有效"},
		{"缺少姓名", domain.ImportMember{Generation: intPtr(1)}, "缺少姓名"},
		{"世代为零", domain.ImportMember{Name: "甲", Generation: intPtr(0)}, "正整数"},
		{"有父亲但无世代", domain.ImportMember{Name: "甲", FatherName: stringPtr("父")}, "大于 1"},
		{"有父亲但第一世", domain.ImportMember{Name: "甲", Generation: intPtr(1), FatherName: stringPtr("父")}, "大于 1"},
		{"非法性别", domain.ImportMember{Name: "甲", Gender: stringPtr("未知")}, "性别"},
		{"非法生日", domain.ImportMember{Name: "甲", Birthday: stringPtr("1990/01/01")}, "YYYY-MM-DD"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			input := []domain.ImportMember{testCase.input}
			if testCase.name == "空数组" {
				input = nil
			}
			_, err := NormalizeImportMembers(input)
			if err == nil || !strings.Contains(err.Error(), testCase.errMsg) {
				t.Fatalf("期望包含 %q 的错误，得到 %v", testCase.errMsg, err)
			}
		})
	}
}

func TestResolveImportFathers(t *testing.T) {
	members := []domain.ImportMember{
		{Name: "父", Generation: intPtr(2)},
		{Name: "子", Generation: intPtr(3), FatherName: stringPtr("父")},
		{Name: "无父", Generation: intPtr(3)},
	}
	matches, err := ResolveImportFathers(members, nil)
	if err != nil {
		t.Fatal(err)
	}
	if matches[0] != nil || matches[2] != nil {
		t.Fatal("没有父亲姓名的行应返回 null")
	}
	if matches[1] == nil || matches[1].Source != "import" || *matches[1].Index != 0 {
		t.Fatalf("应匹配同一文件中的父亲：%+v", matches[1])
	}

	existingMatches, err := ResolveImportFathers([]domain.ImportMember{
		{Name: "子", Generation: intPtr(3), FatherName: stringPtr("父")},
	}, []domain.ImportFatherCandidate{{ID: 9, Name: "父", Generation: intPtr(2)}})
	if err != nil {
		t.Fatal(err)
	}
	if existingMatches[0].Source != "existing" || *existingMatches[0].ID != 9 {
		t.Fatalf("应匹配已有父亲：%+v", existingMatches[0])
	}

	if _, err := ResolveImportFathers([]domain.ImportMember{
		{Name: "子", Generation: intPtr(3), FatherName: stringPtr("父")},
	}, nil); err == nil || !strings.Contains(err.Error(), "未找到") {
		t.Fatalf("缺少父亲应报错，得到 %v", err)
	}

	if _, err := ResolveImportFathers([]domain.ImportMember{
		{Name: "子", Generation: intPtr(3), FatherName: stringPtr("父")},
	}, []domain.ImportFatherCandidate{
		{ID: 1, Name: "父", Generation: intPtr(2)},
		{ID: 2, Name: "父", Generation: intPtr(2)},
	}); err == nil || !strings.Contains(err.Error(), "同名同世代") {
		t.Fatalf("重复候选应报错，得到 %v", err)
	}
}

func TestHasBiography(t *testing.T) {
	emptyJSON := `[{"type":"p","children":[{"text":"   "}]}]`
	contentJSON := `[{"type":"p","children":[{"text":"生平"}]}]`
	cases := []struct {
		value string
		want  bool
	}{
		{"", false},
		{"   ", false},
		{emptyJSON, false},
		{contentJSON, true},
		{"普通文本生平", true},
		{`{"text":""}`, false},
	}
	for _, testCase := range cases {
		value := testCase.value
		if got := HasBiography(&value); got != testCase.want {
			t.Fatalf("HasBiography(%q) = %v, want %v", testCase.value, got, testCase.want)
		}
	}
	if HasBiography(nil) {
		t.Fatal("nil 不应有生平")
	}
}
