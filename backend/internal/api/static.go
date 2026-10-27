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
	// 只有受保护的页面导航需要服务端鉴权；前端数据请求遇到 401 会跳转登录页。
	// 静态资源（/assets、/images、带扩展名）不做重定向，否则页面资源会拿到 HTML。
	if isProtectedPage(r.URL.Path) && !isStaticAssetRequest(r.URL.Path) {
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

// isStaticAssetRequest 判断请求是否是要静态资源而非页面导航。
func isStaticAssetRequest(path string) bool {
	if strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/images/") {
		return true
	}
	lastSegment := path[strings.LastIndex(path, "/")+1:]
	return strings.Contains(lastSegment, ".")
}

func redirectToLogin(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/auth/login/", http.StatusFound)
}
