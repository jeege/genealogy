package api

import (
	"errors"
	"net/http"

	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

type credentialsRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (s *Server) handleSignUp(w http.ResponseWriter, r *http.Request) {
	var request credentialsRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	session, err := s.auth.SignUp(r.Context(), request.Username, request.Password)
	if err != nil {
		s.handleError(w, err, "注册")
		return
	}
	s.setSessionCookie(w, r, session)
	writeJSON(w, http.StatusCreated, map[string]any{"user": session.User.Public()})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var request credentialsRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	session, err := s.auth.Login(r.Context(), request.Username, request.Password)
	if err != nil {
		s.handleError(w, err, "登录")
		return
	}
	s.setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, map[string]any{"user": session.User.Public()})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" {
		if err := s.auth.Logout(r.Context(), cookie.Value); err != nil {
			// 退出登录保持幂等，记录日志但不阻止客户端清除 Cookie。
			s.logger.Warn("撤销会话失败", "error", err)
		}
	}
	s.clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	user, err := s.auth.Authenticate(r.Context(), cookie.Value)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidSession) {
			s.clearSessionCookie(w, r)
			writeError(w, http.StatusUnauthorized, "登录已过期，请重新登录")
			return
		}
		s.handleError(w, err, "读取会话")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user.Public()})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	user, ok := currentUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	var request changePasswordRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.auth.ChangePassword(r.Context(), user.ID, request.CurrentPassword, request.NewPassword); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeError(w, http.StatusBadRequest, "当前密码不正确")
			return
		}
		s.handleError(w, err, "修改密码")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
