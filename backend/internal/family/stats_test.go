package family

import (
	"testing"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

func TestComputeStatistics(t *testing.T) {
	members := []domain.StatisticsMember{
		{ID: 1, Name: "刘建国", Gender: stringPtr("男"), Generation: intPtr(1), IsAlive: true, Birthday: stringPtr("1950-01-01")},
		{ID: 2, Name: "刘秀英", Gender: stringPtr("女"), Generation: intPtr(1), IsAlive: false, Birthday: stringPtr("1930-05-01")},
		{ID: 3, Name: "刘小", Gender: nil, Generation: intPtr(2), IsAlive: true, Birthday: stringPtr("2010-10-26")},
		{ID: 4, Name: "刘", Gender: stringPtr("男"), Generation: nil, IsAlive: true, Birthday: nil},
	}
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	data := ComputeStatistics(members, now)

	if data.TotalMembers != 4 {
		t.Fatalf("总人数 = %d", data.TotalMembers)
	}
	gender := map[string]int{}
	for _, item := range data.GenderStats {
		gender[item.Name] = item.Value
	}
	if gender["男"] != 2 || gender["女"] != 1 || gender["未知"] != 1 {
		t.Fatalf("性别统计错误：%+v", data.GenderStats)
	}
	if len(data.GenerationStats) != 3 ||
		data.GenerationStats[0].Name != "第1世" || data.GenerationStats[0].Value != 2 ||
		data.GenerationStats[1].Name != "第2世" || data.GenerationStats[2].Name != "未知" {
		t.Fatalf("世代统计错误：%+v", data.GenerationStats)
	}
	if data.StatusStats[0].Value != 3 || data.StatusStats[1].Value != 1 {
		t.Fatalf("在世统计错误：%+v", data.StatusStats)
	}
	ages := map[string]int{}
	for _, item := range data.AgeStats {
		ages[item.Name] = item.Value
	}
	if ages["71-80岁"] != 1 || ages["11-20岁"] != 1 {
		t.Fatalf("年龄统计错误：%+v", data.AgeStats)
	}
	if len(data.CommonNames) != 3 {
		t.Fatalf("字辈统计错误：%+v", data.CommonNames)
	}
	for _, item := range data.CommonNames {
		if item.Count != 1 {
			t.Fatalf("字辈计数错误：%+v", data.CommonNames)
		}
	}
}

func TestAgeAtBeforeBirthday(t *testing.T) {
	birthday := time.Date(2000, 12, 31, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	if age := ageAt(birthday, now); age != 25 {
		t.Fatalf("未过生日年龄 = %d, want 25", age)
	}
}
