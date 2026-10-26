package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"familySurname": s.cfg.FamilySurname})
}

func isProtectedPage(path string) bool {
	return path == "/" || path == "/family-tree" || strings.HasPrefix(path, "/family-tree/")
}

// handleStatic 托管内嵌前端；族谱页面在返回 HTML 前校验服务端会话。
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "接口不存在")
		return
	}
	if s.static == nil {
		writeError(w, http.StatusNotFound, "前端静态资源未构建")
		return
	}
	// RSC 载荷只包含页面骨架，不包含族谱数据；允许其加载后由 API 的 401
	// 统一跳转登录，避免客户端路由把 HTML 登录页当作 RSC 解析而报错。
	if isProtectedPage(r.URL.Path) && !isRSCRequest(r) && !strings.HasSuffix(r.URL.Path, ".txt") {
		cookie, err := r.Cookie(SessionCookieName)
		if err != nil || cookie.Value == "" {
			redirectToLogin(w, r)
			return
		}
		if _, err := s.auth.Authenticate(r.Context(), cookie.Value); err != nil {
			if errors.Is(err, domain.ErrInvalidSession) {
				s.clearSessionCookie(w, r)
				redirectToLogin(w, r)
				return
			}
			s.logger.Error("校验页面会话失败", "error", err)
			writeError(w, http.StatusInternalServerError, "服务器内部错误")
			return
		}
	}
	s.static.ServeHTTP(w, r)
}

func isRSCRequest(r *http.Request) bool {
	return r.Header.Get("RSC") == "1" || r.URL.Query().Has("_rsc")
}

func redirectToLogin(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/auth/login/", http.StatusFound)
}
