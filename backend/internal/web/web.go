// Package web 内嵌 Next.js 静态导出产物，并提供适用于静态站点的文件服务。
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

// Handler 服务静态文件，并为无扩展名目录自动补尾部斜杠。
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

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestPath := r.URL.Path
	if requestPath == "" {
		requestPath = "/"
	}
	clean := path.Clean("/" + requestPath)

	// 目录索引必须带尾部斜杠，避免相对资源路径错位。
	if clean != "/" && !strings.HasSuffix(requestPath, "/") && filepath.Ext(clean) == "" {
		index := path.Join(strings.TrimPrefix(clean, "/"), "index.html")
		if h.isFile(index) {
			target := clean + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusMovedPermanently)
			return
		}
	}

	relative := strings.TrimPrefix(clean, "/")
	name := relative
	if relative == "" || relative == "." {
		name = "index.html"
	} else if strings.HasSuffix(clean, "/") {
		name = path.Join(relative, "index.html")
	}
	if !fs.ValidPath(name) {
		h.notFound(w, r)
		return
	}
	if h.serveFile(w, r, name) {
		return
	}
	if filepath.Ext(name) == "" {
		if h.serveFile(w, r, name+".html") {
			return
		}
		if h.serveFile(w, r, path.Join(name, "index.html")) {
			return
		}
	}
	h.notFound(w, r)
}

func (h *Handler) isFile(name string) bool {
	file, err := h.fs.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	return err == nil && !info.IsDir()
}

func (h *Handler) serveFile(w http.ResponseWriter, r *http.Request, name string) bool {
	file, err := h.fs.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
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
	case strings.HasPrefix(name, "_next/static/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case extension == ".html" || extension == ".txt":
		// HTML 与 RSC 载荷需要每次向服务器确认，避免客户端路由拿到过期页面。
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
	page, err := fs.ReadFile(h.fs, "404.html")
	if err != nil {
		http.Error(w, "页面不存在", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write(page)
}
