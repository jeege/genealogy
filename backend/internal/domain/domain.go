// Package domain 定义后端与前端共享的数据结构。
package domain

import "time"

// User 是族谱系统的登录用户。一个部署共享一份族谱，所有用户权限相同。
type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PublicUser 是可以返回给浏览器的用户信息，不含密码散列。
type PublicUser struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

func (u User) Public() PublicUser {
	return PublicUser{ID: u.ID, Email: u.Email, CreatedAt: u.CreatedAt}
}

// Member 是族谱成员。可空字段使用指针，便于前端区分空字符串与未填写。
type Member struct {
	ID               int64     `json:"id"`
	Name             string    `json:"name"`
	Generation       *int      `json:"generation"`
	SiblingOrder     *int      `json:"sibling_order"`
	FatherID         *int64    `json:"father_id"`
	FatherName       *string   `json:"father_name"`
	Gender           *string   `json:"gender"`
	OfficialPosition *string   `json:"official_position"`
	IsAlive          bool      `json:"is_alive"`
	Spouse           *string   `json:"spouse"`
	Remarks          *string   `json:"remarks"`
	Birthday         *string   `json:"birthday"`
	DeathDate        *string   `json:"death_date"`
	ResidencePlace   *string   `json:"residence_place"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// MemberInput 是新增或更新成员的输入。PUT 语义下 nil 表示清空该字段。
type MemberInput struct {
	Name             string
	Generation       *int
	SiblingOrder     *int
	FatherID         *int64
	Gender           *string
	OfficialPosition *string
	IsAlive          *bool
	Spouse           *string
	Remarks          *string
	Birthday         *string
	DeathDate        *string
	ResidencePlace   *string
}

// MemberOption 用于父亲选择下拉框。
type MemberOption struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Generation *int   `json:"generation"`
}

// TimelineMember 是时间轴需要的最小字段集。
type TimelineMember struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Birthday   *string `json:"birthday"`
	DeathDate  *string `json:"death_date"`
	Generation *int    `json:"generation"`
}

// StatisticsMember 是服务端统计所需的最小字段集。
type StatisticsMember struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Gender     *string `json:"gender"`
	Generation *int    `json:"generation"`
	IsAlive    bool    `json:"is_alive"`
	Birthday   *string `json:"birthday"`
}

// ImportMember 是从 Excel/CSV 解析后的导入行。世代可空，父亲姓名按上一世代匹配。
type ImportMember struct {
	Name             string  `json:"name"`
	Generation       *int    `json:"generation"`
	SiblingOrder     *int    `json:"sibling_order"`
	FatherName       *string `json:"father_name"`
	Gender           *string `json:"gender"`
	OfficialPosition *string `json:"official_position"`
	IsAlive          *bool   `json:"is_alive"`
	Spouse           *string `json:"spouse"`
	Remarks          *string `json:"remarks"`
	Birthday         *string `json:"birthday"`
	ResidencePlace   *string `json:"residence_place"`
}

// ImportFatherCandidate 是数据库中可能匹配为父亲的成员。
type ImportFatherCandidate struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Generation *int   `json:"generation"`
}

// ImportFatherMatch 描述某个导入行的父亲来源。null 表示该行没有填写父亲。
type ImportFatherMatch struct {
	Source string `json:"source"`
	ID     *int64 `json:"id,omitempty"`
	Index  *int   `json:"index,omitempty"`
}

// StatisticsData 是统计仪表盘的数据结构。
type StatisticsData struct {
	TotalMembers    int          `json:"totalMembers"`
	GenderStats     []ChartValue `json:"genderStats"`
	GenerationStats []NamedCount `json:"generationStats"`
	StatusStats     []ChartValue `json:"statusStats"`
	AgeStats        []NamedCount `json:"ageStats"`
	CommonNames     []NameCount  `json:"commonNames"`
}

// ChartValue 是带颜色的饼图数据。
type ChartValue struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
	Fill  string `json:"fill"`
}

// NamedCount 是柱状图数据。
type NamedCount struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

// NameCount 是姓名用字排行数据。
type NameCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
