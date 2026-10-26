package auth

import (
	"strings"
	"testing"
)

func TestNormalizeEmail(t *testing.T) {
	for _, input := range []string{" User@Example.COM ", "a.b+tag@example.com"} {
		normalized, err := NormalizeEmail(input)
		if err != nil {
			t.Fatalf("NormalizeEmail(%q) 返回错误：%v", input, err)
		}
		if normalized != strings.ToLower(strings.TrimSpace(input)) {
			t.Fatalf("NormalizeEmail(%q) = %q", input, normalized)
		}
	}
	for _, input := range []string{"", "not-an-email", "Name <a@example.com>", "a b@example.com", "a@example.com\nBcc: x@y.z"} {
		if _, err := NormalizeEmail(input); err == nil {
			t.Fatalf("NormalizeEmail(%q) 应返回错误", input)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	if err := ValidatePassword("12345678"); err != nil {
		t.Fatalf("8 位密码应有效：%v", err)
	}
	if err := ValidatePassword("短密码"); err == nil {
		t.Fatal("过短密码应被拒绝")
	}
	if err := ValidatePassword(strings.Repeat("a", 73)); err == nil {
		t.Fatal("超过 bcrypt 上限的密码应被拒绝")
	}
}

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse", 4)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, "correct-horse") {
		t.Fatal("正确密码应验证通过")
	}
	if VerifyPassword(hash, "wrong-horse") {
		t.Fatal("错误密码不应验证通过")
	}
}

func TestTokensAreRandomAndHashed(t *testing.T) {
	first, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("令牌应随机生成")
	}
	if len(first) < 32 || HashToken(first) == first || len(HashToken(first)) != 64 {
		t.Fatal("令牌应足够长，且数据库只保存 SHA-256 散列")
	}
	if HashToken(first) != HashToken(first) {
		t.Fatal("令牌散列应稳定")
	}
}
