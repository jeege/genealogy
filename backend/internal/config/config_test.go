package config

import (
	"strings"
	"testing"
	"time"
)

func baseEnv() []string {
	return []string{
		"DATABASE_URL=postgres://genealogy:secret@127.0.0.1:5432/genealogy?sslmode=disable",
	}
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := LoadFrom(baseEnv())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 8080 || cfg.SessionTTL != 720*time.Hour || cfg.BcryptCost != 12 || cfg.FamilySurname != "刘" {
		t.Fatalf("默认值错误：%+v", cfg)
	}
	if !cfg.AllowSignup || !cfg.AutoMigrate || cfg.CookieSecure != "auto" {
		t.Fatalf("开关默认值错误：%+v", cfg)
	}
}

func TestLoadOverridesAndValidation(t *testing.T) {
	env := append(baseEnv(),
		"API_PORT=9090",
		"API_HOST=0.0.0.0",
		"APP_ORIGIN=https://genealogy.example.com/",
		"SESSION_TTL=24h",
		"BCRYPT_COST=10",
		"ALLOW_SIGNUP=false",
		"AUTO_MIGRATE=false",
		"COOKIE_SECURE=true",
		"FAMILY_SURNAME=李",
		"ADMIN_USERNAME=admin",
		"ADMIN_PASSWORD=strong-password",
	)
	cfg, err := LoadFrom(env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 9090 || cfg.Host != "0.0.0.0" || cfg.AppOrigin != "https://genealogy.example.com" ||
		cfg.SessionTTL != 24*time.Hour {
		t.Fatalf("覆盖值错误：%+v", cfg)
	}
	if cfg.AllowSignup || cfg.AutoMigrate || cfg.CookieSecure != "true" || cfg.FamilySurname != "李" {
		t.Fatalf("开关覆盖错误：%+v", cfg)
	}
}

func TestLoadRejectsUnsafeOrIncompleteConfig(t *testing.T) {
	cases := []struct {
		name string
		env  []string
		want string
	}{
		{"缺少数据库", nil, "DATABASE_URL"},
		{"非 PostgreSQL", []string{"DATABASE_URL=mysql://u:p@localhost/db"}, "postgres://"},
		{"数据库缺少库名", []string{"DATABASE_URL=postgres://u:p@localhost:5432/"}, "数据库名"},
		{"站点带路径", append(baseEnv(), "APP_ORIGIN=https://example.com/app"), "路径"},
		{"会话过短", append(baseEnv(), "SESSION_TTL=1m"), "SESSION_TTL"},
		{"密码散列成本越界", append(baseEnv(), "BCRYPT_COST=2"), "BCRYPT_COST"},
		{"Cookie 开关非法", append(baseEnv(), "COOKIE_SECURE=yes"), "COOKIE_SECURE"},
		{"管理员配置不完整", append(baseEnv(), "ADMIN_USERNAME=admin"), "同时"},
		{"管理员密码过短", append(baseEnv(), "ADMIN_USERNAME=admin", "ADMIN_PASSWORD=short"), "ADMIN_PASSWORD"},
		{"管理员用户名过长", append(baseEnv(), "ADMIN_USERNAME="+strings.Repeat("a", 257), "ADMIN_PASSWORD=strong-password"), "ADMIN_USERNAME"},
		{"日志级别非法", append(baseEnv(), "LOG_LEVEL=verbose"), "LOG_LEVEL"},
		{"姓氏过长", append(baseEnv(), "FAMILY_SURNAME="+strings.Repeat("刘", 51)), "FAMILY_SURNAME"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := LoadFrom(testCase.env)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("期望包含 %q 的错误，得到 %v", testCase.want, err)
			}
		})
	}
}

func TestMultipleAppOrigins(t *testing.T) {
	cfg, err := LoadFrom(append(baseEnv(), "APP_ORIGIN=http://localhost:3000, http://127.0.0.1:3000"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.AppOrigins) != 2 {
		t.Fatalf("应解析出两个来源：%v", cfg.AppOrigins)
	}
	if cfg.AppOrigin != "http://localhost:3000" {
		t.Fatalf("首个来源用于生成重置链接：%s", cfg.AppOrigin)
	}
	if cfg.AppOrigins[1] != "http://127.0.0.1:3000" {
		t.Fatalf("第二个来源解析错误：%v", cfg.AppOrigins)
	}

	// 任一项非法都应整体拒绝，避免配置被静默忽略。
	if _, err := LoadFrom(append(baseEnv(), "APP_ORIGIN=http://localhost:3000,postgres://db")); err == nil {
		t.Fatal("非法来源应报错")
	}
}
