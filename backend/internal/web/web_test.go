package web

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":              &fstest.MapFile{Data: []byte("<html>app</html>")},
		"assets/index-abc123.js":  &fstest.MapFile{Data: []byte("console.log(1)")},
		"assets/index-abc123.css": &fstest.MapFile{Data: []byte("body{}")},
		"images/login-bg.jpg":     &fstest.MapFile{Data: []byte("jpg")},
		"icon.png":                &fstest.MapFile{Data: []byte("png")},
	}
}

func serve(t *testing.T, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	handler := New(testFS(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(method, target, nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestServesSPAEntryForPageRoutes(t *testing.T) {
	// React Router 的 history 路由：所有页面路径都返回同一个 index.html。
	for _, target := range []string{"/", "/family-tree", "/family-tree/", "/family-tree/graph", "/family-tree/graph-3d", "/auth/login", "/deep/unknown/path"} {
		response := serve(t, http.MethodGet, target)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "app") {
			t.Fatalf("%s 应返回 SPA 入口：%d %q", target, response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-cache" {
			t.Fatalf("%s 的 HTML 缓存头错误：%s", target, response.Header().Get("Cache-Control"))
		}
	}
}

func TestServesHashedAssetsWithLongCache(t *testing.T) {
	asset := serve(t, http.MethodGet, "/assets/index-abc123.js")
	if asset.Code != http.StatusOK || !strings.Contains(asset.Body.String(), "console.log") {
		t.Fatalf("静态资源错误：%d %q", asset.Code, asset.Body.String())
	}
	if asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("哈希资源缓存头错误：%s", asset.Header().Get("Cache-Control"))
	}
	if !strings.Contains(asset.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("JS Content-Type 错误：%s", asset.Header().Get("Content-Type"))
	}

	css := serve(t, http.MethodGet, "/assets/index-abc123.css")
	if css.Code != http.StatusOK || !strings.Contains(css.Header().Get("Content-Type"), "css") {
		t.Fatalf("CSS 响应错误：%d %s", css.Code, css.Header().Get("Content-Type"))
	}
}

func TestImageAndRootAssetsUseDailyCache(t *testing.T) {
	for _, target := range []string{"/images/login-bg.jpg", "/icon.png"} {
		response := serve(t, http.MethodGet, target)
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, max-age=86400" {
			t.Fatalf("%s 缓存头错误：%d %s", target, response.Code, response.Header().Get("Cache-Control"))
		}
	}
}

func TestMissingAssetDoesNotFallBackToHTML(t *testing.T) {
	// 缺失的 JS/CSS 必须返回 404，否则浏览器会把 HTML 当脚本解析。
	for _, target := range []string{"/assets/missing.js", "/images/missing.png"} {
		response := serve(t, http.MethodGet, target)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s 应返回 404：%d %q", target, response.Code, response.Body.String())
		}
	}
}

func TestPostIsNotServedAsPage(t *testing.T) {
	response := serve(t, http.MethodPost, "/family-tree")
	if response.Code != http.StatusNotFound {
		t.Fatalf("非 GET 请求不应返回页面：%d", response.Code)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	response := serve(t, http.MethodGet, "/../../etc/passwd")
	// 穿越路径被清理后回退到 SPA 入口，或返回 404，绝不能读出文件系统内容。
	if strings.Contains(response.Body.String(), "root:") {
		t.Fatalf("路径穿越读取到了系统文件：%q", response.Body.String())
	}
}
