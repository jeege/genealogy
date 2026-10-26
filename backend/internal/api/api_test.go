package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
	"github.com/yunfengsa/pure-genealogy/backend/internal/config"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/gedcom"
	"github.com/yunfengsa/pure-genealogy/backend/internal/mailer"
	"golang.org/x/text/encoding/simplifiedchinese"
)

type fakeAuth struct {
	signUp       func(ctx context.Context, email, password string) (auth.Session, error)
	login        func(ctx context.Context, email, password string) (auth.Session, error)
	authenticate func(ctx context.Context, token string) (domain.User, error)
	logout       func(ctx context.Context, token string) error
	forgot       func(ctx context.Context, email string) (string, domain.User, bool, error)
	reset        func(ctx context.Context, token, password string) error
	change       func(ctx context.Context, userID int64, current, next string) error
}

func (f *fakeAuth) SignUp(ctx context.Context, email, password string) (auth.Session, error) {
	if f.signUp == nil {
		return auth.Session{}, errors.New("未预期的 SignUp")
	}
	return f.signUp(ctx, email, password)
}

func (f *fakeAuth) Login(ctx context.Context, email, password string) (auth.Session, error) {
	if f.login == nil {
		return auth.Session{}, errors.New("未预期的 Login")
	}
	return f.login(ctx, email, password)
}

func (f *fakeAuth) Authenticate(ctx context.Context, token string) (domain.User, error) {
	if f.authenticate == nil {
		return domain.User{}, domain.ErrInvalidSession
	}
	return f.authenticate(ctx, token)
}

func (f *fakeAuth) Logout(ctx context.Context, token string) error {
	if f.logout == nil {
		return nil
	}
	return f.logout(ctx, token)
}

func (f *fakeAuth) CreatePasswordReset(ctx context.Context, email string) (string, domain.User, bool, error) {
	if f.forgot == nil {
		return "", domain.User{}, false, nil
	}
	return f.forgot(ctx, email)
}

func (f *fakeAuth) ResetPassword(ctx context.Context, token, password string) error {
	if f.reset == nil {
		return nil
	}
	return f.reset(ctx, token, password)
}

func (f *fakeAuth) ChangePassword(ctx context.Context, userID int64, current, next string) error {
	if f.change == nil {
		return nil
	}
	return f.change(ctx, userID, current, next)
}

type fakeMembers struct {
	list        func(ctx context.Context, page, pageSize int, search string) ([]domain.Member, int, error)
	all         func(ctx context.Context) ([]domain.Member, error)
	options     func(ctx context.Context) ([]domain.MemberOption, error)
	timeline    func(ctx context.Context) ([]domain.TimelineMember, error)
	biography   func(ctx context.Context) ([]domain.Member, error)
	statistics  func(ctx context.Context) ([]domain.StatisticsMember, error)
	get         func(ctx context.Context, id int64) (domain.Member, error)
	create      func(ctx context.Context, input domain.MemberInput) (domain.Member, error)
	update      func(ctx context.Context, id int64, input domain.MemberInput) (domain.Member, error)
	delete      func(ctx context.Context, ids []int64) (int64, error)
	validate    func(ctx context.Context, memberID, fatherID int64) error
	resolve     func(ctx context.Context, members []domain.ImportMember) ([]*domain.ImportFatherMatch, error)
	importBatch func(ctx context.Context, members []domain.ImportMember) (int, error)
	gedcom      func(ctx context.Context, tree *gedcom.ParsedTree, replace bool) (domain.GEDCOMImportResult, error)

	// 配偶关系：默认实现为内存假仓库，便于接口测试。
	allMarriages   func(ctx context.Context) ([]domain.Marriage, error)
	marriages      func(ctx context.Context, memberID int64) ([]domain.Marriage, error)
	createMarriage func(ctx context.Context, input domain.MarriageInput) (domain.Marriage, error)
	updateMarriage func(ctx context.Context, id int64, input domain.MarriageInput) (domain.Marriage, error)
	deleteMarriage func(ctx context.Context, id int64) error
	replaceSpouses func(ctx context.Context, memberID int64, spouseIDs []int64, note *string) error
}

func (f *fakeMembers) ListMembers(ctx context.Context, page, pageSize int, search string) ([]domain.Member, int, error) {
	if f.list == nil {
		return []domain.Member{}, 0, nil
	}
	return f.list(ctx, page, pageSize, search)
}
func (f *fakeMembers) ListAllMembers(ctx context.Context) ([]domain.Member, error) {
	if f.all == nil {
		return []domain.Member{}, nil
	}
	return f.all(ctx)
}
func (f *fakeMembers) ListMemberOptions(ctx context.Context) ([]domain.MemberOption, error) {
	if f.options == nil {
		return []domain.MemberOption{}, nil
	}
	return f.options(ctx)
}
func (f *fakeMembers) ListMembersForTimeline(ctx context.Context) ([]domain.TimelineMember, error) {
	if f.timeline == nil {
		return []domain.TimelineMember{}, nil
	}
	return f.timeline(ctx)
}
func (f *fakeMembers) ListBiographyMembers(ctx context.Context) ([]domain.Member, error) {
	if f.biography == nil {
		return []domain.Member{}, nil
	}
	return f.biography(ctx)
}
func (f *fakeMembers) ListMembersForStatistics(ctx context.Context) ([]domain.StatisticsMember, error) {
	if f.statistics == nil {
		return []domain.StatisticsMember{}, nil
	}
	return f.statistics(ctx)
}
func (f *fakeMembers) GetMember(ctx context.Context, id int64) (domain.Member, error) {
	if f.get == nil {
		return domain.Member{}, domain.ErrNotFound
	}
	return f.get(ctx, id)
}
func (f *fakeMembers) CreateMember(ctx context.Context, input domain.MemberInput) (domain.Member, error) {
	if f.create == nil {
		return domain.Member{}, errors.New("未预期的 CreateMember")
	}
	return f.create(ctx, input)
}
func (f *fakeMembers) UpdateMember(ctx context.Context, id int64, input domain.MemberInput) (domain.Member, error) {
	if f.update == nil {
		return domain.Member{}, errors.New("未预期的 UpdateMember")
	}
	return f.update(ctx, id, input)
}
func (f *fakeMembers) DeleteMembers(ctx context.Context, ids []int64) (int64, error) {
	if f.delete == nil {
		return 0, nil
	}
	return f.delete(ctx, ids)
}
func (f *fakeMembers) ValidateFather(ctx context.Context, memberID, fatherID int64) error {
	if f.validate == nil {
		return nil
	}
	return f.validate(ctx, memberID, fatherID)
}
func (f *fakeMembers) ResolveImportFathers(ctx context.Context, members []domain.ImportMember) ([]*domain.ImportFatherMatch, error) {
	if f.resolve == nil {
		return make([]*domain.ImportFatherMatch, len(members)), nil
	}
	return f.resolve(ctx, members)
}
func (f *fakeMembers) ListAllMarriages(ctx context.Context) ([]domain.Marriage, error) {
	if f.allMarriages == nil {
		return []domain.Marriage{}, nil
	}
	return f.allMarriages(ctx)
}

func (f *fakeMembers) ListMarriages(ctx context.Context, memberID int64) ([]domain.Marriage, error) {
	if f.marriages == nil {
		return []domain.Marriage{}, nil
	}
	return f.marriages(ctx, memberID)
}

func (f *fakeMembers) CreateMarriage(ctx context.Context, input domain.MarriageInput) (domain.Marriage, error) {
	if f.createMarriage == nil {
		return domain.Marriage{ID: 1, HusbandID: input.HusbandID, WifeID: input.WifeID, Status: input.Status}, nil
	}
	return f.createMarriage(ctx, input)
}

func (f *fakeMembers) UpdateMarriage(ctx context.Context, id int64, input domain.MarriageInput) (domain.Marriage, error) {
	if f.updateMarriage == nil {
		return domain.Marriage{ID: id, HusbandID: input.HusbandID, WifeID: input.WifeID, Status: input.Status}, nil
	}
	return f.updateMarriage(ctx, id, input)
}

func (f *fakeMembers) DeleteMarriage(ctx context.Context, id int64) error {
	if f.deleteMarriage == nil {
		return nil
	}
	return f.deleteMarriage(ctx, id)
}

func (f *fakeMembers) ReplaceSpouses(ctx context.Context, memberID int64, spouseIDs []int64, note *string) error {
	if f.replaceSpouses == nil {
		return nil
	}
	return f.replaceSpouses(ctx, memberID, spouseIDs, note)
}

func (f *fakeMembers) ImportGEDCOM(ctx context.Context, tree *gedcom.ParsedTree, replace bool) (domain.GEDCOMImportResult, error) {
	if f.gedcom == nil {
		return domain.GEDCOMImportResult{Members: len(tree.Members), Families: tree.Families}, nil
	}
	return f.gedcom(ctx, tree, replace)
}

func (f *fakeMembers) ImportMembers(ctx context.Context, members []domain.ImportMember) (int, error) {
	if f.importBatch == nil {
		return len(members), nil
	}
	return f.importBatch(ctx, members)
}

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func testServer(t *testing.T, authenticator Authenticator, members MemberStore, pinger Pinger) *Server {
	t.Helper()
	cfg := config.Config{
		AppOrigin:        "http://app.test",
		PublicBaseURL:    "http://app.test",
		FamilySurname:    "刘",
		SessionTTL:       time.Hour,
		PasswordResetTTL: time.Hour,
		CookieSecure:     "false",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := New(cfg, authenticator, members, pinger, mailer.New(config.SMTPConfig{}), logger)
	server.now = func() time.Time { return time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC) }
	return server
}

func perform(t *testing.T, server *Server, method, target string, body any, headers map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, target, reader)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	return recorder
}

func authCookie() *http.Cookie {
	return &http.Cookie{Name: SessionCookieName, Value: "valid-token"}
}

func authenticatedAuth() *fakeAuth {
	return &fakeAuth{authenticate: func(context.Context, string) (domain.User, error) {
		return domain.User{ID: 1, Email: "user@example.com"}, nil
	}}
}

func TestHealth(t *testing.T) {
	server := testServer(t, &fakeAuth{}, &fakeMembers{}, fakePinger{err: errors.New("down")})
	if response := perform(t, server, http.MethodGet, "/api/health", nil, nil); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("数据库不可用时应返回 503，得到 %d", response.Code)
	}
	server = testServer(t, &fakeAuth{}, &fakeMembers{}, fakePinger{})
	if response := perform(t, server, http.MethodGet, "/api/health", nil, nil); response.Code != http.StatusOK {
		t.Fatalf("健康检查应返回 200，得到 %d", response.Code)
	}
}

func TestLoginSetsCookieAndSessionReturnsUser(t *testing.T) {
	authenticator := &fakeAuth{
		login: func(_ context.Context, email, password string) (auth.Session, error) {
			if email != "user@example.com" || password != "password123" {
				t.Fatalf("登录参数错误：%s / %s", email, password)
			}
			return auth.Session{
				User:      domain.User{ID: 7, Email: email},
				Token:     "issued-token",
				ExpiresAt: time.Now().Add(time.Hour),
			}, nil
		},
		authenticate: func(_ context.Context, token string) (domain.User, error) {
			if token != "issued-token" {
				t.Fatalf("会话令牌错误：%s", token)
			}
			return domain.User{ID: 7, Email: "user@example.com"}, nil
		},
	}
	server := testServer(t, authenticator, &fakeMembers{}, fakePinger{})

	response := perform(t, server, http.MethodPost, "/api/auth/login", map[string]string{
		"email": "user@example.com", "password": "password123",
	}, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("登录失败：%d %s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != SessionCookieName || cookies[0].Value != "issued-token" || !cookies[0].HttpOnly {
		t.Fatalf("登录 Cookie 错误：%+v", cookies)
	}

	session := perform(t, server, http.MethodGet, "/api/auth/session", nil, nil, cookies[0])
	if session.Code != http.StatusOK || !strings.Contains(session.Body.String(), "user@example.com") {
		t.Fatalf("读取会话失败：%d %s", session.Code, session.Body.String())
	}
}

func TestUnauthorizedAndOriginCheck(t *testing.T) {
	server := testServer(t, authenticatedAuth(), &fakeMembers{}, fakePinger{})
	if response := perform(t, server, http.MethodGet, "/api/family-members", nil, nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("未登录应返回 401，得到 %d", response.Code)
	}

	called := false
	authenticator := &fakeAuth{login: func(context.Context, string, string) (auth.Session, error) {
		called = true
		return auth.Session{}, auth.ErrInvalidCredentials
	}}
	server = testServer(t, authenticator, &fakeMembers{}, fakePinger{})
	response := perform(t, server, http.MethodPost, "/api/auth/login", map[string]string{
		"email": "a@example.com", "password": "password123",
	}, map[string]string{"Origin": "http://evil.test"})
	if response.Code != http.StatusForbidden || called {
		t.Fatalf("跨站来源应被拒绝，code=%d called=%v", response.Code, called)
	}
}

func TestListMembersClampsPageSize(t *testing.T) {
	var gotPage, gotSize int
	members := &fakeMembers{list: func(_ context.Context, page, pageSize int, search string) ([]domain.Member, int, error) {
		gotPage, gotSize = page, pageSize
		return []domain.Member{{ID: 1, Name: "刘一"}}, 1, nil
	}}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodGet, "/api/family-members?page=2&page_size=999&search=%E5%88%98", nil, nil, authCookie())
	if response.Code != http.StatusOK {
		t.Fatalf("列表请求失败：%d %s", response.Code, response.Body.String())
	}
	if gotPage != 2 || gotSize != 200 {
		t.Fatalf("分页参数未夹紧：page=%d size=%d", gotPage, gotSize)
	}
}

func TestCreateMemberValidationAndSuccess(t *testing.T) {
	var captured domain.MemberInput
	members := &fakeMembers{
		validate: func(context.Context, int64, int64) error { return nil },
		create: func(_ context.Context, input domain.MemberInput) (domain.Member, error) {
			captured = input
			return domain.Member{ID: 5, Name: input.Name, Birthday: input.Birthday}, nil
		},
	}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	payload := map[string]any{
		"name": " 刘测试 ", "generation": 2, "father_id": 1, "gender": "男",
		"is_alive": true, "birthday": "1990-01-01", "spouse": " 王氏 ",
	}
	response := perform(t, server, http.MethodPost, "/api/family-members", payload, nil, authCookie())
	if response.Code != http.StatusCreated {
		t.Fatalf("新增失败：%d %s", response.Code, response.Body.String())
	}
	if captured.Name != "刘测试" || captured.Birthday == nil || *captured.Birthday != "1990-01-01" ||
		captured.Spouse == nil || *captured.Spouse != "王氏" {
		t.Fatalf("输入清洗错误：%+v", captured)
	}

	invalid := perform(t, server, http.MethodPost, "/api/family-members", map[string]any{
		"name": "刘测试", "birthday": "1990/01/01",
	}, nil, authCookie())
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "YYYY-MM-DD") {
		t.Fatalf("非法日期应返回 400：%d %s", invalid.Code, invalid.Body.String())
	}
}

func TestImportPreviewAndValidation(t *testing.T) {
	fatherID := int64(3)
	members := &fakeMembers{resolve: func(_ context.Context, rows []domain.ImportMember) ([]*domain.ImportFatherMatch, error) {
		return []*domain.ImportFatherMatch{{Source: "existing", ID: &fatherID}}, nil
	}}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodPost, "/api/family-members/import/preview", map[string]any{
		"members": []any{map[string]any{"name": "子", "generation": 3, "father_name": "父"}},
	}, nil, authCookie())
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "existing") {
		t.Fatalf("预览失败：%d %s", response.Code, response.Body.String())
	}

	invalid := perform(t, server, http.MethodPost, "/api/family-members/import/preview", map[string]any{
		"members": []any{map[string]any{"name": ""}},
	}, nil, authCookie())
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "缺少姓名") {
		t.Fatalf("缺少姓名应返回 400：%d %s", invalid.Code, invalid.Body.String())
	}
}

func TestDeleteWithChildrenReturnsConflict(t *testing.T) {
	members := &fakeMembers{delete: func(context.Context, []int64) (int64, error) {
		return 0, domain.ErrHasChildren
	}}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodDelete, "/api/family-members", map[string]any{"ids": []int64{1}}, nil, authCookie())
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "父亲") {
		t.Fatalf("删除有子女成员应返回 409：%d %s", response.Code, response.Body.String())
	}
}

func TestSignupDisabled(t *testing.T) {
	authenticator := &fakeAuth{signUp: func(context.Context, string, string) (auth.Session, error) {
		return auth.Session{}, auth.ErrSignupDisabled
	}}
	server := testServer(t, authenticator, &fakeMembers{}, fakePinger{})
	response := perform(t, server, http.MethodPost, "/api/auth/signup", map[string]string{
		"email": "a@example.com", "password": "password123",
	}, nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("关闭注册应返回 403：%d %s", response.Code, response.Body.String())
	}
}

func TestStatisticsEndpoint(t *testing.T) {
	members := &fakeMembers{statistics: func(context.Context) ([]domain.StatisticsMember, error) {
		generation := 1
		gender := "男"
		birthday := "1950-01-01"
		return []domain.StatisticsMember{{ID: 1, Name: "刘建国", Gender: &gender, Generation: &generation, IsAlive: true, Birthday: &birthday}}, nil
	}}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodGet, "/api/statistics", nil, nil, authCookie())
	if response.Code != http.StatusOK {
		t.Fatalf("统计失败：%d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Data domain.StatisticsData `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.TotalMembers != 1 || payload.Data.GenderStats[0].Value != 1 {
		t.Fatalf("统计结果错误：%+v", payload.Data)
	}
}

func TestConfigAndStaticPageAuth(t *testing.T) {
	static := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("static:" + r.URL.Path))
	})
	server := testServer(t, authenticatedAuth(), &fakeMembers{}, fakePinger{})
	server.SetStaticHandler(static)

	configResponse := perform(t, server, http.MethodGet, "/api/config", nil, nil)
	if configResponse.Code != http.StatusOK || !strings.Contains(configResponse.Body.String(), "刘") {
		t.Fatalf("配置接口错误：%d %s", configResponse.Code, configResponse.Body.String())
	}

	publicPage := perform(t, server, http.MethodGet, "/auth/login/", nil, nil)
	if publicPage.Code != http.StatusOK || !strings.Contains(publicPage.Body.String(), "static:/auth/login/") {
		t.Fatalf("登录页应公开：%d %s", publicPage.Code, publicPage.Body.String())
	}
	asset := perform(t, server, http.MethodGet, "/_next/static/app.js", nil, nil)
	if asset.Code != http.StatusOK {
		t.Fatalf("静态资源应公开：%d", asset.Code)
	}

	for _, target := range []string{"/", "/family-tree/", "/family-tree/graph/"} {
		response := perform(t, server, http.MethodGet, target, nil, nil)
		if response.Code != http.StatusFound || response.Header().Get("Location") != "/auth/login/" {
			t.Fatalf("%s 未登录应跳转登录页：%d %s", target, response.Code, response.Header().Get("Location"))
		}
	}

	authorized := perform(t, server, http.MethodGet, "/family-tree/graph/", nil, nil, authCookie())
	if authorized.Code != http.StatusOK || !strings.Contains(authorized.Body.String(), "static:/family-tree/graph/") {
		t.Fatalf("已登录页面应返回：%d %s", authorized.Code, authorized.Body.String())
	}

	rscPayload := perform(t, server, http.MethodGet, "/family-tree/graph/index.txt?_rsc=abc", nil, map[string]string{"RSC": "1"})
	if rscPayload.Code != http.StatusOK {
		t.Fatalf("未登录的 RSC 骨架应可加载：%d", rscPayload.Code)
	}

	unknownAPI := perform(t, server, http.MethodGet, "/api/not-found", nil, nil)
	if unknownAPI.Code != http.StatusNotFound {
		t.Fatalf("未知 API 应返回 404：%d", unknownAPI.Code)
	}
}

const testGEDCOM = `0 HEAD
1 SOUR pure-genealogy
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME 刘/建国/
1 SEX M
1 BIRT
2 DATE 12 MAR 1950
0 @I2@ INDI
1 NAME 刘/小明/
1 SEX M
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 CHIL @I2@
0 TRLR
`

func TestGEDCOMExportResponse(t *testing.T) {
	fatherID := int64(1)
	members := &fakeMembers{all: func(context.Context) ([]domain.Member, error) {
		return []domain.Member{
			{ID: 1, Name: "刘建国", IsAlive: true, Birthday: stringPtr("1950-03-12")},
			{ID: 2, Name: "刘小明", IsAlive: true, FatherID: &fatherID},
		}, nil
	}}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodGet, "/api/family-members/gedcom", nil, nil, authCookie())
	if response.Code != http.StatusOK {
		t.Fatalf("导出失败：%d %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, "0 HEAD") || !strings.Contains(body, "1 NAME 刘建国") {
		t.Fatalf("导出内容不完整：\n%s", body)
	}
	if !strings.Contains(body, "0 @F1@ FAM") || !strings.Contains(body, "1 CHIL @I2@") {
		t.Fatalf("家庭关系未导出：\n%s", body)
	}
	if disposition := response.Header().Get("Content-Disposition"); !strings.Contains(disposition, "attachment") {
		t.Fatalf("应返回下载响应头：%s", disposition)
	}
	if contentType := response.Header().Get("Content-Type"); !strings.Contains(contentType, "gedcom") {
		t.Fatalf("Content-Type 错误：%s", contentType)
	}

	empty := testServer(t, authenticatedAuth(), &fakeMembers{}, fakePinger{})
	emptyResponse := perform(t, empty, http.MethodGet, "/api/family-members/gedcom", nil, nil, authCookie())
	if emptyResponse.Code != http.StatusBadRequest {
		t.Fatalf("空族谱应返回 400：%d", emptyResponse.Code)
	}
}

func TestGEDCOMPreviewAndImportValidation(t *testing.T) {
	server := testServer(t, authenticatedAuth(), &fakeMembers{}, fakePinger{})

	preview := perform(t, server, http.MethodPost, "/api/family-members/gedcom/preview",
		map[string]string{"content": testGEDCOM}, nil, authCookie())
	if preview.Code != http.StatusOK {
		t.Fatalf("预览失败：%d %s", preview.Code, preview.Body.String())
	}
	var payload struct {
		Preview domain.GEDCOMImportPreview `json:"preview"`
	}
	if err := json.Unmarshal(preview.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Preview.Members != 2 || payload.Preview.Families != 1 || payload.Preview.WithFather != 1 {
		t.Fatalf("预览统计错误：%+v", payload.Preview)
	}

	invalid := perform(t, server, http.MethodPost, "/api/family-members/gedcom/preview",
		map[string]string{"content": "not a gedcom"}, nil, authCookie())
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("非法内容应返回 400：%d %s", invalid.Code, invalid.Body.String())
	}

	emptyBody := perform(t, server, http.MethodPost, "/api/family-members/gedcom/import",
		map[string]string{"content": ""}, nil, authCookie())
	if emptyBody.Code != http.StatusBadRequest {
		t.Fatalf("空内容应返回 400：%d", emptyBody.Code)
	}
}

func TestGEDCOMImportCallsStore(t *testing.T) {
	var capturedReplace bool
	imported := 0
	members := &fakeMembers{gedcom: func(_ context.Context, tree *gedcom.ParsedTree, replace bool) (domain.GEDCOMImportResult, error) {
		capturedReplace = replace
		imported = len(tree.Members)
		return domain.GEDCOMImportResult{Members: len(tree.Members), Families: tree.Families}, nil
	}}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodPost, "/api/family-members/gedcom/import",
		map[string]any{"content": testGEDCOM, "replace": true}, nil, authCookie())
	if response.Code != http.StatusOK {
		t.Fatalf("导入失败：%d %s", response.Code, response.Body.String())
	}
	if !capturedReplace || imported != 2 {
		t.Fatalf("导入参数错误：replace=%v members=%d", capturedReplace, imported)
	}
	if !strings.Contains(response.Body.String(), `"members":2`) {
		t.Fatalf("导入结果错误：%s", response.Body.String())
	}
}

func TestGEDCOMImportRequiresAuth(t *testing.T) {
	server := testServer(t, &fakeAuth{}, &fakeMembers{}, fakePinger{})
	for _, endpoint := range []struct{ method, target string }{
		{http.MethodGet, "/api/family-members/gedcom"},
		{http.MethodPost, "/api/family-members/gedcom/preview"},
		{http.MethodPost, "/api/family-members/gedcom/import"},
	} {
		method, target := endpoint.method, endpoint.target
		response := perform(t, server, method, target, map[string]string{"content": testGEDCOM}, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s 未登录应返回 401：%d", method, target, response.Code)
		}
	}
}

func stringPtr(value string) *string { return &value }

func TestASCIIFilenameFallback(t *testing.T) {
	cases := map[string]string{
		"刘家族-20261026.ged": "genealogy-20261026.ged",
		"genealogy.ged":    "genealogy.ged",
		"李氏族谱.ged":         "genealogy.ged",
		"Liu-Family.ged":   "Liu-Family.ged",
	}
	for input, want := range cases {
		if got := asciiFilename(input); got != want {
			t.Fatalf("asciiFilename(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestGEDCOMRawBodyAndEncoding(t *testing.T) {
	plain := testServer(t, authenticatedAuth(), &fakeMembers{}, fakePinger{})
	request := httptest.NewRequest(http.MethodPost, "/api/family-members/gedcom/preview", strings.NewReader(testGEDCOM))
	request.Header.Set("Content-Type", "text/plain")
	request.AddCookie(authCookie())
	recorder := httptest.NewRecorder()
	plain.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"members":2`) {
		t.Fatalf("原始 GEDCOM 请求体应可预览：%d %s", recorder.Code, recorder.Body.String())
	}

	// GB18030 编码的中文文件应被自动识别。
	gbk, err := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(testGEDCOM))
	if err != nil {
		t.Fatal(err)
	}
	gbkRequest := httptest.NewRequest(http.MethodPost, "/api/family-members/gedcom/preview", bytes.NewReader(gbk))
	gbkRequest.Header.Set("Content-Type", "text/plain")
	gbkRequest.AddCookie(authCookie())
	gbkRecorder := httptest.NewRecorder()
	plain.Handler().ServeHTTP(gbkRecorder, gbkRequest)
	if gbkRecorder.Code != http.StatusOK || !strings.Contains(gbkRecorder.Body.String(), `"members":2`) {
		t.Fatalf("GB18030 文件应可预览：%d %s", gbkRecorder.Code, gbkRecorder.Body.String())
	}

	invalid := httptest.NewRequest(http.MethodPost, "/api/family-members/gedcom/preview", strings.NewReader("not gedcom"))
	invalid.Header.Set("Content-Type", "text/plain")
	invalid.AddCookie(authCookie())
	invalidRecorder := httptest.NewRecorder()
	plain.Handler().ServeHTTP(invalidRecorder, invalid)
	if invalidRecorder.Code != http.StatusBadRequest {
		t.Fatalf("非法原始内容应返回 400：%d", invalidRecorder.Code)
	}
}

func TestMarriageEndpoints(t *testing.T) {
	var created domain.MarriageInput
	var deletedID int64
	members := &fakeMembers{
		marriages: func(_ context.Context, memberID int64) ([]domain.Marriage, error) {
			if memberID != 7 {
				t.Fatalf("成员 ID 错误：%d", memberID)
			}
			wifeID := int64(8)
			wife := "王氏"
			return []domain.Marriage{{
				ID: 1, HusbandID: 7, Husband: "刘一", WifeID: &wifeID, Wife: &wife,
				Status: domain.MarriageMarried,
			}}, nil
		},
		createMarriage: func(_ context.Context, input domain.MarriageInput) (domain.Marriage, error) {
			created = input
			return domain.Marriage{ID: 2, HusbandID: input.HusbandID, WifeID: input.WifeID, Status: input.Status}, nil
		},
		deleteMarriage: func(_ context.Context, id int64) error {
			deletedID = id
			return nil
		},
	}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})

	list := perform(t, server, http.MethodGet, "/api/family-members/7/marriages", nil, nil, authCookie())
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "王氏") {
		t.Fatalf("读取配偶失败：%d %s", list.Code, list.Body.String())
	}

	create := perform(t, server, http.MethodPost, "/api/marriages", map[string]any{
		"husband_id": 7, "wife_id": 8, "status": "divorced", "married_on": "2000-01-01",
	}, nil, authCookie())
	if create.Code != http.StatusCreated {
		t.Fatalf("新增配偶失败：%d %s", create.Code, create.Body.String())
	}
	if created.Status != domain.MarriageDivorced || created.MarriedOn == nil || *created.MarriedOn != "2000-01-01" {
		t.Fatalf("配偶输入映射错误：%+v", created)
	}

	remove := perform(t, server, http.MethodDelete, "/api/marriages/5", nil, nil, authCookie())
	if remove.Code != http.StatusNoContent || deletedID != 5 {
		t.Fatalf("解除配偶失败：%d deleted=%d", remove.Code, deletedID)
	}
}

func TestMarriageValidation(t *testing.T) {
	server := testServer(t, authenticatedAuth(), &fakeMembers{}, fakePinger{})
	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"缺少丈夫", map[string]any{"wife_id": 2}, "请选择"},
		{"非法状态", map[string]any{"husband_id": 1, "status": "unknown"}, "婚姻状态"},
		{"非法日期", map[string]any{"husband_id": 1, "married_on": "2000/01/01"}, "YYYY-MM-DD"},
		{"日期颠倒", map[string]any{"husband_id": 1, "wife_id": 2, "married_on": "2010-01-01", "divorced_on": "2000-01-01"}, "早于"},
		{"自己配偶", map[string]any{"husband_id": 1, "wife_id": 1}, "同一个人"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := perform(t, server, http.MethodPost, "/api/marriages", testCase.body, nil, authCookie())
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), testCase.want) {
				t.Fatalf("%s 应返回 400：%d %s", testCase.name, response.Code, response.Body.String())
			}
		})
	}
}

func TestMemberSpouseIDsTriggerReplace(t *testing.T) {
	var replaced []int64
	var replacedMember int64
	members := &fakeMembers{
		create: func(_ context.Context, input domain.MemberInput) (domain.Member, error) {
			return domain.Member{ID: 42, Name: input.Name}, nil
		},
		get: func(_ context.Context, id int64) (domain.Member, error) {
			return domain.Member{ID: id, Name: "刘一", Spouses: []domain.SpouseLink{{MarriageID: 1, Name: "王氏"}}}, nil
		},
		replaceSpouses: func(_ context.Context, memberID int64, spouseIDs []int64, _ *string) error {
			replacedMember = memberID
			replaced = spouseIDs
			return nil
		},
	}
	server := testServer(t, authenticatedAuth(), members, fakePinger{})
	response := perform(t, server, http.MethodPost, "/api/family-members", map[string]any{
		"name": "刘一", "spouse_ids": []int64{3, 4},
	}, nil, authCookie())
	if response.Code != http.StatusCreated {
		t.Fatalf("新增成员失败：%d %s", response.Code, response.Body.String())
	}
	if replacedMember != 42 || len(replaced) != 2 || replaced[0] != 3 {
		t.Fatalf("配偶同步参数错误：member=%d ids=%v", replacedMember, replaced)
	}
	if !strings.Contains(response.Body.String(), "王氏") {
		t.Fatalf("响应应包含配偶摘要：%s", response.Body.String())
	}

	// 不传 spouse_ids 时不应改动婚姻
	replaced = nil
	unchanged := perform(t, server, http.MethodPost, "/api/family-members", map[string]any{
		"name": "刘二",
	}, nil, authCookie())
	if unchanged.Code != http.StatusCreated || replaced != nil {
		t.Fatalf("未提供 spouse_ids 时不应修改婚姻：%d %v", unchanged.Code, replaced)
	}
}
