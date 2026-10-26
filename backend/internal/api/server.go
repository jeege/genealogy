// Package api 实现族谱后端的 HTTP 接口。
package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
	"github.com/yunfengsa/pure-genealogy/backend/internal/config"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/mailer"
)

// SessionCookieName 是浏览器与服务端共享的会话 Cookie 名称。
const SessionCookieName = "genealogy_session"

// Authenticator 是 HTTP 层需要的认证能力。
type Authenticator interface {
	SignUp(ctx context.Context, email, password string) (auth.Session, error)
	Login(ctx context.Context, email, password string) (auth.Session, error)
	Authenticate(ctx context.Context, token string) (domain.User, error)
	Logout(ctx context.Context, token string) error
	CreatePasswordReset(ctx context.Context, email string) (string, domain.User, bool, error)
	ResetPassword(ctx context.Context, token, password string) error
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
	pinger  Pinger
	mailer  *mailer.Mailer
	logger  *slog.Logger
	mux     *http.ServeMux
	static  http.Handler
	now     func() time.Time
}

func New(
	cfg config.Config,
	authenticator Authenticator,
	members MemberStore,
	pinger Pinger,
	mailerClient *mailer.Mailer,
	logger *slog.Logger,
) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	if mailerClient == nil {
		mailerClient = mailer.New(cfg.SMTP)
	}
	server := &Server{
		cfg:     cfg,
		auth:    authenticator,
		members: members,
		pinger:  pinger,
		mailer:  mailerClient,
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
	s.mux.HandleFunc("POST /api/auth/password/forgot", s.handleForgotPassword)
	s.mux.HandleFunc("POST /api/auth/password/reset", s.handleResetPassword)
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

	s.mux.Handle("GET /api/statistics", s.requireAuth(http.HandlerFunc(s.handleStatistics)))

	// 其余路径由内嵌前端静态资源处理，页面鉴权在 handleStatic 中完成。
	s.mux.Handle("/", http.HandlerFunc(s.handleStatic))
}

// SetStaticHandler 注入内嵌前端处理器。必须在开始接收请求前调用。
func (s *Server) SetStaticHandler(handler http.Handler) {
	s.static = handler
}
