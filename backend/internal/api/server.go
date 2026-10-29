// Package api 实现族谱后端的 HTTP 接口。
package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
	"github.com/yunfengsa/pure-genealogy/backend/internal/config"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/gedcom"
	"github.com/yunfengsa/pure-genealogy/backend/internal/photo"
)

// SessionCookieName 是浏览器与服务端共享的会话 Cookie 名称。
const SessionCookieName = "genealogy_session"

// Authenticator 是 HTTP 层需要的认证能力。
type Authenticator interface {
	SignUp(ctx context.Context, username, password string) (auth.Session, error)
	Login(ctx context.Context, username, password string) (auth.Session, error)
	Authenticate(ctx context.Context, token string) (domain.User, error)
	Logout(ctx context.Context, token string) error
	ChangePassword(ctx context.Context, userID int64, currentPassword, newPassword string) error
}

// MemberStore 是 HTTP 层需要的族谱数据能力。
type MemberStore interface {
	ListMembers(ctx context.Context, page, pageSize int, search string) ([]domain.Member, int, error)
	ListAllMembers(ctx context.Context) ([]domain.Member, error)
	ListMemberOptions(ctx context.Context) ([]domain.MemberOption, error)
	ListMembersForTimeline(ctx context.Context) ([]domain.TimelineMember, error)
	ListBiographyMembers(ctx context.Context) ([]domain.Member, error)
	ListMembersForStatistics(ctx context.Context) ([]domain.StatisticsMember, error)
	GetMember(ctx context.Context, id int64) (domain.Member, error)
	CreateMember(ctx context.Context, input domain.MemberInput) (domain.Member, error)
	UpdateMember(ctx context.Context, id int64, input domain.MemberInput) (domain.Member, error)
	DeleteMembers(ctx context.Context, ids []int64) (int64, error)
	ValidateFather(ctx context.Context, memberID, fatherID int64) error
	ResolveImportFathers(ctx context.Context, members []domain.ImportMember) ([]*domain.ImportFatherMatch, error)
	ImportMembers(ctx context.Context, members []domain.ImportMember) (int, error)
	ImportGEDCOM(ctx context.Context, tree *gedcom.ParsedTree, replace bool) (domain.GEDCOMImportResult, error)
	ListMarriages(ctx context.Context, memberID int64) ([]domain.Marriage, error)
	ListAllMarriages(ctx context.Context) ([]domain.Marriage, error)
	CreateMarriage(ctx context.Context, input domain.MarriageInput) (domain.Marriage, error)
	UpdateMarriage(ctx context.Context, id int64, input domain.MarriageInput) (domain.Marriage, error)
	DeleteMarriage(ctx context.Context, id int64) error
	ReplaceSpouses(ctx context.Context, memberID int64, spouseIDs []int64, note *string) error

	ListMemberPhotos(ctx context.Context, memberID int64) ([]domain.MemberPhoto, error)
	AddMemberPhoto(ctx context.Context, input domain.MemberPhotoInput) (domain.MemberPhoto, error)
	GetMemberPhoto(ctx context.Context, id int64) (domain.MemberPhoto, error)
	DeleteMemberPhoto(ctx context.Context, id int64) (string, string, error)
	ListPhotosForMembers(ctx context.Context, memberIDs []int64) ([]string, error)
	UpdatePhotoCaption(ctx context.Context, id int64, caption *string) (domain.MemberPhoto, error)
}

// PhotoStore 是照片文件的落盘能力。
type PhotoStore interface {
	Save(memberID int64, src io.Reader, size int64) (photo.Stored, error)
	Delete(relativePaths ...string) error
	Root() string
}

// Pinger 用于健康检查，生产环境由数据库连接池实现。
type Pinger interface {
	Ping(ctx context.Context) error
}

// Server 组装路由与依赖。
type Server struct {
	cfg     config.Config
	auth    Authenticator
	members MemberStore
	photos  PhotoStore
	pinger  Pinger
	logger  *slog.Logger
	mux     *http.ServeMux
	static  http.Handler
	// photoFiles 以照片根目录为根提供静态文件读取。
	photoFiles http.Handler
	now        func() time.Time
}

func New(
	cfg config.Config,
	authenticator Authenticator,
	members MemberStore,
	photos PhotoStore,
	pinger Pinger,
	logger *slog.Logger,
) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{
		cfg:     cfg,
		auth:    authenticator,
		members: members,
		photos:  photos,
		pinger:  pinger,
		logger:  logger,
		mux:     http.NewServeMux(),
		now:     time.Now,
	}
	server.routes()
	return server
}

// Handler 返回带安全头、访问日志和 panic 恢复的完整处理器。
func (s *Server) Handler() http.Handler {
	return s.recoverPanic(s.accessLog(s.securityHeaders(s.checkOrigin(s.mux))))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/config", s.handleConfig)

	s.mux.HandleFunc("POST /api/auth/signup", s.handleSignUp)
	s.mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	s.mux.HandleFunc("GET /api/auth/session", s.handleSession)
	s.mux.Handle("POST /api/auth/password/change", s.requireAuth(http.HandlerFunc(s.handleChangePassword)))

	s.mux.Handle("GET /api/family-members", s.requireAuth(http.HandlerFunc(s.handleListMembers)))
	s.mux.Handle("GET /api/family-members/all", s.requireAuth(http.HandlerFunc(s.handleAllMembers)))
	s.mux.Handle("GET /api/family-members/select", s.requireAuth(http.HandlerFunc(s.handleMemberOptions)))
	s.mux.Handle("GET /api/family-members/timeline", s.requireAuth(http.HandlerFunc(s.handleTimeline)))
	s.mux.Handle("GET /api/family-members/biography", s.requireAuth(http.HandlerFunc(s.handleBiography)))
	s.mux.Handle("GET /api/family-members/{id}", s.requireAuth(http.HandlerFunc(s.handleGetMember)))
	s.mux.Handle("POST /api/family-members", s.requireAuth(http.HandlerFunc(s.handleCreateMember)))
	s.mux.Handle("PUT /api/family-members/{id}", s.requireAuth(http.HandlerFunc(s.handleUpdateMember)))
	s.mux.Handle("DELETE /api/family-members", s.requireAuth(http.HandlerFunc(s.handleDeleteMembers)))
	s.mux.Handle("POST /api/family-members/import/preview", s.requireAuth(http.HandlerFunc(s.handlePreviewImport)))
	s.mux.Handle("POST /api/family-members/import", s.requireAuth(http.HandlerFunc(s.handleImportMembers)))
	s.mux.Handle("GET /api/family-members/gedcom", s.requireAuth(http.HandlerFunc(s.handleGEDCOMExport)))
	s.mux.Handle("POST /api/family-members/gedcom/preview", s.requireAuth(http.HandlerFunc(s.handleGEDCOMPreview)))
	s.mux.Handle("POST /api/family-members/gedcom/import", s.requireAuth(http.HandlerFunc(s.handleGEDCOMImport)))

	s.mux.Handle("GET /api/family-members/{id}/marriages", s.requireAuth(http.HandlerFunc(s.handleListMarriages)))
	s.mux.Handle("POST /api/marriages", s.requireAuth(http.HandlerFunc(s.handleCreateMarriage)))
	s.mux.Handle("PUT /api/marriages/{id}", s.requireAuth(http.HandlerFunc(s.handleUpdateMarriage)))
	s.mux.Handle("DELETE /api/marriages/{id}", s.requireAuth(http.HandlerFunc(s.handleDeleteMarriage)))

	s.mux.Handle("GET /api/family-members/{id}/photos", s.requireAuth(http.HandlerFunc(s.handleListMemberPhotos)))
	s.mux.Handle("POST /api/family-members/{id}/photos", s.requireAuth(http.HandlerFunc(s.handleUploadMemberPhotos)))
	s.mux.Handle("DELETE /api/photos/{photoID}", s.requireAuth(http.HandlerFunc(s.handleDeleteMemberPhoto)))
	s.mux.Handle("PUT /api/photos/{photoID}", s.requireAuth(http.HandlerFunc(s.handleUpdatePhotoCaption)))
	// 照片二进制：路径其余部分交给 FileServer，必须注册在 {photoID} 之后，
	// 但 Go 1.22 的 ServeMux 会优先匹配更具体的模式，两者不冲突。
	if s.photos != nil {
		// 前缀必须非空：若配置为空会注册成 "GET /"，把下面的静态资源兜底
		// 路由整个覆盖掉，导致登录页等公开页面返回 401。
		prefix := strings.TrimSuffix(s.cfg.PhotoURLPrefix, "/")
		if prefix == "" {
			prefix = "/api/photos"
		}
		s.photoFiles = http.StripPrefix(prefix, http.FileServer(http.Dir(s.photos.Root())))
		s.mux.Handle("GET "+prefix+"/", s.requireAuth(http.HandlerFunc(s.handlePhotoFile)))
	}

	s.mux.Handle("GET /api/statistics", s.requireAuth(http.HandlerFunc(s.handleStatistics)))

	// 其余路径由内嵌前端静态资源处理，页面鉴权在 handleStatic 中完成。
	s.mux.Handle("/", http.HandlerFunc(s.handleStatic))
}

// SetStaticHandler 注入内嵌前端处理器。必须在开始接收请求前调用。
func (s *Server) SetStaticHandler(handler http.Handler) {
	s.static = handler
}
