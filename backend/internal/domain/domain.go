// Package domain 定义后端与前端共享的数据结构。
package domain

import "time"

// User 是族谱系统的登录用户。一个部署共享一份族谱，所有用户权限相同。
type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PublicUser 是可以返回给浏览器的用户信息，不含密码散列。
type PublicUser struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

func (u User) Public() PublicUser {
	return PublicUser{ID: u.ID, Username: u.Username, CreatedAt: u.CreatedAt}
}

// Member 是族谱成员。可空字段使用指针，便于前端区分空字符串与未填写。
type Member struct {
	ID               int64   `json:"id"`
	Name             string  `json:"name"`
	Generation       *int    `json:"generation"`
	SiblingOrder     *int    `json:"sibling_order"`
	FatherID         *int64  `json:"father_id"`
	FatherName       *string `json:"father_name"`
	Gender           *string `json:"gender"`
	OfficialPosition *string `json:"official_position"`
	IsAlive          bool    `json:"is_alive"`
	Remarks          *string `json:"remarks"`
	Birthday         *string `json:"birthday"`
	DeathDate        *string `json:"death_date"`
	BirthDateRaw     *string `json:"birth_date_raw"`
	DeathDateRaw     *string `json:"death_date_raw"`
	ResidencePlace   *string `json:"residence_place"`
	// Spouses 是婚姻关系摘要；配偶只能通过 marriages 表表达，不再有自由文本备注。
	Spouses   []SpouseLink `json:"spouses"`
	UpdatedAt time.Time    `json:"updated_at"`
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
	Remarks          *string
	Birthday         *string
	DeathDate        *string
	BirthDateRaw     *string
	DeathDateRaw     *string
	ResidencePlace   *string
	// SpouseIDs 为要建立的配偶成员 ID；提交后同步为该成员的婚姻记录。
	// nil 表示不改变现有婚姻；空切片表示解除全部配偶关系。
	SpouseIDs  *[]int64
	SpouseNote *string
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

// GEDCOMDate 是 GEDCOM 日期字段：保留原始表达式，同时给出可存库的近似 ISO 日期。
// Raw 为空表示没有该事件；ISO 为空表示只知道年份或无法转换为具体日期。
type GEDCOMDate struct {
	Raw  string  `json:"raw"`
	ISO  *string `json:"iso"`
	Year *int    `json:"year"`
}

// GEDCOMMember 是解析后尚未写入数据库的成员，Xref 用于在同一文件内解析关系。
type GEDCOMMember struct {
	Xref             string     `json:"xref"`
	Name             string     `json:"name"`
	Surname          string     `json:"surname"`
	GivenNames       string     `json:"given_names"`
	Gender           *string    `json:"gender"`
	Generation       *int       `json:"generation"`
	SiblingOrder     *int       `json:"sibling_order"`
	Remarks          *string    `json:"remarks"`
	ResidencePlace   *string    `json:"residence_place"`
	OfficialPosition *string    `json:"official_position"`
	IsAlive          *bool      `json:"is_alive"`
	Birth            GEDCOMDate `json:"birth"`
	Death            GEDCOMDate `json:"death"`
	FatherXref       *string    `json:"father_xref"`
	FamilyAsChild    *string    `json:"family_as_child"`
	SpouseXrefs      []string   `json:"spouse_xrefs"`
}

// GEDCOMUnion 是 GEDCOM FAM 记录表达的一段配偶关系。
type GEDCOMUnion struct {
	HusbandXref   string     `json:"husband_xref"`
	WifeXref      *string    `json:"wife_xref"`
	FamilyXref    string     `json:"family_xref"`
	Status        string     `json:"status"`
	Married       GEDCOMDate `json:"married"`
	Divorced      GEDCOMDate `json:"divorced"`
	ChildrenXrefs []string   `json:"children_xrefs"`
}

// GEDCOMImportPreview 是导入前的统计与问题清单，不写入数据库。
type GEDCOMImportPreview struct {
	Encoding        string   `json:"encoding"`
	Version         string   `json:"version"`
	Members         int      `json:"members"`
	Families        int      `json:"families"`
	Unions          int      `json:"unions"`
	WithFather      int      `json:"with_father"`
	WithBirthDate   int      `json:"with_birth_date"`
	MissingName     int      `json:"missing_name"`
	DuplicateNames  int      `json:"duplicate_names"`
	IgnoredRecords  int      `json:"ignored_records"`
	UnsupportedTags []string `json:"unsupported_tags"`
	Warnings        []string `json:"warnings"`
}

// GEDCOMImportRequest 是导入接口的请求体。
type GEDCOMImportRequest struct {
	Content string `json:"content"`
	// Replace 为 true 时先清空并重建族谱；默认只追加。
	Replace bool `json:"replace"`
}

// GEDCOMImportResult 是导入结果。
type GEDCOMImportResult struct {
	Members  int      `json:"members"`
	Families int      `json:"families"`
	Unions   int      `json:"unions"`
	Warnings []string `json:"warnings"`
}

// MarriageStatus 是婚姻状态。
type MarriageStatus string

const (
	MarriageMarried  MarriageStatus = "married"
	MarriageDivorced MarriageStatus = "divorced"
	MarriageWidowed  MarriageStatus = "widowed"
)

// Marriage 是一段配偶关系。Wife 可为空，用于只知道配偶姓名的历史记录。
type Marriage struct {
	ID         int64          `json:"id"`
	HusbandID  int64          `json:"husband_id"`
	Husband    string         `json:"husband_name"`
	WifeID     *int64         `json:"wife_id"`
	Wife       *string        `json:"wife_name"`
	Status     MarriageStatus `json:"status"`
	MarriedOn  *string        `json:"married_on"`
	DivorcedOn *string        `json:"divorced_on"`
	// 原始 GEDCOM 日期文本，保证导入导出往返不丢失「ABT/BEF」等精度。
	MarriedOnRaw  *string   `json:"married_on_raw"`
	DivorcedOnRaw *string   `json:"divorced_on_raw"`
	Note          *string   `json:"note"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// MemberPhoto 是成员的一张照片。
//
// 数据库只存相对路径，URL 由 API 层按 PhotoURLPrefix 拼出，
// 这样更换存储根目录或反向代理前缀都不需要刷库。
type MemberPhoto struct {
	ID        int64     `json:"id"`
	MemberID  int64     `json:"member_id"`
	URL       string    `json:"url"`
	ThumbURL  string    `json:"thumbnail_url"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	ByteSize  int64     `json:"byte_size"`
	Caption   *string   `json:"caption"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}

// MemberPhotoInput 是保存照片时的元信息（路径来自存储层）。
type MemberPhotoInput struct {
	MemberID      int64
	OriginalPath  string
	ThumbnailPath string
	Width         int
	Height        int
	ByteSize      int64
	Caption       *string
}

// MarriageInput 是新增或更新配偶关系的输入。
type MarriageInput struct {
	HusbandID     int64
	WifeID        *int64
	Status        MarriageStatus
	MarriedOn     *string
	DivorcedOn    *string
	MarriedOnRaw  *string
	DivorcedOnRaw *string
	Note          *string
}

// SpouseLink 是成员列表/关系图中展示的配偶摘要。
type SpouseLink struct {
	MarriageID int64  `json:"marriage_id"`
	PartnerID  *int64 `json:"partner_id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
}
