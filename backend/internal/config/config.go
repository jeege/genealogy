// Package config 从环境变量读取运行时配置，并在启动时完成校验。
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/yunfengsa/pure-genealogy/backend/internal/auth"
)

// SMTPConfig 是可选的重置密码邮件发送配置。留空时重置链接会写入服务端日志。
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
}

func (c SMTPConfig) Enabled() bool { return c.Host != "" }

// Config 是 API 服务的全部运行时配置。
type Config struct {
	DatabaseURL   string
	FamilySurname string
	Host          string
	Port          int
	AppOrigin     string
	// AppOrigins 是允许的浏览器来源集合，来自 APP_ORIGIN 的逗号分隔列表。
	AppOrigins       []string
	PublicBaseURL    string
	SessionTTL       time.Duration
	PasswordResetTTL time.Duration
	BcryptCost       int
	AllowSignup      bool
	AutoMigrate      bool
	CookieSecure     string
	AdminEmail       string
	AdminPassword    string
	SMTP             SMTPConfig
	LogLevel         slog.Level
}

type env map[string]string

func (e env) get(key string) string { return strings.TrimSpace(e[key]) }

// Load 读取当前进程环境。
func Load() (Config, error) { return LoadFrom(os.Environ()) }

// LoadFrom 便于测试：接受 KEY=VALUE 列表。
func LoadFrom(environ []string) (Config, error) {
	e := env{}
	for _, item := range environ {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		e[key] = value
	}

	cfg := Config{
		DatabaseURL:      e.get("DATABASE_URL"),
		FamilySurname:    "刘",
		Host:             "127.0.0.1",
		Port:             8080,
		SessionTTL:       720 * time.Hour,
		BcryptCost:       12,
		AllowSignup:      true,
		AutoMigrate:      true,
		CookieSecure:     "auto",
		PasswordResetTTL: time.Hour,
		LogLevel:         slog.LevelInfo,
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("缺少 DATABASE_URL（PostgreSQL 连接字符串）")
	}
	if err := validateDatabaseURL(cfg.DatabaseURL); err != nil {
		return Config{}, err
	}

	surname := e.get("FAMILY_SURNAME")
	if surname == "" {
		surname = e.get("NEXT_PUBLIC_FAMILY_SURNAME")
	}
	if surname != "" {
		if strings.ContainsAny(surname, "\r\n\t") || utf8.RuneCountInString(surname) > 50 {
			return Config{}, errors.New("FAMILY_SURNAME 不能包含控制字符且不能超过 50 个字符")
		}
		cfg.FamilySurname = surname
	}

	if raw := e.get("API_HOST"); raw != "" {
		if strings.ContainsAny(raw, " \t\r\n/") {
			return Config{}, errors.New("API_HOST 不能包含空白或路径分隔符")
		}
		cfg.Host = raw
	}
	if raw := e.get("API_PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return Config{}, errors.New("API_PORT 必须是 1-65535 之间的整数")
		}
		cfg.Port = port
	}

	if raw := e.get("APP_ORIGIN"); raw != "" {
		for _, item := range strings.Split(raw, ",") {
			if strings.TrimSpace(item) == "" {
				continue
			}
			origin, err := normalizeOrigin(item, "APP_ORIGIN")
			if err != nil {
				return Config{}, err
			}
			if cfg.AppOrigin == "" {
				cfg.AppOrigin = origin
			}
			cfg.AppOrigins = append(cfg.AppOrigins, origin)
		}
	}
	cfg.PublicBaseURL = cfg.AppOrigin
	if raw := e.get("PUBLIC_BASE_URL"); raw != "" {
		origin, err := normalizeOrigin(raw, "PUBLIC_BASE_URL")
		if err != nil {
			return Config{}, err
		}
		cfg.PublicBaseURL = origin
	}
	if cfg.PublicBaseURL == "" {
		cfg.PublicBaseURL = "http://localhost:3000"
	}

	if raw := e.get("SESSION_TTL"); raw != "" {
		ttl, err := time.ParseDuration(raw)
		if err != nil || ttl < time.Hour || ttl > 365*24*time.Hour {
			return Config{}, errors.New("SESSION_TTL 必须是 1h 到 8760h 之间的 Go duration，例如 720h")
		}
		cfg.SessionTTL = ttl
	}
	if raw := e.get("PASSWORD_RESET_TTL"); raw != "" {
		ttl, err := time.ParseDuration(raw)
		if err != nil || ttl < 5*time.Minute || ttl > 24*time.Hour {
			return Config{}, errors.New("PASSWORD_RESET_TTL 必须是 5m 到 24h 之间的 Go duration，例如 1h")
		}
		cfg.PasswordResetTTL = ttl
	}
	if raw := e.get("BCRYPT_COST"); raw != "" {
		cost, err := strconv.Atoi(raw)
		if err != nil || cost < 4 || cost > 15 {
			return Config{}, errors.New("BCRYPT_COST 必须是 4-15 之间的整数")
		}
		cfg.BcryptCost = cost
	}

	cfg.AllowSignup = e.get("ALLOW_SIGNUP") != "false"
	cfg.AutoMigrate = e.get("AUTO_MIGRATE") != "false"
	if raw := e.get("COOKIE_SECURE"); raw != "" {
		raw = strings.ToLower(raw)
		if raw != "auto" && raw != "true" && raw != "false" {
			return Config{}, errors.New("COOKIE_SECURE 只能是 auto、true 或 false")
		}
		cfg.CookieSecure = raw
	}

	cfg.AdminEmail = e.get("ADMIN_EMAIL")
	cfg.AdminPassword = e.get("ADMIN_PASSWORD")
	if (cfg.AdminEmail == "") != (cfg.AdminPassword == "") {
		return Config{}, errors.New("ADMIN_EMAIL 与 ADMIN_PASSWORD 必须同时设置或同时留空")
	}
	if cfg.AdminEmail != "" {
		if _, err := auth.NormalizeEmail(cfg.AdminEmail); err != nil {
			return Config{}, errors.New("ADMIN_EMAIL 不是有效邮箱")
		}
		if err := auth.ValidatePassword(cfg.AdminPassword); err != nil {
			return Config{}, fmt.Errorf("ADMIN_PASSWORD 无效：%w", err)
		}
	}

	cfg.SMTP = SMTPConfig{
		Host:     e.get("SMTP_HOST"),
		Port:     587,
		Username: e.get("SMTP_USER"),
		Password: e.get("SMTP_PASS"),
		From:     e.get("SMTP_FROM"),
	}
	if raw := e.get("SMTP_PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return Config{}, errors.New("SMTP_PORT 必须是 1-65535 之间的整数")
		}
		cfg.SMTP.Port = port
	}
	if cfg.SMTP.Enabled() && cfg.SMTP.From == "" {
		cfg.SMTP.From = cfg.SMTP.Username
	}
	if cfg.SMTP.Enabled() && cfg.SMTP.From == "" {
		return Config{}, errors.New("配置 SMTP_HOST 时必须同时设置 SMTP_FROM 或 SMTP_USER")
	}

	switch strings.ToLower(e.get("LOG_LEVEL")) {
	case "", "info":
		cfg.LogLevel = slog.LevelInfo
	case "debug":
		cfg.LogLevel = slog.LevelDebug
	case "warn", "warning":
		cfg.LogLevel = slog.LevelWarn
	case "error":
		cfg.LogLevel = slog.LevelError
	default:
		return Config{}, errors.New("LOG_LEVEL 只能是 debug、info、warn 或 error")
	}

	return cfg, nil
}

func validateDatabaseURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return errors.New("DATABASE_URL 不是有效的 URL")
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return errors.New("DATABASE_URL 必须使用 postgres:// 或 postgresql://")
	}
	if parsed.Host == "" || parsed.Path == "" || parsed.Path == "/" {
		return errors.New("DATABASE_URL 必须包含数据库主机和数据库名")
	}
	return nil
}

func normalizeOrigin(raw, name string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("%s 不是有效的 HTTP(S) 地址", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%s 必须使用 http:// 或 https://", name)
	}
	if parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s 不能包含凭据、查询参数或片段", name)
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", fmt.Errorf("%s 只能填写站点源地址，不能包含路径", name)
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}
