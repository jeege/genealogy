package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
)

type fakeUsers struct {
	users map[string]domain.User
	byID  map[int64]domain.User
}

func (f *fakeUsers) CountUsers(context.Context) (int64, error) { return int64(len(f.users)), nil }
func (f *fakeUsers) CreateUser(_ context.Context, username, hash string) (domain.User, error) {
	if f.users == nil {
		f.users = map[string]domain.User{}
		f.byID = map[int64]domain.User{}
	}
	if _, exists := f.users[username]; exists {
		return domain.User{}, domain.ErrUsernameTaken
	}
	user := domain.User{ID: int64(len(f.users) + 1), Username: username, PasswordHash: hash}
	f.users[username] = user
	f.byID[user.ID] = user
	return user, nil
}
func (f *fakeUsers) FindUserByUsername(_ context.Context, username string) (domain.User, error) {
	user, ok := f.users[username]
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
	for username, existing := range f.users {
		if existing.ID == id {
			f.users[username] = user
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

func testService(t *testing.T) (*Service, *fakeUsers, *fakeSessions) {
	t.Helper()
	users := &fakeUsers{users: map[string]domain.User{}, byID: map[int64]domain.User{}}
	sessions := &fakeSessions{userByToken: map[string]domain.User{}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewService(users, sessions, time.Hour, 4, true, logger), users, sessions
}

func TestSignUpAndLoginFlow(t *testing.T) {
	service, users, sessions := testService(t)
	ctx := context.Background()

	session, err := service.SignUp(ctx, " 张三 ", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if session.User.Username != "张三" || session.Token == "" {
		t.Fatalf("注册返回错误：%+v", session)
	}
	if sessions.created != 1 || sessions.tokenHash != HashToken(session.Token) {
		t.Fatalf("会话未保存散列：%+v", sessions)
	}
	stored, _ := users.FindUserByUsername(ctx, "张三")
	sessions.userByToken[HashToken(session.Token)] = stored

	authUser, err := service.Authenticate(ctx, session.Token)
	if err != nil || authUser.ID != stored.ID {
		t.Fatalf("会话验证失败：%+v %v", authUser, err)
	}

	// 用户名大小写不敏感，且允许中文与空格。
	login, err := service.Login(ctx, " 张三 ", "password123")
	if err != nil || login.User.ID != stored.ID {
		t.Fatalf("登录失败：%+v %v", login, err)
	}
	if _, err := service.Login(ctx, "张三", "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("错误密码应返回 ErrInvalidCredentials，得到 %v", err)
	}
	if _, err := service.Login(ctx, "missing-user", "password123"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("不存在用户应返回 ErrInvalidCredentials，得到 %v", err)
	}
}

func TestSignUpDisabledAndDuplicateUsername(t *testing.T) {
	service, _, _ := testService(t)
	service.allowSignup = false
	if _, err := service.SignUp(context.Background(), "alice", "password123"); !errors.Is(err, ErrSignupDisabled) {
		t.Fatalf("关闭注册应拒绝，得到 %v", err)
	}

	service, _, _ = testService(t)
	if _, err := service.SignUp(context.Background(), "alice", "password123"); err != nil {
		t.Fatal(err)
	}
	// 大小写归一化后视为同一账号。
	if _, err := service.SignUp(context.Background(), " ALICE ", "password123"); !errors.Is(err, domain.ErrUsernameTaken) {
		t.Fatalf("重复用户名应返回 ErrUsernameTaken，得到 %v", err)
	}
}

func TestUsernamesAreNotRestrictedToEmail(t *testing.T) {
	// 用户名允许中文、空格、符号与邮箱样式，不要求是合法邮箱。
	allowed := []string{"张三", "李 四", "user@example.com", "user+tag", "王五/六", "🐉龙"}
	for _, username := range allowed {
		normalized, err := NormalizeUsername(username)
		if err != nil {
			t.Fatalf("用户名 %q 应被接受：%v", username, err)
		}
		if normalized == "" {
			t.Fatalf("用户名 %q 归一化后为空", username)
		}
	}

	// 仅拒绝空、超长与控制字符。
	rejected := []string{"", "   ", strings.Repeat("a", MaxUsernameBytes+1), "bad\x00name"}
	for _, username := range rejected {
		if _, err := NormalizeUsername(username); err == nil {
			t.Fatalf("用户名 %q 应被拒绝", username)
		}
	}
}

func TestChangePasswordVerifiesCurrentPassword(t *testing.T) {
	service, users, sessions := testService(t)
	ctx := context.Background()
	session, err := service.SignUp(ctx, "张三", "password123")
	if err != nil {
		t.Fatal(err)
	}

	if err := service.ChangePassword(ctx, session.User.ID, "wrong-password", "new-password-123"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("当前密码错误应返回 ErrInvalidCredentials，得到 %v", err)
	}
	if err := service.ChangePassword(ctx, session.User.ID, "password123", "new-password-123"); err != nil {
		t.Fatal(err)
	}
	updated, _ := users.FindUserByID(ctx, session.User.ID)
	if !VerifyPassword(updated.PasswordHash, "new-password-123") {
		t.Fatal("新密码未写入")
	}
	_ = sessions
}
