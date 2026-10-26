package api

import (
	"errors"
	"net/http"

	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/family"
)

// handleError 将业务错误映射为稳定的 HTTP 状态码与中文提示，隐藏内部细节。
func (s *Server) handleError(w http.ResponseWriter, err error, operation string) {
	if err == nil {
		return
	}
	var validation *family.ValidationError
	switch {
	case errors.As(err, &validation):
		writeError(w, http.StatusBadRequest, validation.Message)
	case errors.Is(err, auth.ErrSignupDisabled):
		writeError(w, http.StatusForbidden, auth.ErrSignupDisabled.Error())
	case errors.Is(err, domain.ErrEmailTaken):
		writeError(w, http.StatusConflict, "该邮箱已注册")
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "邮箱或密码错误")
	case errors.Is(err, auth.ErrInvalidEmail):
		writeError(w, http.StatusBadRequest, auth.ErrInvalidEmail.Error())
	case errors.Is(err, auth.ErrWeakPassword):
		writeError(w, http.StatusBadRequest, auth.ErrWeakPassword.Error())
	case errors.Is(err, auth.ErrPasswordTooLong):
		writeError(w, http.StatusBadRequest, auth.ErrPasswordTooLong.Error())
	case errors.Is(err, domain.ErrInvalidSession):
		writeError(w, http.StatusUnauthorized, "登录已过期，请重新登录")
	case errors.Is(err, domain.ErrInvalidResetToken):
		writeError(w, http.StatusBadRequest, "重置链接无效或已过期")
	case errors.Is(err, domain.ErrInvalidFather):
		writeError(w, http.StatusBadRequest, "父亲成员不存在")
	case errors.Is(err, domain.ErrCycle):
		writeError(w, http.StatusBadRequest, "父子关系不能形成环")
	case errors.Is(err, domain.ErrHasChildren):
		writeError(w, http.StatusConflict, "无法删除：仍有成员以这些成员为父亲")
	case errors.Is(err, domain.ErrDuplicate):
		writeError(w, http.StatusConflict, "记录已存在，请检查重复数据")
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "记录不存在")
	default:
		s.logger.Error("处理请求失败", "operation", operation, "error", err)
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
	}
}
