package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

type marriagePayload struct {
	HusbandID  *int64  `json:"husband_id"`
	WifeID     *int64  `json:"wife_id"`
	Status     *string `json:"status"`
	MarriedOn  *string `json:"married_on"`
	DivorcedOn *string `json:"divorced_on"`
	Note       *string `json:"note"`
}

func (p marriagePayload) toInput() (domain.MarriageInput, error) {
	if p.HusbandID == nil || *p.HusbandID <= 0 {
		return domain.MarriageInput{}, errors.New("请选择配偶关系中的成员")
	}
	input := domain.MarriageInput{
		HusbandID: *p.HusbandID,
		WifeID:    p.WifeID,
		Status:    domain.MarriageMarried,
		Note:      trimmed(p.Note),
	}
	if p.WifeID != nil {
		if *p.WifeID <= 0 {
			return domain.MarriageInput{}, errors.New("配偶 ID 无效")
		}
		if *p.WifeID == *p.HusbandID {
			return domain.MarriageInput{}, errors.New("丈夫与妻子不能是同一个人")
		}
	}
	if p.Status != nil {
		status := domain.MarriageStatus(strings.TrimSpace(*p.Status))
		switch status {
		case "", domain.MarriageMarried:
		case domain.MarriageDivorced, domain.MarriageWidowed:
			input.Status = status
		default:
			return domain.MarriageInput{}, errors.New("婚姻状态只能是 married、divorced 或 widowed")
		}
	}
	marriedOn, err := normalizeDate(p.MarriedOn, "结婚日期")
	if err != nil {
		return domain.MarriageInput{}, err
	}
	divorcedOn, err := normalizeDate(p.DivorcedOn, "解除婚姻日期")
	if err != nil {
		return domain.MarriageInput{}, err
	}
	if marriedOn != nil && divorcedOn != nil && *divorcedOn < *marriedOn {
		return domain.MarriageInput{}, errors.New("解除婚姻日期不能早于结婚日期")
	}
	input.MarriedOn = marriedOn
	input.DivorcedOn = divorcedOn
	return input, nil
}

func (s *Server) handleListMarriages(w http.ResponseWriter, r *http.Request) {
	memberID, err := parseMemberID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	marriages, err := s.members.ListMarriages(r.Context(), memberID)
	if err != nil {
		s.handleError(w, err, "读取配偶关系")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": marriages})
}

func (s *Server) handleCreateMarriage(w http.ResponseWriter, r *http.Request) {
	var payload marriagePayload
	if err := decodeJSON(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	input, err := payload.toInput()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	marriage, err := s.members.CreateMarriage(r.Context(), input)
	if err != nil {
		s.handleError(w, err, "新增配偶关系")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": marriage})
}

func (s *Server) handleUpdateMarriage(w http.ResponseWriter, r *http.Request) {
	marriageID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var payload marriagePayload
	if err := decodeJSON(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	input, err := payload.toInput()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	marriage, err := s.members.UpdateMarriage(r.Context(), marriageID, input)
	if err != nil {
		s.handleError(w, err, "更新配偶关系")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": marriage})
}

func (s *Server) handleDeleteMarriage(w http.ResponseWriter, r *http.Request) {
	marriageID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.members.DeleteMarriage(r.Context(), marriageID); err != nil {
		s.handleError(w, err, "解除配偶关系")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseRouteID(r *http.Request) (int64, error) {
	id, err := parseMemberID(r)
	if err != nil {
		return 0, errors.New("配偶关系 ID 无效")
	}
	return id, nil
}

// replaceSpousesFromInput 处理成员新增/更新时提交的配偶 ID 列表。
func (s *Server) replaceSpousesFromInput(r *http.Request, memberID int64, input domain.MemberInput) error {
	if input.SpouseIDs == nil {
		return nil
	}
	return s.members.ReplaceSpouses(r.Context(), memberID, *input.SpouseIDs, input.SpouseNote)
}
