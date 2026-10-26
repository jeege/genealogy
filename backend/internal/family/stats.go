package family

import (
	"fmt"
	"sort"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

var ageGroupOrder = []string{
	"0-10岁", "11-20岁", "21-30岁", "31-40岁", "41-50岁",
	"51-60岁", "61-70岁", "71-80岁", "80岁以上",
}

// ComputeStatistics 在服务端对完整成员集合汇总统计。
func ComputeStatistics(members []domain.StatisticsMember, now time.Time) domain.StatisticsData {
	genderCounts := map[string]int{}
	generationCounts := map[int]int{}
	unknownGeneration := 0
	statusCounts := map[string]int{}
	ageGroups := make(map[string]int, len(ageGroupOrder))
	for _, name := range ageGroupOrder {
		ageGroups[name] = 0
	}
	givenNameChars := map[string]int{}

	for _, member := range members {
		gender := "未知"
		if member.Gender != nil && (*member.Gender == "男" || *member.Gender == "女") {
			gender = *member.Gender
		}
		genderCounts[gender]++

		if member.Generation == nil || *member.Generation <= 0 {
			unknownGeneration++
		} else {
			generationCounts[*member.Generation]++
		}

		if member.IsAlive {
			statusCounts["在世"]++
		} else {
			statusCounts["已故"]++
		}

		if member.IsAlive && member.Birthday != nil {
			if birthday, err := time.Parse("2006-01-02", *member.Birthday); err == nil {
				ageGroups[ageGroupFor(ageAt(birthday, now))]++
			}
		}

		runes := []rune(member.Name)
		if len(runes) >= 2 {
			givenNameChars[string(runes[1])]++
		}
	}

	genderStats := []domain.ChartValue{
		{Name: "男", Value: genderCounts["男"], Fill: "#3b82f6"},
		{Name: "女", Value: genderCounts["女"], Fill: "#ec4899"},
	}
	if genderCounts["未知"] > 0 {
		genderStats = append(genderStats, domain.ChartValue{
			Name: "未知", Value: genderCounts["未知"], Fill: "#94a3b8",
		})
	}

	generations := make([]int, 0, len(generationCounts))
	for generation := range generationCounts {
		generations = append(generations, generation)
	}
	sort.Ints(generations)
	generationStats := make([]domain.NamedCount, 0, len(generations)+1)
	for _, generation := range generations {
		generationStats = append(generationStats, domain.NamedCount{
			Name:  fmt.Sprintf("第%d世", generation),
			Value: generationCounts[generation],
		})
	}
	if unknownGeneration > 0 {
		generationStats = append(generationStats, domain.NamedCount{Name: "未知", Value: unknownGeneration})
	}

	statusStats := []domain.ChartValue{
		{Name: "在世", Value: statusCounts["在世"], Fill: "#22c55e"},
		{Name: "已故", Value: statusCounts["已故"], Fill: "#64748b"},
	}

	ageStats := make([]domain.NamedCount, 0, len(ageGroupOrder))
	for _, name := range ageGroupOrder {
		ageStats = append(ageStats, domain.NamedCount{Name: name, Value: ageGroups[name]})
	}

	commonNames := make([]domain.NameCount, 0, len(givenNameChars))
	for name, count := range givenNameChars {
		commonNames = append(commonNames, domain.NameCount{Name: name, Count: count})
	}
	sort.Slice(commonNames, func(i, j int) bool {
		if commonNames[i].Count != commonNames[j].Count {
			return commonNames[i].Count > commonNames[j].Count
		}
		return commonNames[i].Name < commonNames[j].Name
	})
	if len(commonNames) > 10 {
		commonNames = commonNames[:10]
	}

	return domain.StatisticsData{
		TotalMembers:    len(members),
		GenderStats:     genderStats,
		GenerationStats: generationStats,
		StatusStats:     statusStats,
		AgeStats:        ageStats,
		CommonNames:     commonNames,
	}
}

func ageAt(birthday, now time.Time) int {
	age := now.Year() - birthday.Year()
	if now.Month() < birthday.Month() ||
		(now.Month() == birthday.Month() && now.Day() < birthday.Day()) {
		age--
	}
	return age
}

func ageGroupFor(age int) string {
	switch {
	case age <= 10:
		return "0-10岁"
	case age <= 20:
		return "11-20岁"
	case age <= 30:
		return "21-30岁"
	case age <= 40:
		return "31-40岁"
	case age <= 50:
		return "41-50岁"
	case age <= 60:
		return "51-60岁"
	case age <= 70:
		return "61-70岁"
	case age <= 80:
		return "71-80岁"
	default:
		return "80岁以上"
	}
}
