// Command server 启动族谱后端 API，也提供迁移与账号管理子命令。
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/api"
	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
	"github.com/yunfengsa/pure-genealogy/backend/internal/config"
	"github.com/yunfengsa/pure-genealogy/backend/internal/database"
	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/store"
	"github.com/yunfengsa/pure-genealogy/backend/internal/web"
)

func main() {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	var err error
	switch command {
	case "serve":
		err = runServe()
	case "migrate":
		err = runMigrate()
	case "user":
		err = runUser(os.Args[2:])
	case "healthcheck":
		err = runHealthcheck()
	case "help", "-h", "--help":
		printUsage()
		return
	default:
		err = fmt.Errorf("未知命令 %q", command)
	}
	if err != nil {
		slog.Error("命令执行失败", "error", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, `用法：
  genealogy-server serve                启动 API 服务（默认）
  genealogy-server migrate              执行数据库迁移
  genealogy-server user create --username <用户名> [--password <密码>]
  genealogy-server user set-password --username <用户名> [--password <密码>]
  genealogy-server healthcheck          检查本机 /api/health

密码优先从 ADMIN_PASSWORD 环境变量读取；也支持从标准输入读取一行。`)
}

func newLogger(level slog.Level) *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

func loadConfig() (config.Config, *slog.Logger, error) {
	cfg, err := config.Load()
	if err != nil {
		logger := newLogger(slog.LevelInfo)
		return config.Config{}, logger, err
	}
	logger := newLogger(cfg.LogLevel)
	slog.SetDefault(logger)
	return cfg, logger, nil
}

func openDatabase(ctx context.Context, cfg config.Config, logger *slog.Logger) (*database.Database, error) {
	var lastErr error
	for attempt := 1; attempt <= 20; attempt++ {
		db, err := database.Open(ctx, cfg.DatabaseURL)
		if err == nil {
			return db, nil
		}
		lastErr = err
		logger.Warn("连接数据库失败，稍后重试", "attempt", attempt, "max", 20, "error", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, fmt.Errorf("数据库在重试后仍不可用：%w", lastErr)
}

func runServe() error {
	cfg, logger, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	db, err := openDatabase(ctx, cfg, logger)
	if err != nil {
		return err
	}
	defer db.Close()

	if cfg.AutoMigrate {
		if err := db.Migrate(ctx); err != nil {
			return err
		}
		logger.Info("数据库迁移完成")
	}

	repository := store.New(db.Pool)
	authService := auth.NewService(
		repository, repository,
		cfg.SessionTTL, cfg.BcryptCost, cfg.AllowSignup, logger,
	)
	if err := bootstrapAdmin(ctx, cfg, authService, logger); err != nil {
		return err
	}

	httpAPI := api.New(cfg, authService, repository, db, logger)
	staticFS, err := web.EmbeddedFS()
	if err != nil {
		return fmt.Errorf("加载内嵌前端失败：%w", err)
	}
	if _, err := fs.Stat(staticFS, "index.html"); err != nil {
		logger.Warn("前端静态资源未构建，请先执行 npm run build；API 仍可正常使用")
	}
	httpAPI.SetStaticHandler(web.New(staticFS, logger))

	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Handler:           httpAPI.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("API 服务已启动",
			"host", cfg.Host,
			"port", cfg.Port,
			"allow_signup", cfg.AllowSignup,
		)
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		logger.Info("正在停止 API 服务")
		return server.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func bootstrapAdmin(ctx context.Context, cfg config.Config, service *auth.Service, logger *slog.Logger) error {
	if cfg.AdminUsername == "" {
		count, err := service.CountUsers(ctx)
		if err != nil {
			return err
		}
		if count == 0 && !cfg.AllowSignup {
			logger.Warn("当前没有任何账号且关闭了注册，请设置 ADMIN_USERNAME/ADMIN_PASSWORD 或执行 user create 命令")
		}
		return nil
	}
	count, err := service.CountUsers(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		logger.Info("数据库已有账号，跳过初始管理员创建")
		return nil
	}
	user, err := service.CreateUser(ctx, cfg.AdminUsername, cfg.AdminPassword)
	if err != nil {
		if errors.Is(err, domain.ErrUsernameTaken) {
			logger.Info("初始管理员已由其他实例创建")
			return nil
		}
		return fmt.Errorf("创建初始管理员失败：%w", err)
	}
	logger.Info("已创建初始管理员账号", "username", user.Username)
	return nil
}

func runMigrate() error {
	cfg, logger, err := loadConfig()
	if err != nil {
		return err
	}
	db, err := openDatabase(context.Background(), cfg, logger)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Migrate(context.Background()); err != nil {
		return err
	}
	logger.Info("数据库迁移完成")
	return nil
}

func runUser(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("缺少 user 子命令（create 或 set-password）")
	}
	action := args[0]
	if action != "create" && action != "set-password" {
		return fmt.Errorf("未知 user 子命令 %q", action)
	}
	flags := flag.NewFlagSet("user "+action, flag.ContinueOnError)
	username := flags.String("username", "", "账号用户名（不限制字符，可用中文）")
	password := flags.String("password", "", "账号密码（建议改用 ADMIN_PASSWORD 或标准输入）")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *username == "" {
		return fmt.Errorf("缺少 --username")
	}
	normalizedUsername, err := auth.NormalizeUsername(*username)
	if err != nil {
		return err
	}
	secret, err := readPassword(*password)
	if err != nil {
		return err
	}
	if err := auth.ValidatePassword(secret); err != nil {
		return err
	}
	hash, err := auth.HashPassword(secret, 12)
	if err != nil {
		return err
	}

	cfg, logger, err := loadConfig()
	if err != nil {
		return err
	}
	db, err := openDatabase(context.Background(), cfg, logger)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Migrate(context.Background()); err != nil {
		return err
	}
	repository := store.New(db.Pool)

	switch action {
	case "create":
		user, err := repository.CreateUser(context.Background(), normalizedUsername, hash)
		if err != nil {
			if errors.Is(err, domain.ErrUsernameTaken) {
				return fmt.Errorf("用户名 %s 已存在，如需修改密码请使用 user set-password", normalizedUsername)
			}
			return err
		}
		fmt.Printf("已创建账号：%s（ID %d）\n", user.Username, user.ID)
	case "set-password":
		user, err := repository.FindUserByUsername(context.Background(), normalizedUsername)
		if err != nil {
			return fmt.Errorf("账号不存在：%s", normalizedUsername)
		}
		if err := repository.UpdatePassword(context.Background(), user.ID, hash); err != nil {
			return err
		}
		if err := repository.DeleteUserSessions(context.Background(), user.ID); err != nil {
			return err
		}
		fmt.Printf("已更新密码并撤销旧会话：%s\n", user.Username)
	default:
		return fmt.Errorf("未知 user 子命令 %q", action)
	}
	return nil
}

func readPassword(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	if value := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD")); value != "" {
		return value, nil
	}
	info, err := os.Stdin.Stat()
	if err == nil && info.Mode()&os.ModeCharDevice == 0 {
		reader := bufio.NewReader(os.Stdin)
		line, err := reader.ReadString('\n')
		if err != nil && line == "" {
			return "", fmt.Errorf("无法读取密码：%w", err)
		}
		return strings.TrimSpace(line), nil
	}
	return "", fmt.Errorf("缺少密码：请设置 ADMIN_PASSWORD、使用 --password 或通过标准输入传入")
}

func runHealthcheck() error {
	port := strings.TrimSpace(os.Getenv("API_PORT"))
	if port == "" {
		port = "8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("健康检查返回 HTTP %d", response.StatusCode)
	}
	return nil
}
