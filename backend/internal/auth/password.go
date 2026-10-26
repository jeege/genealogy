package auth

import (
	"errors"
	"net/mail"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const (
	// MinPasswordRunes 与 NIST 建议一致，至少 8 个字符。
	MinPasswordRunes = 8
	// MaxPasswordBytes 是 bcrypt 的输入上限，超过会静默截断。
	MaxPasswordBytes = 72
	// MaxEmailLength 是常见邮件系统的安全上限。
	MaxEmailLength = 254
)

var (
	ErrInvalidEmail    = errors.New("请输入有效的邮箱地址")
	ErrWeakPassword    = errors.New("密码至少需要 8 个字符")
	ErrPasswordTooLong = errors.New("密码不能超过 72 个字节")
)

// NormalizeEmail 去除首尾空白并转小写；系统按小写邮箱唯一识别用户。
func NormalizeEmail(value string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(value))
	if email == "" || len(email) > MaxEmailLength {
		return "", ErrInvalidEmail
	}
	if strings.ContainsAny(email, "\r\n\t") {
		return "", ErrInvalidEmail
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Name != "" || parsed.Address != email {
		return "", ErrInvalidEmail
	}
	for _, r := range email {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return "", ErrInvalidEmail
		}
	}
	return email, nil
}

// ValidatePassword 同时限制字符数与 bcrypt 的字节上限。
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < MinPasswordRunes {
		return ErrWeakPassword
	}
	if len(password) > MaxPasswordBytes {
		return ErrPasswordTooLong
	}
	return nil
}

// HashPassword 使用 bcrypt 生成不可逆密码散列。
func HashPassword(password string, cost int) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	if cost < bcrypt.MinCost || cost > bcrypt.MaxCost {
		cost = bcrypt.DefaultCost
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword 使用常量时间比较验证密码。
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
