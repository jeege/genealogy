package auth

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

var (
	ErrInvalidCredentials = errors.New("邮箱或密码错误")
	ErrSignupDisabled     = errors.New("当前部署未开放注册")
)

// UserRepository 是认证服务需要的用户存储能力。
type UserRepository interface {
	CountUsers(ctx context.Context) (int64, error)
	CreateUser(ctx context.Context, email, passwordHash string) (domain.User, error)
	FindUserByEmail(ctx context.Context, email string) (domain.User, error)
	FindUserByID(ctx context.Context, id int64) (domain.User, error)
	UpdatePassword(ctx context.Context, userID int64, passwordHash string) error
}

// SessionRepository 是服务端会话存储能力。数据库只保存令牌散列。
type SessionRepository interface {
	CreateSession(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error
	FindUserBySession(ctx context.Context, tokenHash string, now time.Time) (domain.User, error)
	DeleteSession(ctx context.Context, tokenHash string) error
	DeleteUserSessions(ctx context.Context, userID int64) error
	DeleteExpiredSessions(ctx context.Context, now time.Time) error
}

// PasswordResetRepository 是密码重置令牌存储能力。
type PasswordResetRepository interface {
	CreatePasswordReset(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error
	ConsumePasswordReset(ctx context.Context, tokenHash string, now time.Time) (int64, error)
}

// Session 是登录成功后返回给 HTTP 层的一次性令牌及过期时间。
type Session struct {
	User      domain.User
	Token     string
	ExpiresAt time.Time
}

// Service 实现自建邮箱密码认证。所有会话与重置令牌均为随机不透明令牌。
type Service struct {
	users       UserRepository
	sessions    SessionRepository
	resets      PasswordResetRepository
	sessionTTL  time.Duration
	resetTTL    time.Duration
	bcryptCost  int
	allowSignup bool
	dummyHash   string
	logger      *slog.Logger
}

func NewService(
	users UserRepository,
	sessions SessionRepository,
	resets PasswordResetRepository,
	sessionTTL, resetTTL time.Duration,
	bcryptCost int,
	allowSignup bool,
	logger *slog.Logger,
) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	// 登录不存在的邮箱时也执行一次 bcrypt，避免通过响应时间枚举账号。
	dummy, err := HashPassword("timing-equalization-password", bcryptCost)
	if err != nil {
		dummy = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
	}
	return &Service{
		users:       users,
		sessions:    sessions,
		resets:      resets,
		sessionTTL:  sessionTTL,
		resetTTL:    resetTTL,
		bcryptCost:  bcryptCost,
		allowSignup: allowSignup,
		dummyHash:   dummy,
		logger:      logger,
	}
}

func (s *Service) SessionTTL() time.Duration { return s.sessionTTL }

// SignUp 创建账户并立即登录。是否开放注册由部署配置决定。
func (s *Service) SignUp(ctx context.Context, email, password string) (Session, error) {
	if !s.allowSignup {
		return Session{}, ErrSignupDisabled
	}
	normalized, err := NormalizeEmail(email)
	if err != nil {
		return Session{}, err
	}
	if err := ValidatePassword(password); err != nil {
		return Session{}, err
	}
	hash, err := HashPassword(password, s.bcryptCost)
	if err != nil {
		return Session{}, err
	}
	user, err := s.users.CreateUser(ctx, normalized, hash)
	if err != nil {
		return Session{}, err
	}
	return s.newSession(ctx, user)
}

// Login 校验邮箱密码并创建服务端会话。
func (s *Service) Login(ctx context.Context, email, password string) (Session, error) {
	normalized, err := NormalizeEmail(email)
	if err != nil {
		// 邮箱格式错误与密码错误返回同一提示，避免泄露账户状态。
		VerifyPassword(s.dummyHash, password)
		return Session{}, ErrInvalidCredentials
	}
	user, err := s.users.FindUserByEmail(ctx, normalized)
	if err != nil {
		VerifyPassword(s.dummyHash, password)
		if errors.Is(err, domain.ErrNotFound) {
			return Session{}, ErrInvalidCredentials
		}
		return Session{}, err
	}
	if !VerifyPassword(user.PasswordHash, password) {
		return Session{}, ErrInvalidCredentials
	}
	return s.newSession(ctx, user)
}

func (s *Service) newSession(ctx context.Context, user domain.User) (Session, error) {
	// 顺手清理过期会话，避免表无限增长；失败不影响登录。
	if err := s.sessions.DeleteExpiredSessions(ctx, time.Now().UTC()); err != nil {
		s.logger.Warn("清理过期会话失败", "error", err)
	}
	token, err := NewToken()
	if err != nil {
		return Session{}, err
	}
	expiresAt := time.Now().UTC().Add(s.sessionTTL)
	if err := s.sessions.CreateSession(ctx, user.ID, HashToken(token), expiresAt); err != nil {
		return Session{}, err
	}
	return Session{User: user, Token: token, ExpiresAt: expiresAt}, nil
}

// Authenticate 使用浏览器 Cookie 中的令牌恢复用户。
func (s *Service) Authenticate(ctx context.Context, token string) (domain.User, error) {
	if token == "" || len(token) > 512 {
		return domain.User{}, domain.ErrInvalidSession
	}
	user, err := s.sessions.FindUserBySession(ctx, HashToken(token), time.Now().UTC())
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.User{}, domain.ErrInvalidSession
		}
		return domain.User{}, err
	}
	return user, nil
}

// Logout 撤销当前令牌。
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	err := s.sessions.DeleteSession(ctx, HashToken(token))
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	return err
}

// CreatePasswordReset 为存在的邮箱创建一次性重置令牌。
func (s *Service) CreatePasswordReset(ctx context.Context, email string) (string, domain.User, bool, error) {
	normalized, err := NormalizeEmail(email)
	if err != nil {
		return "", domain.User{}, false, nil
	}
	user, err := s.users.FindUserByEmail(ctx, normalized)
	if errors.Is(err, domain.ErrNotFound) {
		return "", domain.User{}, false, nil
	}
	if err != nil {
		return "", domain.User{}, false, err
	}
	token, err := NewToken()
	if err != nil {
		return "", domain.User{}, false, err
	}
	if err := s.resets.CreatePasswordReset(ctx, user.ID, HashToken(token), time.Now().UTC().Add(s.resetTTL)); err != nil {
		return "", domain.User{}, false, err
	}
	return token, user, true, nil
}

// ResetPassword 消费重置令牌、更新密码并撤销该用户全部会话。
func (s *Service) ResetPassword(ctx context.Context, token, password string) error {
	if token == "" {
		return domain.ErrInvalidResetToken
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}
	userID, err := s.resets.ConsumePasswordReset(ctx, HashToken(token), time.Now().UTC())
	if err != nil {
		return err
	}
	hash, err := HashPassword(password, s.bcryptCost)
	if err != nil {
		return err
	}
	if err := s.users.UpdatePassword(ctx, userID, hash); err != nil {
		return err
	}
	if err := s.sessions.DeleteUserSessions(ctx, userID); err != nil {
		return err
	}
	return nil
}

// ChangePassword 修改当前登录用户的密码。
func (s *Service) ChangePassword(ctx context.Context, userID int64, currentPassword, newPassword string) error {
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}
	user, err := s.users.FindUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if !VerifyPassword(user.PasswordHash, currentPassword) {
		return ErrInvalidCredentials
	}
	hash, err := HashPassword(newPassword, s.bcryptCost)
	if err != nil {
		return err
	}
	return s.users.UpdatePassword(ctx, userID, hash)
}

// CreateUser 供启动引导和命令行创建账号使用。
func (s *Service) CreateUser(ctx context.Context, email, password string) (domain.User, error) {
	normalized, err := NormalizeEmail(email)
	if err != nil {
		return domain.User{}, err
	}
	if err := ValidatePassword(password); err != nil {
		return domain.User{}, err
	}
	hash, err := HashPassword(password, s.bcryptCost)
	if err != nil {
		return domain.User{}, err
	}
	return s.users.CreateUser(ctx, normalized, hash)
}

// CountUsers 用于启动引导判断是否还没有任何账号。
func (s *Service) CountUsers(ctx context.Context) (int64, error) {
	return s.users.CountUsers(ctx)
}
