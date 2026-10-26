package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

type fakeUsers struct {
	users map[string]domain.User
	byID  map[int64]domain.User
}

func (f *fakeUsers) CountUsers(context.Context) (int64, error) { return int64(len(f.users)), nil }
func (f *fakeUsers) CreateUser(_ context.Context, email, hash string) (domain.User, error) {
	if f.users == nil {
		f.users = map[string]domain.User{}
		f.byID = map[int64]domain.User{}
	}
	if _, exists := f.users[email]; exists {
		return domain.User{}, domain.ErrEmailTaken
	}
	user := domain.User{ID: int64(len(f.users) + 1), Email: email, PasswordHash: hash}
	f.users[email] = user
	f.byID[user.ID] = user
	return user, nil
}
func (f *fakeUsers) FindUserByEmail(_ context.Context, email string) (domain.User, error) {
	user, ok := f.users[email]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return user, nil
}
func (f *fakeUsers) FindUserByID(_ context.Context, id int64) (domain.User, error) {
	user, ok := f.byID[id]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return user, nil
}
func (f *fakeUsers) UpdatePassword(_ context.Context, id int64, hash string) error {
	user, ok := f.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	user.PasswordHash = hash
	f.byID[id] = user
	for email, existing := range f.users {
		if existing.ID == id {
			f.users[email] = user
		}
	}
	return nil
}

type fakeSessions struct {
	created     int
	tokenHash   string
	expiresAt   time.Time
	userByToken map[string]domain.User
	deletedAll  int64
}

func (f *fakeSessions) CreateSession(_ context.Context, _ int64, tokenHash string, expiresAt time.Time) error {
	f.created++
	f.tokenHash = tokenHash
	f.expiresAt = expiresAt
	return nil
}
func (f *fakeSessions) FindUserBySession(_ context.Context, tokenHash string, _ time.Time) (domain.User, error) {
	user, ok := f.userByToken[tokenHash]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return user, nil
}
func (f *fakeSessions) DeleteSession(context.Context, string) error { return nil }
func (f *fakeSessions) DeleteUserSessions(_ context.Context, userID int64) error {
	f.deletedAll = userID
	return nil
}
func (f *fakeSessions) DeleteExpiredSessions(context.Context, time.Time) error { return nil }

type fakeResets struct {
	userID int64
	hash   string
}

func (f *fakeResets) CreatePasswordReset(_ context.Context, userID int64, tokenHash string, _ time.Time) error {
	f.userID = userID
	f.hash = tokenHash
	return nil
}
func (f *fakeResets) ConsumePasswordReset(_ context.Context, tokenHash string, _ time.Time) (int64, error) {
	if tokenHash != f.hash {
		return 0, domain.ErrInvalidResetToken
	}
	return f.userID, nil
}

func testService(t *testing.T) (*Service, *fakeUsers, *fakeSessions, *fakeResets) {
	t.Helper()
	users := &fakeUsers{users: map[string]domain.User{}, byID: map[int64]domain.User{}}
	sessions := &fakeSessions{userByToken: map[string]domain.User{}}
	resets := &fakeResets{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewService(users, sessions, resets, time.Hour, time.Hour, 4, true, logger), users, sessions, resets
}

func TestSignUpAndLoginFlow(t *testing.T) {
	service, users, sessions, _ := testService(t)
	ctx := context.Background()

	session, err := service.SignUp(ctx, " User@Example.com ", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if session.User.Email != "user@example.com" || session.Token == "" {
		t.Fatalf("注册返回错误：%+v", session)
	}
	if sessions.created != 1 || sessions.tokenHash != HashToken(session.Token) {
		t.Fatalf("会话未保存散列：%+v", sessions)
	}
	stored, _ := users.FindUserByEmail(ctx, "user@example.com")
	sessions.userByToken[HashToken(session.Token)] = stored

	authUser, err := service.Authenticate(ctx, session.Token)
	if err != nil || authUser.ID != stored.ID {
		t.Fatalf("会话验证失败：%+v %v", authUser, err)
	}

	login, err := service.Login(ctx, "USER@example.com", "password123")
	if err != nil || login.User.ID != stored.ID {
		t.Fatalf("登录失败：%+v %v", login, err)
	}
	if _, err := service.Login(ctx, "user@example.com", "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("错误密码应返回 ErrInvalidCredentials，得到 %v", err)
	}
	if _, err := service.Login(ctx, "missing@example.com", "password123"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("不存在邮箱应返回 ErrInvalidCredentials，得到 %v", err)
	}
}

func TestSignUpDisabledAndDuplicateEmail(t *testing.T) {
	service, _, _, _ := testService(t)
	service.allowSignup = false
	if _, err := service.SignUp(context.Background(), "a@example.com", "password123"); !errors.Is(err, ErrSignupDisabled) {
		t.Fatalf("关闭注册应拒绝，得到 %v", err)
	}

	service, _, _, _ = testService(t)
	if _, err := service.SignUp(context.Background(), "a@example.com", "password123"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SignUp(context.Background(), "A@example.com", "password123"); !errors.Is(err, domain.ErrEmailTaken) {
		t.Fatalf("重复邮箱应返回 ErrEmailTaken，得到 %v", err)
	}
}

func TestPasswordResetRevokesSessions(t *testing.T) {
	service, users, sessions, resets := testService(t)
	ctx := context.Background()
	session, err := service.SignUp(ctx, "user@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}

	token, user, found, err := service.CreatePasswordReset(ctx, "user@example.com")
	if err != nil || !found || user.ID != session.User.ID {
		t.Fatalf("创建重置令牌失败：%v %v", found, err)
	}
	if resets.hash != HashToken(token) {
		t.Fatal("重置令牌应只保存散列")
	}

	if err := service.ResetPassword(ctx, token, "new-password-123"); err != nil {
		t.Fatal(err)
	}
	if sessions.deletedAll != session.User.ID {
		t.Fatal("重置密码后应撤销该用户全部会话")
	}
	updated, _ := users.FindUserByID(ctx, session.User.ID)
	if !VerifyPassword(updated.PasswordHash, "new-password-123") {
		t.Fatal("新密码未写入")
	}
	if err := service.ResetPassword(ctx, "invalid-token", "another-password"); !errors.Is(err, domain.ErrInvalidResetToken) {
		t.Fatalf("无效令牌应被拒绝，得到 %v", err)
	}
	if _, _, found, _ := service.CreatePasswordReset(ctx, "missing@example.com"); found {
		t.Fatal("不存在的邮箱不应返回重置令牌")
	}
}
