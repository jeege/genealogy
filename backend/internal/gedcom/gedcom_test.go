package gedcom

import (
	"strings"
	"testing"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

const sampleGEDCOM = `0 HEAD
1 SOUR pure-genealogy
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME 刘/建国/
2 GIVN 建国
2 SURN 刘
1 SEX M
1 BIRT
2 DATE 12 MAR 1950
2 PLAC 山东济南
1 OCCU 教师
1 RESI
2 PLAC 北京
1 NOTE 勤俭持家
0 @I2@ INDI
1 NAME 刘/小明/
1 SEX M
1 BIRT
2 DATE ABT 1978
1 FAMS @F1@
1 FAMC @F1@
0 @I3@ INDI
1 NAME 刘/小红/
1 SEX F
1 BIRT
2 DATE 1980-05-01
0 @I4@ INDI
1 NAME 王/秀英/
1 SEX F
1 BIRT
2 DATE BEF 1955
1 DEAT
2 DATE 2010
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
1 CHIL @I3@
1 WIFE @I4@
0 TRLR
`

func TestDecodeContentUTF8AndGB18030(t *testing.T) {
	text, encoding, err := DecodeContent([]byte("\uFEFF" + sampleGEDCOM))
	if err != nil || encoding != "UTF-8" {
		t.Fatalf("UTF-8 解码失败：%v %s", err, encoding)
	}
	if strings.HasPrefix(text, "\uFEFF") {
		t.Fatal("BOM 应被移除")
	}
	if _, _, err := DecodeContent(nil); err == nil {
		t.Fatal("空内容应报错")
	}
	if _, _, err := DecodeContent(make([]byte, MaxContentBytes+1)); err == nil {
		t.Fatal("超大文件应报错")
	}
}

func TestParseRejectsInvalidDocuments(t *testing.T) {
	cases := map[string]string{
		"缺少头部":  "0 @I1@ INDI\n1 NAME A\n0 TRLR\n",
		"缺少尾部":  "0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME A\n",
		"没有个体":  "0 HEAD\n1 CHAR UTF-8\n0 TRLR\n",
		"层级无效":  "0 HEAD\n1 CHAR UTF-8\nX NAME A\n0 TRLR\n",
		"指针未闭合": "0 HEAD\n1 CHAR UTF-8\n0 @I1 INDI\n0 TRLR\n",
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(content); err == nil {
				t.Fatalf("%s 应解析失败", name)
			}
		})
	}
}

func TestParseTreeRelationsAndGeneration(t *testing.T) {
	tree, err := ParseTree(sampleGEDCOM)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Members) != 4 || tree.Families != 1 {
		t.Fatalf("成员/家庭数量错误：%d %d", len(tree.Members), tree.Families)
	}
	byName := map[string]int{}
	for index, member := range tree.Members {
		byName[member.Name] = index
	}
	father := tree.Members[byName["刘建国"]]
	if father.Generation == nil || *father.Generation != 1 {
		t.Fatalf("根节点世代应为 1：%+v", father.Generation)
	}
	if father.Gender == nil || *father.Gender != "男" {
		t.Fatalf("性别映射错误：%+v", father.Gender)
	}
	if father.Birth.ISO == nil || *father.Birth.ISO != "1950-03-12" {
		t.Fatalf("出生日期错误：%+v", father.Birth)
	}
	if father.ResidencePlace == nil || *father.ResidencePlace != "北京" {
		t.Fatalf("居住地错误：%+v", father.ResidencePlace)
	}
	if father.OfficialPosition == nil || *father.OfficialPosition != "教师" {
		t.Fatalf("官职错误：%+v", father.OfficialPosition)
	}

	son := tree.Members[byName["刘小明"]]
	if son.Generation == nil || *son.Generation != 2 {
		t.Fatalf("子女世代应为 2：%+v", son.Generation)
	}
	if son.SiblingOrder == nil || *son.SiblingOrder != 1 {
		t.Fatalf("子女排行错误：%+v", son.SiblingOrder)
	}
	if son.Birth.ISO != nil || son.Birth.Year == nil || *son.Birth.Year != 1978 {
		t.Fatalf("ABT 日期应只解析出年份：%+v", son.Birth)
	}
	if son.FatherXref == nil || *son.FatherXref != "@I1@" {
		t.Fatalf("父亲指针错误：%+v", son.FatherXref)
	}

	daughter := tree.Members[byName["刘小红"]]
	if daughter.SiblingOrder == nil || *daughter.SiblingOrder != 2 {
		t.Fatalf("排行应递增：%+v", daughter.SiblingOrder)
	}

	mother := tree.Members[byName["王秀英"]]
	if mother.IsAlive == nil || *mother.IsAlive {
		t.Fatalf("有死亡事件应判定为已故：%+v", mother.IsAlive)
	}
	if mother.Death.Raw != "2010" {
		t.Fatalf("死亡原始日期应保留：%q", mother.Death.Raw)
	}
	if mother.Birth.ISO != nil {
		t.Fatalf("BEF 1955 不应产出具体日期：%+v", mother.Birth.ISO)
	}
}

func TestParseTreeHandlesMissingFatherAndDuplicates(t *testing.T) {
	content := `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME 张三
0 @I2@ INDI
1 NAME 张三
1 FAMC @F9@
0 @F9@ FAM
1 HUSB @I99@
1 CHIL @I2@
0 TRLR
`
	tree, err := ParseTree(content)
	if err != nil {
		t.Fatal(err)
	}
	preview := Preview(tree)
	if preview.DuplicateNames != 1 {
		t.Fatalf("重复姓名统计错误：%d", preview.DuplicateNames)
	}
	if len(tree.Warnings) == 0 {
		t.Fatal("缺失父亲应产生提示")
	}
}

func TestExportRoundTrip(t *testing.T) {
	tree, err := ParseTree(sampleGEDCOM)
	if err != nil {
		t.Fatal(err)
	}
	members := ToMembers(tree)
	if len(members) != 4 {
		t.Fatalf("成员数量错误：%d", len(members))
	}
	exported := Export(members, ExportOptions{FileName: "test.ged"})
	if !strings.Contains(exported, "0 HEAD") || !strings.Contains(exported, "0 TRLR") {
		t.Fatal("导出缺少头尾记录")
	}
	if !strings.Contains(exported, "\r\n") {
		t.Fatal("GEDCOM 应使用 CRLF 行尾")
	}
	if !strings.Contains(exported, "1 NAME 刘建国") {
		t.Fatalf("导出姓名错误：\n%s", exported)
	}
	if !strings.Contains(exported, "1 _GENC 1") || !strings.Contains(exported, "1 _SIBO 2") {
		t.Fatal("扩展标签未导出")
	}

	reparsed, err := ParseTree(exported)
	if err != nil {
		t.Fatalf("导出结果无法重新解析：%v\n%s", err, exported)
	}
	if len(reparsed.Members) != len(tree.Members) {
		t.Fatalf("往返后成员数量变化：%d -> %d", len(tree.Members), len(reparsed.Members))
	}
	byName := map[string]int{}
	for index, member := range reparsed.Members {
		byName[member.Name] = index
	}
	son := reparsed.Members[byName["刘小明"]]
	if son.FatherXref == nil {
		t.Fatal("往返后父子关系丢失")
	}
	if son.Generation == nil || *son.Generation != 2 {
		t.Fatalf("往返后世代丢失：%+v", son.Generation)
	}
}

func TestExportSkipsDanglingFather(t *testing.T) {
	fatherID := int64(1)
	members := []domain.Member{
		{ID: 2, Name: "孤子", FatherID: &fatherID, IsAlive: true},
	}
	exported := Export(members, ExportOptions{})
	if strings.Contains(exported, "0 @F1@ FAM") {
		t.Fatalf("父亲不存在时不应生成 FAM 记录：\n%s", exported)
	}
	if strings.Contains(exported, "FAMC") {
		t.Fatalf("父亲不存在时不应写入 FAMC：\n%s", exported)
	}
}

func TestPlainTextNoteExtraction(t *testing.T) {
	remarks := `[{"type":"p","children":[{"text":"第一段"}]},{"type":"p","children":[{"text":"第二段"}]}]`
	member := domain.Member{ID: 1, Name: "甲", Remarks: &remarks, IsAlive: true}
	exported := Export([]domain.Member{member}, ExportOptions{})
	if !strings.Contains(exported, "1 NOTE 第一段") || !strings.Contains(exported, "1 NOTE 第二段") {
		t.Fatalf("富文本备注未转换为 NOTE：\n%s", exported)
	}
}

func TestExportPreservesDeceasedWithoutDeathDate(t *testing.T) {
	members := []domain.Member{{ID: 1, Name: "甲", IsAlive: false}}
	exported := Export(members, ExportOptions{})
	if !strings.Contains(exported, "1 _ALIV N") {
		t.Fatalf("已故但无死亡日期应写 _ALIV N：\n%s", exported)
	}
	tree, err := ParseTree(exported)
	if err != nil {
		t.Fatal(err)
	}
	if tree.Members[0].IsAlive == nil || *tree.Members[0].IsAlive {
		t.Fatalf("往返后在世状态丢失：%+v", tree.Members[0].IsAlive)
	}
}

func TestParseAndExportMarriages(t *testing.T) {
	content := `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME 刘/守仁/
1 SEX M
0 @I2@ INDI
1 NAME 王/秀英/
1 SEX F
0 @I3@ INDI
1 NAME 刘/建国/
1 SEX M
0 @I4@ INDI
1 NAME 李/淑贞/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 12 MAR 1930
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 MARR
2 DATE ABT 1955
1 DIV
2 DATE 1980
0 TRLR
`
	tree, err := ParseTree(content)
	if err != nil {
		t.Fatal(err)
	}
	if len(tree.Unions) != 2 {
		t.Fatalf("婚姻数量错误：%d", len(tree.Unions))
	}
	first := tree.Unions[0]
	if first.WifeXref == nil || *first.WifeXref != "@I2@" {
		t.Fatalf("妻子指针错误：%+v", first)
	}
	if first.Married.ISO == nil || *first.Married.ISO != "1930-03-12" {
		t.Fatalf("结婚日期错误：%+v", first.Married)
	}
	second := tree.Unions[1]
	if second.Status != "divorced" {
		t.Fatalf("有 DIV 应为离异：%s", second.Status)
	}
	// 只写年份时不虚构月份与日期，仅保留年份与原文。
	if second.Divorced.ISO != nil {
		t.Fatalf("仅有年份时不应虚构完整日期：%+v", second.Divorced)
	}
	if second.Divorced.Year == nil || *second.Divorced.Year != 1980 {
		t.Fatalf("离异年份错误：%+v", second.Divorced)
	}

	preview := Preview(tree)
	if preview.Unions != 2 {
		t.Fatalf("预览婚姻数错误：%d", preview.Unions)
	}

	// 导出时应写出 WIFE、MARR 与 DIV
	members := ToMembers(tree)
	ids := make(map[string]int64, len(members))
	for index, member := range tree.Members {
		ids[member.Xref] = members[index].ID
	}
	marriages := []domain.Marriage{
		{
			ID: 1, HusbandID: ids["@I1@"], WifeID: ptrID(ids["@I2@"]),
			Status: domain.MarriageMarried, MarriedOn: first.Married.ISO,
			MarriedOnRaw: ptrStr(first.Married.Raw),
		},
		{
			ID: 2, HusbandID: ids["@I3@"], WifeID: ptrID(ids["@I4@"]),
			Status:        domain.MarriageDivorced,
			MarriedOnRaw:  ptrStr(second.Married.Raw),
			DivorcedOnRaw: ptrStr(second.Divorced.Raw),
		},
	}
	exported := Export(members, ExportOptions{Marriages: marriages})
	if !strings.Contains(exported, "1 WIFE @I2@") && !strings.Contains(exported, "1 WIFE @I4@") {
		t.Fatalf("导出缺少 WIFE：\n%s", exported)
	}
	if !strings.Contains(exported, "1 MARR") || !strings.Contains(exported, "2 DATE 12 MAR 1930") {
		t.Fatalf("导出缺少 MARR 日期：\n%s", exported)
	}
	if !strings.Contains(exported, "1 DIV") || !strings.Contains(exported, "2 DATE 1980") {
		t.Fatalf("导出缺少 DIV：\n%s", exported)
	}

	// 往返后婚姻仍可解析
	reparsed, err := ParseTree(exported)
	if err != nil {
		t.Fatalf("导出结果无法解析：%v\n%s", err, exported)
	}
	if len(reparsed.Unions) < 2 {
		t.Fatalf("往返后婚姻丢失：%d\n%s", len(reparsed.Unions), exported)
	}
	if reparsed.Unions[0].Married.ISO == nil || *reparsed.Unions[0].Married.ISO != "1930-03-12" {
		t.Fatalf("往返后结婚日期丢失：%+v", reparsed.Unions[0])
	}
	// ABT 1955 的原文与年份应原样保留。
	if reparsed.Unions[1].Married.Raw != "ABT 1955" {
		t.Fatalf("往返后原始日期文本丢失：%q", reparsed.Unions[1].Married.Raw)
	}
}

func ptrID(value int64) *int64    { return &value }
func ptrStr(value string) *string { return &value }
