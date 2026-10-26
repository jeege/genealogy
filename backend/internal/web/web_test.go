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
		"index.html":                   &fstest.MapFile{Data: []byte("<html>home</html>")},
		"404.html":                     &fstest.MapFile{Data: []byte("<html>missing</html>")},
		"auth/login/index.html":        &fstest.MapFile{Data: []byte("<html>login</html>")},
		"family-tree/index.html":       &fstest.MapFile{Data: []byte("<html>members</html>")},
		"family-tree/graph/index.html": &fstest.MapFile{Data: []byte("<html>graph</html>")},
		"family-tree/graph/index.txt":  &fstest.MapFile{Data: []byte("rsc payload")},
		"_next/static/chunks/app.js":   &fstest.MapFile{Data: []byte("console.log(1)")},
		"images/login-bg.jpg":          &fstest.MapFile{Data: []byte("jpg")},
	}
}

func serve(t *testing.T, target string) *httptest.ResponseRecorder {
	t.Helper()
	handler := New(testFS(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, target, nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestServesIndexAndDirectoryPages(t *testing.T) {
	for target, body := range map[string]string{
		"/":                   "home",
		"/auth/login/":        "login",
		"/family-tree/":       "members",
		"/family-tree/graph/": "graph",
	} {
		response := serve(t, target)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), body) {
			t.Fatalf("%s = %d %q", target, response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-cache" {
			t.Fatalf("%s 的 HTML 缓存头错误：%s", target, response.Header().Get("Cache-Control"))
		}
	}
}

func TestRedirectsDirectoryWithoutSlash(t *testing.T) {
	response := serve(t, "/family-tree/graph")
	if response.Code != http.StatusMovedPermanently || response.Header().Get("Location") != "/family-tree/graph/" {
		t.Fatalf("目录应重定向：%d %s", response.Code, response.Header().Get("Location"))
	}
}

func TestServesAssetsAndRSCPayloads(t *testing.T) {
	asset := serve(t, "/_next/static/chunks/app.js")
	if asset.Code != http.StatusOK || !strings.Contains(asset.Body.String(), "console.log") {
		t.Fatalf("静态资源错误：%d", asset.Code)
	}
	if asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("静态资源缓存头错误：%s", asset.Header().Get("Cache-Control"))
	}
	payload := serve(t, "/family-tree/graph/index.txt")
	if payload.Code != http.StatusOK || payload.Body.String() != "rsc payload" {
		t.Fatalf("RSC 载荷错误：%d %q", payload.Code, payload.Body.String())
	}
	if !strings.HasPrefix(payload.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("RSC Content-Type 错误：%s", payload.Header().Get("Content-Type"))
	}
	image := serve(t, "/images/login-bg.jpg")
	if image.Code != http.StatusOK || image.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("图片缓存头错误：%d %s", image.Code, image.Header().Get("Cache-Control"))
	}
}

func TestNotFoundUses404Page(t *testing.T) {
	response := serve(t, "/missing/page")
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "missing") {
		t.Fatalf("404 页面错误：%d %q", response.Code, response.Body.String())
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	response := serve(t, "/../../etc/passwd")
	if response.Code != http.StatusNotFound && response.Code != http.StatusMovedPermanently {
		t.Fatalf("路径穿越应被拒绝：%d", response.Code)
	}
}
