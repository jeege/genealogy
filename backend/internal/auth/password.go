package auth

import (
	"errors"
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
	// MaxUsernameBytes 是用户名的字节上限，仅用于防止异常长度的输入。
	// 用户名不限制字符集：中文、空格、符号、邮箱样式都可以作为登录名。
	MaxUsernameBytes = 256
)

var (
	ErrInvalidUsername = errors.New("请输入用户名")
	ErrUsernameTooLong = errors.New("用户名过长")
	ErrWeakPassword    = errors.New("密码至少需要 8 个字符")
	ErrPasswordTooLong = errors.New("密码不能超过 72 个字节")
)

// NormalizeUsername 去除首尾空白并做大小写归一化（转小写）。
//
// 用户名不限制字符集，可以包含中文、空格、符号，也允许邮箱样式的用户名；
// 仅拒绝空、超长以及控制字符，避免日志注入与异常输入。
func NormalizeUsername(value string) (string, error) {
	username := strings.ToLower(strings.TrimSpace(value))
	if username == "" {
		return "", ErrInvalidUsername
	}
	if len(username) > MaxUsernameBytes {
		return "", ErrUsernameTooLong
	}
	for _, r := range username {
		if unicode.IsControl(r) {
			return "", ErrInvalidUsername
		}
	}
	return username, nil
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

// VerifyPassword 校验明文密码与散列是否匹配。
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
