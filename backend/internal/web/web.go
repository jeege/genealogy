// Package web 内嵌纯前端（Vite + React）构建产物，并提供 SPA 文件服务。
package web

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"strings"
)

//go:embed all:dist
var embedded embed.FS

// EmbeddedFS 返回内嵌的 dist 目录。
func EmbeddedFS() (fs.FS, error) {
	return fs.Sub(embedded, "dist")
}

// Handler 服务静态资源；找不到对应文件的导航请求回退到 index.html，
// 以支持 React Router 的 history 路由。
type Handler struct {
	fs     fs.FS
	logger *slog.Logger
}

func New(fsys fs.FS, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{fs: fsys, logger: logger}
}

// isAssetPath 判断请求是否指向静态资源（带扩展名或位于 assets/、images/）。
// 这类请求不应回退到 index.html，否则 JS/CSS 404 会被当成 HTML 解析。
func isAssetPath(clean string) bool {
	if filepath.Ext(clean) != "" {
		return true
	}
	return strings.HasPrefix(clean, "/assets/") || strings.HasPrefix(clean, "/images/")
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.notFound(w, r)
		return
	}
	requestPath := r.URL.Path
	if requestPath == "" {
		requestPath = "/"
	}
	clean := path.Clean("/" + requestPath)
	relative := strings.TrimPrefix(clean, "/")
	name := "index.html"
	if relative != "" && relative != "." {
		name = relative
	}
	if !fs.ValidPath(name) {
		h.notFound(w, r)
		return
	}

	if h.serveFile(w, r, name) {
		return
	}
	// SPA 回退：非资源路径一律返回 index.html，由前端路由渲染对应页面。
	if !isAssetPath(clean) {
		if h.serveFile(w, r, "index.html") {
			return
		}
	}
	h.notFound(w, r)
}

func (h *Handler) serveFile(w http.ResponseWriter, r *http.Request, name string) bool {
	file, err := h.fs.Open(name)
	if err != nil {
		return false
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	data, err := io.ReadAll(file)
	if err != nil {
		return false
	}

	extension := strings.ToLower(filepath.Ext(name))
	switch {
	case strings.HasPrefix(name, "assets/"):
		// Vite 产物文件名带内容哈希，可长期缓存。
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case extension == ".html":
		// index.html 必须每次确认，避免发版后仍引用旧资源。
		w.Header().Set("Cache-Control", "no-cache")
	default:
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	if contentType := mime.TypeByExtension(extension); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), bytes.NewReader(data))
	return true
}

func (h *Handler) notFound(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	// 页面路径由前端路由展示「页面不存在」，但 HTTP 状态必须是 404。
	page, err := fs.ReadFile(h.fs, "index.html")
	if err != nil {
		http.Error(w, "页面不存在", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		_, _ = w.Write(page)
	}
}
