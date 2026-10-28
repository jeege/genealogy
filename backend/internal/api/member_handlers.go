package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/family"
)

type memberPayload struct {
	Name             string  `json:"name"`
	Generation       *int    `json:"generation"`
	SiblingOrder     *int    `json:"sibling_order"`
	FatherID         *int64  `json:"father_id"`
	Gender           *string `json:"gender"`
	OfficialPosition *string `json:"official_position"`
	IsAlive          *bool   `json:"is_alive"`
	Remarks          *string `json:"remarks"`
	Birthday         *string `json:"birthday"`
	DeathDate        *string `json:"death_date"`
	ResidencePlace   *string `json:"residence_place"`
	// SpouseIDs 用于在同一请求中维护配偶关系；不传表示保持不变。
	SpouseIDs  *[]int64 `json:"spouse_ids"`
	SpouseNote *string  `json:"spouse_note"`
}

func (p memberPayload) toInput() (domain.MemberInput, error) {
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return domain.MemberInput{}, errors.New("请输入姓名")
	}
	if utf8.RuneCountInString(name) > 200 {
		return domain.MemberInput{}, errors.New("姓名不能超过 200 个字符")
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return domain.MemberInput{}, errors.New("姓名不能包含控制字符")
		}
	}
	if p.Generation != nil && (*p.Generation < 1 || *p.Generation > 2147483647) {
		return domain.MemberInput{}, errors.New("世代必须为正整数")
	}
	if p.FatherID != nil && *p.FatherID <= 0 {
		return domain.MemberInput{}, errors.New("父亲 ID 无效")
	}
	if p.SiblingOrder != nil && *p.SiblingOrder < 0 {
		return domain.MemberInput{}, errors.New("排行不能为负数")
	}
	var gender *string
	if p.Gender != nil {
		value := strings.TrimSpace(*p.Gender)
		if value != "" && value != "男" && value != "女" {
			return domain.MemberInput{}, errors.New("性别只能是「男」或「女」")
		}
		if value != "" {
			gender = &value
		}
	}
	birthday, err := normalizeDate(p.Birthday, "生日")
	if err != nil {
		return domain.MemberInput{}, err
	}
	deathDate, err := normalizeDate(p.DeathDate, "卒年")
	if err != nil {
		return domain.MemberInput{}, err
	}
	return domain.MemberInput{
		Name:             name,
		Generation:       p.Generation,
		SiblingOrder:     p.SiblingOrder,
		FatherID:         p.FatherID,
		Gender:           gender,
		OfficialPosition: trimmed(p.OfficialPosition),
		IsAlive:          p.IsAlive,
		Remarks:          trimmed(p.Remarks),
		Birthday:         birthday,
		DeathDate:        deathDate,
		ResidencePlace:   trimmed(p.ResidencePlace),
		SpouseIDs:        p.SpouseIDs,
		SpouseNote:       trimmed(p.SpouseNote),
	}, nil
}

func normalizeDate(value *string, field string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil, nil
	}
	if _, err := time.Parse("2006-01-02", cleaned); err != nil {
		return nil, fmt.Errorf("%s格式必须为 YYYY-MM-DD", field)
	}
	return &cleaned, nil
}

func parseMemberID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("成员 ID 无效")
	}
	return id, nil
}

func positiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	page := positiveInt(query.Get("page"), 1)
	if page > 10_000_000 {
		page = 10_000_000
	}
	pageSize := positiveInt(query.Get("page_size"), 50)
	if pageSize > 200 {
		pageSize = 200
	}
	search := strings.TrimSpace(query.Get("search"))
	if utf8.RuneCountInString(search) > 100 {
		writeError(w, http.StatusBadRequest, "搜索关键词不能超过 100 个字符")
		return
	}

	members, total, err := s.members.ListMembers(r.Context(), page, pageSize, search)
	if err != nil {
		s.handleError(w, err, "读取成员列表")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"data": members, "count": total, "page": page, "page_size": pageSize,
	})
}

func (s *Server) handleAllMembers(w http.ResponseWriter, r *http.Request) {
	members, err := s.members.ListAllMembers(r.Context())
	if err != nil {
		s.handleError(w, err, "读取全部成员")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": members})
}

func (s *Server) handleMemberOptions(w http.ResponseWriter, r *http.Request) {
	options, err := s.members.ListMemberOptions(r.Context())
	if err != nil {
		s.handleError(w, err, "读取父亲候选")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": options})
}

func (s *Server) handleTimeline(w http.ResponseWriter, r *http.Request) {
	members, err := s.members.ListMembersForTimeline(r.Context())
	if err != nil {
		s.handleError(w, err, "读取时间轴")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": members})
}

func (s *Server) handleBiography(w http.ResponseWriter, r *http.Request) {
	members, err := s.members.ListBiographyMembers(r.Context())
	if err != nil {
		s.handleError(w, err, "读取生平册")
		return
	}
	withBiography := make([]domain.Member, 0, len(members))
	for _, member := range members {
		if family.HasBiography(member.Remarks) {
			withBiography = append(withBiography, member)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": withBiography})
}

func (s *Server) handleGetMember(w http.ResponseWriter, r *http.Request) {
	id, err := parseMemberID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	member, err := s.members.GetMember(r.Context(), id)
	if err != nil {
		s.handleError(w, err, "读取成员")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": member})
}

func (s *Server) handleCreateMember(w http.ResponseWriter, r *http.Request) {
	var payload memberPayload
	if err := decodeJSON(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	input, err := payload.toInput()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.FatherID != nil {
		if err := s.members.ValidateFather(r.Context(), 0, *input.FatherID); err != nil {
			s.handleError(w, err, "校验父亲")
			return
		}
	}
	member, err := s.members.CreateMember(r.Context(), input)
	if err != nil {
		s.handleError(w, err, "新增成员")
		return
	}
	if err := s.replaceSpousesFromInput(r, member.ID, input); err != nil {
		s.handleError(w, err, "保存配偶关系")
		return
	}
	if input.SpouseIDs != nil {
		if refreshed, err := s.members.GetMember(r.Context(), member.ID); err == nil {
			member = refreshed
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": member})
}

func (s *Server) handleUpdateMember(w http.ResponseWriter, r *http.Request) {
	id, err := parseMemberID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var payload memberPayload
	if err := decodeJSON(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	input, err := payload.toInput()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.FatherID != nil {
		if err := s.members.ValidateFather(r.Context(), id, *input.FatherID); err != nil {
			s.handleError(w, err, "校验父亲")
			return
		}
	}
	member, err := s.members.UpdateMember(r.Context(), id, input)
	if err != nil {
		s.handleError(w, err, "更新成员")
		return
	}
	if err := s.replaceSpousesFromInput(r, member.ID, input); err != nil {
		s.handleError(w, err, "保存配偶关系")
		return
	}
	if input.SpouseIDs != nil {
		if refreshed, err := s.members.GetMember(r.Context(), member.ID); err == nil {
			member = refreshed
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": member})
}

func (s *Server) handleDeleteMembers(w http.ResponseWriter, r *http.Request) {
	var request struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(request.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "没有选择要删除的成员")
		return
	}
	if len(request.IDs) > 1000 {
		writeError(w, http.StatusBadRequest, "单次最多删除 1000 条记录")
		return
	}
	for _, id := range request.IDs {
		if id <= 0 {
			writeError(w, http.StatusBadRequest, "成员 ID 无效")
			return
		}
	}
	deleted, err := s.members.DeleteMembers(r.Context(), request.IDs)
	if err != nil {
		s.handleError(w, err, "删除成员")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "deleted": deleted})
}

func (s *Server) handlePreviewImport(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Members []domain.ImportMember `json:"members"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	members, err := family.NormalizeImportMembers(request.Members)
	if err != nil {
		s.handleError(w, err, "校验导入数据")
		return
	}
	fathers, err := s.members.ResolveImportFathers(r.Context(), members)
	if err != nil {
		s.handleError(w, err, "检查导入父亲")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"fathers": fathers})
}

func (s *Server) handleImportMembers(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Members []domain.ImportMember `json:"members"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	members, err := family.NormalizeImportMembers(request.Members)
	if err != nil {
		s.handleError(w, err, "校验导入数据")
		return
	}
	count, err := s.members.ImportMembers(r.Context(), members)
	if err != nil {
		s.handleError(w, err, "批量导入")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "count": count})
}

func (s *Server) handleStatistics(w http.ResponseWriter, r *http.Request) {
	members, err := s.members.ListMembersForStatistics(r.Context())
	if err != nil {
		s.handleError(w, err, "读取统计数据")
		return
	}
	data := family.ComputeStatistics(members, s.now())
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}
